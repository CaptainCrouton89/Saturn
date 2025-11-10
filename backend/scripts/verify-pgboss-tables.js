/**
 * Verify pg-boss tables are correctly created
 */

import pg from 'pg';

const { Client } = pg;

const connectionString = 'postgresql://postgres:czUYxQpTBVivSGbDhNNIqxerCdOablsC@switchback.proxy.rlwy.net:30266/railway';

async function verifyTables() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected to Railway PostgreSQL\n');

    // Check schema exists
    const schemaResult = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'pgboss'
    `);

    if (schemaResult.rows.length === 0) {
      console.error('❌ pgboss schema does not exist!');
      process.exit(1);
    }
    console.log('✅ pgboss schema exists');

    // Check all required tables
    const requiredTables = ['version', 'job', 'schedule', 'subscription'];
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'pgboss'
      ORDER BY table_name
    `);

    const existingTables = tablesResult.rows.map(row => row.table_name);
    console.log('\n📊 Existing tables:');
    existingTables.forEach(table => console.log(`  ✓ ${table}`));

    const missingTables = requiredTables.filter(t => !existingTables.includes(t));
    if (missingTables.length > 0) {
      console.error('\n❌ Missing tables:', missingTables.join(', '));
      process.exit(1);
    }

    // Check job table structure
    console.log('\n📋 Verifying job table structure...');
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'pgboss' AND table_name = 'job'
      ORDER BY ordinal_position
    `);

    const requiredColumns = [
      'id', 'name', 'priority', 'data', 'state', 'retry_limit',
      'retry_count', 'retry_delay', 'retry_backoff', 'start_after',
      'started_on', 'singleton_key', 'singleton_on', 'expire_in',
      'created_on', 'completed_on', 'keep_until', 'output',
      'dead_letter', 'policy'
    ];

    const existingColumns = columnsResult.rows.map(row => row.column_name);
    const missingColumns = requiredColumns.filter(c => !existingColumns.includes(c));

    if (missingColumns.length > 0) {
      console.error('❌ Missing columns in job table:', missingColumns.join(', '));
      process.exit(1);
    }

    console.log(`✅ All ${requiredColumns.length} required columns present in job table`);

    // Check indexes
    console.log('\n📑 Checking indexes...');
    const indexesResult = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'pgboss' AND tablename = 'job'
    `);

    console.log('  Indexes on job table:');
    indexesResult.rows.forEach(row => console.log(`    - ${row.indexname}`));

    // Check version
    const versionResult = await client.query(`
      SELECT version FROM pgboss.version
    `);

    if (versionResult.rows.length > 0) {
      console.log(`\n✅ pg-boss version: ${versionResult.rows[0].version}`);
    }

    console.log('\n🎉 All pg-boss tables are correctly configured!');

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyTables();
