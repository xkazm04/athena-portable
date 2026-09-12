/**
 * docs/demo.md section 1, beat O1 — first launch, rendered from a live `athena doctor`.
 *
 * The cut opens on the thing every other beat assumes: an engine that answered, a brain that is a
 * folder on this disk, and a constitution with a version. The desktop shell says this in its setup
 * module (`apps/desktop/src/modules/setup/view.tsx`) as a short letter with one button; the take
 * has no shell, so the runner renders the same letter itself, in the surface's own style, exactly
 * as `record-page.ts` renders act 4.
 *
 * **Every row on it comes from the doctor's own JSON.** Nothing here composes a sentence about a
 * version, a path or a credential that `python -m athena.cli doctor` did not print: a stage that
 * is absent from the report is a row that is absent from the page. That is the whole discipline of
 * the beat — an onboarding screen that claims a machine is ready is the one screen a person cannot
 * check, so this one only repeats what the machine said, and says which stage said it.
 *
 * The engine stage is per-engine (`--engine claude_code`, `--engine codex`), so the doctor is run
 * once per engine and the non-engine stages are taken from the first report; they do not vary.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

import { PACKAGE_ROOT } from "./script.ts";

/** The repository root: `uv run` is invoked from here, as the doctor's own docs say to. */
export const REPO_ROOT: string = resolve(PACKAGE_ROOT, "..", "..");

/** The engines `athena doctor --engine` accepts, in the order the letter lists them. */
export const ENGINES: readonly string[] = ["claude_code", "codex"];

export interface DoctorStage {
  readonly name: string;
  readonly status: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly stages: readonly DoctorStage[];
}

/** What the doctor said about one engine: the report, and which engine it was asked about. */
export interface EngineReport {
  readonly engine: string;
  readonly report: DoctorReport;
}

/** One line of the letter: the fact, where it came from, and how the machine is standing. */
export interface OnboardRow {
  /** `claude_code`, `brain`, `constitution` — the doctor stage, or the engine it named. */
  readonly key: string;
  readonly label: string;
  /** The doctor's own words, trimmed to the part the row is about. */
  readonly value: string;
  /** The rest of the doctor's detail, when the value took only half of it. Never invented. */
  readonly note: string;
  /** `ok` | `warn` | `fail`, straight off the stage. */
  readonly status: string;
  /** The stage name this row was read from, printed small so the claim is checkable. */
  readonly from: string;
}

/**
 * Anything that looks like a credential, in the doctor's own detail strings.
 *
 * The doctor prints paths and versions and has no business printing a token, but "has no business"
 * is not a guarantee and this text is about to be rendered into a video. A detail that matches is
 * replaced whole rather than partly: half a secret on screen is a secret on screen.
 */
const SECRET: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /(?:token|secret|api[_-]?key|password|bearer|credential)["'\s:=]+[A-Za-z0-9/+_-]{16,}/i,
];

/** The detail, or `[redacted]` if it carries something that reads like a credential. */
export function redact(detail: string): string {
  return SECRET.some((pattern) => pattern.test(detail)) ? "[redacted — the detail looked like a credential]" : detail;
}

function stageOf(report: DoctorReport, name: string): DoctorStage | null {
  return report.stages.find((stage) => stage.name === name) ?? null;
}

/**
 * Run the doctor once, for one engine.
 *
 * `uv run python -m athena.cli doctor` from the repository root, exactly as `AGENTS.md` runs it.
 * The command prints JSON on stdout and a non-zero exit means "a stage failed", not "no report",
 * so the output is parsed either way and only an unparseable one throws.
 */
export function runDoctor(engine: string, timeoutMs = 180_000): DoctorReport {
  const run = spawnSync("uv", ["run", "python", "-m", "athena.cli", "doctor", "--engine", engine], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  const out = `${run.stdout ?? ""}`;
  const start = out.indexOf("{");
  if (start < 0) {
    throw new Error(`athena doctor --engine ${engine} printed no JSON: ${(run.stderr ?? "").trim().slice(0, 300)}`);
  }
  const parsed = JSON.parse(out.slice(start)) as DoctorReport;
  if (!Array.isArray(parsed.stages)) throw new Error(`athena doctor --engine ${engine}: no stages in the report`);
  return parsed;
}

/** One report per engine, in `ENGINES` order. A run that throws is left out of the letter. */
export function runDoctors(engines: readonly string[] = ENGINES): EngineReport[] {
  const reports: EngineReport[] = [];
  for (const engine of engines) {
    reports.push({ engine, report: runDoctor(engine) });
  }
  return reports;
}

/**
 * The engine row, from the engine stage alone.
 *
 * `cli.py::_engine_stage` has exactly three shapes and this reads all three without adding a
 * fourth: `ok` with `"<engine>: <detail>"`, a `warn` whose detail ends "but no credential was
 * found", and a `warn` that is the probe saying why it could not run.
 */
function engineRow(engine: string, stage: DoctorStage): OnboardRow {
  const detail = redact(stage.detail).trim();
  const bare = detail.startsWith(`${engine}:`) ? detail.slice(engine.length + 1).trim() : detail;
  const signedOut = /no credential was found/i.test(detail);
  const note = stage.status === "ok" ? "signed in" : signedOut ? "installed, signed out" : "cannot run a turn yet";
  const value = signedOut ? bare.replace(/,?\s*but no credential was found\.?$/i, "").trim() : bare;
  return { key: engine, label: engine, value, note, status: stage.status, from: "engine" };
}

/**
 * The letter's rows, in the order the desktop's setup module puts them: the engines first,
 * because that is the choice, then where the brain is and which constitution is in force.
 *
 * A stage the report does not carry is a row this does not build.
 */
export function onboardRows(reports: readonly EngineReport[]): OnboardRow[] {
  const rows: OnboardRow[] = [];
  for (const one of reports) {
    const stage = stageOf(one.report, "engine");
    if (stage) rows.push(engineRow(one.engine, stage));
  }
  const first = reports[0]?.report;
  if (!first) return rows;

  const brain = stageOf(first, "brain");
  if (brain) {
    const detail = redact(brain.detail).trim();
    // `"<path> ({…})"`: the path is the row and the counts are the note — and an empty `{}` is not
    // a note, it is punctuation, so it is dropped rather than printed at a person.
    const split = detail.indexOf(" (");
    const counts = split > 0 ? detail.slice(split + 1).replace(/^\(|\)$/g, "").trim() : "";
    rows.push({
      key: "brain",
      label: "brain",
      value: split > 0 ? detail.slice(0, split) : detail,
      note: counts === "{}" ? "" : counts,
      status: brain.status,
      from: "brain",
    });
  }

  const law = stageOf(first, "constitution");
  if (law) {
    const detail = redact(law.detail).trim();
    // `"<kind>: <directory> v<version>"`. The version is the row; the note is the *kind* of source
    // and not the directory, which is one machine's path and unreadable at this size anyway.
    const version = /\bv[0-9a-f]{6,}\b/i.exec(detail);
    const kind = /^([a-z ]+):/i.exec(detail);
    rows.push({
      key: "constitution",
      label: "constitution",
      value: version ? version[0] : detail,
      note: version !== null && kind !== null ? kind[1]! : "",
      status: law.status,
      from: "constitution",
    });
  }
  return rows;
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0e14; color: #f2f4f8;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { padding: 92px 0 40px; display: flex; justify-content: center; }
  .letter { width: 940px; max-width: 92vw; }
  h1 { font-size: 34px; margin: 0 0 10px; letter-spacing: -.02em; }
  .lede { color: #b8c2d4; font-size: 19px; line-height: 1.45; margin: 0 0 26px; max-width: 760px; }
  h2 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8fd0ff;
    margin: 0 0 12px; font-weight: 700; }
  .rows { border-top: 1px solid #2b3446; margin-bottom: 26px; }
  .row { display: flex; align-items: baseline; gap: 16px; padding: 13px 2px;
    border-bottom: 1px solid #1b2230; }
  .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: #a6e77f; }
  .dot.warn { background: #ffd79a; }
  .dot.fail { background: #ff7a7a; }
  .label { flex: none; width: 150px; font-size: 17px; font-weight: 700;
    font-family: ui-monospace, Menlo, Consolas, monospace; }
  .value { flex: 1 1 auto; font-size: 17px; overflow-wrap: anywhere;
    font-family: ui-monospace, Menlo, Consolas, monospace; color: #f2f4f8; }
  .note { flex: none; font-size: 14px; color: #97a3b8; text-align: right; max-width: 300px; }
  .from { font-size: 12px; color: #6d7789; letter-spacing: .04em; }
  .foot { display: flex; align-items: center; gap: 18px; margin-top: 4px; }
  .btn { font-size: 17px; font-weight: 700; border-radius: 9px; padding: 11px 22px;
    border: 1px solid #a6e77f; background: #a6e77f; color: #16210f; }
  .btn.pressed { outline: 3px solid #8fd0ff; outline-offset: 3px; transform: translateY(1px); }
  .foot span { font-size: 14px; color: #97a3b8; }
  .source { margin-top: 22px; font-size: 12px; color: #6d7789;
    font-family: ui-monospace, Menlo, Consolas, monospace; }
`;

/**
 * The onboarding letter, as a whole document the runner sets on the page.
 *
 * Two sentences of what Athena is, the rows the doctor printed, and the one button the desktop's
 * onboarding ends on. The wording of the letter is the shell's own ("Choose the engine", "Start
 * using Athena"); the facts beside it are the doctor's.
 */
export function onboardPage(rows: readonly OnboardRow[], command: string): string {
  const list = rows
    .map(
      (row) =>
        `<div class="row"><span class="dot ${row.status === "ok" ? "" : row.status === "warn" ? "warn" : "fail"}"></span>
           <span class="label">${escape(row.label)}</span>
           <span class="value">${escape(row.value)}</span>
           <span class="note">${escape(row.note)}<br><span class="from">doctor · ${escape(row.from)}</span></span></div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Athena — first launch</title>
    <style>${STYLE}</style></head><body><main><div class="letter">
      <h1>Athena is on this machine.</h1>
      <p class="lede">She works inside the apps you already have open, and asks before anything that
        cannot be undone. Choose the engine — an engine you already have runs the turns, so no key is
        typed here and nothing is uploaded — and the brain is a folder on this disk.</p>
      <h2>What this machine answered</h2>
      <div class="rows">${list}</div>
      <div class="foot"><button class="btn" id="start">Start using Athena</button>
        <span>Athena opens on the page you left open.</span></div>
      <div class="source">${escape(command)}</div>
    </div></main></body></html>`;
}

/**
 * The last thing the beat does: press "Start using Athena", visibly, for 150 ms.
 *
 * A button that changes the film without being seen to be pressed is the shell taking the person's
 * decision for them, which is the one thing this build does not do — so the press is on camera for
 * long enough to read, and the take moves on when it is released.
 */
export async function pressStart(page: Page, heldMs = 150): Promise<void> {
  await page.evaluate(() => document.getElementById("start")?.classList.add("pressed"));
  await page.waitForTimeout(heldMs);
  await page.evaluate(() => document.getElementById("start")?.classList.remove("pressed"));
}
