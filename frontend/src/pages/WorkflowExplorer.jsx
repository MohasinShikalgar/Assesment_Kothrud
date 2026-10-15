import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, RefreshCw, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function WorkflowExplorer() {
  const [workflows, setWorkflows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkflows = async (page = 1) => {
    try {
      setRefreshing(true);
      const res = await api.listWorkflows({
        page,
        limit: pagination.limit,
        search: search || undefined,
        status: statusFilter || undefined,
      });
      setWorkflows(res.data || []);
      setPagination(res.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Error fetching workflows:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWorkflows(1);
  }, [statusFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchWorkflows(1);
  };

  return (
    <div className="page-wrapper">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Workflow Explorer
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Search, filter, and inspect persisted PostgreSQL workflow instances
          </p>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={() => fetchWorkflows(pagination.page)} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search by Workflow ID, Correlation ID, Customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '36px' }}
            />
            <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '12px' }} />
          </div>

          <div style={{ width: '200px' }}>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="COMPENSATED">Compensated</option>
              <option value="FAILED">Failed</option>
              <option value="VERIFICATION_IN_PROGRESS">Verification In Progress</option>
              <option value="CREDIT_CHECK_IN_PROGRESS">Credit Check In Progress</option>
              <option value="COMPENSATING">Compensating</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary btn-sm">
            Search
          </button>
        </form>
      </div>

      {/* Results Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Workflow ID</th>
                <th>Correlation ID</th>
                <th>Customer</th>
                <th>Loan Amount</th>
                <th>Current Step</th>
                <th>Status</th>
                <th>Created At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {workflows.length > 0 ? (
                workflows.map((wf) => (
                  <tr key={wf.workflow_id}>
                    <td>
                      <code style={{ fontSize: '0.82rem', color: 'var(--primary-blue)', fontWeight: 600 }}>
                        {wf.workflow_id.substring(0, 13)}...
                      </code>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {wf.correlation_id ? `${wf.correlation_id.substring(0, 8)}...` : 'N/A'}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {wf.customer_name || 'N/A'}
                    </td>
                    <td>
                      ₹{(wf.loan_amount || 0).toLocaleString()}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{wf.current_step}</span>
                    </td>
                    <td>
                      <StatusBadge status={wf.status} />
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {new Date(wf.created_at).toLocaleString()}
                    </td>
                    <td>
                      <Link to={`/workflows/${wf.workflow_id}`} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px' }}>
                        <span>Inspect</span>
                        <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    {loading ? 'Fetching workflows from database...' : 'No workflows found matching your search criteria.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--border-color)', backgroundColor: '#F8FAFC' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Showing Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages || 1}</strong> ({pagination.total} total instances)
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={pagination.page <= 1}
              onClick={() => fetchWorkflows(pagination.page - 1)}
            >
              <ChevronLeft size={14} />
              <span>Previous</span>
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => fetchWorkflows(pagination.page + 1)}
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
