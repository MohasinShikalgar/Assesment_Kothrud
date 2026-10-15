const { eventBus } = require('../../../shared/eventBus');
const { TOPICS, EVENT_TYPES } = require('../../../shared/eventTypes');
const { sagaOrchestrator } = require('./sagaOrchestrator');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('orchestrator-consumer');

async function initializeOrchestratorConsumer() {
  logger.info('[OrchestratorConsumer] Subscribing to Kafka result topics...');

  // 1. Subscribe to verification.result
  await eventBus.subscribe(
    TOPICS.VERIFICATION_RESULT,
    'orchestrator-verification-group',
    async (envelope) => {
      logger.info(`[OrchestratorConsumer] Received [${envelope.eventType}] for workflow [${envelope.workflowId}]`);

      try {
        const { eventType, workflowId, payload } = envelope;

        if (eventType === EVENT_TYPES.VERIFICATION_SUCCESS) {
          await sagaOrchestrator.handleStepSuccess(workflowId, 'verify_identity', payload.data);
        } else if (eventType === EVENT_TYPES.VERIFICATION_FAILED) {
          await sagaOrchestrator.handleStepFailureOrRejection(
            workflowId,
            'verify_identity',
            payload.error || 'Verification failed',
            true
          );
        } else if (
          eventType === EVENT_TYPES.VERIFICATION_COMPENSATED ||
          eventType === EVENT_TYPES.VERIFICATION_COMPENSATION_FAILED
        ) {
          const isSuccess = eventType === EVENT_TYPES.VERIFICATION_COMPENSATED;
          await sagaOrchestrator.handleCompensationResult(
            workflowId,
            'verify_identity',
            isSuccess ? 'COMPENSATED' : 'COMPENSATION_FAILED',
            payload.data,
            payload.error
          );
        }
      } catch (err) {
        logger.error(`[OrchestratorConsumer] Error handling verification result for ${envelope.workflowId}: ${err.message}`);
      }
    }
  );

  // 2. Subscribe to credit.result
  await eventBus.subscribe(
    TOPICS.CREDIT_RESULT,
    'orchestrator-credit-group',
    async (envelope) => {
      logger.info(`[OrchestratorConsumer] Received [${envelope.eventType}] for workflow [${envelope.workflowId}]`);

      try {
        const { eventType, workflowId, payload } = envelope;

        if (eventType === EVENT_TYPES.CREDIT_APPROVED) {
          await sagaOrchestrator.handleStepSuccess(workflowId, 'credit_check', payload.data);
        } else if (eventType === EVENT_TYPES.CREDIT_REJECTED) {
          // Downstream credit check rejected the user -> initiate compensation!
          await sagaOrchestrator.handleStepFailureOrRejection(
            workflowId,
            'credit_check',
            payload.reason || 'Credit check rejected',
            true
          );
        } else if (eventType === EVENT_TYPES.CREDIT_ERROR) {
          // Technical error -> initiate failure or retry
          await sagaOrchestrator.handleStepFailureOrRejection(
            workflowId,
            'credit_check',
            payload.error || 'Technical error during credit check',
            false
          );
        }
      } catch (err) {
        logger.error(`[OrchestratorConsumer] Error handling credit result for ${envelope.workflowId}: ${err.message}`);
      }
    }
  );

  logger.info('[OrchestratorConsumer] Result topic subscriptions initialized.');
}

module.exports = { initializeOrchestratorConsumer };
