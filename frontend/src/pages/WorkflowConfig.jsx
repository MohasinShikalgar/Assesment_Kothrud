import React, { useState, useEffect } from 'react';
import { FileCode, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import api from '../api/client';

export default function WorkflowConfig() {
  const [definitions, setDefinitions] = useState([]);
  const [selectedDef, setSelectedDef] = useState(null);
  const [customYaml, setCustomYaml] = useState('');
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    async function fetchDefs() {
      try {
        const res = await api.getDefinitions();
        setDefinitions(res.definitions || []);
        if (res.definitions?.length > 0) {
          setSelectedDef(res.definitions[0]);
        }
      } catch (e) {
        console.error('Error loading definitions:', e);
      }
    }
    fetchDefs();
  }, []);

  const handleValidate = async () => {
    try {
      const res = await api.validateDefinition(customYaml);
      setValidationResult(res);
    } catch (e) {
      setValidationResult({ valid: false, error: e.message });
    }
  };

  return (
    <div className="page-wrapper">
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          YAML Workflow Definitions & Step Configurations
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Declarative Saga topologies, step timeouts, retry policies, and compensation rules
        </p>
      </div>

      <div className="grid-2">
        {/* Left: Active Definitions */}
        <div>
          <div className="card" style={{ marginBottom: '20px' }}>
            <div className="form-group">
              <label className="form-label">Select Loaded Workflow Definition</label>
              <select
                className="form-select"
                value={selectedDef?.name || ''}
                onChange={(e) => setSelectedDef(definitions.find((d) => d.name === e.target.value))}
              >
                {definitions.map((def) => (
                  <option key={def.name} value={def.name}>
                    {def.name} (v{def.version})
                  </option>
                ))}
              </select>
            </div>

            {selectedDef && (
              <div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', marginBottom: '14px', flexWrap: 'wrap' }}>
                  <div><strong>Version:</strong> {selectedDef.version}</div>
                  <div><strong>Timeout:</strong> {selectedDef.timeoutSeconds}s</div>
                  <div><strong>Initial Step:</strong> <code>{selectedDef.initialStep}</code></div>
                  <div><strong>Completion:</strong> <code>{selectedDef.completionStep?.name}</code></div>
                </div>

                <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
                  {selectedDef.description}
                </div>

                <h4 style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '12px' }}>
                  Pipeline Steps & Compensation Policies
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {selectedDef.steps?.map((step) => (
                    <div
                      key={step.id}
                      style={{
                        padding: '14px',
                        backgroundColor: '#F8FAFC',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          Step {step.order}: {step.name}
                        </span>
                        <span className="badge badge-neutral">{step.service}</span>
                      </div>

                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                        <div><strong>Start Event:</strong> <code>{step.startEvent}</code></div>
                        <div><strong>Result Event:</strong> <code>{step.resultEvent}</code></div>
                        <div><strong>Compensate Event:</strong> <code>{step.compensateEvent || 'N/A'}</code></div>
                        <div><strong>Timeout:</strong> {step.timeoutMs}ms</div>
                        <div><strong>Retries:</strong> {step.retryPolicy?.maxRetries || 3} (Exp Backoff)</div>
                        <div><strong>Compensation:</strong> {step.compensation?.required ? `Action: ${step.compensation.action}` : 'None'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Custom YAML Validator */}
        <div>
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <FileCode size={18} color="var(--primary-blue)" />
                <span>Custom YAML Definition Validator</span>
              </div>
            </div>

            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Test new Saga workflows against the FlowMaster Zod schema validator before deploying.
            </p>

            <textarea
              className="form-textarea"
              rows={14}
              style={{ fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5, marginBottom: '16px' }}
              placeholder={`name: "custom_payment_pipeline"\nversion: "1.0.0"\ninitialStep: "deduct_balance"\nsteps:\n  - id: "deduct_balance"\n    name: "Deduct Wallet Balance"\n    order: 1\n    service: "wallet-service"\n    startEvent: "wallet.deduct"\n    resultEvent: "wallet.result"\n    compensateEvent: "wallet.refund"\n    compensation:\n      action: "REFUND_WALLET"\n      required: true\ncompletionStep:\n  name: "order_confirmed"`}
              value={customYaml}
              onChange={(e) => setCustomYaml(e.target.value)}
            />

            <button className="btn btn-primary btn-sm" onClick={handleValidate} disabled={!customYaml.trim()}>
              <span>Validate YAML Schema</span>
            </button>

            {validationResult && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: validationResult.valid ? 'var(--success-bg)' : 'var(--danger-bg)',
                color: validationResult.valid ? 'var(--success)' : 'var(--danger)',
                fontSize: '0.85rem',
              }}>
                {validationResult.valid ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={16} />
                    <span>Valid FlowMaster YAML Definition! Ready for execution.</span>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>Schema Validation Failed:</div>
                    <div>{validationResult.error}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
