const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../../backend/orchestrator-service/src/index');

describe('Orchestrator REST API Integration Tests', () => {
  it('GET /api/v1/health should return 200 with component statuses', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.service, 'orchestrator-service');
    assert.ok(res.body.components.database);
    assert.strictEqual(res.body.components.database.status, 'UP');
  });

  it('GET /api/v1/ready should return 200 READY', async () => {
    const res = await request(app).get('/api/v1/ready');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'READY');
  });

  it('GET /api/v1/metrics should return Prometheus formatted metrics', async () => {
    const res = await request(app).get('/api/v1/metrics');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.text.includes('flowmaster_'));
  });

  it('POST /api/v1/workflows should validate input and return 201 with workflow ID', async () => {
    const payload = {
      workflowType: 'kyc_approval_pipeline',
      inputPayload: {
        customerName: 'API Test Customer',
        idNumber: `KYC-API-${Date.now()}`,
        idType: 'AADHAAR',
        loanAmount: 180000,
        monthlyIncome: 75000,
        creditScore: 790,
      },
    };

    const res = await request(app)
      .post('/api/v1/workflows')
      .send(payload)
      .set('Content-Type', 'application/json');

    assert.strictEqual(res.statusCode, 201);
    assert.ok(res.body.workflowId);
    assert.strictEqual(res.body.workflowType, 'kyc_approval_pipeline');
    assert.strictEqual(res.body.status, 'VERIFICATION_IN_PROGRESS');
  });

  it('POST /api/v1/workflows should reject missing customerName with 400', async () => {
    const invalidPayload = {
      workflowType: 'kyc_approval_pipeline',
      inputPayload: {
        // missing customerName and idNumber
        loanAmount: 100000,
      },
    };

    const res = await request(app)
      .post('/api/v1/workflows')
      .send(invalidPayload);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'Validation failed');
    assert.ok(res.body.details.length >= 1);
  });

  it('GET /api/v1/workflows should support pagination and search', async () => {
    const res = await request(app).get('/api/v1/workflows?page=1&limit=5');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.pagination);
    assert.strictEqual(res.body.pagination.limit, 5);
  });

  it('GET /api/v1/definitions should return available YAML definitions', async () => {
    const res = await request(app).get('/api/v1/definitions');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.definitions.length >= 1);
  });

  it('POST /api/v1/definitions/validate should reject invalid YAML schema', async () => {
    const res = await request(app)
      .post('/api/v1/definitions/validate')
      .send({ yamlContent: 'not: a: valid: workflow' });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.valid, false);
  });

  after(async () => {
    const { eventBus } = require('../../backend/shared/eventBus');
    const { pool } = require('../../backend/shared/db');
    await eventBus.disconnect();
    await pool.end();
  });
});
