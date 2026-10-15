const { query, withTransaction } = require('./db');
const { eventBus } = require('./eventBus');
const { createLogger } = require('./logger');
const { metrics } = require('./metrics');

const logger = createLogger('outbox-publisher');

/**
 * Queue an event into PostgreSQL outbox_events within an ongoing transaction client
 */
async function queueOutboxEvent(dbClient, {
  workflowId,
  correlationId,
  topic,
  eventKey,
  eventType,
  payload,
}) {
  const sql = `
    INSERT INTO outbox_events (
      workflow_id, correlation_id, topic, event_key, event_type, payload, status, scheduled_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW())
    RETURNING outbox_id, status, created_at;
  `;
  const values = [workflowId, correlationId, topic, eventKey || workflowId, eventType, JSON.stringify(payload)];
  const result = await dbClient.query(sql, values);
  return result.rows[0];
}

/**
 * Poll and publish pending outbox events
 * Locks records using FOR UPDATE SKIP LOCKED to support multi-worker concurrency without collision!
 */
async function pollAndPublishPendingEvents(batchSize = 25) {
  let processedCount = 0;

  try {
    // Check pending count for metrics
    const countRes = await query(`SELECT COUNT(*) AS pending_count FROM outbox_events WHERE status = 'PENDING'`);
    const pendingCount = parseInt(countRes.rows[0].pending_count, 10);
    metrics.outboxPendingGauge.set(pendingCount);

    if (pendingCount === 0) return 0;

    // Process a batch inside a transaction
    await withTransaction(async (client) => {
      const selectSql = `
        SELECT outbox_id, workflow_id, correlation_id, topic, event_key, event_type, payload, retry_count, max_retries
        FROM outbox_events
        WHERE status = 'PENDING' AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED;
      `;
      const eventsRes = await client.query(selectSql, [batchSize]);

      for (const row of eventsRes.rows) {
        try {
          const envelope = {
            eventId: row.outbox_id,
            workflowId: row.workflow_id,
            correlationId: row.correlation_id,
            eventType: row.event_type,
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            source: 'orchestrator-outbox',
            payload: row.payload,
          };

          // Deliver via event bus to Kafka
          await eventBus.publish(row.topic, envelope);

          // Mark PUBLISHED
          await client.query(`
            UPDATE outbox_events
            SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
            WHERE outbox_id = $1
          `, [row.outbox_id]);

          processedCount++;
        } catch (pubErr) {
          logger.error(`[Outbox] Error publishing event ${row.outbox_id}: ${pubErr.message}`);
          const newRetryCount = row.retry_count + 1;
          const isFailed = newRetryCount >= row.max_retries;
          const nextDelaySeconds = Math.pow(2, newRetryCount); // Exponential backoff

          await client.query(`
            UPDATE outbox_events
            SET retry_count = $1,
                status = $2,
                error_message = $3,
                scheduled_at = NOW() + ($4 || ' seconds')::INTERVAL
            WHERE outbox_id = $5
          `, [
            newRetryCount,
            isFailed ? 'FAILED' : 'PENDING',
            pubErr.message,
            nextDelaySeconds,
            row.outbox_id
          ]);
        }
      }
    });
  } catch (error) {
    logger.error(`[Outbox] Polling batch execution error: ${error.message}`);
  }

  return processedCount;
}

let outboxWorkerInterval = null;

function startOutboxWorker(intervalMs = 500) {
  if (outboxWorkerInterval) return;

  logger.info(`[Outbox] Starting Transactional Outbox Worker polling every ${intervalMs}ms`);
  outboxWorkerInterval = setInterval(async () => {
    try {
      await pollAndPublishPendingEvents();
    } catch (err) {
      logger.error(`[Outbox Worker] Unexpected poll error: ${err.message}`);
    }
  }, intervalMs);
}

function stopOutboxWorker() {
  if (outboxWorkerInterval) {
    clearInterval(outboxWorkerInterval);
    outboxWorkerInterval = null;
    logger.info('[Outbox] Stopped Transactional Outbox Worker');
  }
}

module.exports = {
  queueOutboxEvent,
  pollAndPublishPendingEvents,
  startOutboxWorker,
  stopOutboxWorker,
};
