# FlowMaster Failure Recovery & Resilience Guide

This guide details the disaster recovery, crash replay, and resilience architecture implemented in FlowMaster.

---

## 1. Crash Recovery Architecture

In enterprise distributed architectures, orchestrators may crash due to server reboots, out-of-memory errors, or infrastructure failures. FlowMaster ensures **zero workflow loss** and **idempotent state recovery** using PostgreSQL as the durable source of truth.

### Recovery Principles:
1. **Append-Only Event Store**: Every state transition and message emission is durably persisted in `workflow_events` and `workflows` before action execution.
2. **Transactional Outbox Guarantee**: No Kafka message is emitted without a corresponding PostgreSQL commit.
3. **Startup Auto-Scan**: Whenever the Orchestrator service boots, `recoveryService.runStartupRecovery()` runs before accepting incoming API traffic.
4. **Step-Level Resumption**: Workflows resume directly from the last unconfirmed step without repeating previously completed business steps.

---

## 2. Step-by-Step Crash & Recovery Demonstration

### Step 1: Submit a Workflow and Simulate a Crash Mid-Flight
In a PowerShell terminal, submit a workflow and simulate an orchestrator crash:
```powershell
$body = @{
    workflowType = "kyc_approval_pipeline"
    inputPayload = @{
        customerName = "Disaster Recovery Test"
        idNumber = "KYC-DR-1001"
        idType = "AADHAAR"
        loanAmount = 150000
        monthlyIncome = 50000
        creditScore = 750
    }
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/workflows" -Method Post -Body $body -ContentType "application/json"
$wfId = $response.workflowId
Write-Host "Created Workflow ID: $wfId"
```

Simulate an unexpected orchestrator process termination:
```powershell
# Find and terminate Orchestrator process
Stop-Process -Name "node" -Force
```

### Step 2: Inspect Workflow State in PostgreSQL
Connect to the database to inspect the durable state during downtime:
```powershell
$env:PGPASSWORD="root"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d bankproject -h localhost -p 5432 -c "SELECT workflow_id, current_step, status FROM workflows WHERE workflow_id = '$wfId';"
```
Notice that the workflow status is safely preserved as `VERIFICATION_IN_PROGRESS` or `RUNNING`.

### Step 3: Restart the Orchestrator Service
Start the service:
```powershell
node backend/orchestrator-service/src/index.js
```

Observe the console logs:
```json
{"level":"INFO","service":"recovery-service","message":"[RecoveryService] Starting crash recovery check for incomplete workflows..."}
{"level":"WARN","service":"recovery-service","message":"[RecoveryService] Found 1 incomplete workflow(s) to recover after startup!"}
{"level":"INFO","service":"recovery-service","message":"[RecoveryService] Reconstructing state for workflow a794bfa2... (Status: RUNNING)"}
{"level":"INFO","service":"recovery-service","message":"[RecoveryService] Resuming workflow a794bfa2... at step credit_check"}
{"level":"INFO","service":"recovery-service","message":"[RecoveryService] Startup crash recovery complete. Recovered 1 workflows."}
```

### Step 4: Verify Full Completion
Check the workflow status:
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/v1/workflows/$wfId" -Method Get
```
The workflow has resumed, executed the remaining credit check step, and reached `COMPLETED` without any human intervention or duplicate side effects!

---

## 3. Administrative Replay API

If a workflow fails due to temporary third-party outages, operators can trigger an idempotent replay:
```http
POST /api/v1/workflows/:workflowId/replay
```
FlowMaster reconstructs the state machine from the PostgreSQL event history, calculates the earliest incomplete step, and re-dispatches the appropriate Kafka event.
