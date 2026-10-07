/**
 * docs/demo.md section 5 ("proving" segment) — the hosted Proving Ground server, booted for a take.
 *
 * `python -m athena.proving.server --hosted` on a free port, from the repository root so it finds
 * the `.env` that holds `NEBIUS_API_KEY`, with a judge token generated here for this one take. The
 * token goes to the child's environment and into the page's password field, and nowhere else: it
 * is never logged, and every line of the server's output is scrubbed of it before it is echoed,
 * in case some future server version prints more than today's does. Runs go under `take/`, which
 * is gitignored, so the take's run is the only one its page lists.
 *
 * The tree kill is `boot.ts`'s: `uv run` is a parent of the Python process that holds the port.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { listening, shutdown, type Booted } from "./boot.ts";
import { PACKAGE_ROOT, TAKE_DIR } from "./script.ts";

export const REPO_ROOT: string = resolve(PACKAGE_ROOT, "..", "..");

const READY_TIMEOUT_MS = 120_000;

export interface ProvingServer {
  readonly url: string;
  readonly token: string;
  readonly runsDir: string;
  readonly booted: Booted;
}

/** A port the OS just handed out and took back: free now, which is all a take needs. */
async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.unref();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

export async function startProving(log: (line: string) => void = () => {}): Promise<ProvingServer> {
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  const runsDir = join(TAKE_DIR, "proving-runs");
  const scrub = (text: string): string => text.split(token).join("[token]");
  const child = spawn(
    process.env.PROVING_UV ?? "uv",
    ["run", "python", "-m", "athena.proving.server", "--hosted", "--port", String(port), "--out", runsDir],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PROVING_JUDGE_TOKEN: token, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      detached: process.platform !== "win32",
    },
  );
  const echo = (chunk: Buffer): void => {
    for (const line of scrub(chunk.toString()).split(/\r?\n/)) if (line.trim()) log(line);
  };
  child.stdout?.on("data", echo);
  child.stderr?.on("data", echo);
  let dead: string | null = null;
  child.on("exit", (code) => {
    dead = `the proving server exited with ${String(code)}`;
  });
  child.on("error", (error) => {
    dead = `the proving server did not start: ${error.message}`;
  });

  const url = `http://127.0.0.1:${port}`;
  const booted: Booted = {
    // Not one of the studio's apps; the spec is here only because `shutdown` takes a `Booted`.
    app: { id: "proving", port, dir: REPO_ROOT, gated: [], kind: "static" },
    child,
    adopted: false,
    cwd: null,
  };
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (dead) throw new Error(dead);
    if (await listening(`${url}/status`)) return { url, token, runsDir, booted };
    await delay(500);
  }
  await shutdown(booted);
  throw new Error(`the proving server did not answer on ${port} within ${READY_TIMEOUT_MS} ms`);
}

export async function stopProving(server: ProvingServer): Promise<void> {
  await shutdown(server.booted);
}
