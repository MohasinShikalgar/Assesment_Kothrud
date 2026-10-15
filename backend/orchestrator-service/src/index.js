const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { createLogger } = require('../../shared/logger');
const { register, metrics } = require('../../shared/metrics');
const { startOutboxWorker, stopOutboxWorker } = require('../../shared/outboxPublisher');
const { initializeOrchestratorConsumer } = require('./services/eventConsumer');
const { recoveryService } = require('./services/recoveryService');
const workflowRoutes = require('./routes/workflowRoutes');

const logger = createLogger('orchestrator-service');
const app = express();
const PORT = process.env.PORT_ORCHESTRATOR || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Metrics and Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    metrics.httpRequestsTotal.inc({
      service: 'orchestrator-service',
      method: req.method,
      route: req.baseUrl + req.path,
      status_code: res.statusCode,
    });
    metrics.httpRequestDuration.observe(
      { service: 'orchestrator-service', method: req.method, route: req.baseUrl + req.path },
      duration
    );
  });
  next();
});

// Primary API Router under /api/v1
app.use('/api/v1', workflowRoutes);

// Root convenience aliases
app.get('/', (req, res) => {
  res.json({
    name: 'FlowMaster Distributed Task Orchestrator',
    version: '1.0.0',
    documentation: '/api/v1/definitions',
    health: '/api/v1/health',
    status: 'ACTIVE',
  });
});
app.get('/health', (req, res) => res.redirect('/api/v1/health'));
app.get('/ready', (req, res) => res.redirect('/api/v1/ready'));
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error(`[Orchestrator API Error]: ${err.message}`, { stack: err.stack, path: req.path });
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
  });
});

let server = null;

async function startServer() {
  logger.info('[Orchestrator] Starting services...');

  // 1. Initialize Kafka result consumer
  await initializeOrchestratorConsumer();

  // 2. Start Transactional Outbox background publisher
  startOutboxWorker(300);

  // 3. Run Crash Recovery scan for incomplete workflows from PostgreSQL
  await recoveryService.runStartupRecovery();

  // 4. Start HTTP Server
  server = app.listen(PORT, () => {
    logger.info(`[Orchestrator] REST API listening on http://localhost:${PORT}`);
  });
}

// Graceful Shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  logger.info('[Orchestrator] Graceful shutdown signal received...');
  stopOutboxWorker();
  if (server) {
    server.close(() => {
      logger.info('[Orchestrator] HTTP server closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.error(`[Orchestrator] Startup fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { app, startServer };
