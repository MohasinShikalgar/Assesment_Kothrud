const { eventBus } = require('../../../shared/eventBus');
const { TOPICS, EVENT_TYPES } = require('../../../shared/eventTypes');
const { createEventEnvelope } = require('../../../shared/eventEnvelope');
const { createLogger } = require('../../../shared/logger');
const { processCreditCheck } = require('./creditLogic');

const logger = createLogger('credit-consumer');

async function initializeCreditConsumer() {
  logger.info('[CreditService] Initializing Kafka event subscriptions...');

  await eventBus.subscribe(
    TOPICS.CREDIT_START,
    'credit-service-group',
    async (envelope) => {
      logger.info(`[CreditService] Received ${envelope.eventType} for workflow ${envelope.workflowId}`);

      try {
        const result = await processCreditCheck(envelope);

        if (result.status === 'DUPLICATE') {
          logger.info(`[CreditService] Skipped duplicate credit event for workflow ${envelope.workflowId}`);
          return;
        }

        let eventType;
        let payloadStatus;

        if (result.status === 'APPROVED') {
          eventType = EVENT_TYPES.CREDIT_APPROVED;
          payloadStatus = 'APPROVED';
        } else if (result.status === 'REJECTED') {
          eventType = EVENT_TYPES.CREDIT_REJECTED;
          payloadStatus = 'REJECTED';
        } else {
          eventType = EVENT_TYPES.CREDIT_ERROR;
          payloadStatus = 'TECHNICAL_ERROR';
        }

        const outEnvelope = createEventEnvelope({
          workflowId: envelope.workflowId,
          correlationId: envelope.correlationId,
          eventType,
          source: 'credit-service',
          payload: {
            stepId: 'credit_check',
            status: payloadStatus,
            data: result.data || null,
            reason: result.reason || null,
            error: result.error || null,
          },
        });

        await eventBus.publish(TOPICS.CREDIT_RESULT, outEnvelope);
      } catch (err) {
        logger.error(`[CreditService] Unexpected error evaluating credit: ${err.message}`);
        const errEnvelope = createEventEnvelope({
          workflowId: envelope.workflowId,
          correlationId: envelope.correlationId,
          eventType: EVENT_TYPES.CREDIT_ERROR,
          source: 'credit-service',
          payload: {
            stepId: 'credit_check',
            status: 'ERROR',
            error: err.message,
          },
        });
        await eventBus.publish(TOPICS.CREDIT_RESULT, errEnvelope);
      }
    }
  );

  logger.info('[CreditService] Subscriptions successfully initialized on Kafka topics.');
}

module.exports = { initializeCreditConsumer };
