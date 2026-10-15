const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../../../shared/db');
const { workflowEngine } = require('../../../shared/workflowEngine');
const { queueOutboxEvent } = require('../../../shared/outboxPublisher');
const { TOPICS, EVENT_TYPES, WORKFLOW_STATUS, STEP_STATUS, COMPENSATION_STATUS } = require('../../../shared/eventTypes');
const { createLogger } = require('../../../shared/logger');
const { metrics } = require('../../../shared/metrics');
const { getCircuitBreaker } = require('../../../shared/circuitBreaker');
const { setCache, getCache, delCache } = require('../../../shared/redisClient');
const { getTracer } = require('../../../shared/tracer');

const logger = createLogger('saga-orchestrator');
const tracer = getTracer('orchestrator-service');
const sagaBreaker = getCircuitBreaker('orchestrator-saga', { failureThreshold: 3, resetTimeoutMs: 10000 });

class SagaOrchestrator {
  /**
   * Submit and initiate a new workflow instance
   */
  async submitWorkflow({ workflowType = 'kyc_approval_pipeline', inputPayload = {}, idempotencyKey = null }) {
    return await sagaBreaker.execute(async () => {
      // 1. Validate workflow definition
      const definition = workflowEngine.getDefinition(workflowType);
      if (!definition) {
        const error = new Error(`Unknown workflow definition '${workflowType}'`);
        error.status = 400;
        throw error;
      }

      // 2. Check Idempotency Key
      if (idempotencyKey) {
        const existingKeyRes = await query(
          'SELECT response_body, workflow_id FROM idempotency_keys WHERE key = $1 AND expires_at > NOW()',
          [idempotencyKey]
        );
        if (existingKeyRes.rows.length > 0) {
          logger.info(`[Saga] Idempotent hit for key: ${idempotencyKey}, returning cached response`);
          return {
            ...existingKeyRes.rows[0].response_body,
            idempotentReplay: true,
          };
        }
      }

      const workflowId = uuidv4();
      const correlationId = inputPayload.correlationId || uuidv4();
      const initialStep = definition.steps.find((s) => s.id === definition.initialStep);

      // Start distributed tracing span
      const traceSpan = tracer.startSpan('workflow.submit', {
        'workflow.id': workflowId,
        'workflow.type': workflowType,
        'correlation.id': correlationId,
      });

      // 3. Atomically persist workflow, initial step, event, and outbox message
      const workflowResponse = await withTransaction(async (client) => {
        // Insert Workflow
        const wfInsertSql = `
          INSERT INTO workflows (
            workflow_id, correlation_id, workflow_type, version, current_step, status, input_payload, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          RETURNING workflow_id, correlation_id, workflow_type, status, current_step, created_at;
        `;
        const wfRes = await client.query(wfInsertSql, [
          workflowId,
          correlationId,
          workflowType,
          definition.version,
          initialStep.id,
          WORKFLOW_STATUS.VERIFICATION_IN_PROGRESS,
          JSON.stringify(inputPayload),
        ]);

        // Insert Initial Step
        const stepInsertSql = `
          INSERT INTO workflow_steps (
            workflow_id, step_name, step_order, status, input_data, started_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
          RETURNING step_id;
        `;
        await client.query(stepInsertSql, [
          workflowId,
          initialStep.id,
          initialStep.order,
          STEP_STATUS.IN_PROGRESS,
          JSON.stringify(inputPayload),
        ]);

        // Insert Append-Only Event
        await client.query(
          `INSERT INTO workflow_events (
            workflow_id, correlation_id, event_type, source_service, target_topic, payload, status, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PROCESSED', NOW())`,
          [
            workflowId,
            correlationId,
            EVENT_TYPES.WORKFLOW_STARTED,
            'orchestrator-service',
            initialStep.startEvent,
            JSON.stringify({ workflowType, initialStep: initialStep.id, inputPayload }),
          ]
        );

        // Queue Transactional Outbox Event to Kafka topic
        await queueOutboxEvent(client, {
          workflowId,
          correlationId,
          topic: initialStep.startEvent,
          eventKey: workflowId,
          eventType: EVENT_TYPES.START_VERIFICATION,
          payload: {
            stepId: initialStep.id,
            ...inputPayload,
          },
        });

        const responseData = {
          workflowId: wfRes.rows[0].workflow_id,
          correlationId: wfRes.rows[0].correlation_id,
          workflowType: wfRes.rows[0].workflow_type,
          status: wfRes.rows[0].status,
          currentStep: wfRes.rows[0].current_step,
          createdAt: wfRes.rows[0].created_at,
          message: 'Workflow successfully submitted and verification initiated',
        };

        // Record Idempotency Key with 24hr expiry
        if (idempotencyKey) {
          await client.query(
            `INSERT INTO idempotency_keys (key, workflow_id, operation_name, response_body, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
             ON CONFLICT (key) DO NOTHING`,
            [idempotencyKey, workflowId, 'submit_workflow', JSON.stringify(responseData)]
          );
        }

        return responseData;
      });

      // Update Prometheus Metrics
      metrics.workflowsTotal.inc({ workflow_type: workflowType, status: 'SUBMITTED' });

      // Cache state in Redis
      await setCache(`workflow:${workflowId}`, workflowResponse, 300);

      traceSpan.addEvent('workflow_persisted');
      traceSpan.end();

      logger.info(`[Saga] Submitted workflow ${workflowId} (${workflowType})`);
      return workflowResponse;
    });
  }

  /**
   * Handle Step Success (e.g. Verification Success or Credit Approval)
   */
  async handleStepSuccess(workflowId, stepId, payloadData = {}) {
    logger.info(`[Saga] Handling step success: workflow=${workflowId}, step=${stepId}`);

    const workflowRes = await query('SELECT * FROM workflows WHERE workflow_id = $1', [workflowId]);
    if (workflowRes.rows.length === 0) {
      logger.error(`[Saga] Workflow not found for step success: ${workflowId}`);
      return;
    }
    const workflow = workflowRes.rows[0];

    // Application-Level Idempotency: Ignore duplicate step completion events
    const stepCheckRes = await query(
      'SELECT status FROM workflow_steps WHERE workflow_id = $1 AND step_name = $2',
      [workflowId, stepId]
    );
    if (stepCheckRes.rows.length > 0 && stepCheckRes.rows[0].status === STEP_STATUS.COMPLETED) {
      logger.info(`[Saga] Step ${stepId} already COMPLETED for workflow ${workflowId}, skipping duplicate.`);
      return;
    }
    if (workflow.status === WORKFLOW_STATUS.COMPLETED || workflow.status === WORKFLOW_STATUS.COMPENSATED) {
      logger.info(`[Saga] Workflow ${workflowId} already in terminal state ${workflow.status}, skipping.`);
      return;
    }

    const definition = workflowEngine.getDefinition(workflow.workflow_type);

    await withTransaction(async (client) => {
      // 1. Mark current step COMPLETED
      await client.query(
        `UPDATE workflow_steps
         SET status = $1, output_data = $2, completed_at = NOW(), updated_at = NOW()
         WHERE workflow_id = $3 AND step_name = $4`,
        [STEP_STATUS.COMPLETED, JSON.stringify(payloadData), workflowId, stepId]
      );

      // 2. Append event to audit log
      await client.query(
        `INSERT INTO workflow_events (
          workflow_id, correlation_id, event_type, source_service, payload, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          workflowId,
          workflow.correlation_id,
          stepId === 'verify_identity' ? EVENT_TYPES.VERIFICATION_SUCCESS : EVENT_TYPES.CREDIT_APPROVED,
          'orchestrator-service',
          JSON.stringify({ stepId, payloadData }),
        ]
      );

      // 3. Determine next step
      const nextStep = workflowEngine.getNextStep(workflow.workflow_type, stepId);

      if (nextStep) {
        // Transition to Next Step
        const nextStatus = nextStep.id === 'credit_check' ? WORKFLOW_STATUS.CREDIT_CHECK_IN_PROGRESS : WORKFLOW_STATUS.RUNNING;

        await client.query(
          `UPDATE workflows
           SET status = $1, current_step = $2, updated_at = NOW()
           WHERE workflow_id = $3`,
          [nextStatus, nextStep.id, workflowId]
        );

        // Insert Next Step row
        await client.query(
          `INSERT INTO workflow_steps (
            workflow_id, step_name, step_order, status, input_data, started_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
          ON CONFLICT DO NOTHING`,
          [
            workflowId,
            nextStep.id,
            nextStep.order,
            STEP_STATUS.IN_PROGRESS,
            JSON.stringify({ ...workflow.input_payload, previousStepResult: payloadData }),
          ]
        );

        // Queue Outbox message for next step
        await queueOutboxEvent(client, {
          workflowId,
          correlationId: workflow.correlation_id,
          topic: nextStep.startEvent,
          eventKey: workflowId,
          eventType: EVENT_TYPES.START_CREDIT_CHECK,
          payload: {
            stepId: nextStep.id,
            ...workflow.input_payload,
            verificationData: payloadData,
          },
        });

        logger.info(`[Saga] Workflow ${workflowId} transitioned to step: ${nextStep.id}`);
      } else {
        // Workflow Reached Terminal Completion!
        const durationSeconds = (Date.now() - new Date(workflow.created_at).getTime()) / 1000;

        await client.query(
          `UPDATE workflows
           SET status = $1, current_step = $2, output_payload = $3, completed_at = NOW(), updated_at = NOW()
           WHERE workflow_id = $4`,
          [
            WORKFLOW_STATUS.COMPLETED,
            definition.completionStep.name,
            JSON.stringify({ finalResult: 'APPROVED', lastStepResult: payloadData }),
            workflowId,
          ]
        );

        await client.query(
          `INSERT INTO workflow_events (
            workflow_id, correlation_id, event_type, source_service, payload, created_at
          ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            workflowId,
            workflow.correlation_id,
            EVENT_TYPES.WORKFLOW_COMPLETED,
            'orchestrator-service',
            JSON.stringify({ durationSeconds, status: 'COMPLETED' }),
          ]
        );

        metrics.workflowsTotal.inc({ workflow_type: workflow.workflow_type, status: 'COMPLETED' });
        metrics.workflowDurationSeconds.observe({ workflow_type: workflow.workflow_type, status: 'COMPLETED' }, durationSeconds);

        logger.info(`[Saga] Workflow ${workflowId} COMPLETED in ${durationSeconds.toFixed(2)}s`);
      }
    });

    await delCache(`workflow:${workflowId}`);
  }

  /**
   * Handle Step Failure or Rejection
   * Triggers Saga compensation for previously completed steps!
   */
  async handleStepFailureOrRejection(workflowId, stepId, reason, isBusinessRejection = true) {
    logger.warn(`[Saga] Handling step failure/rejection: workflow=${workflowId}, step=${stepId}, reason=${reason}`);

    const workflowRes = await query('SELECT * FROM workflows WHERE workflow_id = $1', [workflowId]);
    if (workflowRes.rows.length === 0) return;
    const workflow = workflowRes.rows[0];

    // Ignore if already compensating, compensated, or failed
    if (workflow.status === WORKFLOW_STATUS.COMPENSATED || workflow.status === WORKFLOW_STATUS.FAILED || workflow.status === WORKFLOW_STATUS.COMPENSATING) {
      logger.info(`[Saga] Workflow ${workflowId} already in status ${workflow.status}, ignoring duplicate failure event.`);
      return;
    }

    await withTransaction(async (client) => {
      // 1. Mark step FAILED
      await client.query(
        `UPDATE workflow_steps
         SET status = $1, error_details = $2, updated_at = NOW()
         WHERE workflow_id = $3 AND step_name = $4`,
        [STEP_STATUS.FAILED, JSON.stringify({ reason, isBusinessRejection }), workflowId, stepId]
      );

      // 2. Append event
      await client.query(
        `INSERT INTO workflow_events (
          workflow_id, correlation_id, event_type, source_service, payload, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          workflowId,
          workflow.correlation_id,
          stepId === 'credit_check' ? EVENT_TYPES.CREDIT_REJECTED : EVENT_TYPES.VERIFICATION_FAILED,
          'orchestrator-service',
          JSON.stringify({ stepId, reason, isBusinessRejection }),
        ]
      );

      // 3. Find preceding steps requiring compensation
      const stepsToCompensate = workflowEngine.getStepsToCompensate(workflow.workflow_type, stepId);

      if (stepsToCompensate.length > 0) {
        logger.info(`[Saga:Compensation] Found ${stepsToCompensate.length} steps to compensate for workflow ${workflowId}`);

        // Update workflow status to COMPENSATING
        await client.query(
          `UPDATE workflows
           SET status = $1, compensation_status = $2, error_details = $3, updated_at = NOW()
           WHERE workflow_id = $4`,
          [
            WORKFLOW_STATUS.COMPENSATING,
            COMPENSATION_STATUS.IN_PROGRESS,
            JSON.stringify({ failedStep: stepId, reason, isBusinessRejection }),
            workflowId,
          ]
        );

        // Dispatch compensation event for each step
        for (const compStep of stepsToCompensate) {
          await queueOutboxEvent(client, {
            workflowId,
            correlationId: workflow.correlation_id,
            topic: compStep.compensateEvent,
            eventKey: workflowId,
            eventType: EVENT_TYPES.COMPENSATE_VERIFICATION,
            payload: {
              stepId: compStep.id,
              action: compStep.compensation.action,
              reason: `Compensating due to ${stepId} rejection: ${reason}`,
            },
          });
          logger.info(`[Saga:Compensation] Queued compensation event to ${compStep.compensateEvent} for step ${compStep.id}`);
        }
      } else {
        // No compensation necessary (e.g. step 1 itself failed)
        await client.query(
          `UPDATE workflows
           SET status = $1, error_details = $2, completed_at = NOW(), updated_at = NOW()
           WHERE workflow_id = $3`,
          [WORKFLOW_STATUS.FAILED, JSON.stringify({ reason }), workflowId]
        );

        await client.query(
          `INSERT INTO workflow_events (
            workflow_id, correlation_id, event_type, source_service, payload, created_at
          ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            workflowId,
            workflow.correlation_id,
            EVENT_TYPES.WORKFLOW_FAILED,
            'orchestrator-service',
            JSON.stringify({ failedStep: stepId, reason }),
          ]
        );

        metrics.workflowsTotal.inc({ workflow_type: workflow.workflow_type, status: 'FAILED' });
      }
    });

    await delCache(`workflow:${workflowId}`);
  }

  /**
   * Handle Compensation Result from a microservice
   */
  async handleCompensationResult(workflowId, stepId, status, data, error) {
    logger.info(`[Saga:Compensation] Handling compensation outcome: workflow=${workflowId}, status=${status}`);

    const workflowRes = await query('SELECT * FROM workflows WHERE workflow_id = $1', [workflowId]);
    if (workflowRes.rows.length === 0) return;
    const workflow = workflowRes.rows[0];

    // Idempotency: ignore if already COMPENSATED
    if (workflow.status === WORKFLOW_STATUS.COMPENSATED) {
      logger.info(`[Saga:Compensation] Workflow ${workflowId} already COMPENSATED, skipping duplicate.`);
      return;
    }

    await withTransaction(async (client) => {
      if (status === 'COMPENSATED') {
        // Step compensated successfully
        await client.query(
          `UPDATE workflow_steps
           SET status = $1, compensated_at = NOW(), updated_at = NOW()
           WHERE workflow_id = $2 AND step_name = $3`,
          [STEP_STATUS.COMPENSATED, workflowId, stepId]
        );

        // Update workflow to COMPENSATED
        await client.query(
          `UPDATE workflows
           SET status = $1, compensation_status = $2, completed_at = NOW(), updated_at = NOW()
           WHERE workflow_id = $3`,
          [WORKFLOW_STATUS.COMPENSATED, COMPENSATION_STATUS.SUCCESS, workflowId]
        );

        await client.query(
          `INSERT INTO workflow_events (
            workflow_id, correlation_id, event_type, source_service, payload, created_at
          ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            workflowId,
            workflow.correlation_id,
            EVENT_TYPES.WORKFLOW_COMPENSATED,
            'orchestrator-service',
            JSON.stringify({ stepId, compensationData: data }),
          ]
        );

        metrics.compensationsTotal.inc({ workflow_type: workflow.workflow_type, status: 'SUCCESS' });
        metrics.workflowsTotal.inc({ workflow_type: workflow.workflow_type, status: 'COMPENSATED' });

        logger.info(`[Saga:Compensation] Workflow ${workflowId} successfully COMPENSATED.`);
      } else {
        // Compensation Failed! Must NEVER mark as successfully compensated!
        await client.query(
          `UPDATE workflows
           SET status = $1, compensation_status = $2, error_details = $3, updated_at = NOW()
           WHERE workflow_id = $4`,
          [
            WORKFLOW_STATUS.RECOVERY_REQUIRED,
            COMPENSATION_STATUS.FAILED,
            JSON.stringify({ compensationError: error, failedAt: new Date().toISOString() }),
            workflowId,
          ]
        );

        metrics.compensationsTotal.inc({ workflow_type: workflow.workflow_type, status: 'FAILED' });
        logger.error(`[Saga:Compensation] CRITICAL: Compensation failed for workflow ${workflowId}. Set to RECOVERY_REQUIRED.`);
      }
    });

    await delCache(`workflow:${workflowId}`);
  }

  /**
   * Replay Workflow from PostgreSQL state and events
   */
  async replayWorkflow(workflowId) {
    logger.info(`[Saga:Replay] Replaying workflow ${workflowId}`);

    const wfRes = await query('SELECT * FROM workflows WHERE workflow_id = $1', [workflowId]);
    if (wfRes.rows.length === 0) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    const workflow = wfRes.rows[0];

    // Read steps and event history
    const stepsRes = await query(
      'SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC',
      [workflowId]
    );

    const definition = workflowEngine.getDefinition(workflow.workflow_type);
    if (!definition) throw new Error(`Workflow definition ${workflow.workflow_type} not found`);

    // Determine restart point: find the first step that is NOT completed
    const incompleteStep = stepsRes.rows.find((s) => s.status !== STEP_STATUS.COMPLETED && s.status !== STEP_STATUS.COMPENSATED);

    const targetStep = incompleteStep
      ? definition.steps.find((s) => s.id === incompleteStep.step_name)
      : definition.steps[0];

    // Atomically reset status and publish event
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE workflows
         SET status = $1, current_step = $2, retry_count = retry_count + 1, updated_at = NOW()
         WHERE workflow_id = $3`,
        [WORKFLOW_STATUS.RUNNING, targetStep.id, workflowId]
      );

      await client.query(
        `INSERT INTO workflow_events (
          workflow_id, correlation_id, event_type, source_service, payload, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          workflowId,
          workflow.correlation_id,
          EVENT_TYPES.WORKFLOW_RECOVERY_TRIGGERED,
          'orchestrator-service',
          JSON.stringify({ replayedStep: targetStep.id, at: new Date().toISOString() }),
        ]
      );

      await queueOutboxEvent(client, {
        workflowId,
        correlationId: workflow.correlation_id,
        topic: targetStep.startEvent,
        eventKey: workflowId,
        eventType: targetStep.id === 'verify_identity' ? EVENT_TYPES.START_VERIFICATION : EVENT_TYPES.START_CREDIT_CHECK,
        payload: {
          stepId: targetStep.id,
          ...workflow.input_payload,
          isReplay: true,
        },
      });
    });

    await delCache(`workflow:${workflowId}`);
    return {
      workflowId,
      status: WORKFLOW_STATUS.RUNNING,
      resumedAtStep: targetStep.id,
      message: `Workflow safely replayed from step ${targetStep.id}`,
    };
  }
}

const sagaOrchestrator = new SagaOrchestrator();

module.exports = {
  sagaOrchestrator,
  SagaOrchestrator,
};
