const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');

const EventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  workflowId: z.string().uuid(),
  correlationId: z.string().min(1),
  eventType: z.string().min(1),
  timestamp: z.string().datetime(),
  version: z.string().default('1.0.0'),
  source: z.string().min(1),
  payload: z.record(z.any()),
});

/**
 * Construct and validate a standard FlowMaster event envelope
 */
function createEventEnvelope({
  workflowId,
  correlationId,
  eventType,
  source,
  payload = {},
  version = '1.0.0',
}) {
  const envelope = {
    eventId: uuidv4(),
    workflowId,
    correlationId: correlationId || uuidv4(),
    eventType,
    timestamp: new Date().toISOString(),
    version,
    source,
    payload,
  };

  return EventEnvelopeSchema.parse(envelope);
}

/**
 * Validate an incoming raw event envelope
 */
function validateEventEnvelope(data) {
  return EventEnvelopeSchema.safeParse(data);
}

module.exports = {
  createEventEnvelope,
  validateEventEnvelope,
  EventEnvelopeSchema,
};
