const db = require('./db');
const eventTypes = require('./eventTypes');
const eventEnvelope = require('./eventEnvelope');
const { eventBus } = require('./eventBus');
const { createLogger } = require('./logger');
const metrics = require('./metrics');
const circuitBreaker = require('./circuitBreaker');
const outbox = require('./outboxPublisher');
const workflowEngine = require('./workflowEngine');
const redisClient = require('./redisClient');
const retryQueue = require('./retryQueue');
const tracer = require('./tracer');

module.exports = {
  db,
  ...eventTypes,
  ...eventEnvelope,
  eventBus,
  createLogger,
  ...metrics,
  ...circuitBreaker,
  ...outbox,
  ...workflowEngine,
  ...redisClient,
  ...retryQueue,
  ...tracer,
};
