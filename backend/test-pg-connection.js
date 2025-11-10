/**
 * Test PostgreSQL connection using DATABASE_URL from environment
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

async function testConnection() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found in environment');
    process.exit(1);
  }

  console.log('🔍 Testing PostgreSQL connection...');
  console.log('Connection string:', databaseUrl.replace(/:[^:@]+@/, ':****@')); // Mask password

  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    console.log('📡 Attempting to connect...');
    await client.connect();
    console.log('✅ Connection successful!');

    console.log('📊 Testing query...');
    const result = await client.query('SELECT version()');
    console.log('PostgreSQL version:', result.rows[0].version);

    console.log('🔍 Checking for pgboss schema...');
    const schemaCheck = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'pgboss'
    `);

    if (schemaCheck.rows.length > 0) {
      console.log('✅ pgboss schema exists');
    } else {
      console.log('⚠️  pgboss schema does not exist (will be created on first pg-boss start)');
    }

  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.address) {
      console.error('Attempted address:', error.address);
    }
    if (error.port) {
      console.error('Attempted port:', error.port);
    }
  } finally {
    await client.end();
    console.log('🔌 Connection closed');
  }
}

testConnection();
