# Backend Scripts

Utility scripts for database management and testing.

## pg-boss Queue Scripts

### `test-pgboss-init.js`
Tests pg-boss initialization and auto-schema creation. Use this to verify pg-boss can connect and create its tables.

```bash
node scripts/test-pgboss-init.js
```

**What it does:**
- Creates pg-boss instance
- Lets pg-boss auto-create its schema (6 tables: job, job_common, queue, schedule, subscription, version)
- Lists created tables
- Verifies everything works

### `reset-pgboss-schema.js`
Drops the `pgboss` schema entirely. Use this if you need to reset the queue database.

```bash
node scripts/reset-pgboss-schema.js
```

**Warning:** This deletes all queued jobs. Only use during development/troubleshooting.

### `init-pgboss-tables.js` (DEPRECATED)
Manual table creation script - **DO NOT USE**. pg-boss manages its own schema. This script was created during initial troubleshooting but is not needed.

## Notes

- **pg-boss auto-creates its schema** on first start - no manual table creation needed
- The `pgboss` schema is managed by pg-boss migrations
- To reset: drop schema → restart server → pg-boss recreates everything
- Railway PostgreSQL connection: Uses `PGBOSS_DATABASE_URL` environment variable
