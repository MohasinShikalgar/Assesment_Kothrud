const client = require('prom-client');

// Initialize default recommended Node.js metrics (event loop lag, memory, GC)
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'flowmaster_' });

// FlowMaster Custom Prometheus Metrics
const workflowsTotal = new client.Counter({
  name: 'flowmaster_workflows_total',
  help: 'Total number of workflows submitted, categorized by type and outcome status',
  labelNames: ['workflow_type', 'status'],
  registers: [register],
});

const workflowDurationSeconds = new client.Histogram({
  name: 'flowmaster_workflow_duration_seconds',
  help: 'End-to-end execution duration of workflows in seconds',
  labelNames: ['workflow_type', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

const eventsTotal = new client.Counter({
  name: 'flowmaster_events_total',
  help: 'Total events published or consumed across Kafka topics',
  labelNames: ['topic', 'event_type', 'status'],
  registers: [register],
});

const retriesTotal = new client.Counter({
  name: 'flowmaster_retries_total',
  help: 'Total execution retries triggered by background queues or outbox',
  labelNames: ['step', 'service'],
  registers: [register],
});

const compensationsTotal = new client.Counter({
  name: 'flowmaster_compensations_total',
  help: 'Total compensation events processed',
  labelNames: ['workflow_type', 'status'],
  registers: [register],
});

const outboxPendingGauge = new client.Gauge({
  name: 'flowmaster_outbox_pending_events',
  help: 'Number of pending outbox events awaiting publication to Kafka',
  registers: [register],
});

const circuitBreakerStateGauge = new client.Gauge({
  name: 'flowmaster_circuit_breaker_state',
  help: 'Circuit breaker state: 0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN',
  labelNames: ['service'],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'flowmaster_http_requests_total',
  help: 'Total HTTP requests handled by REST APIs',
  labelNames: ['service', 'method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'flowmaster_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['service', 'method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2],
  registers: [register],
});

module.exports = {
  register,
  metrics: {
    workflowsTotal,
    workflowDurationSeconds,
    eventsTotal,
    retriesTotal,
    compensationsTotal,
    outboxPendingGauge,
    circuitBreakerStateGauge,
    httpRequestsTotal,
    httpRequestDuration,
  },
};
