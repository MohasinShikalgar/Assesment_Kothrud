import React, { useState, useEffect } from 'react';
import {
  Activity,
  Database,
  Server,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import api from '../api/client';

export default function ServiceHealth() {
  const [healthData, setHealthData] = useState(null);
  const [circuitBreakers, setCircuitBreakers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState(null);

  const fetchHealth = async () => {
    try {
      const [hRes, bRes] = await Promise.all([
        api.getHealth(),
        api.getCircuitBreakers(),
      ]);
      setHealthData(hRes);
      setCircuitBreakers(bRes.breakers || []);
    } catch (e) {
      console.error('Error fetching health:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleResetBreaker = async (name) => {
    try {
      await api.resetCircuitBreaker(name);
      setActionMessage(`Circuit breaker '${name}' reset to CLOSED.`);
      await fetchHealth();
    } catch (e) {
      setActionMessage(`Error: ${e.message}`);
    }
  };

  const handleTripBreaker = async (name) => {
    try {
      await api.tripCircuitBreaker(name);
      setActionMessage(`Circuit breaker '${name}' manually tripped to OPEN.`);
      await fetchHealth();
    } catch (e) {
      setActionMessage(`Error: ${e.message}`);
    }
  };

  const db = healthData?.components?.database;
  const kafka = healthData?.components?.kafka;
  const redis = healthData?.components?.redis;

  return (
    <div className="page-wrapper">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Service Topology & Infrastructure Health
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Real-time status of microservices, persistence engines, circuit breakers, and telemetry
          </p>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={fetchHealth}>
          <span>Refresh Status</span>
        </button>
      </div>

      {actionMessage && (
        <div style={{ padding: '12px 16px', backgroundColor: 'var(--surface-blue)', color: 'var(--primary-blue)', borderRadius: 'var(--radius-sm)', marginBottom: '20px' }}>
          {actionMessage}
        </div>
      )}

      {/* 3 Microservices Topology Grid */}
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '14px' }}>
        Microservices Topology (Node.js + Express)
      </h3>
      <div className="grid-3" style={{ marginBottom: '28px' }}>
        {/* Orchestrator Service */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Orchestrator Service</span>
            <span className="badge badge-success">ACTIVE :5000</span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div><strong>Role:</strong> Saga Coordinator & State Machine</div>
            <div><strong>Uptime:</strong> {Math.round(healthData?.uptimeSeconds || 0)}s</div>
            <div><strong>Transactional Outbox:</strong> Active (300ms poll)</div>
            <div><strong>Recovery Engine:</strong> Clean / Active</div>
          </div>
        </div>

        {/* Verification Service */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Verification Service</span>
            <span className="badge badge-success">ACTIVE :5001</span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div><strong>Role:</strong> Identity & KYC Verification</div>
            <div><strong>Kafka Consumer:</strong> verification-service-group</div>
            <div><strong>Compensation:</strong> Reverse KYC Supported</div>
            <div><strong>Protocol:</strong> Kafka Events (No Direct HTTP)</div>
          </div>
        </div>

        {/* Credit Service */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Credit Service</span>
            <span className="badge badge-success">ACTIVE :5002</span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div><strong>Role:</strong> Bureau Credit Risk Scoring</div>
            <div><strong>Kafka Consumer:</strong> credit-service-group</div>
            <div><strong>Underwriting Rules:</strong> Score &ge; 650, DTI &lt; 40%</div>
            <div><strong>Protocol:</strong> Kafka Events (No Direct HTTP)</div>
          </div>
        </div>
      </div>

      {/* Infrastructure Components */}
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '14px' }}>
        Infrastructure & Persistence Layer
      </h3>
      <div className="grid-3" style={{ marginBottom: '28px' }}>
        {/* PostgreSQL */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Database size={20} color="var(--primary-blue)" />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>PostgreSQL</span>
            <span className={`badge ${db?.status === 'UP' ? 'badge-success' : 'badge-danger'}`} style={{ marginLeft: 'auto' }}>
              {db?.status || 'UNKNOWN'}
            </span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div><strong>Database:</strong> {db?.database || 'bankproject'}</div>
            <div><strong>Host:</strong> localhost:5432</div>
            <div><strong>Latency:</strong> {db?.latencyMs || 0} ms</div>
            <div><strong>Connection Pool:</strong> {db?.pool?.idle || 0} idle / {db?.pool?.total || 0} total</div>
            <div><strong>Source of Truth:</strong> Append-Only Durable Store</div>
          </div>
        </div>

        {/* Kafka Broker */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Server size={20} color="var(--primary-blue)" />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Apache Kafka</span>
            <span className={`badge ${kafka?.status === 'UP' ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: 'auto' }}>
              {kafka?.status || 'STANDBY'}
            </span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div><strong>Mode:</strong> {kafka?.mode || 'LOCAL_EVENT_HUB'}</div>
            <div><strong>Bootstrap Brokers:</strong> {kafka?.brokers?.join(', ')}</div>
            <div><strong>Partitions:</strong> Sharded by workflow_id</div>
            <div><strong>Dead Letter Queue:</strong> workflow.events.dlq</div>
          </div>
        </div>

        {/* Redis / Cache */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Zap size={20} color="var(--primary-blue)" />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Redis & BullMQ</span>
            <span className={`badge ${redis?.status === 'UP' ? 'badge-success' : 'badge-neutral'}`} style={{ marginLeft: 'auto' }}>
              {redis?.mode || 'STANDBY'}
            </span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div><strong>Cache Mode:</strong> {redis?.mode || 'IN_MEMORY_FALLBACK'}</div>
            <div><strong>Port:</strong> {redis?.port || 6379}</div>
            <div><strong>BullMQ Queue:</strong> workflow-retries</div>
            <div><strong>Fallback Cache:</strong> Active</div>
          </div>
        </div>
      </div>

      {/* Circuit Breakers & Fault Tolerance */}
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '14px' }}>
        Circuit Breakers & Fault Tolerance
      </h3>
      <div className="card" style={{ marginBottom: '28px' }}>
        <div className="table-container" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Breaker Name</th>
                <th>Current State</th>
                <th>Failures Recorded</th>
                <th>Failure Threshold</th>
                <th>Cooldown Reset</th>
                <th>Operational Controls</th>
              </tr>
            </thead>
            <tbody>
              {circuitBreakers.map((b) => (
                <tr key={b.name}>
                  <td><strong>{b.name}</strong></td>
                  <td>
                    <span className={`badge ${b.state === 'CLOSED' ? 'badge-success' : b.state === 'OPEN' ? 'badge-danger' : 'badge-warning'}`}>
                      {b.state}
                    </span>
                  </td>
                  <td>{b.failureCount}</td>
                  <td>{b.failureThreshold}</td>
                  <td>{b.resetTimeoutMs / 1000}s</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleResetBreaker(b.name)}>
                        Reset (CLOSED)
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleTripBreaker(b.name)}>
                        Trip (OPEN)
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monitoring Links */}
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '14px' }}>
        Observability & Telemetry Endpoints
      </h3>
      <div className="grid-2">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Prometheus Metrics Endpoint</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Scrapable metrics on /api/v1/metrics
              </div>
            </div>
            <a href="http://localhost:5000/api/v1/metrics" target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              <span>View Prometheus Metrics</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Jaeger Distributed Tracing</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Visual span traces & correlation propagation
              </div>
            </div>
            <a href="http://localhost:16686" target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              <span>Open Jaeger UI</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
