const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction, checkHealth, pool } = require('../../backend/shared/db');
const { queueOutboxEvent } = require('../../backend/shared/outboxPublisher');
const { eventBus } = require('../../backend/shared/eventBus');

describe('PostgreSQL Persistence Integration Tests', () => {
  it('should successfully ping bankproject PostgreSQL database', async () => {
    const health = await checkHealth();
    assert.strictEqual(health.status, 'UP');
    assert.strictEqual(health.database.toLowerCase(), 'bankproject');
    assert.ok(health.latencyMs >= 0);
  });

  it('should perform parameterized query without SQL injection risk', async () => {
    const testId = uuidv4();
    const corrId = `corr-${Date.now()}`;

    await query(
      `INSERT INTO workflows (workflow_id, correlation_id, workflow_type, current_step, status, input_payload)
       VALUES ($1, $2, 'test_workflow', 'step_1', 'PENDING', $3)`,
      [testId, corrId, JSON.stringify({ key: "safe' OR '1'='1" })]
    );

    const selectRes = await query('SELECT * FROM workflows WHERE workflow_id = $1', [testId]);
    assert.strictEqual(selectRes.rows.length, 1);
    assert.strictEqual(selectRes.rows[0].workflow_id, testId);
    assert.strictEqual(selectRes.rows[0].input_payload.key, "safe' OR '1'='1");

    // Clean up test row
    await query('DELETE FROM workflows WHERE workflow_id = $1', [testId]);
  });

  it('should rollback database transaction on error', async () => {
    const testId = uuidv4();

    await assert.rejects(async () => {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO workflows (workflow_id, correlation_id, workflow_type, current_step, status, input_payload)
           VALUES ($1, 'corr-rollback', 'test_type', 'step_1', 'PENDING', '{}')`,
          [testId]
        );
        throw new Error('Simulated failure during transaction');
      });
    });

    const checkRes = await query('SELECT * FROM workflows WHERE workflow_id = $1', [testId]);
    assert.strictEqual(checkRes.rows.length, 0, 'Workflow record should have been rolled back');
  });

  it('should insert outbox event within transaction', async () => {
    const testId = uuidv4();
    const corrId = `corr-outbox-${Date.now()}`;

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO workflows (workflow_id, correlation_id, workflow_type, current_step, status, input_payload)
         VALUES ($1, $2, 'outbox_test', 'step_1', 'PENDING', '{}')`,
        [testId, corrId]
      );

      const outboxRecord = await queueOutboxEvent(client, {
        workflowId: testId,
        correlationId: corrId,
        topic: 'verification.start',
        eventType: 'START_VERIFICATION',
        payload: { test: true },
      });

      assert.ok(outboxRecord.outbox_id);
      assert.strictEqual(outboxRecord.status, 'PENDING');
    });

    const outboxCheck = await query('SELECT * FROM outbox_events WHERE workflow_id = $1', [testId]);
    assert.strictEqual(outboxCheck.rows.length, 1);
    assert.strictEqual(outboxCheck.rows[0].status, 'PENDING');

    // Clean up
    await query('DELETE FROM workflows WHERE workflow_id = $1', [testId]);
  });

  after(async () => {
    await eventBus.disconnect();
    await pool.end();
  });
});
