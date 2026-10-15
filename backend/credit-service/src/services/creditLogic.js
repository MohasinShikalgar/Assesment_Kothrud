const { createLogger } = require('../../../shared/logger');

const logger = createLogger('credit-logic');

const creditRecords = new Map();
const processedEvents = new Set();

let simulationConfig = {
  forceRejection: false,
  forceTechnicalError: false,
  processingDelayMs: 50,
};

function setSimulationConfig(config = {}) {
  simulationConfig = { ...simulationConfig, ...config };
  logger.info('[Credit] Updated simulation configuration', simulationConfig);
}

function getSimulationConfig() {
  return { ...simulationConfig };
}

/**
 * Perform Mock Credit Evaluation
 */
async function processCreditCheck(envelope) {
  const { eventId, workflowId, payload } = envelope;

  // Idempotency check
  if (processedEvents.has(eventId)) {
    logger.warn(`[Credit] Duplicate event received: ${eventId} for workflow: ${workflowId}`);
    return {
      status: 'DUPLICATE',
      workflowId,
      result: creditRecords.get(workflowId) || { status: 'ALREADY_PROCESSED' },
    };
  }

  // Artificial latency simulation
  if (simulationConfig.processingDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, simulationConfig.processingDelayMs));
  }

  const {
    loanAmount = 100000,
    monthlyIncome = 45000,
    creditScore = 750,
    simulateReject = false,
    simulateTechnicalError = false,
  } = payload || {};

  // Check transient technical error simulation
  if (simulationConfig.forceTechnicalError || simulateTechnicalError) {
    logger.error(`[Credit] Simulated temporary downstream API technical failure for workflow ${workflowId}`);
    return {
      status: 'TECHNICAL_ERROR',
      workflowId,
      error: 'Downstream Credit Bureau API gateway timeout (504 Gateway Timeout)',
    };
  }

  // Check business rejection conditions
  const isRejected =
    simulationConfig.forceRejection ||
    simulateReject === true ||
    creditScore < 650 ||
    monthlyIncome < 20000 ||
    loanAmount > monthlyIncome * 20;

  if (isRejected) {
    const reason =
      creditScore < 650
        ? `Credit score ${creditScore} is below minimum requirement of 650`
        : monthlyIncome < 20000
        ? `Monthly income of ₹${monthlyIncome} is below minimum underwriting threshold`
        : 'Debt-to-income ratio exceeded underwriting threshold';

    logger.warn(`[Credit] Credit rejected for workflow ${workflowId}. Reason: ${reason}`);

    const rejectionData = {
      approved: false,
      creditScore: creditScore || 580,
      reason,
      evaluatedAt: new Date().toISOString(),
      riskTier: 'HIGH_RISK',
    };

    creditRecords.set(workflowId, rejectionData);
    processedEvents.add(eventId);

    return {
      status: 'REJECTED',
      workflowId,
      data: rejectionData,
      reason,
    };
  }

  // Credit Approved
  const approvalData = {
    approved: true,
    creditScore: creditScore || 775,
    maxApprovedAmount: Math.min(loanAmount, monthlyIncome * 15),
    interestRatePercent: 10.5,
    approvalCode: `CRD-${Math.floor(100000 + Math.random() * 900000)}`,
    evaluatedAt: new Date().toISOString(),
    riskTier: 'PRIME',
  };

  creditRecords.set(workflowId, approvalData);
  processedEvents.add(eventId);

  logger.info(`[Credit] Approved loan for workflow ${workflowId}, ApprovalCode: ${approvalData.approvalCode}`);
  return {
    status: 'APPROVED',
    workflowId,
    data: approvalData,
  };
}

function getCreditRecord(workflowId) {
  return creditRecords.get(workflowId) || null;
}

module.exports = {
  processCreditCheck,
  setSimulationConfig,
  getSimulationConfig,
  getCreditRecord,
};
