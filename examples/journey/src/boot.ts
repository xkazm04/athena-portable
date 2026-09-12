/**
 * README section 3.5 ("sidecar lifecycle ... a tree kill") applied to the example apps.
 *
 * The runner owns the environment it asserts against: it starts each app itself, waits for the
 * first compiled response, and kills the whole process tree on the way out. `next dev` on Windows
 * spawns a child of its own, so a bare `child.kill()` orphans the server that holds the port —
 * the same failure the desktop shell's sidecar module exists to prevent, and the reason the tree
 * kill is here rather than left to the runner's exit.
 *
 * Freshness comes from the working directory, not from deleting anything. Every app resolves its
 * SQLite file as `process.cwd()/data/<app>.sqlite` and seeds it on the first request
 * (`@athena/demo-kit/db`), so the server is started as `next dev <app directory>` from a scratch
 * directory of this run's own: the project is the app, the database is the scratch, and a journey
 * never seeds over — or deletes — a database somebody else is using. A run that repeats sees the
 * same seeded rows as the first one, which is what makes the act 1 beats about specific credits
 * assertable at all.
 *
 * `JOURNEY_KEEP_APPS=1` skips all of it and drives whatever is already listening.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { urlOf, type AppSpec } from "./apps.ts";

/** First response from `next dev` includes a cold compile; four minutes is not generous. */
const READY_TIMEOUT_MS = 240_000;
const PROBE_INTERVAL_MS = 1_000;

export interface Booted {
  readonly app: AppSpec;
  /** Absent when the app was already listening and the runner only adopted it. */
  readonly child: ChildProcess | null;
  readonly adopted: boolean;
  /** The scratch working directory this run's database lives in. */
  readonly cwd: string | null;
}

export function keepApps(): boolean {
  return process.env.JOURNEY_KEEP_APPS === "1";
}

/** A GET that resolves to `true` for any HTTP answer at all: a 500 still means the port is live. */
export async function listening(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    await response.text();
    return true;
  } catch {
    return false;
  }
}

/**
 * This run's working directory for one app: empty, outside the repository, and the place the
 * app's `data/<app>.sqlite` will be created and seeded.
 */
function scratchFor(app: AppSpec): string {
  const dir = join(tmpdir(), "athena-journey", String(process.pid), app.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  return dir;
}

/**
 * Spawn Next's own bin with this Node, never through a shell, with the app passed as the project
 * directory so the working directory — and therefore the database — can be somewhere else.
 *
 * `pnpm exec next` on Windows is `pnpm.cmd`, and Node refuses to spawn a `.cmd` without
 * `shell: true` — which then makes the child a `cmd.exe` whose grandchild owns the port. Calling
 * the JavaScript entry point directly keeps the tree shallow and the kill reliable.
 */
function spawnNext(app: AppSpec, cwd: string): ChildProcess {
  const bin = resolve(app.dir, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(bin)) {
    throw new Error(`${app.id}: next is not installed at ${bin}; run pnpm install at the repo root`);
  }
  return spawn(process.execPath, [bin, "dev", app.dir, "--port", String(app.port)], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", FORCE_COLOR: "0" },
    windowsHide: true,
    // A process group of its own, so the POSIX branch of `shutdown` has something to signal.
    detached: process.platform !== "win32",
  });
}

export async function boot(app: AppSpec, log: (line: string) => void = () => {}): Promise<Booted> {
  const busy = await listening(urlOf(app));
  if (busy && keepApps()) {
    log(`${app.id}: already listening on ${app.port}; adopting it, database and all`);
    return { app, child: null, adopted: true, cwd: null };
  }
  if (busy) {
    // Adopting a server nobody asked for is how a journey ends up asserting against whatever
    // code that process happens to be running — which is a green run that proves nothing. So a
    // held port is a refusal that names both ways out.
    throw new Error(
      `${app.id}: something is already listening on ${app.port}. ` +
        `Set JOURNEY_KEEP_APPS=1 to drive it as it is, or JOURNEY_PORT_OFFSET=<n> to boot a fresh one beside it.`,
    );
  }
  if (keepApps()) throw new Error(`${app.id}: JOURNEY_KEEP_APPS=1 but nothing is listening on ${app.port}`);

  const cwd = scratchFor(app);
  const child = spawnNext(app, cwd);
  const tail: string[] = [];
  const keep = (chunk: Buffer) => {
    tail.push(chunk.toString());
    if (tail.length > 40) tail.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let dead: string | null = null;
  child.on("exit", (code) => {
    dead = `next dev exited with ${String(code)}`;
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (dead) throw new Error(`${app.id}: ${dead}\n${tail.join("")}`);
    if (await listening(urlOf(app))) {
      log(`${app.id}: ready on ${app.port}, database in ${cwd}`);
      return { app, child, adopted: false, cwd };
    }
    await delay(PROBE_INTERVAL_MS);
  }
  await shutdown({ app, child, adopted: false, cwd });
  throw new Error(`${app.id}: no answer on ${app.port} within ${READY_TIMEOUT_MS} ms\n${tail.join("")}`);
}

/** Kill the tree, not the process: on win32 `taskkill /T /F`, elsewhere the process group. */
export async function shutdown(booted: Booted): Promise<void> {
  const { child } = booted;
  if (child && child.pid !== undefined && child.exitCode === null) {
    if (process.platform === "win32") {
      await new Promise<void>((done) => {
        const kill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
        kill.on("exit", () => done());
        kill.on("error", () => done());
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGKILL");
      }
    }
    await delay(500);
  }
  // The scratch database is this run's; keeping it would make the next run's seed a no-op.
  if (booted.cwd) rmSync(booted.cwd, { recursive: true, force: true });
}
