import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ServerCrash,
  RefreshCw,
  ArrowRight,
  Terminal,
} from 'lucide-react';
import api from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function FailureLab() {
  const [runningScenario, setRunningScenario] = useState(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState(null);
  const [activeWorkflow, setActiveWorkflow] = useState(null);
  const [logs, setLogs] = useState([]);

  const addLog = (msg) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 49)]);
  };

  const pollWorkflowUntilDone = async (workflowId) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const wf = await api.getWorkflow(workflowId);
        setActiveWorkflow(wf);
        addLog(`Workflow ${workflowId.substring(0, 8)}... Status: ${wf.status} (Step: ${wf.current_step})`);

        if (['COMPLETED', 'COMPENSATED', 'FAILED', 'RECOVERY_REQUIRED'].includes(wf.status) || attempts > 15) {
          clearInterval(interval);
          setRunningScenario(null);
          addLog(`Pipeline finished with terminal status: ${wf.status}`);
        }
      } catch (e) {
        clearInterval(interval);
        setRunningScenario(null);
      }
    }, 1000);
  };

  // Scenario 1: Happy Path
  const runHappyPath = async () => {
    setRunningScenario('happy');
    addLog('Initiating Scenario 1: Happy Path (Valid KYC + Approved Credit Score)');
    try {
      const res = await api.submitWorkflow({
        workflowType: 'kyc_approval_pipeline',
        inputPayload: {
          customerName: 'Sanjay Deshmukh',
          idNumber: 'KYC-VALID-7891',
          idType: 'AADHAAR',
          loanAmount: 200000,
          monthlyIncome: 85000,
          creditScore: 785,
        },
      });
      setActiveWorkflowId(res.workflowId);
      addLog(`Dispatched workflow: ${res.workflowId}`);
      pollWorkflowUntilDone(res.workflowId);
    } catch (e) {
      addLog(`Error: ${e.message}`);
      setRunningScenario(null);
    }
  };

  // Scenario 2: Credit Rejection & Compensation
  const runCompensationScenario = async () => {
    setRunningScenario('compensate');
    addLog('Initiating Scenario 2: Downstream Credit Rejection -> Triggers Saga Compensation on KYC');
    try {
      const res = await api.submitWorkflow({
        workflowType: 'kyc_approval_pipeline',
        inputPayload: {
          customerName: 'Pooja Agarwal',
          idNumber: 'KYC-VALID-1234',
          idType: 'AADHAAR',
          loanAmount: 300000,
          monthlyIncome: 25000,
          creditScore: 540, // Below 650 threshold -> will reject credit and trigger compensation!
          simulateReject: true,
        },
      });
      setActiveWorkflowId(res.workflowId);
      addLog(`Dispatched workflow: ${res.workflowId} with low credit score (540)`);
      pollWorkflowUntilDone(res.workflowId);
    } catch (e) {
      addLog(`Error: ${e.message}`);
      setRunningScenario(null);
    }
  };

  // Scenario 3: Identity Verification Failure
  const runVerificationFailure = async () => {
    setRunningScenario('verif_fail');
    addLog('Initiating Scenario 3: Immediate Identity/KYC Verification Failure');
    try {
      const res = await api.submitWorkflow({
        workflowType: 'kyc_approval_pipeline',
        inputPayload: {
          customerName: 'Fail_KYC Test User',
          idNumber: 'FAIL_KYC',
          idType: 'AADHAAR',
          loanAmount: 100000,
          monthlyIncome: 50000,
          creditScore: 750,
          failVerification: true,
        },
      });
      setActiveWorkflowId(res.workflowId);
      addLog(`Dispatched workflow: ${res.workflowId} with blacklist ID`);
      pollWorkflowUntilDone(res.workflowId);
    } catch (e) {
      addLog(`Error: ${e.message}`);
      setRunningScenario(null);
    }
  };

  // Scenario 4: Temporary Technical Failure
  const runTechnicalFailure = async () => {
    setRunningScenario('technical_error');
    addLog('Initiating Scenario 4: Bureau Gateway Timeout (504) -> Tests Circuit Breakers & Retries');
    try {
      const res = await api.submitWorkflow({
        workflowType: 'kyc_approval_pipeline',
        inputPayload: {
          customerName: 'Vijay Varma',
          idNumber: 'KYC-VALID-9900',
          idType: 'AADHAAR',
          loanAmount: 150000,
          monthlyIncome: 60000,
          creditScore: 750,
          simulateTechnicalError: true,
        },
      });
      setActiveWorkflowId(res.workflowId);
      addLog(`Dispatched workflow: ${res.workflowId} with simulated technical failure`);
      pollWorkflowUntilDone(res.workflowId);
    } catch (e) {
      addLog(`Error: ${e.message}`);
      setRunningScenario(null);
    }
  };

  // Scenario 5: Crash & Startup Recovery
  const runRecoverySimulation = async () => {
    setRunningScenario('recovery');
    addLog('Initiating Scenario 5: Triggering Crash Recovery Scan across PostgreSQL');
    try {
      const res = await api.triggerRecovery();
      addLog(`Recovery complete: Scanned PostgreSQL, recovered ${res.recovered} incomplete workflow(s)`);
      setRunningScenario(null);
    } catch (e) {
      addLog(`Recovery error: ${e.message}`);
      setRunningScenario(null);
    }
  };

  return (
    <div className="page-wrapper">
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Saga Failure & Resilience Testing Lab
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Interactively test and verify Saga compensations, rollback mechanics, circuit breakers, and crash recovery
        </p>
      </div>

      <div className="grid-2" style={{ marginBottom: '24px' }}>
        {/* Scenarios Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Scenario 1: Happy Path */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <CheckCircle2 size={18} color="var(--success)" />
                <span>Scenario 1: Happy Path (Full Approval)</span>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={runHappyPath}
                disabled={runningScenario !== null}
              >
                <Play size={13} />
                <span>Execute</span>
              </button>
            </div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
              KYC verification succeeds &rarr; Bureau credit check approved (785 score) &rarr; Saga commits terminal <strong>COMPLETED</strong>.
            </p>
          </div>

          {/* Scenario 2: Credit Rejection & Compensation */}
          <div className="card" style={{ padding: '18px 20px', backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#92400E' }}>
                <RotateCcw size={18} color="#D97706" />
                <span>Scenario 2: Credit Rejection & Compensation Rollback</span>
              </div>
              <button
                className="btn btn-sm"
                style={{ backgroundColor: '#D97706', color: 'white' }}
                onClick={runCompensationScenario}
                disabled={runningScenario !== null}
              >
                <Play size={13} />
                <span>Execute Saga Rollback</span>
              </button>
            </div>
            <p style={{ fontSize: '0.83rem', color: '#78350F' }}>
              KYC verification succeeds &rarr; Credit check rejects user (Score: 540) &rarr; Orchestrator detects failure &rarr; Dispatches <code>verification.compensate</code> event &rarr; KYC step is logically reversed &rarr; Workflow marked <strong>COMPENSATED</strong>.
            </p>
          </div>

          {/* Scenario 3: Identity Verification Failure */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <XCircle size={18} color="var(--danger)" />
                <span>Scenario 3: Identity Verification Failure</span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={runVerificationFailure}
                disabled={runningScenario !== null}
              >
                <Play size={13} />
                <span>Execute Fast-Fail</span>
              </button>
            </div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
              KYC document fails validation at step 1 &rarr; Workflow immediately fails &rarr; Zero downstream credit events published.
            </p>
          </div>

          {/* Scenario 4: Temporary Technical Failure */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <AlertTriangle size={18} color="var(--warning)" />
                <span>Scenario 4: Bureau Gateway Timeout (504)</span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={runTechnicalFailure}
                disabled={runningScenario !== null}
              >
                <Play size={13} />
                <span>Simulate Timeout</span>
              </button>
            </div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
              Simulates transient downstream API error. Verifies retry handling and circuit breaker tripping.
            </p>
          </div>

          {/* Scenario 5: Crash & Startup Recovery */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <ServerCrash size={18} color="var(--primary-blue)" />
                <span>Scenario 5: Crash & Restart Recovery</span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={runRecoverySimulation}
                disabled={runningScenario !== null}
              >
                <Play size={13} />
                <span>Trigger Recovery</span>
              </button>
            </div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
              Scans PostgreSQL for incomplete workflows and resumes them from the last confirmed step.
            </p>
          </div>
        </div>

        {/* Live Execution Monitor & Terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Active Workflow Status */}
          {activeWorkflow && (
            <div className="card" style={{ backgroundColor: 'var(--surface-blue)', borderColor: 'var(--surface-blue-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>Active Scenario Workflow</span>
                <StatusBadge status={activeWorkflow.status} />
              </div>
              <div style={{ fontSize: '0.82rem', marginBottom: '10px' }}>
                <div><strong>Workflow ID:</strong> <code>{activeWorkflow.workflow_id}</code></div>
                <div><strong>Current Step:</strong> {activeWorkflow.current_step}</div>
                <div><strong>Compensation Status:</strong> {activeWorkflow.compensation_status}</div>
              </div>
              <Link to={`/workflows/${activeWorkflow.workflow_id}`} className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
                <span>Inspect Full Timeline</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          )}

          {/* Terminal Console */}
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div style={{ backgroundColor: '#1E293B', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#94A3B8', fontSize: '0.82rem', fontWeight: 600 }}>
              <Terminal size={16} />
              <span>Real-Time Execution Console Log</span>
            </div>

            <div style={{
              flex: 1,
              backgroundColor: '#0F172A',
              color: '#38BDF8',
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              padding: '16px',
              minHeight: '280px',
              maxHeight: '380px',
              overflowY: 'auto',
              lineHeight: 1.6,
            }}>
              {logs.length > 0 ? (
                logs.map((log, i) => (
                  <div key={i} style={{ color: log.includes('COMPENSATED') ? '#FBBF24' : log.includes('COMPLETED') ? '#34D399' : log.includes('Error') ? '#F87171' : '#38BDF8' }}>
                    {log}
                  </div>
                ))
              ) : (
                <div style={{ color: '#64748B' }}>
                  // Click any scenario on the left to observe live Saga execution logs...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
