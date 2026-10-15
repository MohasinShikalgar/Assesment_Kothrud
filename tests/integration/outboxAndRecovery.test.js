const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');

const { query, withTransaction } = require('../../backend/shared/db');
const { queueOutboxEvent, pollAndPublishPendingEvents } = require('../../backend/shared/outboxPublisher');
const { recoveryService } = require('../../backend/orchestrator-service/src/services/recoveryService');
const { sagaOrchestrator } = require('../../backend/orchestrator-service/src/services/sagaOrchestrator');
const { WORKFLOW_STATUS, STEP_STATUS } = require('../../backend/shared/eventTypes');

describe('Transactional Outbox & Orchestrator Restart Recovery Tests', () => {
  it('should deliver pending outbox events and mark them PUBLISHED', async () => {
    const wfId = uuidv4();
    const corrId = `corr-outbox-${Date.now()}`;

    // 1. Create workflow and outbox event
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO workflows (workflow_id, correlation_id, workflow_type, current_step, status, input_payload)
         VALUES ($1, $2, 'kyc_approval_pipeline', 'verify_identity', 'PENDING', '{}')`,
        [wfId, corrId]
      );

      await queueOutboxEvent(client, {
        workflowId: wfId,
        correlationId: corrId,
        topic: 'verification.start',
        eventType: 'START_VERIFICATION',
        payload: { customer: 'Outbox Test' },
      });
    });

    // 2. Verify PENDING in PostgreSQL
    const pendingCheck = await query('SELECT status FROM outbox_events WHERE workflow_id = $1', [wfId]);
    assert.strictEqual(pendingCheck.rows[0].status, 'PENDING');

    // 3. Trigger Outbox Publisher poll batch
    const processed = await pollAndPublishPendingEvents(10);
    assert.ok(processed >= 1, 'At least 1 outbox event should have been published');

    // 4. Verify PUBLISHED in PostgreSQL
    const publishedCheck = await query('SELECT status, published_at FROM outbox_events WHERE workflow_id = $1', [wfId]);
    assert.strictEqual(publishedCheck.rows[0].status, 'PUBLISHED');
    assert.ok(publishedCheck.rows[0].published_at, 'published_at must be populated');

    // Clean up
    await query('DELETE FROM workflows WHERE workflow_id = $1', [wfId]);
  });

  it('should detect and recover incomplete workflows after orchestrator crash/restart', async () => {
    const orphanWfId = uuidv4();
    const corrId = `corr-crash-${Date.now()}`;

    // Simulate an incomplete workflow that was in progress when orchestrator crashed
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO workflows (workflow_id, correlation_id, workflow_type, current_step, status, input_payload)
         VALUES ($1, $2, 'kyc_approval_pipeline', 'credit_check', $3, '{}')`,
        [orphanWfId, corrId, WORKFLOW_STATUS.CREDIT_CHECK_IN_PROGRESS]
      );

      await client.query(
        `INSERT INTO workflow_steps (workflow_id, step_name, step_order, status)
         VALUES ($1, 'verify_identity', 1, $2),
                ($1, 'credit_check', 2, $3)`,
        [orphanWfId, STEP_STATUS.COMPLETED, STEP_STATUS.IN_PROGRESS]
      );
    });

    // Run startup recovery
    const recoveryResult = await recoveryService.runStartupRecovery();
    assert.ok(recoveryResult.recovered >= 1, 'Recovery should have found at least 1 incomplete workflow');

    const recoveredItem = recoveryResult.workflows.find((w) => w.workflowId === orphanWfId);
    assert.ok(recoveredItem, 'Orphaned workflow should be recovered');
    assert.strictEqual(recoveredItem.previousStatus, WORKFLOW_STATUS.CREDIT_CHECK_IN_PROGRESS);

    // Clean up
    await query('DELETE FROM workflows WHERE workflow_id = $1', [orphanWfId]);
  });

  it('should support administrative idempotent replay from PostgreSQL event store', async () => {
    const replayWfId = uuidv4();
    const corrId = `corr-replay-${Date.now()}`;

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO workflows (workflow_id, correlation_id, workflow_type, current_step, status, input_payload)
         VALUES ($1, $2, 'kyc_approval_pipeline', 'credit_check', $3, '{"customer": "Replay User"}')`,
        [replayWfId, corrId, WORKFLOW_STATUS.FAILED]
      );

      await client.query(
        `INSERT INTO workflow_steps (workflow_id, step_name, step_order, status)
         VALUES ($1, 'verify_identity', 1, $2),
                ($1, 'credit_check', 2, $3)`,
        [replayWfId, STEP_STATUS.COMPLETED, STEP_STATUS.FAILED]
      );
    });

    const replayRes = await sagaOrchestrator.replayWorkflow(replayWfId);
    assert.strictEqual(replayRes.workflowId, replayWfId);
    assert.strictEqual(replayRes.status, WORKFLOW_STATUS.RUNNING);
    assert.strictEqual(replayRes.resumedAtStep, 'credit_check', 'Must resume from the incomplete step, not repeat step 1');

    // Clean up
    await query('DELETE FROM workflows WHERE workflow_id = $1', [replayWfId]);
  });

  after(async () => {
    const { eventBus } = require('../../backend/shared/eventBus');
    const { pool } = require('../../backend/shared/db');
    await eventBus.disconnect();
    await pool.end();
  });
});
