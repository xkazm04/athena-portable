/**
 * README section 3.2 and 3.5 — a real Athena daemon on an ephemeral port, for the journey specs
 * that need one (today `tests/gravitone.spec.ts`).
 *
 * Modelled on `apps/desktop/e2e/support/daemon.ts` and held to its three rules: port 0 read back
 * off the ready line, a scratch `ATHENA_HOME` per daemon (brain, token file and `mcp.json` all in
 * it), and a tree kill on the way out, because `uv run` puts a Python grandchild on the port.
 *
 * Two ways to start one. `scripted` is `tests/e2e/serve_scripted.py`: the shipped `athena serve`
 * with only the engine's transport replaced by a recorded transcript (ADR 0007). `real` is
 * `athena serve` itself, on the signed-in `claude` CLI, for the opt-in live test.
 *
 * The routes are the panel's (docs/daemon.md): `POST /manifest`, `POST /run` (read to the end of
 * its SSE body), `POST /decisions/<id>`, `GET /ledger`, `GET /connectors`, each with
 * `X-Athena-Token`. A value the caller passes in `env` (a connector's bearer, say) reaches the
 * daemon's environment only and is scrubbed from every error message this module builds.
 */
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { ATHENA_ROOT } from "./gravitone.ts";

type Child = ChildProcessByStdio<null, Readable, Readable>;

const READY_TIMEOUT_MS = 180_000;

/** The line a continuation carries (apps/desktop/src/stores/run.ts `CONTINUE`). */
export const CONTINUE = "(the tools you called have answered; continue)";

export interface McpServer {
  readonly id: string;
  readonly url: string;
  readonly token_env: string;
}

export type DaemonOptions = (
  | { readonly mode: "scripted"; readonly transcript: string }
  | { readonly mode: "real"; readonly model?: string }
) & {
  /** Written to `ATHENA_HOME/mcp.json` (the contract's default location) when given. */
  readonly mcpServers?: readonly McpServer[];
  /** `false` passes `--no-connectors`. */
  readonly connectors?: boolean;
  /** Extra environment for the daemon only (a connector token). Scrubbed from error text. */
  readonly env?: Readonly<Record<string, string>>;
};

export interface ChannelEvent {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface ToolResultRow {
  readonly call_id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly output: string;
  readonly tier: number;
  readonly error?: string;
}

export interface Daemon {
  readonly url: string;
  readonly port: number;
  readonly home: string;
  readonly stderr: () => string;
  manifest(body: unknown): Promise<Record<string, unknown>>;
  run(body: Record<string, unknown>): Promise<ChannelEvent[]>;
  decide(id: string, choice: "approve" | "decline", origin: string): Promise<Record<string, unknown>>;
  ledger(limit?: number): Promise<Record<string, unknown>>;
  get(path: string): Promise<Record<string, unknown>>;
  stop(): Promise<void>;
}

function scrubber(secrets: readonly string[]): (text: string) => string {
  const live = secrets.filter((s) => s.length >= 8);
  return (text) => live.reduce((out, secret) => out.split(secret).join("<redacted>"), text);
}

/** SSE body to events: one `data:` line of JSON per frame (ADR 0012). */
export function parseFrames(body: string): ChannelEvent[] {
  const events: ChannelEvent[] = [];
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) events.push(JSON.parse(data) as ChannelEvent);
  }
  return events;
}

export async function startDaemon(options: DaemonOptions): Promise<Daemon> {
  const home = mkdtempSync(join(tmpdir(), "athena-journey-daemon-"));
  const token = `journey-${process.pid}-${Math.random().toString(36).slice(2, 12)}`;
  const scrub = scrubber([token, ...Object.values(options.env ?? {})]);
  if (options.mcpServers) {
    writeFileSync(join(home, "mcp.json"), JSON.stringify({ servers: options.mcpServers }, null, 2));
  }
  const common = [
    "--port", "0",
    "--token", token,
    "--token-file", join(home, "daemon.json"),
    "--brain", join(home, "brain"),
    "--engine", "claude_code",
    "--voice-backend", "none",
  ];
  if (options.connectors === false) common.push("--no-connectors");
  const args =
    options.mode === "scripted"
      ? ["run", "python", join("tests", "e2e", "serve_scripted.py"), "--transcript", resolve(options.transcript), "--model", "fake-model", ...common]
      : ["run", "athena", "serve", ...(options.model ? ["--model", options.model] : []), ...common];

  const child = spawn("uv", args, {
    cwd: ATHENA_ROOT,
    env: { ...process.env, ...options.env, ATHENA_HOME: home, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  }) as Child;

  let err = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    err = (err + chunk).slice(-64_000);
  });
  const stderr = () => scrub(err);

  const stop = async (): Promise<void> => {
    const ended = new Promise<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) done();
      else child.once("exit", () => done());
    });
    if (child.pid !== undefined) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    }
    await Promise.race([ended, delay(10_000)]);
    child.stdout.destroy();
    child.stderr.destroy();
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A brain file Windows still holds; the scratch root is temporary.
    }
  };

  let ready: { ok?: boolean; url?: string };
  try {
    ready = await readyLine(child, stderr);
  } catch (error) {
    await stop();
    throw error;
  }
  if (!ready.ok || !ready.url) {
    await stop();
    throw new Error(`the daemon refused to start: ${scrub(JSON.stringify(ready))}\n${stderr()}`);
  }
  const url = ready.url;
  const headers = { "X-Athena-Token": token, "Content-Type": "application/json" };

  const json = async (method: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${method} ${path}: ${response.status} with a body that is not JSON: ${scrub(text.slice(0, 400))}`);
    }
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${scrub(text.slice(0, 800))}`);
    return parsed;
  };

  return {
    url,
    port: Number(new URL(url).port),
    home,
    stderr,
    manifest: (body) => json("POST", "/manifest", body),
    async run(body) {
      const response = await fetch(`${url}/run`, { method: "POST", headers, body: JSON.stringify(body) });
      const text = await response.text();
      if (!response.ok) throw new Error(`POST /run: ${response.status} ${scrub(text.slice(0, 800))}`);
      return parseFrames(text);
    },
    decide: (id, choice, origin) => json("POST", `/decisions/${encodeURIComponent(id)}`, { choice, origin }),
    ledger: (limit = 20) => json("GET", `/ledger?limit=${limit}`),
    get: (path) => json("GET", path),
    stop,
  };
}

function readyLine(child: Child, stderr: () => string): Promise<{ ok?: boolean; url?: string }> {
  return new Promise((resolveLine, reject) => {
    let buffer = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`no ready line within ${READY_TIMEOUT_MS} ms\n${stderr()}`))),
      READY_TIMEOUT_MS,
    );
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let cut = buffer.indexOf("\n");
      while (cut !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (line.startsWith("{")) {
          try {
            const parsed = JSON.parse(line) as { ok?: boolean; url?: string };
            finish(() => resolveLine(parsed));
            return;
          } catch {
            // Not the ready line.
          }
        }
        cut = buffer.indexOf("\n");
      }
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code) =>
      finish(() => reject(new Error(`the daemon exited ${String(code)} before its ready line\n${stderr()}`))),
    );
  });
}

/**
 * One recorded round, in the `claude -p - --output-format stream-json` shape
 * `tests/fixtures/claude_code_turn.ndjson` records, so the harness's own decoder reads it.
 */
export function round(text: string, session = "01JGRAVITONEE2E"): string[] {
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: session, model: "fake-model", tools: [], cwd: "~" }),
    JSON.stringify({ type: "assistant", message: { id: "msg_01", role: "assistant", content: [{ type: "text", text }] } }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 900,
      num_turns: 1,
      total_cost_usd: 0.001,
      usage: { input_tokens: 1200, output_tokens: 60 },
      session_id: session,
    }),
  ];
}

/** `OP:` line proposing one action (README section 3.2's grammar). */
export function op(action: string, params: Record<string, unknown>, rationale: string): string {
  return `OP: ${JSON.stringify({ op: "propose_action", action, params, rationale })}`;
}

/** Write a transcript of `rounds` (blank-line separated) and return its path. */
export function writeTranscript(path: string, note: string, rounds: readonly (readonly string[])[]): string {
  mkdirSync(dirname(path), { recursive: true });
  const head = `# SYNTHETIC, written by tests/gravitone.spec.ts: ${note}\n`;
  writeFileSync(path, head + rounds.map((r) => r.join("\n")).join("\n\n") + "\n");
  return path;
}
