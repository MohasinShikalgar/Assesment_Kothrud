const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { z } = require('zod');
const { createLogger } = require('./logger');

const logger = createLogger('workflow-engine');

const StepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().positive(),
  service: z.string().min(1),
  startEvent: z.string().min(1),
  resultEvent: z.string().min(1),
  compensateEvent: z.string().nullable().optional(),
  timeoutMs: z.number().int().positive().default(10000),
  retryPolicy: z.object({
    maxRetries: z.number().int().nonnegative().default(3),
    backoffMs: z.number().int().positive().default(1000),
    exponential: z.boolean().default(true),
  }).default({}),
  compensation: z.object({
    action: z.string().nullable().optional(),
    required: z.boolean().default(false),
    timeoutMs: z.number().int().positive().default(5000),
  }).default({}),
});

const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  timeoutSeconds: z.number().int().positive().default(300),
  initialStep: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  completionStep: z.object({
    name: z.string().min(1),
    status: z.string().default('COMPLETED'),
  }),
});

class WorkflowEngine {
  constructor(workflowsDir = path.resolve(__dirname, '../workflows')) {
    this.workflowsDir = workflowsDir;
    this.definitions = new Map();
    this.loadAllDefinitions();
  }

  loadAllDefinitions() {
    try {
      if (!fs.existsSync(this.workflowsDir)) {
        fs.mkdirSync(this.workflowsDir, { recursive: true });
      }

      const files = fs.readdirSync(this.workflowsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        const filePath = path.join(this.workflowsDir, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const parsed = YAML.parse(raw);
          const validated = WorkflowDefinitionSchema.parse(parsed);

          // Verify step order is unique and initialStep exists
          const stepIds = new Set(validated.steps.map((s) => s.id));
          if (!stepIds.has(validated.initialStep)) {
            throw new Error(`Initial step '${validated.initialStep}' is not defined in steps list`);
          }

          this.definitions.set(validated.name, validated);
          logger.info(`[WorkflowEngine] Loaded valid workflow definition: ${validated.name} (v${validated.version})`);
        } catch (err) {
          logger.error(`[WorkflowEngine] Failed to parse workflow YAML ${file}: ${err.message}`);
        }
      }
    } catch (e) {
      logger.error(`[WorkflowEngine] Error reading workflows directory: ${e.message}`);
    }
  }

  getDefinition(name = 'kyc_approval_pipeline') {
    return this.definitions.get(name) || null;
  }

  getAllDefinitions() {
    return Array.from(this.definitions.values());
  }

  validateDefinition(yamlContent) {
    try {
      const parsed = YAML.parse(yamlContent);
      const validated = WorkflowDefinitionSchema.parse(parsed);
      return { valid: true, definition: validated };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  getNextStep(workflowName, currentStepId) {
    const def = this.getDefinition(workflowName);
    if (!def) return null;

    const sortedSteps = [...def.steps].sort((a, b) => a.order - b.order);
    const currentIndex = sortedSteps.findIndex((s) => s.id === currentStepId);

    if (currentIndex === -1 || currentIndex >= sortedSteps.length - 1) {
      return null; // No more steps, reaches completion
    }
    return sortedSteps[currentIndex + 1];
  }

  getStep(workflowName, stepId) {
    const def = this.getDefinition(workflowName);
    if (!def) return null;
    return def.steps.find((s) => s.id === stepId) || null;
  }

  getStepsToCompensate(workflowName, failedStepId) {
    const def = this.getDefinition(workflowName);
    if (!def) return [];

    const sortedSteps = [...def.steps].sort((a, b) => a.order - b.order);
    const failedIndex = sortedSteps.findIndex((s) => s.id === failedStepId);
    if (failedIndex <= 0) return [];

    // Compensate all preceding completed steps in REVERSE order!
    return sortedSteps
      .slice(0, failedIndex)
      .filter((s) => s.compensation && s.compensation.required)
      .reverse();
  }
}

const workflowEngine = new WorkflowEngine();

module.exports = {
  workflowEngine,
  WorkflowEngine,
  WorkflowDefinitionSchema,
};
