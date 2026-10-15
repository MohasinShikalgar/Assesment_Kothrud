const { workflowEngine } = require('../../../shared/workflowEngine');
const { getAllCircuitBreakers, getCircuitBreaker } = require('../../../shared/circuitBreaker');
const { checkHealth: checkDbHealth, query } = require('../../../shared/db');
const { eventBus } = require('../../../shared/eventBus');
const { checkRedisHealth } = require('../../../shared/redisClient');
const { recoveryService } = require('../services/recoveryService');

/**
 * Get all available YAML workflow definitions
 */
async function getDefinitions(req, res) {
  const definitions = workflowEngine.getAllDefinitions();
  res.json({ definitions });
}

/**
 * Validate a YAML definition string
 */
async function validateDefinition(req, res) {
  const { yamlContent } = req.body;
  if (!yamlContent) {
    return res.status(400).json({ valid: false, error: 'yamlContent is required' });
  }
  const result = workflowEngine.validateDefinition(yamlContent);
  if (!result.valid) {
    return res.status(400).json(result);
  }
  res.json(result);
}

/**
 * Get circuit breaker statuses
 */
async function getCircuitBreakers(req, res) {
  const breakers = getAllCircuitBreakers();
  res.json({ breakers });
}

/**
 * Reset a circuit breaker
 */
async function resetCircuitBreaker(req, res) {
  const { name } = req.params;
  const breaker = getCircuitBreaker(name);
  breaker.reset();
  res.json({ message: `Circuit breaker ${name} reset to CLOSED`, status: breaker.getStatus() });
}

/**
 * Trip a circuit breaker (Failure Lab testing)
 */
async function tripCircuitBreaker(req, res) {
  const { name } = req.params;
  const breaker = getCircuitBreaker(name);
  breaker.trip();
  res.json({ message: `Circuit breaker ${name} manually tripped to OPEN`, status: breaker.getStatus() });
}

/**
 * Trigger manual crash recovery scan
 */
async function triggerRecovery(req, res) {
  const result = await recoveryService.runStartupRecovery();
  res.json({
    message: 'Manual recovery scan executed',
    ...result,
  });
}

/**
 * Global Event Logs across all workflows
 * GET /api/v1/events
 */
async function listAllEvents(req, res, next) {
  try {
    const { page = 1, limit = 50, eventType, workflowId } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (eventType) {
      params.push(eventType);
      conditions.push(`event_type = $${params.length}`);
    }

    if (workflowId) {
      params.push(workflowId);
      conditions.push(`workflow_id::text = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*) AS total FROM workflow_events ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].total, 10);

    params.push(parseInt(limit, 10), offset);
    const dataSql = `
      SELECT event_id, workflow_id, correlation_id, event_type, source_service, target_topic, payload, status, retry_count, error_details, created_at
      FROM workflow_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;
    const dataRes = await query(dataSql, params);

    res.json({
      data: dataRes.rows,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Detailed Health Check for PostgreSQL, Kafka, and Redis
 */
async function getHealth(req, res) {
  const [dbHealth, kafkaHealth, redisHealth] = await Promise.all([
    checkDbHealth(),
    eventBus.checkHealth(),
    checkRedisHealth(),
  ]);

  const breakers = getAllCircuitBreakers();
  const isHealthy = dbHealth.status === 'UP';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    service: 'orchestrator-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    components: {
      database: dbHealth,
      kafka: kafkaHealth,
      redis: redisHealth,
      circuitBreakers: breakers,
    },
  });
}

/**
 * Readiness check
 */
async function getReadiness(req, res) {
  const dbHealth = await checkDbHealth();
  const isReady = dbHealth.status === 'UP';

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'READY' : 'NOT_READY',
    service: 'orchestrator-service',
    readyAt: new Date().toISOString(),
  });
}

module.exports = {
  getDefinitions,
  validateDefinition,
  getCircuitBreakers,
  resetCircuitBreaker,
  tripCircuitBreaker,
  triggerRecovery,
  listAllEvents,
  getHealth,
  getReadiness,
};
