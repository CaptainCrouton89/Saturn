/**
 * Manually initialize pg-boss tables in Railway PostgreSQL
 *
 * This script creates the pgboss schema and all required tables
 * for pg-boss to function properly.
 */

import pg from 'pg';
import readline from 'readline';

const { Client } = pg;

const connectionString = 'postgresql://postgres:czUYxQpTBVivSGbDhNNIqxerCdOablsC@switchback.proxy.rlwy.net:30266/railway';

async function initPgBossTables() {
  const client = new Client({ connectionString });

  try {
    console.log('🔌 Connecting to Railway PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully');

    // Check if pgboss schema exists
    console.log('\n📋 Checking for existing pgboss schema...');
    const schemaCheck = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'pgboss'
    `);

    if (schemaCheck.rows.length > 0) {
      console.log('⚠️  pgboss schema already exists');

      // Check what tables exist
      const tablesCheck = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'pgboss'
        ORDER BY table_name
      `);

      console.log('\n📊 Existing tables in pgboss schema:');
      tablesCheck.rows.forEach(row => {
        console.log(`  - ${row.table_name}`);
      });

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question('\nDrop and recreate all tables? (yes/no): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Aborted');
        return;
      }

      console.log('\n🗑️  Dropping pgboss schema...');
      await client.query('DROP SCHEMA pgboss CASCADE');
      console.log('✅ Schema dropped');
    }

    // Create pgboss schema
    console.log('\n🔧 Creating pgboss schema...');
    await client.query('CREATE SCHEMA IF NOT EXISTS pgboss');
    console.log('✅ Schema created');

    // Create version table
    console.log('\n📦 Creating version table...');
    await client.query(`
      CREATE TABLE pgboss.version (
        version int PRIMARY KEY,
        maintained_on timestamp without time zone,
        cron_on timestamp without time zone
      )
    `);

    // Insert current version (pg-boss uses version 22 as of latest)
    await client.query(`
      INSERT INTO pgboss.version (version) VALUES (22)
    `);
    console.log('✅ Version table created');

    // Create job table (main table for jobs)
    console.log('\n📦 Creating job table...');
    await client.query(`
      CREATE TABLE pgboss.job (
        id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
        name text NOT NULL,
        priority integer NOT NULL DEFAULT 0,
        data jsonb,
        state text NOT NULL DEFAULT 'created',
        retry_limit integer NOT NULL DEFAULT 0,
        retry_count integer NOT NULL DEFAULT 0,
        retry_delay integer NOT NULL DEFAULT 0,
        retry_backoff boolean NOT NULL DEFAULT false,
        start_after timestamp with time zone NOT NULL DEFAULT now(),
        started_on timestamp with time zone,
        singleton_key text,
        singleton_on timestamp without time zone,
        expire_in interval NOT NULL DEFAULT interval '15 minutes',
        created_on timestamp with time zone NOT NULL DEFAULT now(),
        completed_on timestamp with time zone,
        keep_until timestamp with time zone NOT NULL DEFAULT now() + interval '14 days',
        output jsonb,
        dead_letter text,
        policy text,
        CONSTRAINT job_name_check CHECK (name IS NOT NULL AND LENGTH(name) > 0)
      )
    `);
    console.log('✅ Job table created');

    // Create indexes for job table
    console.log('\n📑 Creating indexes...');

    await client.query(`
      CREATE INDEX job_name ON pgboss.job (name text_pattern_ops)
    `);

    await client.query(`
      CREATE INDEX job_fetch ON pgboss.job (name text_pattern_ops, state, priority desc, created_on, id)
      WHERE state < 'active'
    `);

    await client.query(`
      CREATE INDEX job_singleton_key ON pgboss.job (singleton_key text_pattern_ops)
      WHERE state < 'expired' AND singleton_key IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX job_singleton_on ON pgboss.job (name text_pattern_ops, singleton_on)
      WHERE state < 'expired' AND singleton_on IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX job_keep_until ON pgboss.job (keep_until)
      WHERE state = 'completed' OR state = 'failed'
    `);

    console.log('✅ Indexes created');

    // Create schedule table (for scheduled/recurring jobs)
    console.log('\n📦 Creating schedule table...');
    await client.query(`
      CREATE TABLE pgboss.schedule (
        name text PRIMARY KEY,
        cron text NOT NULL,
        timezone text,
        data jsonb,
        options jsonb,
        created_on timestamp with time zone NOT NULL DEFAULT now(),
        updated_on timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    console.log('✅ Schedule table created');

    // Create subscription table (for pub/sub functionality)
    console.log('\n📦 Creating subscription table...');
    await client.query(`
      CREATE TABLE pgboss.subscription (
        event text NOT NULL,
        name text NOT NULL,
        created_on timestamp with time zone NOT NULL DEFAULT now(),
        updated_on timestamp with time zone NOT NULL DEFAULT now(),
        PRIMARY KEY(event, name)
      )
    `);
    console.log('✅ Subscription table created');

    // Verify all tables were created
    console.log('\n✅ All pg-boss tables created successfully!');

    const finalCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'pgboss'
      ORDER BY table_name
    `);

    console.log('\n📊 Created tables:');
    finalCheck.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the script
initPgBossTables().then(() => {
  console.log('\n🎉 Done!');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
