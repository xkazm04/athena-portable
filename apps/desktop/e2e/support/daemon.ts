/**
 * A real `athena serve` on a real ephemeral port, for the end-to-end suites — README section 3.5.
 *
 * The daemon under test is the shipped one. `tests/e2e/serve_scripted.py` substitutes exactly two
 * seams — the engine's transport and the voice backend — and then calls
 * `athena.daemon.server.serve` with every flag untouched, so the routes, the token check, CORS,
 * the gate, the catalog, the approval table and the ledger are the ones the product builds.
 *
 * Three rules hold here and they are the difference between a suite that can be run on a machine
 * that is already busy and one that eats it:
 *
 *  1. **Port 0, always.** The port is read back off the ready line. Nothing in this directory ever
 *     names a port, so two suites and a running shell never collide.
 *  2. **`ATHENA_HOME` is a scratch directory per daemon.** The connector vault has no flag for
 *     where it lives; without this it writes `~/.athena/connectors/` and can reach the real OS
 *     keychain. The brain and the token file are named explicitly for the same reason.
 *  3. **Teardown kills the tree and closes the pipes, on failure as well as success.** `uv run`
 *     spawns a grandchild, so `child.kill()` alone leaves a Python holding the port. An orphan
 *     holding a port is the one outcome this work must never produce.
 */
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The daemon's handle: stdin is closed, and both answers are pipes we read. */
type Child = ChildProcessByStdio<null, Readable, Readable>;

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root: `apps/desktop/e2e/support` is four levels down from it. */
export const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

/** The test-only spawner another agent owns. Its contract is in its own docstring. */
export const SPAWNER = join("tests", "e2e", "serve_scripted.py");

/** How long the ready line may take. `uv run` resolves the environment before Python starts. */
const READY_TIMEOUT_MS = 120_000;

export interface ReadyLine {
  ok: boolean;
  url: string;
  token_file: string | null;
  engine: string;
  brain: string;
  voice: string;
}

export interface DaemonOptions {
  /** The transcript the scripted engine replays. Required: every daemon here has an engine. */
  transcript: string;
  /** Origins CORS may answer. The browser suite passes its static server's origin. */
  allowOrigins?: readonly string[];
  /** `false` — the default — starts with `--no-connectors`, which serves no `/connectors`. */
  connectors?: boolean;
  /** `scripted` registers `/voice` with the recorded microphone; `none` registers no socket. */
  voice?: "none" | "scripted";
  /** What the scripted microphone hears, one per utterance, in order. */
  utterances?: readonly string[];
}

export interface Daemon extends ReadyLine {
  token: string;
  /** The origin the daemon is on, for an `Origin` header a test wants to state. */
  origin: string;
  home: string;
  /** Everything the daemon wrote on stderr, for a failure message worth reading. */
  stderr: () => string;
  stop: () => Promise<void>;
}

let seq = 0;

/** A token per daemon, so a leaked one cannot open the next. Not a secret: this is a test. */
function mintToken(): string {
  seq += 1;
  return `e2e-token-${process.pid}-${seq}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Start one daemon and resolve once its ready line is on stdout.
 *
 * The line is the contract: the socket is bound before it is printed, so a caller that has seen
 * it can connect without polling `/health` first.
 */
export async function startDaemon(options: DaemonOptions): Promise<Daemon> {
  const home = mkdtempSync(join(tmpdir(), "athena-e2e-"));
  const token = mintToken();
  const args = [
    "run",
    "python",
    SPAWNER,
    "--transcript",
    resolve(options.transcript),
    "--port",
    "0",
    "--token",
    token,
    "--token-file",
    join(home, "daemon.json"),
    "--brain",
    join(home, "brain"),
    "--voice-backend",
    options.voice ?? "none",
  ];
  if (!options.connectors) args.push("--no-connectors");
  for (const origin of options.allowOrigins ?? []) args.push("--allow-origin", origin);
  for (const utterance of options.utterances ?? []) args.push("--utterance", utterance);

  const child = spawn("uv", args, {
    cwd: REPO_ROOT,
    // `ATHENA_HOME` is the whole of rule 2. `PYTHONUNBUFFERED` is what makes the ready line
    // arrive when it is printed rather than when the buffer happens to flush.
    env: { ...process.env, ATHENA_HOME: home, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    stdio: ["ignore", "pipe", "pipe"],
    // No shell. `uv` is an executable on PATH, and a shell between here and it is one more
    // process to lose track of when the tree is killed.
    windowsHide: true,
    detached: process.platform !== "win32",
  }) as Child;

  let err = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    err += chunk;
  });

  const stop = async (): Promise<void> => {
    await killTree(child);
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A brain SQLite file Windows still holds is not a test failure; the scratch root is
      // temporary and the next run mints its own.
    }
  };

  let line: ReadyLine;
  try {
    line = await firstJsonLine(child, () => err);
  } catch (error) {
    await stop();
    throw error;
  }
  if (!line.ok || !line.url) {
    await stop();
    throw new Error(`the daemon refused to start: ${JSON.stringify(line)}\n${err}`);
  }

  return {
    ...line,
    token,
    origin: new URL(line.url).origin,
    home,
    stderr: () => err,
    stop,
  };
}

/** Read stdout until one line parses as the ready line's JSON object. */
function firstJsonLine(
  child: Child,
  stderr: () => string,
): Promise<ReadyLine> {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `no ready line within ${READY_TIMEOUT_MS} ms.\nstdout: ${buffer}\nstderr: ${stderr()}`,
        ),
      );
    }, READY_TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let cut = buffer.indexOf("\n");
      while (cut !== -1) {
        const candidate = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (candidate.startsWith("{")) {
          try {
            const parsed = JSON.parse(candidate) as ReadyLine;
            finish(() => resolvePromise(parsed));
            return;
          } catch {
            // Not the ready line. Keep reading: stdout is the ready line's channel and the
            // daemon logs nothing else there, but a warning from a dependency is possible.
          }
        }
        cut = buffer.indexOf("\n");
      }
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code) =>
      finish(() =>
        reject(new Error(`the daemon exited ${code} before its ready line.\nstderr: ${stderr()}`)),
      ),
    );
  });
}

/**
 * Kill the process and everything it spawned, then close the pipes.
 *
 * `uv run python …` is two processes on every platform, so signalling the child alone leaves the
 * Python listening. Windows has no process group to signal; `taskkill /T` is the tree kill, and
 * `tests/daemon/test_ready.py` is the precedent for terminating rather than wrapping the handle
 * in something that waits.
 */
async function killTree(child: Child): Promise<void> {
  const pid = child.pid;
  const ended = new Promise<void>((resolveEnded) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveEnded();
      return;
    }
    child.once("exit", () => resolveEnded());
  });

  if (pid !== undefined) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
  child.kill("SIGKILL");

  await Promise.race([ended, new Promise<void>((r) => setTimeout(r, 10_000))]);

  // Both pipes, explicitly: an unread stream keeps a handle open and vitest will not exit.
  child.stdout.destroy();
  child.stderr.destroy();
}
