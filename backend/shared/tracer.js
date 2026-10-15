/**
 * OpenTelemetry-compatible Lightweight Distributed Tracer for FlowMaster
 * Generates W3C tracecontext and Jaeger-compatible spans.
 */
const { v4: uuidv4 } = require('uuid');

function generateTraceId() {
  return uuidv4().replace(/-/g, '');
}

function generateSpanId() {
  return uuidv4().replace(/-/g, '').substring(0, 16);
}

class Tracer {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.traces = [];
    this.maxTraces = 200;
  }

  startSpan(name, attributes = {}, parentContext = {}) {
    const traceId = parentContext.traceId || generateTraceId();
    const parentSpanId = parentContext.spanId || null;
    const spanId = generateSpanId();
    const startTime = Date.now();

    const span = {
      name,
      traceId,
      spanId,
      parentSpanId,
      serviceName: this.serviceName,
      startTime,
      attributes: {
        ...attributes,
        'service.name': this.serviceName,
      },
      events: [],
      status: 'OK',
    };

    return {
      span,
      context: { traceId, spanId },
      addEvent: (eventName, data = {}) => {
        span.events.push({ name: eventName, time: Date.now(), data });
      },
      setAttribute: (key, value) => {
        span.attributes[key] = value;
      },
      setStatus: (status, message) => {
        span.status = status;
        if (message) span.attributes['error.message'] = message;
      },
      end: () => {
        span.endTime = Date.now();
        span.durationMs = span.endTime - startTime;
        this.recordSpan(span);
        return span;
      },
    };
  }

  recordSpan(span) {
    this.traces.push(span);
    if (this.traces.length > this.maxTraces) {
      this.traces.shift();
    }
  }

  getRecentSpans(limit = 50) {
    return this.traces.slice(-limit).reverse();
  }

  getSpansByWorkflowId(workflowId) {
    return this.traces.filter((s) => s.attributes['workflow.id'] === workflowId);
  }
}

const tracers = {};

function getTracer(serviceName = 'flowmaster') {
  if (!tracers[serviceName]) {
    tracers[serviceName] = new Tracer(serviceName);
  }
  return tracers[serviceName];
}

module.exports = {
  getTracer,
  generateTraceId,
  generateSpanId,
};
