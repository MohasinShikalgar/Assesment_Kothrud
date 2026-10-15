const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');

const { query } = require('../../backend/shared/db');
const { eventBus } = require('../../backend/shared/eventBus');
const { startOutboxWorker, stopOutboxWorker } = require('../../backend/shared/outboxPublisher');
const { initializeVerificationConsumer } = require('../../backend/verification-service/src/services/verificationConsumer');
const { initializeCreditConsumer } = require('../../backend/credit-service/src/services/creditConsumer');
const { initializeOrchestratorConsumer } = require('../../backend/orchestrator-service/src/services/eventConsumer');
const { sagaOrchestrator } = require('../../backend/orchestrator-service/src/services/sagaOrchestrator');
const { WORKFLOW_STATUS, COMPENSATION_STATUS, STEP_STATUS } = require('../../backend/shared/eventTypes');

// Helper to poll workflow until it reaches a terminal status
async function waitForWorkflowStatus(workflowId, terminalStatuses, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await query('SELECT * FROM workflows WHERE workflow_id = $1', [workflowId]);
    if (res.rows.length > 0) {
      const status = res.rows[0].status;
      if (terminalStatuses.includes(status)) {
        return res.rows[0];
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const finalRes = await query('SELECT * FROM workflows WHERE workflow_id = $1', [workflowId]);
  return finalRes.rows[0] || null;
}

describe('Saga Orchestrator End-to-End Integration Tests', () => {
  before(async () => {
    // Initialize consumers and outbox worker for integration testing
    await initializeVerificationConsumer();
    await initializeCreditConsumer();
    await initializeOrchestratorConsumer();
    startOutboxWorker(100);
  });

  after(async () => {
    stopOutboxWorker();
    await eventBus.disconnect();
    const { pool } = require('../../backend/shared/db');
    await pool.end();
  });

  it('Scenario 1: Happy Path - Workflow completes successfully', async () => {
    const submitResult = await sagaOrchestrator.submitWorkflow({
      workflowType: 'kyc_approval_pipeline',
      inputPayload: {
        customerName: 'Integration Test User',
        idNumber: `KYC-${Date.now()}`,
        idType: 'AADHAAR',
        loanAmount: 120000,
        monthlyIncome: 60000,
        creditScore: 780,
      },
    });

    assert.ok(submitResult.workflowId);
    assert.strictEqual(submitResult.status, WORKFLOW_STATUS.VERIFICATION_IN_PROGRESS);

    // Wait for end-to-end completion through Kafka/event bus
    const finalWf = await waitForWorkflowStatus(
      submitResult.workflowId,
      [WORKFLOW_STATUS.COMPLETED, WORKFLOW_STATUS.FAILED],
      6000
    );

    assert.ok(finalWf, 'Workflow record should exist');
    assert.strictEqual(finalWf.status, WORKFLOW_STATUS.COMPLETED, `Workflow should be COMPLETED, got ${finalWf.status}`);
    assert.ok(finalWf.completed_at, 'completed_at timestamp should be set');

    // Verify all steps are marked COMPLETED in PostgreSQL
    const stepsRes = await query(
      'SELECT step_name, status FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC',
      [submitResult.workflowId]
    );
    assert.strictEqual(stepsRes.rows.length, 2);
    assert.strictEqual(stepsRes.rows[0].status, STEP_STATUS.COMPLETED);
    assert.strictEqual(stepsRes.rows[1].status, STEP_STATUS.COMPLETED);

    // Verify event store has append-only audit trail
    const eventsRes = await query(
      'SELECT event_type FROM workflow_events WHERE workflow_id = $1 ORDER BY created_at ASC',
      [submitResult.workflowId]
    );
    const eventTypes = eventsRes.rows.map((r) => r.event_type);
    assert.ok(eventTypes.includes('WORKFLOW_STARTED'));
    assert.ok(eventTypes.includes('VERIFICATION_SUCCESS'));
    assert.ok(eventTypes.includes('CREDIT_APPROVED'));
    assert.ok(eventTypes.includes('WORKFLOW_COMPLETED'));
  });

  it('Scenario 2: Credit Rejection - Triggers verification compensation rollback', async () => {
    const submitResult = await sagaOrchestrator.submitWorkflow({
      workflowType: 'kyc_approval_pipeline',
      inputPayload: {
        customerName: 'Compensation Test User',
        idNumber: `KYC-COMP-${Date.now()}`,
        idType: 'AADHAAR',
        loanAmount: 200000,
        monthlyIncome: 20000,
        creditScore: 520, // Rejection trigger (< 650)
        simulateReject: true,
      },
    });

    assert.ok(submitResult.workflowId);

    // Wait for Saga compensation to complete
    const finalWf = await waitForWorkflowStatus(
      submitResult.workflowId,
      [WORKFLOW_STATUS.COMPENSATED, WORKFLOW_STATUS.FAILED],
      7000
    );

    assert.ok(finalWf, 'Workflow record should exist');
    assert.strictEqual(finalWf.status, WORKFLOW_STATUS.COMPENSATED, `Workflow should be COMPENSATED, got ${finalWf.status}`);
    assert.strictEqual(finalWf.compensation_status, COMPENSATION_STATUS.SUCCESS);

    // Verify verification step was logically rolled back (COMPENSATED)
    const verifStepRes = await query(
      "SELECT status, compensated_at FROM workflow_steps WHERE workflow_id = $1 AND step_name = 'verify_identity'",
      [submitResult.workflowId]
    );
    assert.strictEqual(verifStepRes.rows[0].status, STEP_STATUS.COMPENSATED);
    assert.ok(verifStepRes.rows[0].compensated_at, 'compensated_at timestamp must be recorded');

    // Verify event audit trail contains compensation events
    const eventsRes = await query(
      'SELECT event_type FROM workflow_events WHERE workflow_id = $1 ORDER BY created_at ASC',
      [submitResult.workflowId]
    );
    const eventTypes = eventsRes.rows.map((r) => r.event_type);
    assert.ok(eventTypes.includes('CREDIT_REJECTED'));
    assert.ok(eventTypes.includes('WORKFLOW_COMPENSATED'));
  });

  it('Scenario 3: Verification Failure - Fast-fails without downstream steps', async () => {
    const submitResult = await sagaOrchestrator.submitWorkflow({
      workflowType: 'kyc_approval_pipeline',
      inputPayload: {
        customerName: 'Fail_KYC User',
        idNumber: 'FAIL_KYC',
        idType: 'AADHAAR',
        loanAmount: 50000,
        failVerification: true,
      },
    });

    const finalWf = await waitForWorkflowStatus(
      submitResult.workflowId,
      [WORKFLOW_STATUS.FAILED, WORKFLOW_STATUS.COMPENSATED],
      5000
    );

    assert.strictEqual(finalWf.status, WORKFLOW_STATUS.FAILED);

    // Verify step 2 was NEVER initiated
    const creditStepRes = await query(
      "SELECT * FROM workflow_steps WHERE workflow_id = $1 AND step_name = 'credit_check'",
      [submitResult.workflowId]
    );
    assert.strictEqual(creditStepRes.rows.length, 0, 'Credit step should not be created if KYC fails');
  });

  it('Scenario 4: Idempotency Key deduplication prevents duplicate execution', async () => {
    const fixedKey = `idem-test-${Date.now()}`;

    const firstRun = await sagaOrchestrator.submitWorkflow({
      workflowType: 'kyc_approval_pipeline',
      inputPayload: { customerName: 'Duplicate Test', idNumber: 'KYC-DUP', loanAmount: 100000 },
      idempotencyKey: fixedKey,
    });

    assert.ok(firstRun.workflowId);
    assert.strictEqual(firstRun.idempotentReplay, undefined);

    // Second run with identical key
    const secondRun = await sagaOrchestrator.submitWorkflow({
      workflowType: 'kyc_approval_pipeline',
      inputPayload: { customerName: 'Duplicate Test', idNumber: 'KYC-DUP', loanAmount: 100000 },
      idempotencyKey: fixedKey,
    });

    assert.strictEqual(secondRun.workflowId, firstRun.workflowId);
    assert.strictEqual(secondRun.idempotentReplay, true, 'Second run must return cached response with idempotentReplay flag');
  });
});
