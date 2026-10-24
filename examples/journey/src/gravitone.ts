/**
 * README section 3.5 ("sidecar lifecycle ... a tree kill") applied to a sibling repository: a real,
 * production-built Gravitone for `tests/gravitone.spec.ts`.
 *
 * Gravitone is not ours. It lives beside this repository (`GRAVITONE_DIR`, default
 * `<athena repo>/../gravitone-gcloud`, resolved at runtime so no machine path is committed), and its
 * operator runs their own `next dev` on :3000 against their own store. So everything here is about
 * leaving that checkout exactly as it was found:
 *
 *  - **its store is never opened.** `GRAVITONE_STORE_PATH` points at a scratch file of this run, and
 *    every `*_STORE_DIR` the checkout's `.env.example` declares (read at runtime, plus the stores the
 *    code reads with no `.env.example` line) points at a scratch directory. Exported variables beat
 *    `.env.local` in both Next and gravitone's own CLIs, so a key in that file cannot move them back.
 *    `GRAVITONE_DRY_ONLY=1` makes a live receipt unreadable, so nothing this run launches can spend.
 *  - **its build output is its own.** `NEXT_DIST_DIR=.next-athena-e2e` (gravitone's next.config reads
 *    it; `.next-*` is gitignored there), on its own port (3150 + `JOURNEY_PORT_OFFSET`), refused if
 *    that port is already held.
 *  - **its tracked files are put back.** `next build` appends the dist dir's type globs to
 *    `tsconfig.json` and rewrites `next-env.d.ts`; both are read before the build and written back
 *    byte for byte after it, success or not. Teardown asserts `git status --porcelain tsconfig.json`
 *    is empty.
 *
 * The build is cached: skipped when `.next-athena-e2e/BUILD_ID` is newer than gravitone's HEAD commit.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { envInt } from "./apps.ts";
import { listening } from "./boot.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The athena-portable checkout: `examples/journey/src` is three levels below it. */
export const ATHENA_ROOT = resolve(here, "..", "..", "..");

export const DIST_DIR = ".next-athena-e2e";
export const GRAVITONE_PORT = 3150 + envInt("JOURNEY_PORT_OFFSET", 0);

/**
 * Stores gravitone's code reads from an env override that `.env.example` does not list. Each defaults
 * to `<cwd>/foundry-out/<x>`, the operator's real data, so each is pointed at scratch as well.
 */
const UNLISTED_STORES = [
  "SPEND_STORE_DIR",
  "SCOUT_STORE_DIR",
  "SCOUT_MUSE_STORE_DIR",
  "EXTRACT_STORE_DIR",
  "MESH_STORE_DIR",
  "PUBLISH_STORE_DIR",
  "CLIP_STORE_DIR",
  "STRIPS_STORE_DIR",
  "TEXT_TURN_DIR",
] as const;

const BUILD_TIMEOUT_MS = 25 * 60_000;
const READY_TIMEOUT_MS = 120_000;
/** Files `next build` rewrites in the checkout; both are restored byte for byte. */
const TOUCHED = ["tsconfig.json", "next-env.d.ts"] as const;

export function gravitoneDir(): string {
  return resolve(process.env.GRAVITONE_DIR ?? join(ATHENA_ROOT, "..", "gravitone-gcloud"));
}

/** Why this machine cannot run the Gravitone spec, or `null` when it can. */
export function unavailable(dir = gravitoneDir()): string | null {
  if (!existsSync(join(dir, "package.json"))) return `no Gravitone checkout at ${dir} (set GRAVITONE_DIR)`;
  if (!existsSync(nextBin(dir))) return `Gravitone at ${dir} has no node_modules/next; run its install first`;
  if (!existsSync(join(dir, "pipeline", "token.mts"))) return `Gravitone at ${dir} has no pipeline/token.mts`;
  return null;
}

function nextBin(dir: string): string {
  return join(dir, "node_modules", "next", "dist", "bin", "next");
}

export interface Gravitone {
  readonly dir: string;
  readonly port: number;
  /** `http://localhost:<port>`: local entry needs a loopback Host, and this is the page origin. */
  readonly origin: string;
  readonly scratch: string;
  /** The `act` token minted into the scratch store. Never print it. */
  readonly token: string;
  readonly built: "cached" | "fresh";
  readonly tail: () => string;
  /** Kill the server tree, remove scratch, and report what teardown found. */
  readonly stop: () => Promise<Teardown>;
}

export interface Teardown {
  /** `git status --porcelain tsconfig.json` in the checkout; must be empty. */
  readonly tsconfigStatus: string;
  readonly portFree: boolean;
}

/** The environment every gravitone process of this run gets: scratch stores, dry only, prod. */
function envFor(dir: string, scratch: string): NodeJS.ProcessEnv {
  const stores = new Set<string>(UNLISTED_STORES);
  const example = join(dir, ".env.example");
  if (existsSync(example)) {
    for (const match of readFileSync(example, "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]*_STORE_DIR)\s*=/gm)) {
      stores.add(match[1] as string);
    }
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    FORCE_COLOR: "0",
    NEXT_DIST_DIR: DIST_DIR,
    GRAVITONE_STORE_PATH: join(scratch, "gravitone.sqlite"),
    GRAVITONE_DRY_ONLY: "1",
  };
  for (const name of stores) {
    const at = join(scratch, "stores", name.toLowerCase());
    mkdirSync(at, { recursive: true });
    env[name] = at;
  }
  // An agent token from the operator's shell must not be what any gravitone process reads.
  delete env.GRAVITONE_CLI_TOKEN;
  return env;
}

function headTime(dir: string): number {
  const out = spawnSync("git", ["-C", dir, "log", "-1", "--format=%ct"], { encoding: "utf8" });
  const seconds = Number(out.stdout.trim());
  return Number.isFinite(seconds) ? seconds * 1000 : Number.POSITIVE_INFINITY;
}

function buildIsFresh(dir: string): boolean {
  const id = join(dir, DIST_DIR, "BUILD_ID");
  return existsSync(id) && statSync(id).mtimeMs > headTime(dir);
}

/** Run `next build` with the checkout's touched files read before and written back after. */
async function build(dir: string, env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> {
  const saved = new Map<string, Buffer>();
  for (const name of TOUCHED) {
    const at = join(dir, name);
    if (existsSync(at)) saved.set(name, readFileSync(at));
  }
  log(`gravitone: building ${DIST_DIR} (this takes minutes)`);
  try {
    const child = spawn(process.execPath, [nextBin(dir), "build", dir], {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const tail = collect(child);
    const code = await new Promise<number | null>((done) => {
      const timer = setTimeout(() => {
        void killTree(child).then(() => done(null));
      }, BUILD_TIMEOUT_MS);
      child.on("exit", (c) => {
        clearTimeout(timer);
        done(c);
      });
    });
    if (code !== 0) throw new Error(`gravitone: next build exited ${String(code)}\n${tail()}`);
    log("gravitone: build done");
  } finally {
    for (const [name, bytes] of saved) {
      const at = join(dir, name);
      if (!existsSync(at) || !readFileSync(at).equals(bytes)) writeFileSync(at, bytes);
    }
  }
}

/** Mint `athena`'s `act` token into the scratch store. The token never reaches a log. */
function mint(dir: string, env: NodeJS.ProcessEnv): string {
  const out = spawnSync(
    process.execPath,
    [join("pipeline", "token.mts"), "mint", "--name", "athena", "--scope", "act", "--json"],
    { cwd: dir, env, encoding: "utf8", windowsHide: true, timeout: 120_000 },
  );
  let parsed: { ok?: boolean; token?: unknown; error?: unknown } = {};
  try {
    parsed = JSON.parse(out.stdout.trim().split("\n").pop() ?? "{}") as typeof parsed;
  } catch {
    // Reported below without stdout, which is where a token would be.
  }
  if (out.status !== 0 || parsed.ok !== true || typeof parsed.token !== "string") {
    const why = typeof parsed.error === "string" ? parsed.error : `exit ${String(out.status)}`;
    throw new Error(`gravitone: token mint failed: ${why}\n${out.stderr}`);
  }
  return parsed.token;
}

function collect(child: ChildProcess): () => string {
  const tail: string[] = [];
  const keep = (chunk: Buffer) => {
    tail.push(chunk.toString());
    if (tail.length > 60) tail.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return () => tail.join("");
}

export async function killTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((done) => child.once("exit", () => done()));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGKILL");
    }
  }
  await Promise.race([ended, delay(10_000)]);
  child.stdout?.destroy();
  child.stderr?.destroy();
}

/** Build (or reuse the build), mint the token, start `next start`, and wait for its first answer. */
export async function startGravitone(log: (line: string) => void = () => {}): Promise<Gravitone> {
  const dir = gravitoneDir();
  const missing = unavailable(dir);
  if (missing) throw new Error(missing);
  const origin = `http://localhost:${GRAVITONE_PORT}`;
  if (await listening(origin)) {
    throw new Error(`gravitone: something already listens on ${GRAVITONE_PORT}; set JOURNEY_PORT_OFFSET=<n>`);
  }

  const scratch = join(tmpdir(), "athena-journey-gravitone", String(process.pid));
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const env = envFor(dir, scratch);

  let built: "cached" | "fresh" = "cached";
  if (buildIsFresh(dir)) log(`gravitone: reusing ${DIST_DIR} (newer than HEAD)`);
  else {
    await build(dir, env, log);
    built = "fresh";
  }

  const token = mint(dir, env);
  const child = spawn(process.execPath, [nextBin(dir), "start", dir, "-p", String(GRAVITONE_PORT)], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const tail = collect(child);
  let dead: string | null = null;
  child.on("exit", (code) => {
    dead = `next start exited with ${String(code)}`;
  });

  const stop = async (): Promise<Teardown> => {
    await killTree(child);
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A SQLite file Windows still holds is not a failure; the scratch root is temporary.
    }
    const status = spawnSync("git", ["-C", dir, "status", "--porcelain", "tsconfig.json"], { encoding: "utf8" });
    return { tsconfigStatus: status.stdout.trim(), portFree: !(await listening(origin)) };
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (dead) {
      await stop();
      throw new Error(`gravitone: ${dead}\n${tail()}`);
    }
    if (await listening(origin)) {
      log(`gravitone: ready on ${GRAVITONE_PORT}, store in ${scratch}`);
      return { dir, port: GRAVITONE_PORT, origin, scratch, token, built, tail, stop };
    }
    await delay(1_000);
  }
  await stop();
  throw new Error(`gravitone: no answer on ${GRAVITONE_PORT} within ${READY_TIMEOUT_MS} ms\n${tail()}`);
}
