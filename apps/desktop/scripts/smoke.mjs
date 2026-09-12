/**
 * The relay's smoke — README section 8, layer 2: *the smoke needs a machine with WebView2 and a
 * Rust toolchain, and prints one assertable line per claim*.
 *
 * It serves `scratch/webmcp-page.html`, starts the shell with `ATHENA_SMOKE=1` pointed at it, and
 * asserts the one line the shell prints before it exits:
 *
 *     [smoke] tab 1: ok=true tools=3 transport=webmcp-polyfill
 *
 * That line is the whole of c19's claim: `inject.js` ran in a page webview before the page's own
 * scripts, the page answered `list` over `window.postMessage`, the forwarder carried the answer
 * back through `bridge_reply`, and the relay matched it to the request that was waiting.
 *
 * Usage, from `apps/desktop`:
 *
 *     node scripts/smoke.mjs                       # `pnpm tauri dev`, which compiles first
 *     node scripts/smoke.mjs --binary <path>       # a debug binary that is already built
 *     node scripts/smoke.mjs --url https://…       # a real site instead of the scratch page
 *     node scripts/smoke.mjs --timeout 900         # a cold Rust build on a slow machine
 *
 * It is a local gate and not part of `pnpm test`: everything it needs — a Rust toolchain, a
 * WebView2 runtime, a window server — is exactly what CI does not have.
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

/** The line the shell prints, and the only thing this script believes. */
const LINE = /\[smoke\] tab (\d+): ok=(true|false)(.*)$/m;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function args(argv) {
  const out = { url: null, binary: null, timeout: 300 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--url") out.url = argv[++i];
    else if (flag === "--binary") out.binary = argv[++i];
    else if (flag === "--timeout") out.timeout = Number(argv[++i]);
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
      resolve({ server, url: `http://127.0.0.1:${port}/${PAGE}` });
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

async function main() {
  const options = args(process.argv.slice(2));
  const { server, url: served } = await serve();
  const url = options.url ?? served;

  const command = options.binary
    ? { file: options.binary, argv: [] }
    : { file: process.platform === "win32" ? "pnpm.cmd" : "pnpm", argv: ["tauri", "dev"] };

  console.log(`[smoke.mjs] serving ${SCRATCH}`);
  console.log(`[smoke.mjs] ATHENA_START_URL=${url}`);
  console.log(`[smoke.mjs] ${command.file} ${command.argv.join(" ")} (up to ${options.timeout}s)`);

  // Node refuses to spawn a `.cmd` without a shell (EINVAL) since the 2024 argument-injection
  // fix, and `pnpm` on Windows is a `.cmd`. The whole line goes as one string rather than as a
  // command plus an argv, because passing both is what the deprecation warning is about — and
  // there is nothing user-supplied in it either way.
  const shell = /\.(cmd|bat)$/i.test(command.file);
  const spawnOptions = {
    cwd: APP_DIR,
    env: { ...process.env, ATHENA_SMOKE: "1", ATHENA_START_URL: url },
    stdio: ["ignore", "pipe", "pipe"],
  };
  const child = shell
    ? spawn([command.file, ...command.argv].join(" "), { ...spawnOptions, shell: true })
    : spawn(command.file, command.argv, spawnOptions);

  let seen = null;
  const watch = (stream, where) => {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      rest += chunk;
      const lines = rest.split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        console.log(`[${where}] ${line}`);
        const match = LINE.exec(line);
        if (match && seen === null) seen = match;
      }
    });
  };
  watch(child.stdout, "out");
  watch(child.stderr, "err");

  const timer = setTimeout(() => {
    console.error(`[smoke.mjs] FAIL — nothing said in ${options.timeout}s`);
    killTree(child);
  }, options.timeout * 1000);

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
  const expected = options.url ? null : SCRATCH_TOOLS;
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
