/**
 * The shell's smoke — README section 8, layer 2: *the smoke needs a machine with WebView2 and a
 * Rust toolchain, and prints one assertable line per claim*.
 *
 * It serves `scratch/`, starts the shell pointed at a page in it, and asserts the lines the shell
 * prints before it exits. Two modes, chosen with `ATHENA_SMOKE`, because there are two claims:
 *
 * ```text
 * ATHENA_SMOKE=1     the relay (c19)
 *   [smoke] tab 1: ok=true tools=3 transport=webmcp-polyfill
 *
 * ATHENA_SMOKE=turn  the panel's run loop (c23)
 *   [smoke] turn: manifest tools=3
 *   [smoke] turn: tool.call invoice_list ok=true
 *   [smoke] turn: decision apr_… declined
 *   [smoke] turn: ledger user_denied=1
 * ```
 *
 * The relay's line says `inject.js` ran in a page webview before the page's own scripts, the page
 * answered `list` over `window.postMessage`, and the relay matched the answer to the request that
 * was waiting. The turn's four say the whole of P5: the page's tools reached the daemon's
 * catalog, the gate let the AUTO one through and the page ran it, the GATED one became a card,
 * the user's answer resolved the row, and the decline is in the ledger under a reason from the
 * closed set.
 *
 * The turn mode points the sidecar at `scratch/gated-round.jsonl` through `ATHENA_ENGINE_SCRIPT`,
 * so the daemon replays a recorded round instead of spawning `claude` (`athena serve --script`).
 * A smoke whose verdict depends on what a model felt like saying is not a smoke.
 *
 * Usage, from `apps/desktop`:
 *
 *     node scripts/smoke.mjs                            # the relay; `pnpm tauri dev` compiles first
 *     ATHENA_SMOKE=turn node scripts/smoke.mjs          # one gated turn, end to end
 *     node scripts/smoke.mjs --binary <path>            # a debug binary that is already built
 *     node scripts/smoke.mjs --url https://…            # a real site instead of the scratch page
 *     node scripts/smoke.mjs --timeout 900              # a cold Rust build on a slow machine
 *     ATHENA_SMOKE=turn node scripts/smoke.mjs --script <path>   # another recorded round
 *
 * It is a local gate and not part of `pnpm test`: everything it needs — a Rust toolchain, a
 * WebView2 runtime, a window server, a Python daemon — is exactly what CI does not have.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = path.join(APP_DIR, "scratch");
const PAGE = "webmcp-page.html";
/** What `scratch/webmcp-page.html` registers. Asserted only when that page is the one served. */
const SCRATCH_TOOLS = 3;
/** The recorded round the turn mode replays. One AUTO call, then one GATED proposal. */
const SCRIPT = path.join(SCRATCH, "gated-round.jsonl");

/** The relay's line, and the only thing `ATHENA_SMOKE=1` believes. */
const RELAY_LINE = /\[smoke\] tab (\d+): ok=(true|false)(.*)$/m;
/** Every line the turn mode prints, kept in the order the shell printed them. */
const TURN_LINE = /\[smoke\] (turn: .*)$/;

/**
 * The four claims of a turn, each with what makes it true.
 *
 * A claim is its own regex rather than a shared parser, because the failure a person needs is
 * "this line did not say what it had to", and the line is the evidence.
 */
const TURN_CLAIMS = [
  {
    name: "manifest",
    of: /^turn: manifest tools=(\d+)$/,
    holds: ([, tools], scratch) =>
      scratch ? Number(tools) === SCRATCH_TOOLS : Number(tools) > 0,
    want: (scratch) => (scratch ? `tools=${SCRATCH_TOOLS}` : "tools > 0"),
  },
  {
    name: "tool.call",
    of: /^turn: tool\.call (\S+) ok=(true|false)$/,
    holds: ([, , ok]) => ok === "true",
    want: () => "ok=true — the page ran the AUTO call",
  },
  {
    name: "decision",
    of: /^turn: decision (\S+) (\S+)$/,
    holds: ([, , status]) => status === "declined",
    want: () => "declined — the gated call became a card the user answered",
  },
  {
    name: "ledger",
    of: /^turn: ledger user_denied=(\d+)$/,
    holds: ([, count]) => Number(count) === 1,
    want: () => "user_denied=1",
  },
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function args(argv) {
  const out = { url: null, binary: null, timeout: null, script: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--url") out.url = argv[++i];
    else if (flag === "--binary") out.binary = argv[++i];
    else if (flag === "--timeout") out.timeout = Number(argv[++i]);
    else if (flag === "--script") out.script = argv[++i];
    else throw new Error(`unknown argument ${flag}`);
  }
  return out;
}

/**
 * The scratch page, over http. A page webview is granted `bridge_reply` by a capability whose
 * remote urls are `http://*:*` and `https://*:*`, so a `file://` page would be a page that can
 * never answer — which is why this exists at all rather than opening the file directly.
 */
function serve() {
  const server = createServer((req, res) => {
    const name = path.basename(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = path.join(SCRATCH, name === "" || name === "/" ? PAGE : name);
    readFile(file).then(
      (body) => {
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "text/plain" });
        res.end(body);
      },
      () => {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("no such file in scratch/");
      },
    );
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      // `localhost` and not `127.0.0.1`, though they are the same socket: `HostManifest.validate`
      // takes a page origin only over https or `http://localhost`, so a manifest from the dotted
      // spelling is refused whole — correctly, and it would make the turn mode untestable here.
      resolve({ server, url: `http://localhost:${port}/${PAGE}` });
    });
  });
}

/** Windows does not kill a process tree with a signal, and `tauri dev` is three processes. */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

/** Every claim, against the lines the shell actually printed. Returns the failures. */
function judge(lines, scratch) {
  const failures = [];
  for (const claim of TURN_CLAIMS) {
    const found = lines.map((line) => claim.of.exec(line)).find(Boolean);
    if (!found) {
      failures.push(`${claim.name}: no line — wanted ${claim.want(scratch)}`);
    } else if (!claim.holds(found, scratch)) {
      failures.push(`${found[0]} — wanted ${claim.want(scratch)}`);
    }
  }
  return failures;
}

async function main() {
  const options = args(process.argv.slice(2));
  const mode = (process.env.ATHENA_SMOKE || "1").trim();
  const turn = mode === "turn";
  const timeout = options.timeout ?? (turn ? 600 : 300);
  const { server, url: served } = await serve();
  const url = options.url ?? served;
  const scratch = options.url === null;

  const command = options.binary
    ? { file: options.binary, argv: [] }
    : { file: process.platform === "win32" ? "pnpm.cmd" : "pnpm", argv: ["tauri", "dev"] };

  const env = { ...process.env, ATHENA_SMOKE: mode, ATHENA_START_URL: url };
  if (turn) {
    // The daemon replays this instead of spawning the engine, so the turn is the same turn every
    // time. An explicit `--script`, or an `ATHENA_ENGINE_SCRIPT` already in the environment,
    // wins: this is the default and not an override.
    env.ATHENA_ENGINE_SCRIPT = options.script ?? env.ATHENA_ENGINE_SCRIPT ?? SCRIPT;
  }

  console.log(`[smoke.mjs] mode ${mode}, serving ${SCRATCH}`);
  console.log(`[smoke.mjs] ATHENA_START_URL=${url}`);
  if (turn) console.log(`[smoke.mjs] ATHENA_ENGINE_SCRIPT=${env.ATHENA_ENGINE_SCRIPT}`);
  console.log(`[smoke.mjs] ${command.file} ${command.argv.join(" ")} (up to ${timeout}s)`);

  // Node refuses to spawn a `.cmd` without a shell (EINVAL) since the 2024 argument-injection
  // fix, and `pnpm` on Windows is a `.cmd`. The whole line goes as one string rather than as a
  // command plus an argv, because passing both is what the deprecation warning is about — and
  // there is nothing user-supplied in it either way.
  const shell = /\.(cmd|bat)$/i.test(command.file);
  const spawnOptions = { cwd: APP_DIR, env, stdio: ["ignore", "pipe", "pipe"] };
  const child = shell
    ? spawn([command.file, ...command.argv].join(" "), { ...spawnOptions, shell: true })
    : spawn(command.file, command.argv, spawnOptions);

  let seen = null;
  const turnLines = [];
  const watch = (stream, where) => {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      rest += chunk;
      const lines = rest.split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        console.log(`[${where}] ${line}`);
        const relay = RELAY_LINE.exec(line);
        if (relay && seen === null) seen = relay;
        const claim = TURN_LINE.exec(line);
        if (claim) turnLines.push(claim[1].trim());
      }
    });
  };
  watch(child.stdout, "out");
  watch(child.stderr, "err");

  const timer = setTimeout(() => {
    console.error(`[smoke.mjs] FAIL — nothing said in ${timeout}s`);
    killTree(child);
  }, timeout * 1000);

  const code = await new Promise((resolve) => {
    child.on("error", (e) => {
      console.error(`[smoke.mjs] cannot run ${command.file}: ${e.message}`);
      resolve(null);
    });
    child.on("exit", (exit) => resolve(exit));
  });
  clearTimeout(timer);
  killTree(child);
  server.close();

  if (turn) return verdictForTurn(turnLines, scratch, code);
  return verdictForRelay(seen, options.url !== null, code);
}

function verdictForTurn(lines, scratch, code) {
  if (lines.length === 0) {
    console.error(`[smoke.mjs] FAIL — the shell printed no turn line at all (exit ${code})`);
    process.exit(1);
  }
  const failures = judge(lines, scratch);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[smoke.mjs] FAIL — ${failure}`);
    process.exit(1);
  }
  console.log(`[smoke.mjs] PASS — ${TURN_CLAIMS.length} claims, one gated turn in the shell:`);
  for (const line of lines) console.log(`[smoke.mjs]   ${line}`);
  process.exit(0);
}

function verdictForRelay(seen, ownUrl, code) {
  if (!seen) {
    console.error(`[smoke.mjs] FAIL — the shell never printed a smoke line (exit ${code})`);
    process.exit(1);
  }
  const [line, tab, ok, tail] = seen;
  const tools = /tools=(\d+)/.exec(tail);
  const transport = /transport=(\S+)/.exec(tail);
  // `ok` and a transport are the relay's claim on any page. The count is only an assertion on the
  // scratch page, which registers exactly three; a real site is entitled to have none, and that
  // is what the nine generic hands are for.
  const expected = ownUrl ? null : SCRATCH_TOOLS;
  const counted = tools ? Number(tools[1]) : null;
  if (ok !== "true" || counted === null || !transport || (expected !== null && counted !== expected)) {
    console.error(`[smoke.mjs] FAIL — ${line.trim()}`);
    if (expected !== null && counted !== null && counted !== expected) {
      console.error(`[smoke.mjs] the scratch page registers ${expected} tools, the page answered ${counted}`);
    }
    process.exit(1);
  }
  console.log(
    `[smoke.mjs] PASS — tab ${tab} answered list: ${tools[1]} tools over ${transport[1]}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(`[smoke.mjs] ${e.message}`);
  process.exit(1);
});
