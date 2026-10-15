const { createLogger } = require('../../../shared/logger');

const logger = createLogger('verification-logic');

// In-memory store for idempotency and KYC record status
const verifiedIdentities = new Map();
const processedEvents = new Set();

let simulationConfig = {
  forceFailure: false,
  forceCompensationFailure: false,
  processingDelayMs: 50,
};

function setSimulationConfig(config = {}) {
  simulationConfig = { ...simulationConfig, ...config };
  logger.info('[Verification] Updated simulation configuration', simulationConfig);
}

function getSimulationConfig() {
  return { ...simulationConfig };
}

/**
 * Process Identity/KYC Verification
 */
async function processVerification(envelope) {
  const { eventId, workflowId, payload } = envelope;

  // Idempotency check: if event already processed, return cached outcome
  if (processedEvents.has(eventId)) {
    logger.warn(`[Verification] Duplicate event detected: ${eventId} for workflow: ${workflowId}`);
    return {
      status: 'DUPLICATE',
      workflowId,
      result: verifiedIdentities.get(workflowId) || { status: 'ALREADY_PROCESSED' },
    };
  }

  // Artificial processing delay if configured
  if (simulationConfig.processingDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, simulationConfig.processingDelayMs));
  }

  const { customerName, idNumber, idType, failVerification } = payload || {};

  // Check failure conditions: explicit flag, config, or test ID
  const shouldFail =
    failVerification === true ||
    simulationConfig.forceFailure === true ||
    idNumber === 'FAIL_KYC' ||
    (customerName && customerName.toLowerCase().includes('fail_kyc'));

  if (shouldFail) {
    logger.warn(`[Verification] Identity verification failed for customer ${customerName || 'N/A'}, ID: ${idNumber}`);
    const failureResult = {
      verified: false,
      reason: 'Identity verification failed: document mismatch or blacklist hit',
      verifiedAt: new Date().toISOString(),
      serviceCode: 'VERIF_ERR_403',
    };
    processedEvents.add(eventId);
    return {
      status: 'FAILED',
      workflowId,
      error: failureResult.reason,
      data: failureResult,
    };
  }

  // Verification Success
  const successResult = {
    verified: true,
    verificationId: `KYC-${Math.floor(100000 + Math.random() * 900000)}`,
    customerName: customerName || 'Rajesh Sharma',
    idType: idType || 'AADHAAR',
    idNumber: idNumber || 'XXXX-XXXX-4210',
    verifiedAt: new Date().toISOString(),
    status: 'ACTIVE',
  };

  verifiedIdentities.set(workflowId, successResult);
  processedEvents.add(eventId);

  logger.info(`[Verification] Successfully verified identity for workflow ${workflowId}, KYC ID: ${successResult.verificationId}`);
  return {
    status: 'SUCCESS',
    workflowId,
    data: successResult,
  };
}

/**
 * Process Saga Compensation for Identity Verification
 * Undoes or flags previous successful KYC step
 */
async function processCompensation(envelope) {
  const { eventId, workflowId, payload } = envelope;

  if (simulationConfig.forceCompensationFailure === true || (payload && payload.forceCompensationFailure === true)) {
    logger.error(`[Verification] Simulated compensation failure for workflow ${workflowId}`);
    return {
      status: 'FAILED',
      workflowId,
      error: 'CRITICAL: Third-party KYC registry unavailable during rollback',
    };
  }

  const existing = verifiedIdentities.get(workflowId);
  if (existing) {
    existing.status = 'COMPENSATED_REVERSED';
    existing.compensatedAt = new Date().toISOString();
    existing.compensationReason = payload.reason || 'Downstream credit check failure';
  }

  logger.info(`[Verification:Compensation] Successfully compensated and reversed KYC record for workflow ${workflowId}`);
  return {
    status: 'COMPENSATED',
    workflowId,
    data: {
      action: 'REVERSE_KYC',
      previousStatus: 'ACTIVE',
      newStatus: 'COMPENSATED_REVERSED',
      timestamp: new Date().toISOString(),
      reason: payload.reason || 'Downstream credit check rejected',
    },
  };
}

function getVerificationRecord(workflowId) {
  return verifiedIdentities.get(workflowId) || null;
}

module.exports = {
  processVerification,
  processCompensation,
  setSimulationConfig,
  getSimulationConfig,
  getVerificationRecord,
};
