import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PlusCircle, Database, Server, RefreshCw } from 'lucide-react';
import api from '../api/client';

export default function Navbar() {
  const location = useLocation();
  const [health, setHealth] = useState({ db: 'UP', kafka: 'UP' });

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await api.getHealth();
        setHealth({
          db: res.components?.database?.status || 'UP',
          kafka: res.components?.kafka?.status || 'STANDBY',
        });
      } catch (e) {
        setHealth({ db: 'DEGRADED', kafka: 'STANDBY' });
      }
    }
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/': return 'Executive Saga Dashboard';
      case '/create': return 'Submit New Workflow';
      case '/workflows': return 'Workflow Explorer';
      case '/events': return 'Audit Event Store';
      case '/health': return 'Microservice & Infrastructure Health';
      case '/config': return 'YAML Workflow Definitions';
      case '/lab': return 'Saga Failure & Resilience Testing Lab';
      default: return 'Workflow Details';
    }
  };

  return (
    <header className="top-navbar">
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {getPageTitle()}
        </h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* PostgreSQL Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <Database size={15} color={health.db === 'UP' ? 'var(--success)' : 'var(--danger)'} />
          <span>PostgreSQL: <strong style={{ color: health.db === 'UP' ? 'var(--success)' : 'var(--danger)' }}>{health.db}</strong></span>
        </div>

        {/* Kafka Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <Server size={15} color={health.kafka === 'UP' ? 'var(--success)' : 'var(--warning)'} />
          <span>Event Pipeline: <strong style={{ color: health.kafka === 'UP' ? 'var(--success)' : 'var(--warning)' }}>{health.kafka}</strong></span>
        </div>

        <Link to="/create" className="btn btn-primary btn-sm">
          <PlusCircle size={15} />
          <span>New Workflow</span>
        </Link>
      </div>
    </header>
  );
}
