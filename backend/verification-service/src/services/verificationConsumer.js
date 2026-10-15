const { eventBus } = require('../../../shared/eventBus');
const { TOPICS, EVENT_TYPES } = require('../../../shared/eventTypes');
const { createEventEnvelope } = require('../../../shared/eventEnvelope');
const { createLogger } = require('../../../shared/logger');
const { processVerification, processCompensation } = require('./verificationLogic');

const logger = createLogger('verification-consumer');

async function initializeVerificationConsumer() {
  logger.info('[VerificationService] Initializing Kafka event subscriptions...');

  // 1. Subscribe to verification.start
  await eventBus.subscribe(
    TOPICS.VERIFICATION_START,
    'verification-service-group',
    async (envelope) => {
      logger.info(`[VerificationService] Received ${envelope.eventType} for workflow ${envelope.workflowId}`);

      try {
        const result = await processVerification(envelope);

        if (result.status === 'DUPLICATE') {
          logger.info(`[VerificationService] Skipped duplicate processing for workflow ${envelope.workflowId}`);
          return;
        }

        const isSuccess = result.status === 'SUCCESS';
        const resultEventType = isSuccess ? EVENT_TYPES.VERIFICATION_SUCCESS : EVENT_TYPES.VERIFICATION_FAILED;

        const outEnvelope = createEventEnvelope({
          workflowId: envelope.workflowId,
          correlationId: envelope.correlationId,
          eventType: resultEventType,
          source: 'verification-service',
          payload: {
            stepId: 'verify_identity',
            status: isSuccess ? 'SUCCESS' : 'FAILED',
            data: result.data || null,
            error: result.error || null,
          },
        });

        await eventBus.publish(TOPICS.VERIFICATION_RESULT, outEnvelope);
      } catch (err) {
        logger.error(`[VerificationService] Unexpected failure handling verification: ${err.message}`);
        const errEnvelope = createEventEnvelope({
          workflowId: envelope.workflowId,
          correlationId: envelope.correlationId,
          eventType: EVENT_TYPES.VERIFICATION_FAILED,
          source: 'verification-service',
          payload: {
            stepId: 'verify_identity',
            status: 'FAILED',
            error: err.message,
          },
        });
        await eventBus.publish(TOPICS.VERIFICATION_RESULT, errEnvelope);
      }
    }
  );

  // 2. Subscribe to verification.compensate
  await eventBus.subscribe(
    TOPICS.VERIFICATION_COMPENSATE,
    'verification-service-group',
    async (envelope) => {
      logger.info(`[VerificationService] Received COMPENSATION event for workflow ${envelope.workflowId}`);

      try {
        const compResult = await processCompensation(envelope);
        const isSuccess = compResult.status === 'COMPENSATED';
        const resultEventType = isSuccess
          ? EVENT_TYPES.VERIFICATION_COMPENSATED
          : EVENT_TYPES.VERIFICATION_COMPENSATION_FAILED;

        const outEnvelope = createEventEnvelope({
          workflowId: envelope.workflowId,
          correlationId: envelope.correlationId,
          eventType: resultEventType,
          source: 'verification-service',
          payload: {
            stepId: 'verify_identity',
            status: isSuccess ? 'COMPENSATED' : 'COMPENSATION_FAILED',
            data: compResult.data || null,
            error: compResult.error || null,
          },
        });

        await eventBus.publish(TOPICS.VERIFICATION_RESULT, outEnvelope);
      } catch (err) {
        logger.error(`[VerificationService] Compensation execution error: ${err.message}`);
        const errEnvelope = createEventEnvelope({
          workflowId: envelope.workflowId,
          correlationId: envelope.correlationId,
          eventType: EVENT_TYPES.VERIFICATION_COMPENSATION_FAILED,
          source: 'verification-service',
          payload: {
            stepId: 'verify_identity',
            status: 'COMPENSATION_FAILED',
            error: err.message,
          },
        });
        await eventBus.publish(TOPICS.VERIFICATION_RESULT, errEnvelope);
      }
    }
  );

  logger.info('[VerificationService] Subscriptions successfully initialized on Kafka topics.');
}

module.exports = { initializeVerificationConsumer };
