#!/usr/bin/env node
/**
 * One command per call against a running Athena desktop, JSON on stdout: the form an agent (or a
 * person at a terminal) can drive the app with. See README.md beside this file.
 *
 *   node drive/drive.mjs launch [--exe <path>] [--start-url <url>] [--reuse]
 *   node drive/drive.mjs status | ready | onboard | pages
 *   node drive/drive.mjs register <url>
 *   node drive/drive.mjs tabs | focus <id> | tools <tab> | call <tab> <name> [json] | hand <tab> <name> [json]
 *   node drive/drive.mjs say <text...> [--no-wait] [--timeout <s>] | settle | transcript | cards
 *   node drive/drive.mjs approve <card> | decline <card>
 *   node drive/drive.mjs daemon <route>          (GET; the token stays in the page)
 *   node drive/drive.mjs shot <chrome|athena> <file.png>
 *   node drive/drive.mjs stop
 *
 * `--cdp <url>` attaches to any instance started with a CDP port (your own included); without it
 * the last `launch` is used (its session file), else http://127.0.0.1:9222. `stop` only ever kills
 * and cleans an instance this tool launched.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { attach, launch, stopInstance } from "./athena-drive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSION = join(process.env.ATHENA_DRIVE_STATE ?? join(tmpdir(), "athena-drive"), "session.json");
const DEFAULT_EXE = resolve(HERE, "..", "src-tauri", "target", "debug", process.platform === "win32" ? "athena-desktop.exe" : "athena-desktop");

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else rest.push(a);
  }
  return { flags, rest };
}

const session = () => (existsSync(SESSION) ? JSON.parse(readFileSync(SESSION, "utf-8")) : null);
const out = (v) => process.stdout.write(`${JSON.stringify(v ?? null, null, 2)}\n`);
const json = (s) => (s === undefined ? {} : JSON.parse(s));

async function main() {
  const { flags, rest } = parse(process.argv.slice(2));
  const [cmd, ...args] = rest;
  if (!cmd || cmd === "help") {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf-8").split("*/")[0]);
    return;
  }

  if (cmd === "launch") {
    const prior = session();
    if (prior) throw new Error(`a launched session is already recorded (pid ${prior.pid}); run stop first`);
    const d = await launch({
      exe: flags.exe ?? process.env.ATHENA_DESKTOP_EXE ?? DEFAULT_EXE,
      startUrl: flags["start-url"],
      reuse: Boolean(flags.reuse),
      detach: true,
    });
    mkdirSync(dirname(SESSION), { recursive: true });
    const rec = { cdp: d.cdp, pid: d.process.pid, identifier: d.process.identifier, created: d.process.created };
    writeFileSync(SESSION, JSON.stringify(rec, null, 2));
    await d.close();
    out(rec);
    return;
  }

  if (cmd === "stop") {
    const s = session();
    if (!s) throw new Error("no launched session recorded; nothing to stop");
    stopInstance(s);
    rmSync(SESSION, { force: true });
    out({ stopped: s.pid, removed: s.created ? s.identifier : null });
    return;
  }

  const cdp = flags.cdp ?? session()?.cdp ?? "http://127.0.0.1:9222";
  const d = await attach({ cdp });
  try {
    switch (cmd) {
      case "pages":
        return out(d.pages().map((p) => p.url()));
      case "status":
        return out(await d.status());
      case "ready":
        return out(await d.ready());
      case "onboard":
        await d.onboard();
        return out({ onboarded: true });
      case "register":
        return out(await d.register(args[0]));
      case "origin":
        return out(await d.origin(args[0]));
      case "retrust":
        return out(await d.retrust(args[0]));
      case "tabs":
        return out(await d.tabs());
      case "focus":
        return out(await d.focus(Number(args[0])));
      case "tools": {
        const listed = await d.tools(Number(args[0]));
        return out({ ok: listed?.ok, page: listed?.page, tools: (listed?.tools ?? []).map((t) => t.name) });
      }
      case "call":
        return out(await d.call(Number(args[0]), args[1], json(args[2])));
      case "hand":
        return out(await d.hand(Number(args[0]), args[1], json(args[2])));
      case "say":
        return out(await d.say(args.join(" "), { wait: !flags["no-wait"], timeout: Number(flags.timeout ?? 300) * 1000 }));
      case "settle":
        return out(await d.settle({ timeout: Number(flags.timeout ?? 300) * 1000 }));
      case "transcript":
        return out(await d.transcript());
      case "cards":
        return out(await d.cards());
      case "approve":
        await d.approve(args[0]);
        return out(await d.settle({ timeout: Number(flags.timeout ?? 300) * 1000 }));
      case "decline":
        await d.decline(args[0]);
        return out(await d.cards());
      case "daemon":
        return out(await d.daemon(args[0] ?? "/health"));
      case "eval": {
        // An expression evaluated in `chrome` or `athena` (inspection; the token never comes back
        // through `status`/`daemon`, but an eval can read anything the page can: use with care).
        const page = args[0] === "athena" ? d.athena : d.chrome;
        return out(await page.evaluate(args.slice(1).join(" ")));
      }
      case "shot":
        return out({ file: await d.shot(args[0], resolve(args[1])) });
      default:
        throw new Error(`unknown command ${cmd}; run help`);
    }
  } finally {
    await d.close();
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
