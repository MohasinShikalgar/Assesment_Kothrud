import React from 'react';
import { CheckCircle2, Clock, XCircle, RotateCcw, ArrowRight } from 'lucide-react';
import StatusBadge from './StatusBadge';

export default function StepTimeline({ steps = [], workflowStatus = 'PENDING', compensationStatus = 'NONE' }) {
  const getStepIcon = (status) => {
    switch ((status || '').toUpperCase()) {
      case 'COMPLETED':
        return <CheckCircle2 size={18} color="var(--success)" />;
      case 'COMPENSATED':
        return <RotateCcw size={18} color="#D97706" />;
      case 'FAILED':
        return <XCircle size={18} color="var(--danger)" />;
      case 'IN_PROGRESS':
        return <Clock size={18} color="var(--primary-blue)" />;
      default:
        return <Clock size={18} color="var(--text-light)" />;
    }
  };

  return (
    <div className="timeline-container" style={{ margin: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', overflowX: 'auto', padding: '12px 0' }}>
        {steps.map((step, index) => {
          const isCompensated = step.status === 'COMPENSATED';
          return (
            <React.Fragment key={step.step_id || index}>
              <div
                style={{
                  minWidth: '240px',
                  backgroundColor: isCompensated ? 'var(--warning-bg)' : 'var(--card-bg)',
                  border: `1px solid ${isCompensated ? 'var(--warning-border)' : 'var(--border-color)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  boxShadow: 'var(--shadow-sm)',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getStepIcon(step.status)}
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Step {step.step_order || index + 1}
                    </span>
                  </div>
                  <StatusBadge status={step.status} />
                </div>

                <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {step.step_name === 'verify_identity'
                    ? 'Identity Verification'
                    : step.step_name === 'credit_check'
                    ? 'Credit Bureau Evaluation'
                    : step.step_name}
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {step.started_at ? `Started: ${new Date(step.started_at).toLocaleTimeString()}` : 'Not started'}
                </div>

                {step.completed_at && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--success)' }}>
                    Completed: {new Date(step.completed_at).toLocaleTimeString()}
                  </div>
                )}

                {step.compensated_at && (
                  <div style={{ fontSize: '0.78rem', color: '#B45309', fontWeight: 600, marginTop: '4px' }}>
                    Compensated: {new Date(step.compensated_at).toLocaleTimeString()}
                  </div>
                )}

                {step.error_details && (
                  <div style={{
                    marginTop: '8px',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--danger-bg)',
                    color: 'var(--danger)',
                    fontSize: '0.74rem',
                  }}>
                    {typeof step.error_details === 'string' ? step.error_details : step.error_details.reason || 'Error'}
                  </div>
                )}
              </div>

              {index < steps.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center', color: 'var(--text-light)' }}>
                  <ArrowRight size={20} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
