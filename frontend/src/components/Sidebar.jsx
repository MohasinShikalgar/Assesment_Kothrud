import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  PlusCircle,
  ListTree,
  ScrollText,
  Activity,
  FileCode2,
  FlaskConical,
  Layers,
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/create', label: 'Create Workflow', icon: PlusCircle },
  { path: '/workflows', label: 'Workflow Explorer', icon: ListTree },
  { path: '/events', label: 'Event Logs', icon: ScrollText },
  { path: '/health', label: 'Service Health', icon: Activity },
  { path: '/config', label: 'Configuration', icon: FileCode2 },
  { path: '/lab', label: 'Failure Testing Lab', icon: FlaskConical },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-icon">
          <Layers size={22} />
        </div>
        <div>
          <div className="brand-title">FlowMaster</div>
          <div className="brand-sub">Saga Orchestrator</div>
        </div>
      </div>

      <nav className="nav-menu">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            end={path === '/'}
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div><strong>PostgreSQL:</strong> bankProject</div>
        <div><strong>Broker:</strong> Apache Kafka (KRaft)</div>
        <div style={{ color: '#10B981', marginTop: '4px' }}>● FlowMaster v1.0 Production</div>
      </div>
    </aside>
  );
}
