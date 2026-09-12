/**
 * `ATHENA_SMOKE=turn` — one gated turn, in the real window, through the real run store.
 *
 * README section 8, layer 2 says the smoke *prints one assertable line per claim*, and c22's
 * headless test drives the run loop against a fake daemon (`src/test/fake-daemon.ts`). This is
 * the same seam with nothing faked: a real Tauri window, a real page webview with a real bridge,
 * a real daemon over loopback, and a real approval row. The only thing that is recorded is the
 * engine — `athena serve --script` replays `scratch/gated-round.jsonl`, because a claim about the
 * shell must not depend on what a model felt like saying (ADR 0007).
 *
 * Four lines, in the order the turn produces them:
 *
 * ```text
 * [smoke] turn: manifest tools=3
 * [smoke] turn: tool.call invoice_list ok=true
 * [smoke] turn: decision apr_… declined
 * [smoke] turn: ledger user_denied=1
 * ```
 *
 * Together they are the whole of P5: the page's tools reached the daemon's catalog, the gate let
 * the AUTO one through to the page and the page ran it, the GATED one became a card instead, the
 * user's answer resolved the row, and the decline is in the ledger under a reason from the closed
 * set (README invariant 6). Anything short of all four exits 1 with the line that failed.
 *
 * It runs in the `chrome` webview and hands its lines to Rust (`smokeSay`), because a
 * `console.log` here is not on the shell process's stdout and stdout is what `scripts/smoke.mjs`
 * reads. Nothing in this file is reachable outside a shell armed with the variable.
 */
import { daemonClient } from "@/lib/daemon-client";
import { hasShell, smokeMode, smokeSay } from "@/lib/ipc";
import { endpoint as endpointOf, useDaemon } from "@/stores/daemon";
import { runActions, useRun } from "@/stores/run";

/** What the recorded round is an answer to. The transcript does not read it; a person does. */
const MESSAGE = "Which invoices are over thirty days, and chase the oldest one.";

/** How long any one wait may take. A cold `uv run` daemon is the slowest of them. */
const WAIT_MS = 90_000;
const POLL_MS = 250;

/** The answer the smoke gives the card. A decline, because a decline is the ledgered half. */
const CHOICE = "decline";

/** How much of the ledger the last claim reads back. The rows it wants are the newest there are. */
const LEDGER_ROWS = 100;

/** Once per process. React's strict mode mounts the root's effect twice, and this is one run. */
let started = false;

/**
 * Run the smoke if this shell was armed for it. Called by the app root after the stores start.
 *
 * It never throws into the root: a smoke that failed to set up is a failed smoke, and it says so
 * on its own line and exits 1 like every other failure.
 */
export async function startSmoke(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  // A shell that does not answer `smoke_mode` is a shell older than this file, which is not
  // armed either: either way there is nothing to run and nothing to report.
  const mode = await smokeMode().catch(() => "");
  if (mode !== "turn") return;
  try {
    await runTurnSmoke();
  } catch (e) {
    await finish([`turn: setup — ${e instanceof Error ? e.message : String(e)}`], false);
  }
}

async function runTurnSmoke(): Promise<void> {
  const lines: string[] = [];

  // The daemon is a sidecar the window spawns; the page's tools arrive on `bridge:toolchange`
  // after the document has run its own scripts. Neither is instant and neither is a fixed delay.
  if (!(await until(() => endpointOf(useDaemon.getState()) !== null))) {
    const daemon = useDaemon.getState();
    await finish([`turn: daemon ${daemon.health} — ${daemon.lastError || "no endpoint"}`], false);
    return;
  }
  if (!(await until(() => useRun.getState().tools.length > 0))) {
    await finish(["turn: manifest tools=0 — the page registered nothing"], false);
    return;
  }

  // Claim 1. What the panel will post as this page's manifest: the tools the bridge reported,
  // with this origin's pins folded in. `send` posts it before the first round.
  const tools = useRun.getState().tools.length;
  lines.push(`turn: manifest tools=${tools}`);

  await runActions.send(MESSAGE);

  // Claim 2. The AUTO call the gate let through to the page, and the page's own answer to it. A
  // `tool.result` the surface wrote is a call that really ran in the page webview — the daemon's
  // own results for a cancelled call carry `ok: false` and a reason.
  const ran = useRun
    .getState()
    .transcript.find((item) => item.kind === "tool.result" && item.meta?.ok === true);
  lines.push(`turn: tool.call ${bare(String(ran?.meta?.name ?? "none"))} ok=${ran !== undefined}`);

  // Claim 3. The gated one became a card, and the card is answerable.
  const card = useRun.getState().pendingDecision;
  if (!card) {
    lines.push("turn: decision none — the gated call filed no card");
    await finish(lines, false);
    return;
  }
  const before = await denials();
  await runActions.answer(card.id, CHOICE);
  // The *answered* item, not the one that showed the card: both are `decision` items carrying
  // this id, and only the answer carries the status the daemon resolved the row to.
  const answered = useRun
    .getState()
    .transcript.filter(
      (item) =>
        item.kind === "decision" && item.meta?.id === card.id && item.meta.status !== undefined,
    )
    .at(-1);
  const status = String(answered?.meta?.status ?? "unanswered");
  lines.push(`turn: decision ${card.id} ${status}`);

  // Claim 4. The decline is in the ledger under a reason from the closed set, read back over the
  // same route the Activity module will read (README invariant 6).
  const denied = (await denials()) - before;
  lines.push(`turn: ledger user_denied=${denied}`);

  await finish(lines, ran !== undefined && status === "declined" && denied === 1);
}

/**
 * How many rows the ledger has recorded as `user_denied`, right now.
 *
 * The claim is a **difference** across the answer and not this number, because the brain is the
 * shell's real one and outlives the window: every earlier run's decline is still on the ledger,
 * which is what a ledger is for. A conversation id would not narrow it either — it is
 * `conv_<app_id>`, deliberately stable, so the same page is the same conversation next week.
 */
async function denials(): Promise<number> {
  const at = endpointOf(useDaemon.getState());
  if (!at) return -1;
  const reply = await daemonClient(at).ledger(LEDGER_ROWS);
  return reply.rows.filter((row) => row.error_reason === "user_denied").length;
}

/**
 * Print every line, then the verdict, then leave. The exit code is the whole answer.
 *
 * A failure also prints the transcript. A smoke that says only "ok=false" is a smoke whose next
 * step is running the window by hand, and the transcript is exactly what that would have shown —
 * the refusal, its reason, and the daemon's own sentence beside it (README invariant 6).
 */
async function finish(lines: string[], ok: boolean): Promise<void> {
  for (const line of lines) await smokeSay(line);
  if (!ok) {
    for (const item of useRun.getState().transcript) {
      await smokeSay(`turn: · ${item.kind} ${item.text.replace(/\s+/g, " ").slice(0, 240)}`);
    }
  }
  await smokeSay(`turn: ${ok ? "PASS" : "FAIL"} — ${lines.length} of 4 claims printed`, ok ? 0 : 1);
}

/** Poll a predicate until it holds or the budget runs out. `false` means it never held. */
async function until(holds: () => boolean): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (holds()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return holds();
}

/** `host.<app_id>.<tool>` to the bare name the page knows it by. */
function bare(name: string): string {
  return name.replace(/^host\.[^.]+\./, "");
}
