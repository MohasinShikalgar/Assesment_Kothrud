import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Response interceptor for clean error unwrapping
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || 'An unexpected error occurred';
    return Promise.reject(new Error(errorMsg));
  }
);

export const api = {
  // Dashboard
  getDashboardStats: () => apiClient.get('/admin/dashboard-stats'),

  // Workflows
  submitWorkflow: (data, idempotencyKey = null) => {
    const headers = idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {};
    return apiClient.post('/workflows', data, { headers });
  },
  listWorkflows: (params) => apiClient.get('/workflows', { params }),
  getWorkflow: (id) => apiClient.get(`/workflows/${id}`),
  getWorkflowEvents: (id) => apiClient.get(`/workflows/${id}/events`),
  getWorkflowSteps: (id) => apiClient.get(`/workflows/${id}/steps`),
  getWorkflowMetrics: (id) => apiClient.get(`/workflows/${id}/metrics`),
  retryWorkflow: (id) => apiClient.post(`/workflows/${id}/retry`),
  replayWorkflow: (id) => apiClient.post(`/workflows/${id}/replay`),

  // Global Event Logs
  listAllEvents: (params) => apiClient.get('/events', { params }),

  // Definitions
  getDefinitions: () => apiClient.get('/definitions'),
  validateDefinition: (yamlContent) => apiClient.post('/definitions/validate', { yamlContent }),

  // System Health & Breakers
  getHealth: () => apiClient.get('/health'),
  getReadiness: () => apiClient.get('/ready'),
  getCircuitBreakers: () => apiClient.get('/circuit-breakers'),
  resetCircuitBreaker: (name) => apiClient.post(`/circuit-breakers/${name}/reset`),
  tripCircuitBreaker: (name) => apiClient.post(`/circuit-breakers/${name}/trip`),
  triggerRecovery: () => apiClient.post('/admin/recovery'),
};

export default api;
