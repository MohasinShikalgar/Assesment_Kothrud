const fs = require('fs');
const path = require('path');
const { query } = require('./db');

async function runMigration() {
  console.log('[Migration] Starting FlowMaster PostgreSQL schema initialization...');
  try {
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');
    await query(schemaSql);
    console.log('[Migration] Database schema and indexes verified successfully.');
    return true;
  } catch (error) {
    console.error('[Migration Error]:', error.message);
    throw error;
  }
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runMigration };
