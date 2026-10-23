/**
 * Shadowrunr, booted for real on scratch copies: its daemon (`--scripted`) and its console.
 *
 * The daemon is the built binary (`SHADOWRUNR_BIN`) and nothing about it is substituted. What is
 * arranged is only WHERE it reads and writes, through a scratch `shadowrunr.toml` named with
 * `--config` (docs/guide/cli.md, "Configuration"):
 *
 *  - `[paths] characters` is a temp COPY of the overlord checkout's `characters/`, so a GATED
 *    write that lands, lands on the copy. The real package is hashed before and after the suite
 *    and the suites assert it did not move;
 *  - `[paths] data` is an empty temp dir (backups land in `<data>/character-backups/`);
 *  - `[paths] runs` is a temp dir holding a copy of the main checkout's `runs/sandbox` (so Review
 *    has real sessions) and one small tournament under `runs/sim/` (so the Simulator has one);
 *  - `policy`, `sim` and `segments` point at the checkout, read only.
 *
 * The console is the built `apps/console/dist`, served by a static server inside this process
 * on an ephemeral port and opened as `http://localhost:<port>/`: the daemon's Origin allowlist
 * admits `http://localhost:*` and nothing on `127.0.0.1`.
 *
 * The same three rules as `../../support/daemon.ts`: port 0 always (the daemon's ready line
 * names the port it bound), scratch everything, and teardown kills the tree on failure too.
 */
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

import { REPO_ROOT } from "../../support/daemon";

type Child = ChildProcessByStdio<null, Readable, Readable>;

/**
 * The overlord checkout the binary, the console build and the packages come from: `SHADOWRUNR_ROOT`,
 * else a sibling `overlord` next to this repository (`../overlord` from the repository root).
 */
export const OVERLORD = process.env.SHADOWRUNR_ROOT ?? resolve(REPO_ROOT, "..", "overlord");

/** The overlord checkout whose `runs/sandbox` holds the real sandbox sessions (a worktree has none). */
export const OVERLORD_MAIN = process.env.SHADOWRUNR_MAIN ?? OVERLORD;

export const SHADOWRUNR_BIN =
  process.env.SHADOWRUNR_BIN ?? join(OVERLORD, "target", "debug", process.platform === "win32" ? "shadowrunr.exe" : "shadowrunr");

export const CONSOLE_DIST = process.env.SHADOWRUNR_CONSOLE_DIST ?? join(OVERLORD, "apps", "console", "dist");

/** The one tournament copied into the scratch runs: small (about 1 MB) and with a tournament.json. */
export const TOURNAMENT_COPY = process.env.SHADOWRUNR_TOURNAMENT ?? "pilot-d1ef98d3a6";

/** Everything the suites need present before they boot; a missing piece skips, it does not fail. */
export function missingPieces(): string[] {
  const missing: string[] = [];
  if (!existsSync(SHADOWRUNR_BIN)) missing.push(`no shadowrunr binary at ${SHADOWRUNR_BIN}`);
  if (!existsSync(join(CONSOLE_DIST, "index.html"))) missing.push(`no console build at ${CONSOLE_DIST}`);
  if (!existsSync(join(OVERLORD, "characters", "malakor"))) missing.push(`no characters/malakor under ${OVERLORD}`);
  if (!existsSync(join(OVERLORD_MAIN, "runs", "sandbox"))) missing.push(`no runs/sandbox under ${OVERLORD_MAIN}`);
  return missing;
}

/** `sha256:<hex>` of a file's bytes, the digest `character.doc.get` reports. */
export function digestOf(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/** A digest over every file of a tree, for "the real package did not move". */
export function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(path.slice(root.length)).update(readFileSync(path));
    }
  };
  walk(root);
  return hash.digest("hex");
}

export interface Scratch {
  root: string;
  characters: string;
  data: string;
  runs: string;
  config: string;
}

const tomlPath = (p: string) => p.replace(/\\/g, "/");

/**
 * The scratch tree and its `shadowrunr.toml`, copied from `shadowrunr.example.toml` with only the
 * `[paths]` block rewritten (and the engine made keyless), so every other default is the shipped one.
 */
export function makeScratch(): Scratch {
  const root = mkdtempSync(join(tmpdir(), "shadowrunr-e2e-"));
  const characters = join(root, "characters");
  const data = join(root, "data");
  const runs = join(root, "runs");
  cpSync(join(OVERLORD, "characters"), characters, { recursive: true });
  mkdirSync(data, { recursive: true });
  cpSync(join(OVERLORD_MAIN, "runs", "sandbox"), join(runs, "sandbox"), { recursive: true });
  const tournament = join(OVERLORD_MAIN, "runs", "sim", TOURNAMENT_COPY);
  if (existsSync(tournament)) cpSync(tournament, join(runs, "sim", TOURNAMENT_COPY), { recursive: true });
  else mkdirSync(join(runs, "sim"), { recursive: true });

  const example = readFileSync(join(OVERLORD, "shadowrunr.example.toml"), "utf-8");
  const paths: Record<string, string> = {
    characters,
    runs,
    data,
    policy: join(OVERLORD, "policy"),
    sim: join(OVERLORD, "sim"),
    segments: join(OVERLORD, "crates", "shadowrunr-segments", "data"),
  };
  const lines = example.split(/\r?\n/);
  let section = "";
  const out = lines.map((line) => {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) section = header[1];
    const kv = /^(\w+)\s*=/.exec(line);
    if (section === "paths" && kv && kv[1] in paths) return `${kv[1]} = '${tomlPath(paths[kv[1]])}'`;
    // Keyless: no CLI accounts, the ScriptedEngine. `--scripted` says the same on the command line.
    if (section === "engine" && kv && kv[1] === "scripted") return "scripted = true";
    return line;
  });
  const config = join(root, "shadowrunr.toml");
  writeFileSync(config, out.join("\n"), "utf-8");
  return { root, characters, data, runs, config };
}

// ---- the daemon ---------------------------------------------------------------------------------

export interface ShadowDaemon {
  url: string;
  stderr: () => string;
  stop: () => Promise<void>;
}

const READY_TIMEOUT_MS = 60_000;

/** `shadowrunr --config <scratch> daemon --scripted --port 0`, resolved on its ready line. */
export async function startShadowDaemon(scratch: Scratch): Promise<ShadowDaemon> {
  const child = spawn(SHADOWRUNR_BIN, ["--config", scratch.config, "daemon", "--scripted", "--port", "0"], {
    // The scratch root, so even a relative default could not reach the real tree.
    cwd: scratch.root,
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "warn" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  }) as Child;
  let err = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (c: string) => {
    err = (err + c).slice(-20_000);
  });
  const stop = () => killTree(child);
  try {
    const url = await new Promise<string>((resolveUrl, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error(`no shadowrunr ready line in ${READY_TIMEOUT_MS} ms\n${buffer}\n${err}`)), READY_TIMEOUT_MS);
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (c: string) => {
        buffer += c;
        // `shadowrunr daemon on http://127.0.0.1:<port> (scripted engine): POST /rpc, ...`
        const m = /daemon on (http:\/\/127\.0\.0\.1:\d+)/.exec(buffer);
        if (m) {
          clearTimeout(timer);
          resolveUrl(m[1]);
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`shadowrunr exited ${code} before its ready line\n${err}`));
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    return { url, stderr: () => err, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** One `POST /rpc`, with no Origin (a non-browser client), answering the result or throwing. */
export async function rpc<T = unknown>(daemonUrl: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${daemonUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { code: string; message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.code}: ${body.error.message}`);
  return body.result as T;
}

// ---- the console --------------------------------------------------------------------------------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

export interface ConsoleServer {
  /** `http://localhost:<port>`, the origin the page runs under. */
  origin: string;
  stop: () => Promise<void>;
}

/**
 * The built console, served from this process (no child to lose). Bound on 127.0.0.1 and
 * opened by the name `localhost`, which Chromium always resolves to loopback. `port` 0 (the
 * default) is ephemeral; a fixed one keeps the origin stable across runs, which matters when the
 * suite drives a person's own Athena and every new origin would be a new row in their trust table.
 */
export async function serveConsole(dist: string = CONSOLE_DIST, port = 0): Promise<ConsoleServer> {
  const root = resolve(dist);
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  const bound = (server.address() as AddressInfo).port;
  return {
    origin: `http://localhost:${bound}`,
    stop: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

// ---- teardown -----------------------------------------------------------------------------------

export async function killTree(child: Child): Promise<void> {
  const pid = child.pid;
  const ended = new Promise<void>((r) => {
    if (child.exitCode !== null || child.signalCode !== null) r();
    else child.once("exit", () => r());
  });
  if (pid !== undefined) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
  child.kill("SIGKILL");
  await Promise.race([ended, new Promise<void>((r) => setTimeout(r, 10_000))]);
  child.stdout.destroy();
  child.stderr.destroy();
}

export function removeScratch(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A file Windows still holds is not a test failure; the root is under the OS temp dir.
  }
}
