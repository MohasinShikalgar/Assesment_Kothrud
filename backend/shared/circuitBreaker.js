const { metrics } = require('./metrics');
const { createLogger } = require('./logger');

const logger = createLogger('circuit-breaker');

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 10000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold || 2;

    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.stateTransitions = [];

    this._updateMetric();
  }

  _recordTransition(from, to, reason) {
    const transition = {
      timestamp: new Date().toISOString(),
      from,
      to,
      reason,
      failureCount: this.failureCount,
    };
    this.stateTransitions.push(transition);
    if (this.stateTransitions.length > 50) this.stateTransitions.shift();

    logger.warn(`[CircuitBreaker:${this.name}] Transitioned: ${from} -> ${to}. Reason: ${reason}`);
    this._updateMetric();
  }

  _updateMetric() {
    const val = this.state === STATES.CLOSED ? 0 : this.state === STATES.HALF_OPEN ? 1 : 2;
    metrics.circuitBreakerStateGauge.set({ service: this.name }, val);
  }

  async execute(action, fallback = null) {
    const now = Date.now();

    // Check if OPEN cooldown has expired -> switch to HALF_OPEN
    if (this.state === STATES.OPEN) {
      if (now >= this.nextAttempt) {
        this.state = STATES.HALF_OPEN;
        this.successCount = 0;
        this._recordTransition(STATES.OPEN, STATES.HALF_OPEN, 'Cooldown period elapsed; trial probe');
      } else {
        const err = new Error(`Circuit breaker [${this.name}] is OPEN. Fast-failing request.`);
        err.code = 'CIRCUIT_BREAKER_OPEN';
        if (fallback) {
          logger.info(`[CircuitBreaker:${this.name}] Executing fallback due to OPEN breaker`);
          return await fallback(err);
        }
        throw err;
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      if (fallback) {
        logger.info(`[CircuitBreaker:${this.name}] Executing fallback due to action error: ${error.message}`);
        return await fallback(error);
      }
      throw error;
    }
  }

  onSuccess() {
    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        const from = this.state;
        this.state = STATES.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this._recordTransition(from, STATES.CLOSED, 'Success threshold met during probe');
      }
    } else {
      this.failureCount = 0;
    }
  }

  onFailure(error) {
    this.failureCount++;
    if (this.state === STATES.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      const from = this.state;
      this.state = STATES.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeoutMs;
      this._recordTransition(from, STATES.OPEN, `Failures (${this.failureCount}) exceeded threshold. Error: ${error.message}`);
    }
  }

  getState() {
    // Check if OPEN timer has elapsed
    if (this.state === STATES.OPEN && Date.now() >= this.nextAttempt) {
      return STATES.HALF_OPEN;
    }
    return this.state;
  }

  getStatus() {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeoutMs,
      nextAttemptInMs: Math.max(0, this.nextAttempt - Date.now()),
      recentTransitions: this.stateTransitions.slice(-5),
    };
  }

  // Administrative reset
  reset() {
    const from = this.state;
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this._recordTransition(from, STATES.CLOSED, 'Manual administrative reset');
  }

  // Administrative trip
  trip() {
    const from = this.state;
    this.state = STATES.OPEN;
    this.nextAttempt = Date.now() + this.resetTimeoutMs;
    this._recordTransition(from, STATES.OPEN, 'Manual administrative trip');
  }
}

const breakers = {};

function getCircuitBreaker(name, options = {}) {
  if (!breakers[name]) {
    breakers[name] = new CircuitBreaker(name, options);
  }
  return breakers[name];
}

function getAllCircuitBreakers() {
  return Object.values(breakers).map((b) => b.getStatus());
}

module.exports = {
  CircuitBreaker,
  getCircuitBreaker,
  getAllCircuitBreakers,
  STATES,
};
