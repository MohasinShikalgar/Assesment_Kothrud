const { Queue, Worker } = require('bullmq');
const { isRedisConnected, redisClient } = require('./redisClient');
const { createLogger } = require('./logger');
const { metrics } = require('./metrics');

const logger = createLogger('retry-queue');

class RetryQueueManager {
  constructor() {
    this.queue = null;
    this.worker = null;
    this.localQueue = [];
    this.retryHandler = null;

    this._init();
  }

  _init() {
    // If Redis is active, initialize BullMQ
    if (isRedisConnected() && redisClient) {
      try {
        this.queue = new Queue('workflow-retries', {
          connection: redisClient,
        });
        logger.info('[RetryQueue] Initialized BullMQ queue with Redis backend');
      } catch (e) {
        logger.warn('[RetryQueue] BullMQ init failed, using local queue:', e.message);
      }
    }
  }

  registerHandler(handler) {
    this.retryHandler = handler;

    if (this.queue && isRedisConnected() && redisClient) {
      try {
        this.worker = new Worker(
          'workflow-retries',
          async (job) => {
            logger.info(`[RetryQueue] Processing BullMQ job ${job.id}`, job.data);
            return await this.retryHandler(job.data);
          },
          { connection: redisClient }
        );
      } catch (e) {
        logger.warn('[RetryQueue] BullMQ worker init failed:', e.message);
      }
    }
  }

  async scheduleRetry(workflowId, stepName, attemptNumber, delayMs = 1000, context = {}) {
    metrics.retriesTotal.inc({ step: stepName, service: 'orchestrator' });
    logger.info(`[RetryQueue] Scheduling retry for workflow=${workflowId}, step=${stepName}, attempt=${attemptNumber}, delayMs=${delayMs}`);

    const payload = { workflowId, stepName, attemptNumber, context };

    if (this.queue && isRedisConnected()) {
      try {
        await this.queue.add('retry-step', payload, {
          delay: delayMs,
          attempts: 1, // BullMQ delay handles the wait, orchestrator manages overall attempts
          removeOnComplete: true,
        });
        return { queued: true, backend: 'bullmq', delayMs };
      } catch (err) {
        logger.warn(`[RetryQueue] BullMQ schedule failed, falling back to local timer: ${err.message}`);
      }
    }

    // Local asynchronous queue with setTimeout (guaranteed local retry)
    setTimeout(async () => {
      try {
        if (this.retryHandler) {
          logger.info(`[RetryQueue:Local] Executing scheduled retry for workflow=${workflowId}`);
          await this.retryHandler(payload);
        }
      } catch (err) {
        logger.error(`[RetryQueue:Local] Error in local retry handler: ${err.message}`);
      }
    }, delayMs);

    return { queued: true, backend: 'local_timer', delayMs };
  }
}

const retryQueue = new RetryQueueManager();

module.exports = { retryQueue };
