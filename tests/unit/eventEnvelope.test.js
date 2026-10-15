const { describe, it } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');
const { createEventEnvelope, validateEventEnvelope } = require('../../backend/shared/eventEnvelope');

describe('Event Envelope Schema Unit Tests', () => {
  it('should construct and validate canonical event envelope', () => {
    const envelope = createEventEnvelope({
      workflowId: uuidv4(),
      correlationId: 'corr-12345',
      eventType: 'START_VERIFICATION',
      source: 'orchestrator-service',
      payload: { customer: 'John Doe', loanAmount: 50000 },
    });

    assert.ok(envelope.eventId);
    assert.ok(envelope.timestamp);
    assert.strictEqual(envelope.version, '1.0.0');
    assert.strictEqual(envelope.eventType, 'START_VERIFICATION');
    assert.strictEqual(envelope.source, 'orchestrator-service');

    const validation = validateEventEnvelope(envelope);
    assert.strictEqual(validation.success, true);
  });

  it('should reject invalid envelope missing required fields', () => {
    const broken = {
      eventType: 'MISSING_FIELDS',
      source: 'test',
    };
    const validation = validateEventEnvelope(broken);
    assert.strictEqual(validation.success, false);
    assert.ok(validation.error.errors.length > 0);
  });

  it('should reject invalid non-UUID workflowId', () => {
    const broken = {
      eventId: uuidv4(),
      workflowId: 'not-a-valid-uuid',
      correlationId: 'corr-1',
      eventType: 'TEST',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      payload: {},
    };
    const validation = validateEventEnvelope(broken);
    assert.strictEqual(validation.success, false);
  });
});
