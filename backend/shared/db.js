const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL || 
  `postgresql://${process.env.PG_USER || 'postgres'}:${process.env.PG_PASSWORD || 'root'}@${process.env.PG_HOST || 'localhost'}:${process.env.PG_PORT || 5432}/${process.env.PG_DATABASE || 'bankproject'}`;

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]: Unexpected error on idle client', err.message);
});

/**
 * Execute parameterized query
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    return res;
  } catch (error) {
    console.error('[PostgreSQL Query Error]:', { text, error: error.message });
    throw error;
  }
}

/**
 * Execute callback within a database transaction
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check database connection and health metrics
 */
async function checkHealth() {
  const start = Date.now();
  try {
    const res = await pool.query('SELECT 1 AS healthy, NOW() AS db_time, current_database() AS db_name');
    const duration = Date.now() - start;
    return {
      status: 'UP',
      latencyMs: duration,
      database: res.rows[0].db_name,
      dbTime: res.rows[0].db_time,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      }
    };
  } catch (error) {
    return {
      status: 'DOWN',
      error: error.message,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      }
    };
  }
}

module.exports = {
  pool,
  query,
  withTransaction,
  checkHealth,
};
