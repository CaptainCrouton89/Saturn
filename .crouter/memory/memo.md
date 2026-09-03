---
kind: knowledge
when-and-why-to-read: When Silas hands you a voice memo, note, or article to put
  into Saturn production, this knowledge should be read because the upload needs
  the admin key from Railway and the fixed canonical user id, and a wrong
  source_type mis-routes ingestion.
short-form: "/memo: POST an information dump to production"
slash: true
last-updated: 2026-09-03T07:00:14.982Z
origin:
  created: 2026-09-03T06:38:14.911Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl4fq6m-b9f71632
---

# /memo — upload an information dump to the local API

`$ARGUMENTS` is plain text, a file path, or a URL; resolve it to text first. Production is down (local-only until the Cloudflare move), so the target is the api in this checkout.

1. `dev status` — the api must be listening (slot 0 is `http://localhost:3001`); `dev start` if not.
2. Pick `source_type` from `voice-memo`, `meeting`, `journal`, `book-summary`, `article`, `conversation`, `other` (default `voice-memo`).
3. Admin key: `ADMIN_API_KEY` in `backend/.env`.
4. `POST http://localhost:3001/api/information-dumps` with header `X-Admin-Key` and JSON body `{content, source_type, user_id: "00000000-0000-0000-0000-000000000001"}`. JSON-escape the content (`python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))'`).
5. Report the returned `source_id`, then `GET /api/information-dumps/<source_id>` for processing status, or the error verbatim. Worker output is in `dev logs --service worker`.
