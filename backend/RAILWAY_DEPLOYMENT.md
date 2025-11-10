# Railway Deployment Guide - Memory Pipeline

## Overview

The memory extraction system requires **TWO separate Railway services** to run:
1. **API Service** - Express server (handles HTTP requests)
2. **Worker Service** - Background job processor (processes queue jobs)

Both services run from the same codebase but with different start commands.

## Why Two Services?

Railway runs **one process per service**. Since we need both an API server and a background worker running simultaneously, we deploy them as separate services that share the same environment variables and database.

## Deployment Steps

### 1. Initial Setup

**Prerequisites:**
- Railway account connected to your GitHub repo
- Supabase database URL ready
- Neo4j Aura instance ready
- OpenAI API key

### 2. Deploy API Service (Service #1)

1. **Create New Project in Railway**
   - Go to Railway dashboard → New Project
   - Select your GitHub repo
   - Choose `/backend` as the root directory

2. **Configure API Service**
   - Railway will auto-detect the `railway.json` config
   - Service name: `saturn-backend-api` (or your preference)
   - Railway assigns a public URL automatically

3. **Set Environment Variables** (for API service)
   ```bash
   DATABASE_URL=postgresql://...              # From Supabase
   NEO4J_URI=neo4j+s://...                   # From Neo4j Aura
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=...
   OPENAI_API_KEY=sk-...
   JWT_SECRET=your-secret-key
   NODE_ENV=production
   PORT=3001                                  # Railway auto-assigns, but safe to set
   ```

4. **Deploy**
   - Railway will automatically build and deploy
   - Wait for deployment to complete
   - Test: `curl https://your-railway-url.railway.app/health`
   - Should return: `{"status":"ok","timestamp":"..."}`

### 3. Deploy Worker Service (Service #2)

1. **Add New Service to Same Project**
   - In Railway project dashboard → New → Service
   - Select the **same GitHub repo**
   - Choose `/backend` as root directory again

2. **Configure Worker Service**
   - Service name: `saturn-backend-worker`
   - **Override start command**: In Railway dashboard → Settings → Start Command:
     ```bash
     node dist/worker.js
     ```
   - **No public URL needed** (worker doesn't serve HTTP)

3. **Set Environment Variables** (for Worker service)
   ```bash
   # Copy ALL environment variables from API service
   DATABASE_URL=postgresql://...              # SAME as API service
   NEO4J_URI=neo4j+s://...                   # SAME as API service
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=...
   OPENAI_API_KEY=sk-...
   JWT_SECRET=your-secret-key                # SAME as API service
   NODE_ENV=production
   ```

   **⚠️ IMPORTANT**: Both services MUST use the **same `DATABASE_URL`** so they share the pg-boss queue tables.

4. **Deploy Worker**
   - Railway builds and starts worker process
   - Check logs: Should see `✅ pg-boss queue started` and `👂 Listening for jobs...`

### 4. Verify Everything Works

**Test the full pipeline:**

1. **Check API health:**
   ```bash
   curl https://your-api-url.railway.app/health
   ```

2. **Check Neo4j connection:**
   ```bash
   curl https://your-api-url.railway.app/api/neo4j/health
   ```

3. **Create and end a test conversation** (via iOS app or API)

4. **Check worker logs in Railway:**
   - Should see job picked up
   - Pipeline phases executing
   - `✅ Memory extraction complete`

5. **Check queue status:**
   ```bash
   curl https://your-api-url.railway.app/admin/queue-status
   ```

6. **Verify Neo4j** (in Neo4j Browser):
   ```cypher
   MATCH (c:Conversation)
   RETURN c
   ORDER BY c.date DESC
   LIMIT 5
   ```

## Service Architecture on Railway

```
Railway Project: saturn-backend
├── Service 1: saturn-backend-api
│   ├── Start command: node dist/index.js
│   ├── Port: 3001 (public URL)
│   └── Env vars: DATABASE_URL, NEO4J_*, OPENAI_API_KEY, etc.
│
└── Service 2: saturn-backend-worker
    ├── Start command: node dist/worker.js
    ├── Port: None (background only)
    └── Env vars: SAME as API service
```

Both services:
- Build from same `backend/` directory
- Share same `DATABASE_URL` (pg-boss queue)
- Connect to same Neo4j instance
- Use same OpenAI API key

## Railway-Specific Configuration

### `railway.json` (Already Created)

This file configures the API service build/deploy:

```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm install && pnpm run build"
  },
  "deploy": {
    "startCommand": "node dist/index.js",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

For the **worker service**, override the `startCommand` in Railway dashboard settings (Railway doesn't support multiple config files).

### Health Checks

- **API Service**: Railway pings `/health` endpoint automatically
- **Worker Service**: No health check needed (Railway monitors process status)

### Auto-Restart

Both services have restart policies configured:
- Restart on failure (crashes, errors)
- Max 10 retries with exponential backoff
- Worker will reconnect to queue automatically

## Monitoring

### Railway Dashboard

**API Service Logs:**
- HTTP request logs (Morgan)
- Queue enqueue confirmations
- Error logs

**Worker Service Logs:**
- `🧠 Memory Extraction Pipeline` headers
- Phase-by-phase progress
- Entity counts, relationship counts
- Success/failure messages

### Queue Monitoring Endpoints

Access via your API service public URL:

```bash
# Queue status
GET https://your-api-url.railway.app/admin/queue-status

# Conversation extraction status
GET https://your-api-url.railway.app/admin/conversation/:id/extraction-status

# Retry failed job
POST https://your-api-url.railway.app/admin/retry/:jobId
```

## Cost Considerations

**Railway Pricing (as of 2024):**
- Charged per service (2 services = 2x compute cost)
- Worker runs 24/7 (even when idle, polling queue)
- API service scales based on traffic

**Cost Optimization:**
- Worker `newJobCheckInterval: 2000ms` → Consider increasing to `5000ms` in production
- Reduce polling frequency to save compute hours
- Alternative: Railway Cron (if you can batch process daily instead of real-time)

**Estimated cost for 100 conversations/day:**
- API service: ~$5-10/month (low traffic)
- Worker service: ~$5-10/month (24/7 background)
- **Total Railway: ~$10-20/month**

Plus external services:
- Supabase: Free tier or $25/month
- Neo4j Aura: Free tier (500MB) or paid
- OpenAI: ~$5/day = $150/month for LLM calls

## Troubleshooting

### Worker not processing jobs

**Check Railway worker logs:**
```
Looking for:
✅ pg-boss queue started
👂 Listening for jobs...
```

**If missing:**
- Verify `DATABASE_URL` matches API service exactly
- Check pg-boss tables exist: `SELECT * FROM pgboss.version` in Supabase
- Restart worker service in Railway

### Jobs stuck in queue

**Check API service is enqueuing:**
```
Look for log: "✅ Enqueued memory extraction for conversation..."
```

**Check worker is running:**
- Railway dashboard → Worker service → Logs
- Should see periodic queue polling activity

**Manual fix:**
- Query failed jobs: `/admin/queue-status`
- Retry stuck jobs: `POST /admin/retry/:jobId`

### Build failures

**Common issues:**
- Missing `pnpm` in buildCommand → Already configured in `railway.json`
- TypeScript errors → Run `npm run type-check` locally first
- Environment variables missing → Add before deployment

### Connection errors

**Neo4j connection failed:**
- Verify `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`
- Test: `GET /api/neo4j/health`
- Check Neo4j Aura is running and accessible

**Database connection failed:**
- Verify `DATABASE_URL` from Supabase
- Ensure Supabase project is active
- Check connection string format: `postgresql://...`

## Scaling

### Horizontal Scaling (Future)

**Multiple workers:**
1. Clone worker service in Railway (Service #3, #4, etc.)
2. All workers connect to same queue
3. pg-boss automatically distributes jobs across workers
4. Increase `teamSize` per worker for parallelism

**API instances:**
- Railway auto-scales API service based on traffic
- Multiple API instances can enqueue jobs safely

### Vertical Scaling

Adjust Railway service resources:
- Settings → Resources → Increase CPU/Memory
- Useful if worker processes large conversations slowly

## Environment Variables Reference

### Required for Both Services

| Variable | Source | Example |
|----------|--------|---------|
| `DATABASE_URL` | Supabase | `postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres` |
| `NEO4J_URI` | Neo4j Aura | `neo4j+s://xxx.databases.neo4j.io` |
| `NEO4J_USERNAME` | Neo4j Aura | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j Aura | `your-password` |
| `OPENAI_API_KEY` | OpenAI | `sk-proj-...` |
| `JWT_SECRET` | Generate | Any secure random string |
| `NODE_ENV` | Railway | `production` |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | API server port (Railway auto-assigns) |

## Deployment Checklist

- [ ] Railway project created
- [ ] API service deployed with `railway.json` config
- [ ] API service environment variables set
- [ ] API service health check passing (`/health`)
- [ ] Worker service added to same project
- [ ] Worker service start command: `node dist/worker.js`
- [ ] Worker service environment variables set (SAME as API)
- [ ] Worker logs show queue started
- [ ] Test conversation → end → verify worker processes job
- [ ] Check Neo4j for created entities
- [ ] Monitor `/admin/queue-status` endpoint

## Success!

Your memory extraction pipeline is now running on Railway with:
- ✅ Automatic restarts on failure
- ✅ Shared database queue (pg-boss)
- ✅ Real-time job processing
- ✅ Full monitoring via admin endpoints

Next: Monitor the system for a few conversations and verify everything works end-to-end! 🚀
