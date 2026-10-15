import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  RotateCcw,
  RefreshCw,
  Clock,
  ShieldCheck,
  CreditCard,
  AlertTriangle,
  History,
  FileJson,
} from 'lucide-react';
import api from '../api/client';
import StatusBadge from '../components/StatusBadge';
import StepTimeline from '../components/StepTimeline';

export default function WorkflowDetails() {
  const { workflowId } = useParams();
  const [workflow, setWorkflow] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('events'); // events | input | output
  const [actionMessage, setActionMessage] = useState(null);

  const fetchDetails = async () => {
    try {
      setRefreshing(true);
      const [wfData, evData] = await Promise.all([
        api.getWorkflow(workflowId),
        api.getWorkflowEvents(workflowId),
      ]);
      setWorkflow(wfData);
      setEvents(evData.events || []);
    } catch (err) {
      console.error('Error fetching workflow details:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDetails();
    const interval = setInterval(fetchDetails, 2000); // 2s live polling
    return () => clearInterval(interval);
  }, [workflowId]);

  const handleRetry = async () => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await api.retryWorkflow(workflowId);
      setActionMessage({ type: 'success', text: res.message });
      await fetchDetails();
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReplay = async () => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await api.replayWorkflow(workflowId);
      setActionMessage({ type: 'success', text: res.message });
      await fetchDetails();
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !workflow) {
    return (
      <div className="page-wrapper" style={{ textAlign: 'center', padding: '60px' }}>
        <RefreshCw size={32} className="spin" color="var(--primary-blue)" />
        <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Retrieving workflow state from PostgreSQL...</p>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="page-wrapper">
        <Link to="/workflows" className="btn btn-secondary btn-sm" style={{ marginBottom: '16px' }}>
          <ArrowLeft size={14} /> Back to Explorer
        </Link>
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <h3>Workflow Not Found</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>The requested workflow ID does not exist.</p>
        </div>
      </div>
    );
  }

  const verifStep = workflow.steps?.find((s) => s.step_name === 'verify_identity');
  const creditStep = workflow.steps?.find((s) => s.step_name === 'credit_check');

  return (
    <div className="page-wrapper">
      {/* Header & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Link to="/workflows" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={16} />
            </Link>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Workflow: <span style={{ color: 'var(--primary-blue)', fontFamily: 'monospace' }}>{workflow.workflow_id}</span>
            </h2>
            <StatusBadge status={workflow.status} />
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', gap: '16px' }}>
            <span><strong>Correlation ID:</strong> <code>{workflow.correlation_id}</code></span>
            <span><strong>Definition:</strong> {workflow.workflow_type} (v{workflow.version})</span>
            <span><strong>Retries:</strong> {workflow.retry_count}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary btn-sm" onClick={fetchDetails} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            <span>Live Polling (2s)</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleRetry} disabled={actionLoading}>
            <RotateCcw size={14} />
            <span>Retry Step</span>
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleReplay} disabled={actionLoading}>
            <RotateCcw size={14} />
            <span>Replay from Event Store</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div style={{
          padding: '12px 16px',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '20px',
          backgroundColor: actionMessage.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
          color: actionMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
        }}>
          {actionMessage.text}
        </div>
      )}

      {/* Visual Saga Execution Timeline */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <div className="card-title">
            <span>Saga Execution State Machine</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Compensation Status: <strong style={{ color: workflow.compensation_status === 'SUCCESS' ? 'var(--warning)' : 'inherit' }}>{workflow.compensation_status}</strong>
          </div>
        </div>

        <StepTimeline
          steps={workflow.steps || []}
          workflowStatus={workflow.status}
          compensationStatus={workflow.compensation_status}
        />
      </div>

      {/* Service Outcome Cards */}
      <div className="grid-3" style={{ marginBottom: '24px' }}>
        {/* Verification Result Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <ShieldCheck size={20} color="var(--primary-blue)" />
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Identity Verification</h3>
          </div>
          {verifStep ? (
            <div>
              <div style={{ marginBottom: '8px' }}>
                <StatusBadge status={verifStep.status} />
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                {verifStep.output_data?.data?.verificationId && (
                  <div><strong>KYC ID:</strong> {verifStep.output_data.data.verificationId}</div>
                )}
                <div><strong>Customer:</strong> {workflow.input_payload?.customerName}</div>
                <div><strong>ID Number:</strong> {workflow.input_payload?.idNumber}</div>
                {verifStep.status === 'COMPENSATED' && (
                  <div style={{ color: '#B45309', fontWeight: 600, marginTop: '6px' }}>
                    Status: KYC Reversed & Compensated
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Awaiting execution...</div>
          )}
        </div>

        {/* Credit Assessment Result Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <CreditCard size={20} color="var(--primary-blue)" />
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Credit Assessment</h3>
          </div>
          {creditStep ? (
            <div>
              <div style={{ marginBottom: '8px' }}>
                <StatusBadge status={creditStep.status} />
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                <div><strong>Score Evaluated:</strong> {creditStep.output_data?.data?.creditScore || workflow.input_payload?.creditScore}</div>
                {creditStep.output_data?.data?.approvalCode && (
                  <div><strong>Approval Code:</strong> {creditStep.output_data.data.approvalCode}</div>
                )}
                {creditStep.error_details && (
                  <div style={{ color: 'var(--danger)', marginTop: '4px' }}>
                    <strong>Rejection:</strong> {typeof creditStep.error_details === 'string' ? creditStep.error_details : creditStep.error_details.reason}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Awaiting execution...</div>
          )}
        </div>

        {/* Compensation & Final Settlement Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <RotateCcw size={20} color={workflow.compensation_status === 'SUCCESS' ? '#D97706' : 'var(--text-muted)'} />
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Saga Compensation State</h3>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            <div><strong>Saga Outcome:</strong> <StatusBadge status={workflow.status} /></div>
            <div style={{ marginTop: '6px' }}><strong>Compensation:</strong> {workflow.compensation_status}</div>
            {workflow.status === 'COMPENSATED' && (
              <div style={{ padding: '8px', backgroundColor: 'var(--warning-bg)', borderRadius: '4px', marginTop: '8px', color: '#92400E', fontSize: '0.8rem' }}>
                Verified identity step was logically rolled back (flagged as compensated) to maintain decentralized consistency.
              </div>
            )}
            {workflow.status === 'COMPLETED' && (
              <div style={{ padding: '8px', backgroundColor: 'var(--success-bg)', borderRadius: '4px', marginTop: '8px', color: '#065F46', fontSize: '0.8rem' }}>
                All distributed steps completed without rollback. Loan approved.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs: Events History, Input, Output */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', backgroundColor: '#F8FAFC', padding: '0 16px' }}>
          <button
            onClick={() => setActiveTab('events')}
            style={{
              padding: '14px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.88rem',
              color: activeTab === 'events' ? 'var(--primary-blue)' : 'var(--text-muted)',
              borderBottom: activeTab === 'events' ? '2px solid var(--primary-blue)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <History size={16} />
            <span>Append-Only Event Store ({events.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('input')}
            style={{
              padding: '14px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.88rem',
              color: activeTab === 'input' ? 'var(--primary-blue)' : 'var(--text-muted)',
              borderBottom: activeTab === 'input' ? '2px solid var(--primary-blue)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FileJson size={16} />
            <span>Input Payload</span>
          </button>

          <button
            onClick={() => setActiveTab('output')}
            style={{
              padding: '14px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.88rem',
              color: activeTab === 'output' ? 'var(--primary-blue)' : 'var(--text-muted)',
              borderBottom: activeTab === 'output' ? '2px solid var(--primary-blue)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FileJson size={16} />
            <span>Output / Error Payload</span>
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          {activeTab === 'events' && (
            <div className="table-container" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Event Type</th>
                    <th>Source Service</th>
                    <th>Target Topic</th>
                    <th>Payload Snippet</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.event_id}>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(ev.created_at).toLocaleTimeString()}
                      </td>
                      <td>
                        <code style={{ fontWeight: 600, color: 'var(--primary-blue)' }}>
                          {ev.event_type}
                        </code>
                      </td>
                      <td>{ev.source_service}</td>
                      <td>{ev.target_topic || 'internal'}</td>
                      <td>
                        <pre style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxHeight: '60px', overflowY: 'auto' }}>
                          {JSON.stringify(ev.payload)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'input' && (
            <pre style={{ backgroundColor: '#0F172A', color: '#E2E8F0', padding: '16px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', overflowX: 'auto' }}>
              {JSON.stringify(workflow.input_payload, null, 2)}
            </pre>
          )}

          {activeTab === 'output' && (
            <pre style={{ backgroundColor: '#0F172A', color: '#E2E8F0', padding: '16px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', overflowX: 'auto' }}>
              {JSON.stringify(workflow.output_payload || workflow.error_details || { message: 'Workflow still in progress' }, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
