import React from 'react';

export default function MetricCard({ title, value, subtext, icon: Icon, color = '#2563EB', trend }) {
  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {title}
        </span>
        {Icon && (
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: `${color}15`,
            color: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={20} />
          </div>
        )}
      </div>

      <div style={{ fontSize: '1.85rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '4px' }}>
        {value}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        {trend && (
          <span style={{ color: trend.startsWith('+') ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
            {trend}
          </span>
        )}
        <span>{subtext}</span>
      </div>
    </div>
  );
}
