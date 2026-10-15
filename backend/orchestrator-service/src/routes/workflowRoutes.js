const express = require('express');
const {
  submitWorkflow,
  listWorkflows,
  getWorkflowById,
  getWorkflowEvents,
  getWorkflowSteps,
  retryWorkflow,
  replayWorkflow,
  getWorkflowMetrics,
  getDashboardStats,
} = require('../controllers/workflowController');

const {
  getDefinitions,
  validateDefinition,
  getCircuitBreakers,
  resetCircuitBreaker,
  tripCircuitBreaker,
  triggerRecovery,
  listAllEvents,
  getHealth,
  getReadiness,
} = require('../controllers/adminController');

const { register } = require('../../../shared/metrics');

const router = express.Router();

// Workflows endpoints
router.post('/workflows', submitWorkflow);
router.get('/workflows', listWorkflows);
router.get('/workflows/:workflowId', getWorkflowById);
router.get('/workflows/:workflowId/events', getWorkflowEvents);
router.get('/workflows/:workflowId/steps', getWorkflowSteps);
router.post('/workflows/:workflowId/retry', retryWorkflow);
router.post('/workflows/:workflowId/replay', replayWorkflow);
router.get('/workflows/:workflowId/metrics', getWorkflowMetrics);

// Global event logs
router.get('/events', listAllEvents);

// Workflow definitions
router.get('/definitions', getDefinitions);
router.post('/definitions/validate', validateDefinition);

// Circuit Breakers
router.get('/circuit-breakers', getCircuitBreakers);
router.post('/circuit-breakers/:name/reset', resetCircuitBreaker);
router.post('/circuit-breakers/:name/trip', tripCircuitBreaker);

// Admin & Dashboard
router.get('/admin/dashboard-stats', getDashboardStats);
router.post('/admin/recovery', triggerRecovery);

// Health, Readiness, and Metrics
router.get('/health', getHealth);
router.get('/ready', getReadiness);
router.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

module.exports = router;
