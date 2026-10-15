# FlowMaster REST API Documentation

All endpoints are versioned under `/api/v1`.

Base URL: `http://localhost:5000/api/v1`

---

## 1. Workflow Management

### `POST /api/v1/workflows`
Submit and initiate a new workflow instance.

#### Headers
- `Content-Type: application/json`
- `x-idempotency-key: <string>` (Optional, prevents duplicate executions)

#### Request Body
```json
{
  "workflowType": "kyc_approval_pipeline",
  "inputPayload": {
    "customerName": "Anand Kulkarni",
    "idNumber": "4829-1092-8821",
    "idType": "AADHAAR",
    "loanAmount": 150000,
    "monthlyIncome": 65000,
    "creditScore": 780,
    "failVerification": false,
    "simulateReject": false,
    "simulateTechnicalError": false
  }
}
```

#### Response (`201 Created` or `200 OK` on Idempotent Hit)
```json
{
  "workflowId": "a794bfa2-f38b-4b13-980b-22b02008f51a",
  "correlationId": "corr-482910928821",
  "workflowType": "kyc_approval_pipeline",
  "status": "VERIFICATION_IN_PROGRESS",
  "currentStep": "verify_identity",
  "createdAt": "2026-10-15T19:30:00.000Z",
  "message": "Workflow successfully submitted and verification initiated"
}
```

---

### `GET /api/v1/workflows`
List workflows with pagination, filtering, and search.

#### Query Parameters
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `status`: Filter by status (`COMPLETED`, `COMPENSATED`, `FAILED`, etc.)
- `workflowType`: Filter by definition name
- `search`: Search across workflowId, correlationId, or customer name

#### Response (`200 OK`)
```json
{
  "data": [
    {
      "workflow_id": "a794bfa2-f38b-4b13-980b-22b02008f51a",
      "correlation_id": "corr-482910928821",
      "workflow_type": "kyc_approval_pipeline",
      "current_step": "approve_loan",
      "status": "COMPLETED",
      "compensation_status": "NONE",
      "customer_name": "Anand Kulkarni",
      "loan_amount": 150000,
      "created_at": "2026-10-15T19:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

---

### `GET /api/v1/workflows/:workflowId`
Retrieve full status and step timeline of a specific workflow.

#### Response (`200 OK`)
```json
{
  "workflow_id": "a794bfa2-f38b-4b13-980b-22b02008f51a",
  "status": "COMPLETED",
  "current_step": "approve_loan",
  "compensation_status": "NONE",
  "input_payload": { ... },
  "output_payload": {
    "finalResult": "APPROVED",
    "lastStepResult": {
      "creditScore": 780,
      "approvalCode": "CRD-948201",
      "riskTier": "PRIME"
    }
  },
  "steps": [
    {
      "step_name": "verify_identity",
      "step_order": 1,
      "status": "COMPLETED",
      "started_at": "2026-10-15T19:30:00.050Z",
      "completed_at": "2026-10-15T19:30:00.120Z"
    },
    {
      "step_name": "credit_check",
      "step_order": 2,
      "status": "COMPLETED",
      "started_at": "2026-10-15T19:30:00.125Z",
      "completed_at": "2026-10-15T19:30:00.220Z"
    }
  ]
}
```

---

### `GET /api/v1/workflows/:workflowId/events`
Retrieve immutable event sourcing history for a workflow.

---

### `POST /api/v1/workflows/:workflowId/retry`
Trigger retry execution on a failed or stuck workflow.

---

### `POST /api/v1/workflows/:workflowId/replay`
Reconstruct state from PostgreSQL event log and resume workflow.

---

## 2. Health & Observability

### `GET /api/v1/health`
Health check reporting status of PostgreSQL, Kafka, Redis, and Circuit Breakers.

### `GET /api/v1/ready`
Readiness check reporting whether the service can accept workflows.

### `GET /api/v1/metrics`
Prometheus metrics format scraped by Prometheus (`/prometheus/prometheus.yml`).

---

## 3. Administration & Circuit Breakers

### `GET /api/v1/circuit-breakers`
List all circuit breaker states (CLOSED, OPEN, HALF_OPEN) and failure metrics.

### `POST /api/v1/circuit-breakers/:name/reset`
Manually reset circuit breaker to CLOSED.

### `POST /api/v1/circuit-breakers/:name/trip`
Manually trip circuit breaker to OPEN (for failure simulation testing).

### `POST /api/v1/admin/recovery`
Trigger manual crash recovery scan of incomplete workflows.
