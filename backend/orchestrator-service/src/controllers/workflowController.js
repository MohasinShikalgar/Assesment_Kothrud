const { z } = require('zod');
const { query } = require('../../../shared/db');
const { sagaOrchestrator } = require('../services/sagaOrchestrator');
const { workflowEngine } = require('../../../shared/workflowEngine');
const { getCache, setCache } = require('../../../shared/redisClient');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('workflow-controller');

const SubmitWorkflowSchema = z.object({
  workflowType: z.string().default('kyc_approval_pipeline'),
  inputPayload: z.object({
    customerName: z.string().min(1, 'Customer name is required'),
    idNumber: z.string().min(1, 'ID number is required'),
    idType: z.string().default('AADHAAR'),
    loanAmount: z.number().positive().default(100000),
    monthlyIncome: z.number().positive().default(50000),
    creditScore: z.number().int().min(300).max(900).default(750),
    failVerification: z.boolean().optional(),
    simulateReject: z.boolean().optional(),
    simulateTechnicalError: z.boolean().optional(),
    forceCompensationFailure: z.boolean().optional(),
    correlationId: z.string().optional(),
  }),
});

/**
 * Submit a new workflow
 * POST /api/v1/workflows
 */
async function submitWorkflow(req, res, next) {
  try {
    const parseResult = SubmitWorkflowSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey || null;

    const result = await sagaOrchestrator.submitWorkflow({
      workflowType: parseResult.data.workflowType,
      inputPayload: parseResult.data.inputPayload,
      idempotencyKey,
    });

    const statusCode = result.idempotentReplay ? 200 : 201;
    return res.status(statusCode).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * List workflows with pagination and filters
 * GET /api/v1/workflows
 */
async function listWorkflows(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      workflowType,
      search,
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (workflowType) {
      params.push(workflowType);
      conditions.push(`workflow_type = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(workflow_id::text ILIKE $${params.length} OR correlation_id ILIKE $${params.length} OR input_payload->>'customerName' ILIKE $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countSql = `SELECT COUNT(*) AS total FROM workflows ${whereClause}`;
    const countRes = await query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    // Data query
    params.push(parseInt(limit, 10), offset);
    const dataSql = `
      SELECT workflow_id, correlation_id, workflow_type, version, current_step, status,
             compensation_status, retry_count, created_at, updated_at, completed_at,
             input_payload->>'customerName' AS customer_name,
             (input_payload->>'loanAmount')::numeric AS loan_amount
      FROM workflows
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;
    const dataRes = await query(dataSql, params);

    return res.json({
      data: dataRes.rows,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get workflow by ID
 * GET /api/v1/workflows/:workflowId
 */
async function getWorkflowById(req, res, next) {
  try {
    const { workflowId } = req.params;

    // Check Redis cache first
    const cached = await getCache(`workflow:${workflowId}`);
    if (cached && req.query.fresh !== 'true') {
      return res.json(cached);
    }

    const sql = `
      SELECT w.*,
             COALESCE(
               (SELECT json_agg(s ORDER BY s.step_order ASC)
                FROM workflow_steps s WHERE s.workflow_id = w.workflow_id), '[]'::json
             ) AS steps
      FROM workflows w
      WHERE w.workflow_id = $1;
    `;
    const result = await query(sql, [workflowId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Workflow '${workflowId}' not found` });
    }

    const workflow = result.rows[0];
    await setCache(`workflow:${workflowId}`, workflow, 30);

    return res.json(workflow);
  } catch (err) {
    next(err);
  }
}

/**
 * Get workflow events history
 * GET /api/v1/workflows/:workflowId/events
 */
async function getWorkflowEvents(req, res, next) {
  try {
    const { workflowId } = req.params;
    const sql = `
      SELECT event_id, workflow_id, correlation_id, event_type, source_service, target_topic, payload, status, retry_count, error_details, created_at
      FROM workflow_events
      WHERE workflow_id = $1
      ORDER BY created_at ASC;
    `;
    const result = await query(sql, [workflowId]);
    return res.json({ workflowId, count: result.rows.length, events: result.rows });
  } catch (err) {
    next(err);
  }
}

/**
 * Get workflow steps
 * GET /api/v1/workflows/:workflowId/steps
 */
async function getWorkflowSteps(req, res, next) {
  try {
    const { workflowId } = req.params;
    const sql = `
      SELECT step_id, workflow_id, step_name, step_order, status, input_data, output_data, error_details, started_at, completed_at, compensated_at, retry_count, created_at, updated_at
      FROM workflow_steps
      WHERE workflow_id = $1
      ORDER BY step_order ASC;
    `;
    const result = await query(sql, [workflowId]);
    return res.json({ workflowId, count: result.rows.length, steps: result.rows });
  } catch (err) {
    next(err);
  }
}

/**
 * Retry workflow
 * POST /api/v1/workflows/:workflowId/retry
 */
async function retryWorkflow(req, res, next) {
  try {
    const { workflowId } = req.params;
    const result = await sagaOrchestrator.replayWorkflow(workflowId);
    return res.json({
      message: 'Workflow retry initiated successfully',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Replay workflow from event log
 * POST /api/v1/workflows/:workflowId/replay
 */
async function replayWorkflow(req, res, next) {
  try {
    const { workflowId } = req.params;
    const result = await sagaOrchestrator.replayWorkflow(workflowId);
    return res.json({
      message: 'Workflow replay reconstructed from PostgreSQL event log',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Workflow specific metrics
 * GET /api/v1/workflows/:workflowId/metrics
 */
async function getWorkflowMetrics(req, res, next) {
  try {
    const { workflowId } = req.params;
    const wfRes = await query('SELECT created_at, completed_at, status, retry_count FROM workflows WHERE workflow_id = $1', [workflowId]);
    if (wfRes.rows.length === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const wf = wfRes.rows[0];
    const stepsRes = await query('SELECT step_name, started_at, completed_at, status, retry_count FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC', [workflowId]);

    const totalDurationMs = wf.completed_at
      ? new Date(wf.completed_at).getTime() - new Date(wf.created_at).getTime()
      : Date.now() - new Date(wf.created_at).getTime();

    const stepMetrics = stepsRes.rows.map((s) => ({
      step: s.step_name,
      status: s.status,
      retryCount: s.retry_count,
      durationMs: s.completed_at && s.started_at
        ? new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()
        : null,
    }));

    return res.json({
      workflowId,
      status: wf.status,
      totalDurationMs,
      retryCount: wf.retry_count,
      steps: stepMetrics,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Global Dashboard Stats
 * GET /api/v1/admin/dashboard-stats
 */
async function getDashboardStats(req, res, next) {
  try {
    const statusCountsSql = `
      SELECT status, COUNT(*) AS count
      FROM workflows
      GROUP BY status;
    `;
    const statusCountsRes = await query(statusCountsSql);

    const counts = {
      TOTAL: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      COMPENSATED: 0,
      PENDING: 0,
    };

    statusCountsRes.rows.forEach((r) => {
      const count = parseInt(r.count, 10);
      counts.TOTAL += count;
      if (r.status === 'COMPLETED') counts.COMPLETED += count;
      else if (r.status === 'FAILED') counts.FAILED += count;
      else if (r.status === 'COMPENSATED') counts.COMPENSATED += count;
      else if (['RUNNING', 'VERIFICATION_IN_PROGRESS', 'CREDIT_CHECK_IN_PROGRESS', 'COMPENSATING'].includes(r.status)) {
        counts.RUNNING += count;
      } else {
        counts.PENDING += count;
      }
    });

    const successRate = counts.TOTAL > 0 ? ((counts.COMPLETED / counts.TOTAL) * 100).toFixed(1) : 0;

    // Average duration of completed workflows
    const avgDurationRes = await query(`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) * 1000 AS avg_duration_ms
      FROM workflows
      WHERE status = 'COMPLETED' AND completed_at IS NOT NULL;
    `);
    const avgDurationMs = Math.round(avgDurationRes.rows[0]?.avg_duration_ms || 240);

    // Recent activity list
    const recentActivityRes = await query(`
      SELECT w.workflow_id, w.correlation_id, w.workflow_type, w.status, w.current_step, w.created_at,
             w.input_payload->>'customerName' AS customer_name,
             (w.input_payload->>'loanAmount')::numeric AS loan_amount
      FROM workflows w
      ORDER BY w.created_at DESC
      LIMIT 10;
    `);

    // Volume history (last 7 time buckets)
    const volumeHistoryRes = await query(`
      SELECT to_char(created_at, 'HH24:00') AS time_bucket,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
             COUNT(*) FILTER (WHERE status = 'FAILED' OR status = 'COMPENSATED') AS failed
      FROM workflows
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY to_char(created_at, 'HH24:00')
      ORDER BY time_bucket ASC;
    `);

    return res.json({
      counts,
      successRate: parseFloat(successRate),
      avgDurationMs,
      recentActivity: recentActivityRes.rows,
      volumeHistory: volumeHistoryRes.rows,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitWorkflow,
  listWorkflows,
  getWorkflowById,
  getWorkflowEvents,
  getWorkflowSteps,
  retryWorkflow,
  replayWorkflow,
  getWorkflowMetrics,
  getDashboardStats,
};
