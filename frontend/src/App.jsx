import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';

import Dashboard from './pages/Dashboard';
import CreateWorkflow from './pages/CreateWorkflow';
import WorkflowExplorer from './pages/WorkflowExplorer';
import WorkflowDetails from './pages/WorkflowDetails';
import EventLogs from './pages/EventLogs';
import ServiceHealth from './pages/ServiceHealth';
import WorkflowConfig from './pages/WorkflowConfig';
import FailureLab from './pages/FailureLab';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <Navbar />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/create" element={<CreateWorkflow />} />
            <Route path="/workflows" element={<WorkflowExplorer />} />
            <Route path="/workflows/:workflowId" element={<WorkflowDetails />} />
            <Route path="/events" element={<EventLogs />} />
            <Route path="/health" element={<ServiceHealth />} />
            <Route path="/config" element={<WorkflowConfig />} />
            <Route path="/lab" element={<FailureLab />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
