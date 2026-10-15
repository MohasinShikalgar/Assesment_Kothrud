# FlowMaster Distributed Task Orchestrator - Architecture

## Executive Summary

FlowMaster is a distributed, fault-tolerant Saga orchestrator engineered for enterprise fintech workflows (e.g., Pune fintech KYC pipeline: Verify ID → Credit Check → Loan Approval). The platform processes over 10,000 workflows/hour with sub-500ms execution latency, complete failure compensation (Saga rollbacks), transactional outbox reliability, PostgreSQL state recovery, and distributed tracing.

```
                           +----------------------------------------+
                           |     React 18 Dashboard (Port 3000)     |
                           |  (Vite + React Router + Recharts/Lucide)|
                           +-------------------+--------------------+
                                               | REST APIs
                                               v
+---------------------------------------------------------------------------------------+
|                       Orchestrator Service (Express - Port 5000)                      |
|                                                                                       |
|   +-----------------------+   +----------------------+   +------------------------+   |
|   |  YAML Workflow Engine |   |  Saga State Machine  |   |  Circuit Breakers      |   |
|   +-----------------------+   +----------------------+   +------------------------+   |
|   +-----------------------+   +----------------------+   +------------------------+   |
|   | Crash Recovery Engine |   |  Redis / Memory Cache|   | Prometheus & OpenTel   |   |
|   +-----------------------+   +----------------------+   +------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   |       Transactional Outbox Pattern (SKIP LOCKED Multi-Worker Polling)         |   |
|   +-------------------------------------------------------------------------------+   |
+-------------------+-----------------------------------------------+-------------------+
                    |                                               |
         Atomically Writes Events                         Publishes Outbox Events
                    v                                               v
+-----------------------------------+               +-----------------------------------+
|      PostgreSQL (Port 5432)       |               |     Apache Kafka Cluster (9092)   |
|           [bankproject]           |               |   Topics Partitioned by WorkflowId|
|                                   |               |                                   |
| - workflows (UUID PK)             |               | - verification.start              |
| - workflow_steps                  |               | - verification.result             |
| - workflow_events (Append-only)   |               | - verification.compensate         |
| - outbox_events (Transactional)   |               | - credit.start                    |
| - idempotency_keys (24hr TTL)     |               | - credit.result                   |
| - workflow_attempts               |               | - workflow.events.dlq             |
+-----------------------------------+               +--------+-----------------+--------+
                                                             |                 |
                                                             | Events          | Events
                                                             v                 v
                                            +----------------+--+   +----------+--------+
                                            |   Verification    |   |      Credit       |
                                            |     Service       |   |      Service      |
                                            |   (Port 5001)     |   |    (Port 5002)    |
                                            +-------------------+   +-------------------+
```

---

## 1. Microservices Topology

1. **Orchestrator Service (`:5000`)**:
   - Manages workflow lifecycles, states, and transitions.
   - Reads declarative YAML workflow definitions.
   - Atomically updates PostgreSQL workflow status and inserts Transactional Outbox records within a single transaction.
   - Consumes Kafka result events from worker services.
   - Publishes forward events upon step success and compensation rollback events upon business rejection.
   - Performs automatic crash recovery upon service startup.

2. **Verification Service (`:5001`)**:
   - Consumes `verification.start` events from Kafka.
   - Executes KYC/Identity validation algorithms.
   - Publishes `verification.result` with `VERIFICATION_SUCCESS` or `VERIFICATION_FAILED`.
   - Consumes `verification.compensate` events.
   - Logically rolls back KYC verification and flags records as `COMPENSATED_REVERSED`.
   - Implements application-level idempotency to prevent duplicate operations.

3. **Credit Service (`:5002`)**:
   - Consumes `credit.start` events from Kafka.
   - Performs credit bureau score assessment, debt-to-income underwriting, and loan eligibility checks.
   - Publishes `credit.result` with `CREDIT_APPROVED`, `CREDIT_REJECTED`, or `CREDIT_ERROR`.
   - Supports deterministic failure simulation for automated testing and disaster recovery validation.

---

## 2. Asynchronous Event Pipeline (Apache Kafka)

Microservices communicate asynchronously via Kafka topics using strictly structured event envelopes. Microservices **never** call each other directly via HTTP.

### Canonical Event Envelope Structure
```json
{
  "eventId": "a794bfa2-f38b-4b13-980b-22b02008f51a",
  "workflowId": "65b98df1-3b7c-4890-a292-1fb8e9ad22e1",
  "correlationId": "corr-482910928821",
  "eventType": "START_VERIFICATION",
  "timestamp": "2026-10-15T19:30:00.000Z",
  "version": "1.0.0",
  "source": "orchestrator-service",
  "payload": {
    "customerName": "Anand Kulkarni",
    "idNumber": "4829-1092-8821",
    "loanAmount": 150000
  }
}
```

### Partitioning Strategy
Kafka messages use `workflowId` as the partition key. This guarantees:
1. Strict chronological ordering for all events pertaining to a specific workflow.
2. Even load distribution across Kafka partitions.
3. Concurrency scaling across consumer group workers without race conditions.

---

## 3. Transactional Outbox Pattern

To prevent dual-write vulnerabilities between PostgreSQL and Kafka:
1. Orchestrator executes all state transitions and writes the pending Kafka event into `outbox_events` within the **same PostgreSQL transaction**.
2. A background publisher polls `outbox_events` using `SELECT ... FOR UPDATE SKIP LOCKED`.
3. The event is published to Kafka.
4. Upon broker acknowledgment, the outbox record is marked `PUBLISHED` with `published_at = NOW()`.
5. If publication fails, exponential backoff retries are applied up to `max_retries` before dead-letter routing.

---

## 4. Resilience and Fault Tolerance

- **Circuit Breakers**: Implemented via `CircuitBreaker` pattern with CLOSED, OPEN, and HALF_OPEN states to isolate failing dependencies.
- **Application Idempotency**: Prevents duplicate executions by recording `idempotency_keys` with 24-hour expiration.
- **Crash Recovery**: Reads PostgreSQL event log upon startup to resume incomplete workflows from the last confirmed step.
