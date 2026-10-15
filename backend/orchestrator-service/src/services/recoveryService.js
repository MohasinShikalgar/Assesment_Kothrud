const { query } = require('../../../shared/db');
const { sagaOrchestrator } = require('./sagaOrchestrator');
const { WORKFLOW_STATUS, STEP_STATUS } = require('../../../shared/eventTypes');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('recovery-service');

class RecoveryService {
  /**
   * Run automatic recovery on Orchestrator startup
   * Scans for incomplete workflows and resumes them from the last confirmed state in PostgreSQL.
   */
  async runStartupRecovery() {
    logger.info('[RecoveryService] Starting crash recovery check for incomplete workflows...');

    try {
      const activeStatuses = [
        WORKFLOW_STATUS.PENDING,
        WORKFLOW_STATUS.RUNNING,
        WORKFLOW_STATUS.VERIFICATION_IN_PROGRESS,
        WORKFLOW_STATUS.CREDIT_CHECK_IN_PROGRESS,
        WORKFLOW_STATUS.COMPENSATING,
      ];

      const res = await query(
        `SELECT workflow_id, correlation_id, workflow_type, current_step, status, created_at, retry_count
         FROM workflows
         WHERE status = ANY($1::varchar[])
         ORDER BY created_at ASC`,
        [activeStatuses]
      );

      const count = res.rows.length;
      if (count === 0) {
        logger.info('[RecoveryService] No orphaned or incomplete workflows detected. System is clean.');
        return { recovered: 0, workflows: [] };
      }

      logger.warn(`[RecoveryService] Found ${count} incomplete workflow(s) to recover after startup!`);
      const recoveredList = [];

      for (const wf of res.rows) {
        try {
          logger.info(`[RecoveryService] Reconstructing state for workflow ${wf.workflow_id} (Status: ${wf.status})`);

          // Read the steps from PostgreSQL
          const stepsRes = await query(
            'SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC',
            [wf.workflow_id]
          );

          // Find the last completed step
          const completedSteps = stepsRes.rows.filter((s) => s.status === STEP_STATUS.COMPLETED);
          const inProgressStep = stepsRes.rows.find((s) => s.status === STEP_STATUS.IN_PROGRESS || s.status === STEP_STATUS.PENDING);

          if (wf.status === WORKFLOW_STATUS.COMPENSATING) {
            // Workflow was compensating when crash happened; re-dispatch compensation
            logger.info(`[RecoveryService] Workflow ${wf.workflow_id} was compensating. Resuming compensation.`);
            await sagaOrchestrator.handleStepFailureOrRejection(
              wf.workflow_id,
              wf.current_step,
              'Resumed compensation after orchestrator restart',
              true
            );
          } else if (inProgressStep) {
            // Resume from this unconfirmed step
            logger.info(`[RecoveryService] Resuming workflow ${wf.workflow_id} at step ${inProgressStep.step_name}`);
            await sagaOrchestrator.replayWorkflow(wf.workflow_id);
          }

          recoveredList.push({
            workflowId: wf.workflow_id,
            previousStatus: wf.status,
            resumedStep: wf.current_step,
          });
        } catch (err) {
          logger.error(`[RecoveryService] Failed to recover workflow ${wf.workflow_id}: ${err.message}`);
        }
      }

      logger.info(`[RecoveryService] Startup crash recovery complete. Recovered ${recoveredList.length} workflows.`);
      return { recovered: recoveredList.length, workflows: recoveredList };
    } catch (error) {
      logger.error(`[RecoveryService] Error during startup recovery scan: ${error.message}`);
      return { recovered: 0, error: error.message };
    }
  }
}

const recoveryService = new RecoveryService();

module.exports = {
  recoveryService,
  RecoveryService,
};
