#!/usr/bin/env node
// Saturn development lifecycle CLI. Grove dispatches `dev …` here with cwd at the
// source or instance root and GROVE_SLOT / GROVE_PORT_<NAME> in the env.
// Run directly: node .grove/dev.ts -h
// Regenerate the crtr surface: node .grove/dev.ts --emit-crtr-fragment > .crouter/commands/dev.json

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { defineCli, generateCrtrFragment, withExitCode, type JsonObject } from "./dev-cli.ts";

// ---------------------------------------------------------------------------
// Repository facts
// ---------------------------------------------------------------------------

const ROOT = resolve(process.cwd());
const BACKEND = join(ROOT, "backend");
const WEB = join(ROOT, "web");
const RUN_DIR = join(ROOT, ".grove", "run");
const SLOT = process.env.GROVE_SLOT ?? "0";

type ServiceName = "api" | "worker" | "web";
const SERVICE_NAMES = ["api", "worker", "web"] as const;

type Service = {
  name: ServiceName;
  cwd: string;
  port?: number;
  probe?: string;
  command: () => { file: string; args: string[]; env: Record<string, string> };
};

function portFor(name: string, base: number): number {
  const fromGrove = process.env[`GROVE_PORT_${name.toUpperCase()}`];
  if (fromGrove) return Number(fromGrove);
  return base + Number(SLOT) * 100;
}

const API_PORT = portFor("api", 3001);
const WEB_PORT = portFor("web", 3000);

const SERVICES: Record<ServiceName, Service> = {
  api: {
    name: "api",
    cwd: BACKEND,
    port: API_PORT,
    probe: `http://127.0.0.1:${API_PORT}/health`,
    command: () => ({ file: "pnpm", args: ["exec", "tsx", "watch", "src/index.ts"], env: { PORT: String(API_PORT) } }),
  },
  worker: {
    name: "worker",
    cwd: BACKEND,
    command: () => ({ file: "pnpm", args: ["exec", "tsx", "watch", "src/worker.ts"], env: {} }),
  },
  web: {
    name: "web",
    cwd: WEB,
    port: WEB_PORT,
    probe: `http://127.0.0.1:${WEB_PORT}/`,
    command: () => ({ file: "pnpm", args: ["exec", "next", "dev", "-p", String(WEB_PORT)], env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}` } }),
  },
};

// ---------------------------------------------------------------------------
// Env + process helpers
// ---------------------------------------------------------------------------

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const backendEnv = () => readEnvFile(join(BACKEND, ".env"));

function isLocalNeo4j(uri: string | undefined): boolean {
  return !!uri && /^(bolt|neo4j):\/\/(localhost|127\.0\.0\.1)/.test(uri);
}

function isLocalSupabase(url: string | undefined): boolean {
  return !!url && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);
}

function pidPath(name: ServiceName): string {
  return join(RUN_DIR, `${name}.pid`);
}

function logPath(name: ServiceName): string {
  return join(RUN_DIR, `${name}.log`);
}

function readPid(name: ServiceName): number | undefined {
  const path = pidPath(name);
  if (!existsSync(path)) return undefined;
  const pid = Number(readFileSync(path, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listenerPid(port: number): number | undefined {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  const first = result.stdout.trim().split("\n").filter(Boolean)[0];
  return first ? Number(first) : undefined;
}

function tcpOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function httpStatus(url: string, timeoutMs = 3000): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.status;
  } catch {
    return null;
  }
}

function sh(file: string, args: string[], cwd: string, env: Record<string, string> = {}): { code: number; out: string } {
  const result = spawnSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function requestedServices(input: Readonly<Record<string, unknown>>): Service[] {
  const picked = input.service as string[] | undefined;
  const names = picked && picked.length ? picked : [...SERVICE_NAMES];
  return names.map((name) => SERVICES[name as ServiceName]);
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

type ServiceState = { service: string; pid: number | null; running: boolean; port: number | null; listening: boolean; http: number | null; log: string };

async function serviceState(service: Service): Promise<ServiceState> {
  const pid = readPid(service.name);
  const running = alive(pid);
  const listening = service.port ? listenerPid(service.port) !== undefined : false;
  const http = service.probe && listening ? await httpStatus(service.probe) : null;
  return { service: service.name, pid: pid ?? null, running, port: service.port ?? null, listening, http, log: logPath(service.name) };
}

async function ensureLocalDependencies(): Promise<string[]> {
  const notes: string[] = [];
  const env = backendEnv();
  if (isLocalNeo4j(env.NEO4J_URI)) {
    if (!(await tcpOpen("127.0.0.1", 7687))) {
      const up = sh("docker", ["compose", "up", "-d"], BACKEND);
      notes.push(up.code === 0 ? "neo4j: started docker container" : `neo4j: docker compose up failed: ${up.out}`);
    } else notes.push("neo4j: already listening on 7687");
  }
  if (isLocalSupabase(env.NEXT_PUBLIC_SUPABASE_URL)) {
    const port = Number(new URL(env.NEXT_PUBLIC_SUPABASE_URL).port || 54321);
    if (!(await tcpOpen("127.0.0.1", port))) {
      const up = sh("supabase", ["start"], BACKEND);
      notes.push(up.code === 0 ? "supabase: started local stack" : `supabase: start failed: ${up.out.split("\n").slice(-3).join(" ")}`);
    } else notes.push(`supabase: already listening on ${port}`);
  }
  return notes;
}

function startService(service: Service): string {
  const current = readPid(service.name);
  if (alive(current)) return `${service.name}: already running (pid ${current})`;
  if (service.port) {
    const owner = listenerPid(service.port);
    if (owner) return `${service.name}: port ${service.port} is held by pid ${owner} that this CLI does not own; stop it first`;
  }
  mkdirSync(RUN_DIR, { recursive: true });
  const { file, args, env } = service.command();
  const log = logPath(service.name);
  writeFileSync(log, `\n=== dev start ${new Date().toISOString()} slot ${SLOT} ===\n`, { flag: "a" });
  const child = spawn(file, args, {
    cwd: service.cwd,
    env: { ...process.env, ...env, FORCE_COLOR: "0" },
    detached: true,
    stdio: ["ignore", openSync(log, "a"), openSync(log, "a")],
  });
  child.unref();
  writeFileSync(pidPath(service.name), String(child.pid));
  return `${service.name}: started pid ${child.pid}${service.port ? ` on ${service.port}` : ""}`;
}

async function waitFor(service: Service, timeoutMs = 60000): Promise<boolean> {
  if (!service.port) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.probe && (await httpStatus(service.probe)) !== null) return true;
    if (!alive(readPid(service.name))) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function stopService(service: Service): Promise<string> {
  const pid = readPid(service.name);
  const messages: string[] = [];
  if (alive(pid)) {
    try {
      process.kill(-(pid as number), "SIGTERM");
    } catch {
      process.kill(pid as number, "SIGTERM");
    }
    const deadline = Date.now() + 8000;
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    if (alive(pid)) {
      try {
        process.kill(-(pid as number), "SIGKILL");
      } catch {
        process.kill(pid as number, "SIGKILL");
      }
    }
    messages.push(`${service.name}: stopped pid ${pid}`);
  } else messages.push(`${service.name}: not running`);
  rmSync(pidPath(service.name), { force: true });
  if (service.port) {
    const owner = listenerPid(service.port);
    if (owner) messages.push(`${service.name}: port ${service.port} still held by pid ${owner} (not started by this CLI)`);
  }
  return messages.join("; ");
}

function tailLog(path: string, lines: number): string[] {
  if (!existsSync(path)) return [];
  const all = readFileSync(path, "utf8").split("\n");
  return all.slice(Math.max(0, all.length - lines - 1)).filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

type Check = { check: string; ok: boolean; detail: string };

async function doctor(): Promise<Check[]> {
  const checks: Check[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ check: "node", ok: nodeMajor >= 22, detail: `v${process.versions.node} (need >=22)` });
  const pnpm = sh("pnpm", ["--version"], ROOT);
  checks.push({ check: "pnpm", ok: pnpm.code === 0, detail: pnpm.code === 0 ? pnpm.out : "pnpm not found" });
  checks.push({ check: "backend deps", ok: existsSync(join(BACKEND, "node_modules")), detail: existsSync(join(BACKEND, "node_modules")) ? "installed" : "run `dev deps`" });
  checks.push({ check: "web deps", ok: existsSync(join(WEB, "node_modules")), detail: existsSync(join(WEB, "node_modules")) ? "installed" : "run `dev deps`" });

  const env = backendEnv();
  const required = ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "JWT_SECRET", "OPENAI_API_KEY"];
  const missing = required.filter((key) => !env[key]);
  checks.push({ check: "backend/.env", ok: existsSync(join(BACKEND, ".env")) && missing.length === 0, detail: existsSync(join(BACKEND, ".env")) ? (missing.length ? `missing ${missing.join(", ")}` : "all required keys set") : "missing; copy backend/.env.example" });
  checks.push({ check: "web/.env.local", ok: existsSync(join(WEB, ".env.local")), detail: existsSync(join(WEB, ".env.local")) ? "present" : "missing; copy web/.env.example" });

  if (env.NEO4J_URI) {
    const url = new URL(env.NEO4J_URI.replace(/^(neo4j|bolt)(\+s|\+ssc)?:/, "http:"));
    const host = url.hostname;
    const port = Number(url.port || 7687);
    const open = await tcpOpen(host, port, 3000);
    checks.push({ check: "neo4j", ok: open, detail: `${env.NEO4J_URI} ${open ? "reachable" : "unreachable"}${isLocalNeo4j(env.NEO4J_URI) && !open ? " — `dev start` brings up backend/docker-compose.yml" : ""}` });
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL) {
    const status = await httpStatus(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`);
    checks.push({ check: "supabase", ok: status !== null, detail: `${env.NEXT_PUBLIC_SUPABASE_URL} ${status === null ? "unreachable" : `HTTP ${status}`}${isLocalSupabase(env.NEXT_PUBLIC_SUPABASE_URL) && status === null ? " — `dev db supabase start`" : ""}` });
  }

  for (const service of Object.values(SERVICES)) {
    if (!service.port) continue;
    const owner = listenerPid(service.port);
    const ours = readPid(service.name);
    const ok = owner === undefined || (ours !== undefined && alive(ours));
    checks.push({ check: `port ${service.port} (${service.name})`, ok, detail: owner === undefined ? "free" : ours === owner ? `owned by ${service.name} pid ${owner}` : `held by foreign pid ${owner}` });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Command tree
// ---------------------------------------------------------------------------

const serviceFlag = {
  kind: "flag" as const,
  name: "service",
  type: "enum" as const,
  values: SERVICE_NAMES,
  repeatable: true,
  description: "Limit to one or more services. Omit for all three: api, worker, web.",
};

const definition = {
  name: "dev",
  description: "Saturn development lifecycle: the Express api, the pg-boss worker, and the Next.js web app, plus the local databases they need.",
  commands: [
    {
      name: "start",
      description: "start development services in the background.",
      whenToUse: "you need the api, worker, or web app running in this checkout.",
      params: [serviceFlag],
      output: [
        { name: "slot", type: "string", description: "Grove slot this checkout runs in (0 = source)." },
        { name: "dependencies", type: "string[]", description: "What was done for local Neo4j and Supabase." },
        { name: "services", type: "string[]", description: "One line per requested service." },
        { name: "ready", type: "boolean", description: "Every requested service with a port answered its HTTP probe." },
      ],
      effects: ["Starts local Neo4j (docker compose) and Supabase when backend/.env points at localhost.", "Spawns detached processes; pids and logs under .grove/run/."],
      result: {
        block: "dev-start",
        render: (value: JsonObject) => {
          const v = value as { slot: string; dependencies: string[]; services: string[]; ready: boolean };
          return { attributes: { slot: v.slot, ready: v.ready }, body: [...v.dependencies, ...v.services].join("\n") };
        },
      },
      run: async (input) => {
        const dependencies = await ensureLocalDependencies();
        const services = requestedServices(input);
        const lines = services.map(startService);
        let ready = true;
        for (const service of services) if (!(await waitFor(service))) ready = false;
        return withExitCode({ slot: SLOT, dependencies, services: lines, ready }, ready ? 0 : 1);
      },
    },
    {
      name: "stop",
      description: "stop development services and release their listeners.",
      whenToUse: "you are done with the services or need their ports back.",
      params: [serviceFlag],
      output: [{ name: "services", type: "string[]", description: "One line per requested service." }],
      effects: ["Sends SIGTERM (then SIGKILL after 8s) to processes this CLI started. Leaves Neo4j and Supabase running; they are shared."],
      result: { block: "dev-stop", render: (value: JsonObject) => ({ body: (value.services as string[]).join("\n") }) },
      run: async (input) => ({ services: await Promise.all(requestedServices(input).map(stopService)) }),
    },
    {
      name: "restart",
      description: "stop then start development services.",
      whenToUse: "a service is wedged or env changed and a watcher restart is not enough.",
      params: [serviceFlag],
      output: [
        { name: "stopped", type: "string[]", description: "Stop results." },
        { name: "started", type: "string[]", description: "Start results." },
        { name: "ready", type: "boolean", description: "Every requested service with a port answered its HTTP probe." },
      ],
      effects: ["Same as stop followed by start."],
      result: { block: "dev-restart", render: (value: JsonObject) => ({ attributes: { ready: value.ready as boolean }, body: [...(value.stopped as string[]), ...(value.started as string[])].join("\n") }) },
      run: async (input) => {
        const services = requestedServices(input);
        const stopped = await Promise.all(services.map(stopService));
        await ensureLocalDependencies();
        const started = services.map(startService);
        let ready = true;
        for (const service of services) if (!(await waitFor(service))) ready = false;
        return withExitCode({ stopped, started, ready }, ready ? 0 : 1);
      },
    },
    {
      name: "status",
      description: "report each service: pid, port, listener, HTTP probe.",
      whenToUse: "you need to know what is running before acting.",
      output: [
        { name: "slot", type: "string", description: "Grove slot." },
        { name: "services", type: "object[]", description: "{service, pid, running, port, listening, http, log}." },
      ],
      effects: ["None. Read-only."],
      result: {
        block: "dev-status",
        render: (value: JsonObject) => {
          const rows = value.services as ServiceState[];
          return {
            attributes: { slot: value.slot as string },
            body: rows.map((r) => `${r.service}: ${r.running ? `running pid ${r.pid}` : "stopped"}${r.port ? ` · port ${r.port} ${r.listening ? "listening" : "closed"}` : ""}${r.http !== null ? ` · HTTP ${r.http}` : ""}`).join("\n"),
          };
        },
      },
      run: async () => ({ slot: SLOT, services: await Promise.all(Object.values(SERVICES).map(serviceState)) }),
    },
    {
      name: "logs",
      description: "read recent log lines from a service.",
      whenToUse: "a service misbehaves and you need its output.",
      params: [serviceFlag, { kind: "flag", name: "tail", type: "integer", description: "Lines per service.", default: 60, min: 1, max: 5000 }],
      output: [{ name: "logs", type: "object[]", description: "{service, path, lines[]}." }],
      effects: ["None. Read-only."],
      result: {
        block: "dev-logs",
        render: (value: JsonObject) => ({ body: (value.logs as { service: string; path: string; lines: string[] }[]).map((l) => `--- ${l.service} (${l.path}) ---\n${l.lines.join("\n")}`).join("\n\n") }),
      },
      run: async (input) => ({ logs: requestedServices(input).map((s) => ({ service: s.name, path: logPath(s.name), lines: tailLog(logPath(s.name), input.tail as number) })) }),
    },
    {
      name: "logpath",
      description: "print absolute log paths.",
      whenToUse: "you want to tail or open a log yourself.",
      params: [serviceFlag],
      output: [{ name: "paths", type: "object[]", description: "{service, path}." }],
      effects: ["None. Read-only."],
      result: { block: "dev-logpath", render: (value: JsonObject) => ({ body: (value.paths as { service: string; path: string }[]).map((p) => `${p.service}: ${p.path}`).join("\n") }) },
      run: async (input) => ({ paths: requestedServices(input).map((s) => ({ service: s.name, path: logPath(s.name) })) }),
    },
    {
      name: "doctor",
      description: "check toolchain, env files, database reachability, and port ownership.",
      whenToUse: "something will not start, or you are in a fresh checkout.",
      output: [
        { name: "healthy", type: "boolean", description: "Every check passed." },
        { name: "checks", type: "object[]", description: "{check, ok, detail}." },
      ],
      effects: ["None. Read-only: probes sockets and reads files; changes nothing."],
      result: {
        block: "dev-doctor",
        render: (value: JsonObject) => ({ attributes: { healthy: value.healthy as boolean }, body: (value.checks as Check[]).map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.check}: ${c.detail}`).join("\n") }),
      },
      run: async () => {
        const checks = await doctor();
        const healthy = checks.every((c) => c.ok);
        return withExitCode({ healthy, checks }, healthy ? 0 : 1);
      },
    },
    {
      name: "deps",
      description: "install backend and web dependencies with pnpm.",
      whenToUse: "a fresh checkout, a planted instance, or package.json changed.",
      output: [{ name: "results", type: "string[]", description: "One line per package dir." }],
      effects: ["Runs `pnpm install` in backend/ and web/."],
      result: { block: "dev-deps", render: (value: JsonObject) => ({ body: (value.results as string[]).join("\n") }) },
      run: async () => {
        const results = [BACKEND, WEB].map((dir) => {
          const r = sh("pnpm", ["install"], dir);
          return `${dir}: ${r.code === 0 ? "ok" : `failed\n${r.out}`}`;
        });
        return withExitCode({ results }, results.every((r) => r.endsWith(": ok")) ? 0 : 1);
      },
    },
    {
      name: "check",
      description: "type-check the backend and run its unit tests.",
      whenToUse: "before committing or reporting a backend change done.",
      params: [{ kind: "flag", name: "skip-tests", type: "boolean", description: "Only type-check.", default: false }],
      output: [
        { name: "typecheck", type: "string", description: "ok or the tsc output." },
        { name: "tests", type: "string", description: "ok, skipped, or the vitest output." },
      ],
      effects: ["None beyond compiler and test side effects."],
      result: { block: "dev-check", render: (value: JsonObject) => ({ body: `typecheck: ${value.typecheck}\ntests: ${value.tests}` }) },
      run: async (input) => {
        const tc = sh("pnpm", ["run", "type-check"], BACKEND);
        const typecheck = tc.code === 0 ? "ok" : tc.out;
        let tests = "skipped";
        let testsOk = true;
        if (!input["skip-tests"]) {
          const t = sh("pnpm", ["run", "test:run"], BACKEND);
          testsOk = t.code === 0;
          tests = testsOk ? "ok" : t.out.split("\n").slice(-40).join("\n");
        }
        return withExitCode({ typecheck, tests }, tc.code === 0 && testsOk ? 0 : 1);
      },
    },
    {
      name: "db",
      description: "the two databases: Neo4j (graph) and Supabase Postgres.",
      whenToUse: "you need to reset, back up, restore, or regenerate types for a database.",
      model: "Neo4j holds the per-user knowledge graph; Supabase Postgres holds transcripts, embeddings, users, and the pg-boss queue. Both are shared across Grove instances on this machine.",
      children: [
        {
          name: "neo4j",
          description: "the Neo4j knowledge graph.",
          whenToUse: "you need to initialise, wipe, back up, or restore graph data.",
          children: [
            {
              name: "init-schema",
              description: "create constraints and indexes.",
              whenToUse: "a fresh database; the api also does this on boot.",
              output: [{ name: "output", type: "string", description: "Script output." }],
              effects: ["Creates Neo4j constraints and indexes; idempotent."],
              result: { block: "neo4j-init-schema", render: (v: JsonObject) => ({ body: v.output as string }) },
              run: async () => {
                const r = sh("pnpm", ["exec", "tsx", "scripts/init-schema.ts"], BACKEND);
                return withExitCode({ output: r.out }, r.code);
              },
            },
            {
              name: "reset",
              description: "delete every node and relationship.",
              whenToUse: "you want an empty graph for a clean run.",
              params: [{ kind: "flag", name: "force", type: "boolean", description: "Required when NEO4J_URI is not localhost.", default: false }],
              output: [{ name: "output", type: "string", description: "Script output." }],
              effects: ["DESTRUCTIVE: wipes the graph named by backend/.env NEO4J_URI."],
              result: { block: "neo4j-reset", render: (v: JsonObject) => ({ body: v.output as string }) },
              run: async (input) => {
                const uri = backendEnv().NEO4J_URI;
                if (!isLocalNeo4j(uri) && !input.force) return withExitCode({ output: `refusing: NEO4J_URI=${uri} is not localhost; pass --force to wipe a remote graph` }, 1);
                const r = sh("node", ["scripts/reset-neo4j.js"], BACKEND);
                return withExitCode({ output: r.out }, r.code);
              },
            },
            {
              name: "backup",
              description: "dump the graph to backend/backups/.",
              whenToUse: "before a destructive change.",
              output: [{ name: "output", type: "string", description: "Script output including the file written." }],
              effects: ["Writes a JSON file under backend/backups/."],
              result: { block: "neo4j-backup", render: (v: JsonObject) => ({ body: v.output as string }) },
              run: async () => {
                const r = sh("pnpm", ["exec", "tsx", "scripts/backup-neo4j.ts"], BACKEND);
                return withExitCode({ output: r.out }, r.code);
              },
            },
            {
              name: "restore",
              description: "load a backup file into the graph.",
              whenToUse: "you need data back after a reset.",
              params: [{ kind: "positional", name: "file", type: "path", description: "Backup JSON path.", required: true }],
              output: [{ name: "output", type: "string", description: "Script output." }],
              effects: ["Writes nodes and relationships into the graph named by NEO4J_URI."],
              result: { block: "neo4j-restore", render: (v: JsonObject) => ({ body: v.output as string }) },
              run: async (input) => {
                const r = sh("pnpm", ["exec", "tsx", "scripts/restore-neo4j.ts", String(input.file)], BACKEND);
                return withExitCode({ output: r.out }, r.code);
              },
            },
          ],
        },
        {
          name: "supabase",
          description: "the local Supabase stack (Postgres, auth, REST) declared in backend/supabase/.",
          whenToUse: "the api or worker cannot reach Postgres, or the schema changed.",
          children: [
            {
              name: "start",
              description: "start the local Supabase containers.",
              whenToUse: "backend/.env points at 127.0.0.1:54321 and nothing answers.",
              output: [{ name: "output", type: "string", description: "supabase CLI output." }],
              effects: ["Starts docker containers via `supabase start` in backend/."],
              result: { block: "supabase-start", render: (v: JsonObject) => ({ body: v.output as string }) },
              run: async () => {
                const r = sh("supabase", ["start"], BACKEND);
                return withExitCode({ output: r.out }, r.code);
              },
            },
            {
              name: "stop",
              description: "stop the local Supabase containers.",
              whenToUse: "you want the containers gone.",
              output: [{ name: "output", type: "string", description: "supabase CLI output." }],
              effects: ["Stops the containers; data volumes persist."],
              result: { block: "supabase-stop", render: (v: JsonObject) => ({ body: v.output as string }) },
              run: async () => {
                const r = sh("supabase", ["stop"], BACKEND);
                return withExitCode({ output: r.out }, r.code);
              },
            },
            {
              name: "status",
              description: "show local Supabase URLs and keys.",
              whenToUse: "you need the local API URL or keys for .env.",
              output: [{ name: "output", type: "string", description: "supabase CLI output." }],
              effects: ["None. Read-only."],
              result: { block: "supabase-status", render: (v: JsonObject) => ({ body: v.output as string }) },
              run: async () => {
                const r = sh("supabase", ["status"], BACKEND);
                return withExitCode({ output: r.out }, r.code);
              },
            },
            {
              name: "types",
              description: "regenerate database.types.ts for backend and web from the linked project.",
              whenToUse: "a migration changed the schema.",
              output: [{ name: "results", type: "string[]", description: "One line per package." }],
              effects: ["Overwrites backend/src/types/database.types.ts and web/src/types/database.types.ts."],
              result: { block: "supabase-types", render: (v: JsonObject) => ({ body: (v.results as string[]).join("\n") }) },
              run: async () => {
                const results = [BACKEND, WEB].map((dir) => {
                  const r = sh("pnpm", ["run", "db:pull"], dir);
                  return `${dir}: ${r.code === 0 ? "ok" : `failed\n${r.out}`}`;
                });
                return withExitCode({ results }, results.every((r) => r.endsWith(": ok")) ? 0 : 1);
              },
            },
          ],
        },
      ],
    },
    {
      name: "query",
      description: "run a Cypher query against the graph named by backend/.env.",
      whenToUse: "you need to inspect graph data directly.",
      params: [
        { kind: "positional", name: "cypher", type: "string", description: "The Cypher statement.", required: true },
        { kind: "flag", name: "prod", type: "boolean", description: "Use backend/.env.production instead.", default: false },
      ],
      output: [{ name: "output", type: "string", description: "Result rows encoded as TOON." }],
      effects: ["Runs the statement as written; a write statement writes."],
      result: { block: "dev-query", render: (v: JsonObject) => ({ body: v.output as string }) },
      run: async (input) => {
        const args = ["exec", "tsx", "cli.ts"];
        if (input.prod) args.push("--prod");
        args.push(String(input.cypher));
        const r = sh("pnpm", args, BACKEND);
        return withExitCode({ output: r.out }, r.code);
      },
    },
  ],
};

const cli = defineCli(definition);

if (process.argv.length === 3 && process.argv[2] === "--emit-crtr-fragment") {
  process.stdout.write(`${JSON.stringify(generateCrtrFragment(definition, ".grove/dev.ts"), null, 2)}\n`);
} else {
  cli.run();
}
