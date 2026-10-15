/**
 * FlowMaster Serverless Adaptation (AWS Lambda / EventBridge / MSK)
 * Bonus evaluation requirement: Adapting microservice workers to event-driven serverless invocations.
 */

const { processVerification, processCompensation } = require('../verification-service/src/services/verificationLogic');
const { processCreditCheck } = require('../credit-service/src/services/creditLogic');
const { sagaOrchestrator } = require('../orchestrator-service/src/services/sagaOrchestrator');
const { createLogger } = require('./logger');

const logger = createLogger('serverless-adapter');

/**
 * AWS Lambda Handler for Verification Service (MSK / SQS / EventBridge trigger)
 */
exports.verificationLambdaHandler = async (event, context) => {
  logger.info('[Lambda:Verification] Received event batch', { recordCount: event.Records?.length || 1 });

  const results = [];
  const records = event.Records || [event];

  for (const record of records) {
    try {
      const envelope = typeof record.body === 'string' ? JSON.parse(record.body) : record;
      let outcome;

      if (envelope.eventType === 'COMPENSATE_VERIFICATION') {
        outcome = await processCompensation(envelope);
      } else {
        outcome = await processVerification(envelope);
      }
      results.push({ statusCode: 200, outcome });
    } catch (err) {
      logger.error('[Lambda:Verification] Error processing record', { error: err.message });
      results.push({ statusCode: 500, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify(results) };
};

/**
 * AWS Lambda Handler for Credit Service (MSK / SQS / EventBridge trigger)
 */
exports.creditLambdaHandler = async (event, context) => {
  logger.info('[Lambda:Credit] Received event batch', { recordCount: event.Records?.length || 1 });

  const results = [];
  const records = event.Records || [event];

  for (const record of records) {
    try {
      const envelope = typeof record.body === 'string' ? JSON.parse(record.body) : record;
      const outcome = await processCreditCheck(envelope);
      results.push({ statusCode: 200, outcome });
    } catch (err) {
      logger.error('[Lambda:Credit] Error evaluating credit in Lambda', { error: err.message });
      results.push({ statusCode: 500, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify(results) };
};

/**
 * AWS Lambda Handler for API Gateway workflow submission
 */
exports.apiGatewayWorkflowHandler = async (event, context) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const idempotencyKey = event.headers?.['x-idempotency-key'] || null;

    const result = await sagaOrchestrator.submitWorkflow({
      workflowType: body.workflowType || 'kyc_approval_pipeline',
      inputPayload: body.inputPayload,
      idempotencyKey,
    });

    return {
      statusCode: result.idempotentReplay ? 200 : 201,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: err.status || 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
