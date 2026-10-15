import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import api from '../api/client';

export default function EventLogs() {
  const [events, setEvents] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [workflowIdSearch, setWorkflowIdSearch] = useState('');
  const [selectedPayload, setSelectedPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchEvents = async (page = 1) => {
    try {
      setLoading(true);
      const res = await api.listAllEvents({
        page,
        limit: pagination.limit,
        eventType: eventTypeFilter || undefined,
        workflowId: workflowIdSearch || undefined,
      });
      setEvents(res.data || []);
      setPagination(res.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (e) {
      console.error('Error fetching event logs:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents(1);
  }, [eventTypeFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchEvents(1);
  };

  return (
    <div className="page-wrapper">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Append-Only Audit Event Store
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Immutable event sourcing log of all Kafka events and Saga state transitions
          </p>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={() => fetchEvents(pagination.page)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>Refresh Events</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search by Workflow ID..."
              value={workflowIdSearch}
              onChange={(e) => setWorkflowIdSearch(e.target.value)}
            />
          </div>

          <div style={{ width: '240px' }}>
            <select
              className="form-select"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
            >
              <option value="">All Event Types</option>
              <option value="WORKFLOW_STARTED">WORKFLOW_STARTED</option>
              <option value="VERIFICATION_SUCCESS">VERIFICATION_SUCCESS</option>
              <option value="VERIFICATION_FAILED">VERIFICATION_FAILED</option>
              <option value="CREDIT_APPROVED">CREDIT_APPROVED</option>
              <option value="CREDIT_REJECTED">CREDIT_REJECTED</option>
              <option value="COMPENSATE_VERIFICATION">COMPENSATE_VERIFICATION</option>
              <option value="WORKFLOW_COMPENSATED">WORKFLOW_COMPENSATED</option>
              <option value="WORKFLOW_COMPLETED">WORKFLOW_COMPLETED</option>
              <option value="WORKFLOW_RECOVERY_TRIGGERED">WORKFLOW_RECOVERY_TRIGGERED</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary btn-sm">Filter</button>
        </form>
      </div>

      {/* Events Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Workflow ID</th>
                <th>Source Service</th>
                <th>Target Topic</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {events.length > 0 ? (
                events.map((ev) => (
                  <tr key={ev.event_id}>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td>
                      <code style={{ fontWeight: 600, color: 'var(--primary-blue)' }}>
                        {ev.event_type}
                      </code>
                    </td>
                    <td>
                      <code style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {ev.workflow_id ? ev.workflow_id.substring(0, 8) + '...' : 'N/A'}
                      </code>
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                        {ev.source_service}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {ev.target_topic || 'orchestrator.internal'}
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                        onClick={() => setSelectedPayload(ev)}
                      >
                        <Eye size={12} />
                        <span>View JSON</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No events recorded matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--border-color)', backgroundColor: '#F8FAFC' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Showing Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages || 1}</strong> ({pagination.total} total events)
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={pagination.page <= 1}
              onClick={() => fetchEvents(pagination.page - 1)}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => fetchEvents(pagination.page + 1)}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Payload Modal */}
      {selectedPayload && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}>
          <div className="card" style={{ width: '600px', maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <div className="card-title">
                <span>Event: {selectedPayload.event_type}</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedPayload(null)}>✕ Close</button>
            </div>
            <pre style={{ flex: 1, backgroundColor: '#0F172A', color: '#E2E8F0', padding: '16px', borderRadius: 'var(--radius-sm)', overflow: 'auto', fontSize: '0.82rem' }}>
              {JSON.stringify(selectedPayload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
