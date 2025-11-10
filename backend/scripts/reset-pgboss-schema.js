/**
 * Reset pg-boss schema - drop existing and let pg-boss auto-create
 *
 * This removes the manually created schema so pg-boss can manage
 * its own schema migrations properly.
 */

import pg from 'pg';

const { Client } = pg;

const connectionString = 'postgresql://postgres:czUYxQpTBVivSGbDhNNIqxerCdOablsC@switchback.proxy.rlwy.net:30266/railway';

async function resetSchema() {
  const client = new Client({ connectionString });

  try {
    console.log('🔌 Connecting to Railway PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Check if pgboss schema exists
    const schemaCheck = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'pgboss'
    `);

    if (schemaCheck.rows.length === 0) {
      console.log('ℹ️  No pgboss schema found - nothing to reset');
      return;
    }

    console.log('📋 Current pgboss tables:');
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'pgboss'
      ORDER BY table_name
    `);

    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    console.log('\n🗑️  Dropping pgboss schema (CASCADE will remove all tables)...');
    await client.query('DROP SCHEMA pgboss CASCADE');
    console.log('✅ Schema dropped successfully\n');

    console.log('✨ Schema reset complete!');
    console.log('   Next: Start your backend server and pg-boss will auto-create its schema.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Disconnected from database');
  }
}

resetSchema();
