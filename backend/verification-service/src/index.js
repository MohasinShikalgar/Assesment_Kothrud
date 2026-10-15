const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { createLogger } = require('../../shared/logger');
const { register, metrics } = require('../../shared/metrics');
const { eventBus } = require('../../shared/eventBus');
const { initializeVerificationConsumer } = require('./services/verificationConsumer');
const {
  setSimulationConfig,
  getSimulationConfig,
  getVerificationRecord,
} = require('./services/verificationLogic');

const logger = createLogger('verification-service');
const app = express();
const PORT = process.env.PORT_VERIFICATION || 5001;

app.use(cors());
app.use(express.json());

// Request logger & metric tracking
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    metrics.httpRequestsTotal.inc({
      service: 'verification-service',
      method: req.method,
      route: req.path,
      status_code: res.statusCode,
    });
    metrics.httpRequestDuration.observe(
      { service: 'verification-service', method: req.method, route: req.path },
      duration
    );
  });
  next();
});

// Liveness Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'verification-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
  });
});

// Readiness Check
app.get('/ready', async (req, res) => {
  const kafkaHealth = await eventBus.checkHealth();
  const isReady = true; // Service is ready to process events via event bus

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'READY' : 'NOT_READY',
    service: 'verification-service',
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
    service: 'verification-service',
    config: getSimulationConfig(),
  });
});

app.post('/admin/simulation', (req, res) => {
  setSimulationConfig(req.body);
  res.json({
    message: 'Simulation configuration updated',
    service: 'verification-service',
    config: getSimulationConfig(),
  });
});

app.get('/records/:workflowId', (req, res) => {
  const record = getVerificationRecord(req.params.workflowId);
  if (!record) {
    return res.status(404).json({ error: 'Record not found for workflow' });
  }
  res.json(record);
});

// Start service
async function startServer() {
  await initializeVerificationConsumer();
  app.listen(PORT, () => {
    logger.info(`[VerificationService] HTTP server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.error(`[VerificationService] Startup fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { app, startServer };
