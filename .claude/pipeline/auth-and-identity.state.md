# Pipeline State: auth-and-identity

## Specification Phase

### Alternatives Considered
- Omi as identity provider (rejected — Saturn needs standalone accounts, Omi is one integration)
- OAuth-only signup (rejected — email/password is simpler for MVP, OAuth can come later)
- JWT-only for API access (rejected — API keys are better for programmatic use, long-lived, revocable)
- Saturn handling Omi webhooks directly (rejected — user wants Tartarus as separate Omi concern)
- Single global admin key for all integrations (rejected — per-user API keys needed for multi-user)

### Key Discoveries
- Tartarus already has Omi OAuth flow and stores omi_uid in `accounts` table — just needs saturn_api_key column
- Tartarus currently hardcodes SATURN_USER_ID env var, ignores omi uid when forwarding
- Saturn's auth middleware already supports multiple auth paths — adding API key is incremental
- Owner Person node in Neo4j is created at registration with placeholder name "Device xxx"
- `user_profiles` table has no display_name — needs migration
- The ingestion pipeline's `wrapContentForExtraction` currently uses userId UUID — needs display name lookup
- OMI_WEBHOOK_SECRET exists in Tartarus .env but is never validated
- Omi webhooks pass uid as query param, no signature/HMAC validation
- Web app at /web is currently just a landing page with waitlist + graph viz

### Handoff Notes
- This is a large feature spanning Saturn backend, Saturn web, and Tartarus
- API key hashing strategy matters: SHA-256 with key_prefix for indexed lookup is simpler than bcrypt (no timing attacks on API keys since prefix narrows to one row)
- Supabase Auth is already in place — web dashboard signup can use Supabase client-side auth (same project)
- The iOS device auth should keep working but doesn't need enhancement in this phase
- Tartarus is a separate repo at ~/Code/tartarus — changes there are minimal (1-2 files)
