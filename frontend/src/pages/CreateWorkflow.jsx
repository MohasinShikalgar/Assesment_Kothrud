import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, FileCode, CheckCircle2, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import api from '../api/client';

export default function CreateWorkflow() {
  const navigate = useNavigate();

  const [definitions, setDefinitions] = useState([]);
  const [selectedDefName, setSelectedDefName] = useState('kyc_approval_pipeline');
  const [selectedDef, setSelectedDef] = useState(null);

  const [formData, setFormData] = useState({
    customerName: 'Anand Kulkarni',
    idNumber: '4829-1092-8821',
    idType: 'AADHAAR',
    loanAmount: 150000,
    monthlyIncome: 65000,
    creditScore: 780,
    failVerification: false,
    simulateReject: false,
    simulateTechnicalError: false,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submissionResult, setSubmissionResult] = useState(null);

  useEffect(() => {
    async function loadDefs() {
      try {
        const res = await api.getDefinitions();
        setDefinitions(res.definitions || []);
        if (res.definitions?.length > 0) {
          setSelectedDef(res.definitions[0]);
          setSelectedDefName(res.definitions[0].name);
        }
      } catch (e) {
        console.error('Failed to load workflow definitions:', e);
      }
    }
    loadDefs();
  }, []);

  const handleDefChange = (e) => {
    const name = e.target.value;
    setSelectedDefName(name);
    const def = definitions.find((d) => d.name === name);
    setSelectedDef(def || null);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? parseFloat(value) : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSubmissionResult(null);

    try {
      const payload = {
        workflowType: selectedDefName,
        inputPayload: {
          customerName: formData.customerName,
          idNumber: formData.idNumber,
          idType: formData.idType,
          loanAmount: Number(formData.loanAmount),
          monthlyIncome: Number(formData.monthlyIncome),
          creditScore: Number(formData.creditScore),
          failVerification: formData.failVerification,
          simulateReject: formData.simulateReject,
          simulateTechnicalError: formData.simulateTechnicalError,
        },
      };

      const res = await api.submitWorkflow(payload);
      setSubmissionResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-wrapper">
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Initiate New Distributed Workflow
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Submit customer financial application to the Kafka-orchestrated Saga pipeline
        </p>
      </div>

      {submissionResult && (
        <div className="card" style={{ backgroundColor: 'var(--surface-blue)', borderColor: 'var(--surface-blue-border)', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <CheckCircle2 size={24} color="var(--primary-blue)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-blue)' }}>
              Workflow Successfully Dispatched!
            </h3>
          </div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            {submissionResult.message}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.85rem', marginBottom: '16px' }}>
            <div><strong>Workflow ID:</strong> <code>{submissionResult.workflowId}</code></div>
            <div><strong>Correlation ID:</strong> <code>{submissionResult.correlationId}</code></div>
            <div><strong>Initial Status:</strong> <span className="badge badge-info">{submissionResult.status}</span></div>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/workflows/${submissionResult.workflowId}`)}
            >
              <span>Track Live Saga Progress</span>
              <ArrowRight size={14} />
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSubmissionResult(null)}>
              Submit Another
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '14px', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid-2">
        {/* Form Card */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Application Parameters</div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Workflow Definition</label>
              <select className="form-select" value={selectedDefName} onChange={handleDefChange}>
                {definitions.map((def) => (
                  <option key={def.name} value={def.name}>
                    {def.name} (v{def.version})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Customer Name</label>
                <input
                  type="text"
                  name="customerName"
                  className="form-input"
                  value={formData.customerName}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Government ID Number</label>
                <input
                  type="text"
                  name="idNumber"
                  className="form-input"
                  value={formData.idNumber}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">Loan Amount (₹)</label>
                <input
                  type="number"
                  name="loanAmount"
                  className="form-input"
                  value={formData.loanAmount}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Monthly Income (₹)</label>
                <input
                  type="number"
                  name="monthlyIncome"
                  className="form-input"
                  value={formData.monthlyIncome}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Credit Bureau Score</label>
                <input
                  type="number"
                  name="creditScore"
                  className="form-input"
                  min="300"
                  max="900"
                  value={formData.creditScore}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>

            {/* Failure Injection Toggles */}
            <div style={{ marginTop: '16px', padding: '16px', backgroundColor: 'var(--bg-neutral)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>
                Failure & Compensation Simulation Controls
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="failVerification"
                    checked={formData.failVerification}
                    onChange={handleInputChange}
                  />
                  <span>Simulate Verification Failure (Step 1 failure)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="simulateReject"
                    checked={formData.simulateReject}
                    onChange={handleInputChange}
                  />
                  <span style={{ color: '#B45309', fontWeight: 600 }}>
                    Simulate Credit Rejection (Triggers Saga Compensation on Step 1)
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="simulateTechnicalError"
                    checked={formData.simulateTechnicalError}
                    onChange={handleInputChange}
                  />
                  <span>Simulate Bureau Technical Error (Tests retries & circuit breakers)</span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: '24px' }}>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
                <span>{loading ? 'Submitting to Saga Orchestrator...' : 'Submit Workflow to Pipeline'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* YAML Definition Preview */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <div className="card-title">
              <FileCode size={18} color="var(--primary-blue)" />
              <span>YAML Definition Preview</span>
            </div>
          </div>

          <div style={{ flex: 1, backgroundColor: '#0F172A', color: '#E2E8F0', padding: '16px', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontSize: '0.8rem', lineHeight: 1.6 }}>
            <pre>
              {selectedDef
                ? JSON.stringify(selectedDef, null, 2)
                : '// Select a workflow to preview definition'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
