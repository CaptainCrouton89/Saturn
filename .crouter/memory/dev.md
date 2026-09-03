---
kind: knowledge
when-and-why-to-read: When you are about to start, resume, or troubleshoot
  development work in Saturn, this knowledge should be read because work begun
  in the wrong checkout or against the wrong graph state is disposable even when
  the implementation is correct.
short-form: "/dev: choose current checkout, existing instance, or fresh Grove; then act"
slash: true
last-updated: 2026-09-03T10:49:30.483Z
origin:
  created: 2026-09-03T06:37:55.538Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl4fq6m-b9f71632
---

# /dev — pick the checkout and the data state before doing anything

Saturn is Grove-managed: the source checkout at `~/Code/Cosmo/Saturn` is slot 0 and serves api on 3001 and web on 3000; each planted instance is a copy in its own slot with ports `base + 100·slot`. Neo4j (docker container `neo4j`) and local Supabase are shared by every slot — instances isolate code and ports, not data. `$ARGUMENTS` is the request; decide which of the three pathways it is, then act. Work done in the wrong checkout or against the wrong data is thrown away even when the code is right.

## 1. Operate the current checkout

The request is about the environment you are standing in — start, stop, status, logs, why a service will not boot, reset the graph. Read `dev -h` and use the bare `dev` lifecycle; do not restate its grammar here.

Diagnostic order when something is wrong: `dev doctor` (env keys, database reachability, port ownership) → `dev status` (pid vs listener vs HTTP probe disagreement tells you which layer died) → `dev logs --service <name>`. A port held by a foreign pid means another slot or a stray `pnpm run dev` owns it; never kill it blind — find its checkout first. A worker that starts and immediately runs a decay pass is normal. The api boots without Neo4j by design, so a 200 on `/health` with a failing `/api/neo4j/health` means Neo4j, not the api.

Check the container runtime first with `docker info` or `orb status`: `dev doctor` reports both databases down when Docker itself is dead, so its database failures are downstream symptoms rather than two independent outages. Relaunch OrbStack with `orb start`, never `open -a OrbStack`; macOS Automatic Termination kills the idle windowless app started through `open -a`.

## 2. Resume isolated work

The request continues something already in flight ("keep going on the auth work", a branch name, an instance name). Read `dev grove -h` and list the instances; pick the one whose name or branch matches and continue there. Plant nothing new when a match exists.

## 3. Start distinct work in a fresh Grove

A new feature, fix, or experiment, or an explicit ask for isolation. Read `grove plant -h`. Resolve two things separately:

- **Code provenance** — which branch or commit the instance starts from. Default: the configured source at `main`.
- **Data state** — Neo4j and Supabase are shared, so a fresh instance sees whatever the local graph holds now. If the work needs a clean graph, `dev db neo4j backup` first, then `dev db neo4j reset`; if it needs a specific dataset, `dev db neo4j restore <file>`. There is no per-instance snapshot yet.

Choose an instance name that says what the work is. Plant it. Then carry the full original request into a working node rooted in that instance's directory and start the work there — planting and reporting the path is not the deliverable. Start services (`dev start` in that checkout) only when the work needs them running.

## Ambiguity and unavailability

"Based on X" can mean code (a branch) or data (a graph state). Inspect first; if it is still unclear, ask one focused question. If Grove is unavailable or `grove setup` reports the source not ready, point at `/dev:init` and Grove's own setup recovery — never substitute a worktree or a copied directory as a silent stand-in for an instance.
