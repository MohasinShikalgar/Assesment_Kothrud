# FlowMaster Saga Orchestration & Compensation Workflows

This document specifies the Saga state transitions, compensation logic, and failure handling mechanisms implemented in FlowMaster.

---

## 1. Saga Sequence Diagram

### A. Success Path (Full Loan Approval)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Frontend / REST Client
    participant Orch as Orchestrator Service
    participant DB as PostgreSQL (bankproject)
    participant Kafka as Kafka Broker
    participant Verif as Verification Service
    participant Credit as Credit Service

    Client->>Orch: POST /api/v1/workflows (kyc_approval_pipeline)
    activate Orch
    Note over Orch,DB: Atomically persist PENDING & Queue Outbox
    Orch->>DB: INSERT INTO workflows (VERIFICATION_IN_PROGRESS)
    Orch->>DB: INSERT INTO outbox_events (verification.start)
    Orch-->>Client: 201 Created (workflowId)
    deactivate Orch

    Note over Orch,Kafka: Outbox worker publishes event to Kafka
    Orch->>Kafka: Publish to verification.start
    Kafka->>Verif: Consume verification.start
    activate Verif
    Verif->>Verif: Validate KYC & Identity documents
    Verif->>Kafka: Publish to verification.result (VERIFICATION_SUCCESS)
    deactivate Verif

    Kafka->>Orch: Consume verification.result
    activate Orch
    Orch->>DB: UPDATE workflow_steps (verify_identity -> COMPLETED)
    Orch->>DB: UPDATE workflows (CREDIT_CHECK_IN_PROGRESS)
    Orch->>DB: INSERT INTO outbox_events (credit.start)
    Orch->>Kafka: Publish to credit.start
    deactivate Orch

    Kafka->>Credit: Consume credit.start
    activate Credit
    Credit->>Credit: Evaluate credit bureau score & underwriting rules
    Credit->>Kafka: Publish to credit.result (CREDIT_APPROVED)
    deactivate Credit

    Kafka->>Orch: Consume credit.result
    activate Orch
    Orch->>DB: UPDATE workflow_steps (credit_check -> COMPLETED)
    Orch->>DB: UPDATE workflows (COMPLETED, completed_at = NOW())
    Orch->>DB: INSERT INTO workflow_events (WORKFLOW_COMPLETED)
    deactivate Orch
```

---

### B. Failure & Compensation Rollback Path (Credit Rejected)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Frontend / REST Client
    participant Orch as Orchestrator Service
    participant DB as PostgreSQL (bankproject)
    participant Kafka as Kafka Broker
    participant Verif as Verification Service
    participant Credit as Credit Service

    Note over Orch,Verif: Step 1 (Identity Verification) completed successfully
    Orch->>DB: verify_identity = COMPLETED
    Orch->>Kafka: Publish to credit.start

    Kafka->>Credit: Consume credit.start
    activate Credit
    Note over Credit: Score 520 is below minimum 650 threshold
    Credit->>Credit: Reject loan application
    Credit->>Kafka: Publish to credit.result (CREDIT_REJECTED)
    deactivate Credit

    Kafka->>Orch: Consume credit.result (CREDIT_REJECTED)
    activate Orch
    Note over Orch,DB: Saga Orchestrator catches failure & checks YAML definition
    Orch->>DB: UPDATE workflow_steps (credit_check -> FAILED)
    Orch->>DB: UPDATE workflows (status = COMPENSATING)
    Orch->>DB: INSERT INTO outbox_events (verification.compensate)
    Orch->>Kafka: Publish to verification.compensate
    deactivate Orch

    Kafka->>Verif: Consume verification.compensate
    activate Verif
    Note over Verif: Logically undo & flag previous KYC record
    Verif->>Verif: Update KYC status = COMPENSATED_REVERSED
    Verif->>Kafka: Publish to verification.result (VERIFICATION_COMPENSATED)
    deactivate Verif

    Kafka->>Orch: Consume verification.result (VERIFICATION_COMPENSATED)
    activate Orch
    Orch->>DB: UPDATE workflow_steps (verify_identity -> COMPENSATED)
    Orch->>DB: UPDATE workflows (status = COMPENSATED, compensation_status = SUCCESS)
    Orch->>DB: INSERT INTO workflow_events (WORKFLOW_COMPENSATED)
    deactivate Orch
```

---

## 2. Saga State Machine Definitions

| Status | Category | Description |
|---|---|---|
| `PENDING` | Initial | Workflow submitted and awaiting initial outbox dispatch. |
| `VERIFICATION_IN_PROGRESS` | Running | Step 1 event dispatched to Kafka; awaiting verification worker. |
| `CREDIT_CHECK_IN_PROGRESS` | Running | Step 1 succeeded; Step 2 dispatched to credit service. |
| `COMPENSATING` | Rollback | Downstream failure detected; rollback events dispatched in reverse order. |
| `COMPLETED` | Terminal Success | All pipeline steps executed successfully; loan approved. |
| `FAILED` | Terminal Failure | Step 1 failed directly without requiring prior step compensation. |
| `COMPENSATED` | Terminal Rollback | Prior steps successfully reversed/flagged; data consistency maintained. |
| `RECOVERY_REQUIRED` | Administrative Alert | Compensation action itself failed; flagged for manual/operator triage. |

---

## 3. Distinction Between Failure Types

1. **Business Rejection**:
   - Customer fails underwriting eligibility (e.g. credit score < 650, low income).
   - Expected business outcome: triggers Saga compensation rollback of prior completed steps.
2. **Transient Technical Error**:
   - Network timeout, 504 Gateway Timeout, broker disconnection.
   - Handled via BullMQ exponential backoff retries and circuit breaker fast-failing.
3. **Compensation Failure**:
   - The compensation action itself fails (e.g. KYC registry unavailable during rollback).
   - Workflow transitions to `RECOVERY_REQUIRED` with `compensation_status = FAILED`.
   - Never falsely marks as compensated.
