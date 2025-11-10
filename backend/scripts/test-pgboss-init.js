/**
 * Test pg-boss initialization
 *
 * This will let pg-boss create its own schema naturally
 */

import { PgBoss } from 'pg-boss';

const connectionString = 'postgresql://postgres:czUYxQpTBVivSGbDhNNIqxerCdOablsC@switchback.proxy.rlwy.net:30266/railway';

async function testInit() {
  console.log('🔧 Creating pg-boss instance...');

  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
  });

  boss.on('error', (error) => {
    console.error('[pg-boss] Error event:', error);
  });

  try {
    console.log('🚀 Starting pg-boss (will auto-create schema)...');
    await boss.start();
    console.log('✅ pg-boss started successfully!');

    // Check what tables were created
    const { Client } = await import('pg');
    const client = new Client({ connectionString });
    await client.connect();

    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'pgboss'
      ORDER BY table_name
    `);

    console.log('\n📊 Created tables:');
    tablesResult.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    await client.end();
    await boss.stop();
    console.log('\n🎉 Success! pg-boss schema is ready.');
  } catch (error) {
    console.error('\n❌ Failed to initialize pg-boss:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

testInit();
