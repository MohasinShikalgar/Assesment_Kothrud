const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CircuitBreaker, STATES } = require('../../backend/shared/circuitBreaker');

describe('Circuit Breaker Unit Tests', () => {
  it('should start in CLOSED state and execute actions successfully', async () => {
    const breaker = new CircuitBreaker('test-breaker-1', { failureThreshold: 2, resetTimeoutMs: 100 });
    assert.strictEqual(breaker.getState(), STATES.CLOSED);

    const result = await breaker.execute(async () => 'OK');
    assert.strictEqual(result, 'OK');
    assert.strictEqual(breaker.getState(), STATES.CLOSED);
  });

  it('should transition to OPEN after consecutive failures exceed threshold', async () => {
    const breaker = new CircuitBreaker('test-breaker-2', { failureThreshold: 2, resetTimeoutMs: 200 });

    // Failure 1
    await assert.rejects(async () => {
      await breaker.execute(async () => { throw new Error('Fail 1'); });
    });
    assert.strictEqual(breaker.getState(), STATES.CLOSED);

    // Failure 2 (Threshold reached)
    await assert.rejects(async () => {
      await breaker.execute(async () => { throw new Error('Fail 2'); });
    });
    assert.strictEqual(breaker.getState(), STATES.OPEN);

    // Fast-fail call without invoking action
    let executedAction = false;
    await assert.rejects(async () => {
      await breaker.execute(async () => {
        executedAction = true;
        return 'Should not run';
      });
    }, (err) => {
      assert.strictEqual(err.code, 'CIRCUIT_BREAKER_OPEN');
      return true;
    });
    assert.strictEqual(executedAction, false);
  });

  it('should invoke fallback when breaker is OPEN', async () => {
    const breaker = new CircuitBreaker('test-breaker-fallback', { failureThreshold: 1, resetTimeoutMs: 500 });
    breaker.trip();

    const fallbackResult = await breaker.execute(
      async () => 'Never runs',
      async (err) => `Fallback called: ${err.code}`
    );

    assert.strictEqual(fallbackResult, 'Fallback called: CIRCUIT_BREAKER_OPEN');
  });

  it('should transition from OPEN to HALF_OPEN after timeout and recover to CLOSED on success', async () => {
    const breaker = new CircuitBreaker('test-breaker-recovery', {
      failureThreshold: 1,
      resetTimeoutMs: 50,
      halfOpenSuccessThreshold: 1,
    });

    breaker.trip();
    assert.strictEqual(breaker.state, STATES.OPEN);

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(breaker.getState(), STATES.HALF_OPEN);

    // Successful probe
    const res = await breaker.execute(async () => 'Probe Success');
    assert.strictEqual(res, 'Probe Success');
    assert.strictEqual(breaker.getState(), STATES.CLOSED);
  });
});
