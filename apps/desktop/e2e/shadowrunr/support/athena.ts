/**
 * Athena's daemon for the Shadowrunr suites: the scripted one (`../../support/daemon.ts`, reused
 * as it is) over a rendered transcript, and the live one on the operator's signed-in CLI.
 *
 * TRANSCRIPTS. The files in `../transcripts/` are the `claude -p --output-format stream-json`
 * shape the other e2e transcripts use, with `{{NAME}}` placeholders where a value only exists at
 * run time: the digest of the scratch bible, a real session id off the copied runs, the new text
 * of a document. `renderTranscript` fills them, escaped twice (once for the OP's JSON, once for
 * the stream line's JSON string), and writes the result into a scratch dir.
 *
 * LIVE. `startLiveDaemon` spawns `uv run athena serve --port 0 --engine claude_code` with its own
 * scratch `ATHENA_HOME`, `--brain`, `--token` and `--token-file` (docs/daemon.md, "The real
 * thing"), and the same teardown as the scripted one: the tree is killed, on failure too.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { REPO_ROOT, startDaemon, type Daemon, type ReadyLine } from "../../support/daemon";
import { killTree } from "./shadowrunr";

type Child = ChildProcessByStdio<null, Readable, Readable>;

const HERE = dirname(fileURLToPath(import.meta.url));
export const TRANSCRIPTS = resolve(HERE, "..", "transcripts");

/** Fill a transcript template and write it under `dir`; returns the rendered file's path. */
export function renderTranscript(name: string, values: Readonly<Record<string, string | number>>, dir: string): string {
  let text = readFileSync(join(TRANSCRIPTS, name), "utf-8");
  for (const [key, value] of Object.entries(values)) {
    // Inside the OP's JSON (one escape), inside the stream line's JSON string (a second one).
    const once = JSON.stringify(String(value)).slice(1, -1);
    const twice = JSON.stringify(once).slice(1, -1);
    text = text.split(`{{${key}}}`).join(twice);
  }
  const body = text
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n");
  const left = /\{\{([A-Z_]+)\}\}/.exec(body);
  if (left) throw new Error(`${name}: no value for {{${left[1]}}}`);
  const path = join(dir, name);
  writeFileSync(path, text, "utf-8");
  return path;
}

/** The scripted daemon over a rendered transcript. */
export async function startScripted(transcriptPath: string): Promise<Daemon> {
  return startDaemon({ transcript: transcriptPath });
}

const READY_TIMEOUT_MS = 180_000;

let seq = 0;

/** `athena serve` on the operator's `claude` CLI. Spends quota: only the live pilot calls it. */
export async function startLiveDaemon(options: { engine?: string; model?: string } = {}): Promise<Daemon> {
  const home = mkdtempSync(join(tmpdir(), "athena-live-"));
  seq += 1;
  // Not a secret: a per-daemon test token, so a leaked one opens nothing else.
  const token = `live-${process.pid}-${seq}-${Math.random().toString(36).slice(2, 10)}`;
  const args = [
    "run",
    "athena",
    "serve",
    "--port",
    "0",
    "--engine",
    options.engine ?? "claude_code",
    "--token",
    token,
    "--token-file",
    join(home, "daemon.json"),
    "--brain",
    join(home, "brain"),
    "--no-connectors",
    "--voice-backend",
    "none",
  ];
  if (options.model) args.push("--model", options.model);
  const child = spawn("uv", args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ATHENA_HOME: home, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  }) as Child;
  let err = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (c: string) => {
    err = (err + c).slice(-50_000);
  });
  const stop = async () => {
    await killTree(child);
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A brain file Windows still holds; the root is temporary.
    }
  };
  try {
    const line = await new Promise<ReadyLine>((ok, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error(`no ready line in ${READY_TIMEOUT_MS} ms\n${buffer}\n${err}`)), READY_TIMEOUT_MS);
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (c: string) => {
        buffer += c;
        let cut = buffer.indexOf("\n");
        while (cut !== -1) {
          const candidate = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (candidate.startsWith("{")) {
            try {
              const parsed = JSON.parse(candidate) as ReadyLine;
              clearTimeout(timer);
              ok(parsed);
              return;
            } catch {
              // not the ready line
            }
          }
          cut = buffer.indexOf("\n");
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`athena serve exited ${code} before its ready line\n${err}`));
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    if (!line.ok || !line.url) throw new Error(`athena serve refused to start: ${JSON.stringify(line)}\n${err}`);
    return { ...line, token, origin: new URL(line.url).origin, home, stderr: () => err, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
