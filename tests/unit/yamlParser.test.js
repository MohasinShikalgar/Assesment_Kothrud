const { describe, it } = require('node:test');
const assert = require('node:assert');
const { workflowEngine } = require('../../backend/shared/workflowEngine');

describe('Workflow Engine & YAML Parser Tests', () => {
  it('should load default kyc_approval_pipeline workflow definition', () => {
    const def = workflowEngine.getDefinition('kyc_approval_pipeline');
    assert.ok(def, 'Definition should exist');
    assert.strictEqual(def.name, 'kyc_approval_pipeline');
    assert.strictEqual(def.initialStep, 'verify_identity');
    assert.strictEqual(def.steps.length, 2);
  });

  it('should resolve next step correctly in order', () => {
    const next = workflowEngine.getNextStep('kyc_approval_pipeline', 'verify_identity');
    assert.ok(next);
    assert.strictEqual(next.id, 'credit_check');

    // Terminal step has no next step
    const afterCredit = workflowEngine.getNextStep('kyc_approval_pipeline', 'credit_check');
    assert.strictEqual(afterCredit, null);
  });

  it('should correctly identify steps requiring compensation in reverse order', () => {
    const compSteps = workflowEngine.getStepsToCompensate('kyc_approval_pipeline', 'credit_check');
    assert.strictEqual(compSteps.length, 1);
    assert.strictEqual(compSteps[0].id, 'verify_identity');
    assert.strictEqual(compSteps[0].compensation.action, 'REVERSE_KYC');
  });

  it('should reject malformed YAML schema', () => {
    const invalidYaml = `
      name: "broken_workflow"
      steps:
        - id: "step_one"
    `;
    const res = workflowEngine.validateDefinition(invalidYaml);
    assert.strictEqual(res.valid, false);
    assert.ok(res.error);
  });

  it('should accept valid custom YAML definition', () => {
    const validYaml = `
      name: "custom_payout"
      version: "1.0.0"
      initialStep: "verify_account"
      steps:
        - id: "verify_account"
          name: "Verify Bank Account"
          order: 1
          service: "payout-service"
          startEvent: "account.verify"
          resultEvent: "account.result"
          compensateEvent: null
      completionStep:
        name: "disburse_done"
        status: "COMPLETED"
    `;
    const res = workflowEngine.validateDefinition(validYaml);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.definition.name, 'custom_payout');
  });
});
