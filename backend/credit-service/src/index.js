const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { createLogger } = require('../../shared/logger');
const { register, metrics } = require('../../shared/metrics');
const { eventBus } = require('../../shared/eventBus');
const { initializeCreditConsumer } = require('./services/creditConsumer');
const {
  setSimulationConfig,
  getSimulationConfig,
  getCreditRecord,
} = require('./services/creditLogic');

const logger = createLogger('credit-service');
const app = express();
const PORT = process.env.PORT_CREDIT || 5002;

app.use(cors());
app.use(express.json());

// Request logger & metric tracking
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    metrics.httpRequestsTotal.inc({
      service: 'credit-service',
      method: req.method,
      route: req.path,
      status_code: res.statusCode,
    });
    metrics.httpRequestDuration.observe(
      { service: 'credit-service', method: req.method, route: req.path },
      duration
    );
  });
  next();
});

// Liveness Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'credit-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
  });
});

// Readiness Check
app.get('/ready', async (req, res) => {
  const kafkaHealth = await eventBus.checkHealth();
  const isReady = true;

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'READY' : 'NOT_READY',
    service: 'credit-service',
    eventBus: kafkaHealth,
    timestamp: new Date().toISOString(),
  });
});

// Prometheus Metrics Endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// Admin / Failure Testing Lab endpoints
app.get('/admin/simulation', (req, res) => {
  res.json({
    service: 'credit-service',
    config: getSimulationConfig(),
  });
});

app.post('/admin/simulation', (req, res) => {
  setSimulationConfig(req.body);
  res.json({
    message: 'Simulation configuration updated',
    service: 'credit-service',
    config: getSimulationConfig(),
  });
});

app.get('/records/:workflowId', (req, res) => {
  const record = getCreditRecord(req.params.workflowId);
  if (!record) {
    return res.status(404).json({ error: 'Record not found for workflow' });
  }
  res.json(record);
});

// Start service
async function startServer() {
  await initializeCreditConsumer();
  app.listen(PORT, () => {
    logger.info(`[CreditService] HTTP server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.error(`[CreditService] Startup fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { app, startServer };
