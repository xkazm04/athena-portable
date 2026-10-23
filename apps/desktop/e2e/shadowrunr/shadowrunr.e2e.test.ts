/**
 * Athena drives Shadowrunr, end to end, on scripted transcripts — the gate that spends no quota.
 *
 * Both systems are real and both are booted here: the `shadowrunr` daemon (`--scripted`) on
 * scratch copies of the characters and the runs, the built console in Playwright Chromium with
 * `inject.js`, and `athena serve` with its engine's transport replaying a transcript
 * (`../support/daemon.ts`). The run loop is the shell's own (`src/stores/run.ts`), and its `call`
 * is the page relay, so every tool that runs is the console's real tool against the real daemon.
 *
 * Every case asserts on the real page (its hash, its DOM) and the real files, not only on frames.
 * See README.md beside this file.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Daemon } from "../support/daemon";
import { resetRunForTests, useRun } from "@/stores/run";

import { startScripted, renderTranscript } from "./support/athena";
import { launchBrowser, openConsole, type ConsolePage } from "./support/browser";
import { APP_ID, gatedFor, manifestFor, toolCallsOf, wireLoop, type Wired } from "./support/loop";
import {
  OVERLORD,
  digestOf,
  makeScratch,
  missingPieces,
  removeScratch,
  rpc,
  serveConsole,
  startShadowDaemon,
  treeDigest,
  type ConsoleServer,
  type Scratch,
  type ShadowDaemon,
} from "./support/shadowrunr";

const missing = missingPieces();
const LIVE = process.env.ATHENA_LIVE === "1";
if (missing.length > 0) console.warn(`shadowrunr e2e skipped:\n  ${missing.join("\n  ")}`);

const REAL_CHARACTERS = join(OVERLORD, "characters");

describe.skipIf(missing.length > 0 || LIVE)("Athena drives Shadowrunr (scripted)", () => {
  let scratch: Scratch;
  let shadow: ShadowDaemon;
  let web: ConsoleServer;
  let cp: ConsolePage;
  let athena: Daemon | null = null;
  let transcripts: string;
  let realBefore = "";

  beforeAll(async () => {
    realBefore = treeDigest(REAL_CHARACTERS);
    scratch = makeScratch();
    transcripts = join(scratch.root, "transcripts");
    mkdirSync(transcripts, { recursive: true });
    shadow = await startShadowDaemon(scratch);
    web = await serveConsole();
    const browser = await launchBrowser();
    cp = await openConsole(browser, web.origin, shadow.url);
  });

  afterEach(async () => {
    resetRunForTests();
    const d = athena;
    athena = null;
    await d?.stop();
  });

  afterAll(async () => {
    await cp?.close().catch(() => undefined);
    await cp?.browser.close().catch(() => undefined);
    await web?.stop().catch(() => undefined);
    await shadow?.stop().catch(() => undefined);
    if (scratch) removeScratch(scratch.root);
  });

  /** One scripted Athena on a rendered transcript, the loop wired to it, the page on `start`. */
  async function turnOn(name: string, values: Record<string, string | number>, start: string): Promise<Wired> {
    await cp.goHash(start);
    athena = await startScripted(renderTranscript(name, values, transcripts));
    return wireLoop(athena, cp);
  }

  const lastSaid = () => useRun.getState().transcript.filter((e) => e.kind === "assistant").at(-1)?.text.trim() ?? "";
  const bible = () => join(scratch.characters, "malakor", "bible.md");
  const backups = () => {
    const dir = join(scratch.data, "character-backups", "malakor");
    return existsSync(dir) ? readdirSync(dir) : [];
  };

  // -- pairing -------------------------------------------------------------------------------------

  it("pairs: the meta, the pressed toggle, the relay's list, an accepted manifest, a registered origin", async () => {
    // 1. The page names itself.
    const meta = await cp.page.evaluate(() => document.querySelector('meta[name="athena:app"]')?.getAttribute("content"));
    expect(meta).toBe(APP_ID);

    // 2. The opt-in is rendered (a registry exists) and pressed (the init script set it).
    const toggle = cp.page.locator('[data-role="athena-drive"]');
    await toggle.waitFor({ state: "visible", timeout: 15_000 });
    expect(await toggle.getAttribute("aria-pressed")).toBe("true");

    // 3. The relay lists the console's catalog.
    const listed = await cp.waitForTools(20);
    expect(listed.page.app_id).toBe(APP_ID);
    expect(listed.page.origin).toBe(web.origin);
    const names = listed.tools.map((t) => t.name);
    for (const name of ["where_am_i", "app_map", "go_to", "list_sessions", "open_moment", "read_character_doc", "set_character_doc", "start_sim"]) {
      expect(names).toContain(name);
    }

    // 4. The shell's manifest builder makes a body the real daemon takes.
    const body = manifestFor(listed.page.origin, listed);
    expect(body).not.toBeNull();
    athena = await startScripted(renderTranscript("orientation.ndjson", {}, transcripts));
    // Sent raw rather than through `DaemonApi.manifest`, so a refusal shows the daemon's
    // `problems` list (the client keeps only `detail`) — the one line worth reading when it fails.
    const response = await fetch(`${athena.url}/manifest`, {
      method: "POST",
      headers: { "X-Athena-Token": athena.token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const accepted = (await response.json()) as { ok: boolean; problems?: string[] };
    expect(accepted.problems ?? [], "POST /manifest problems").toEqual([]);
    expect(response.status).toBe(200);
    expect(accepted.ok).toBe(true);

    // 5. Registered: the shell's gate lists do not hold the app as first sight, and pin nothing.
    //    Unregistered, the same tab is first sight — which is what the registration step changes.
    const title = await cp.page.title();
    const registered = gatedFor(listed.page.origin, cp.page.url(), title, listed, true);
    expect(registered.gated_origins).not.toContain(`host:${APP_ID}`);
    expect(registered.gated_tools).toEqual([]);
    const unregistered = gatedFor(listed.page.origin, cp.page.url(), title, listed, false);
    expect(unregistered.gated_origins).toContain(`host:${APP_ID}`);
  });

  // -- orientation ---------------------------------------------------------------------------------

  it("orients: where_am_i, then go_to the bible; the page moved and the turn ended with text", async () => {
    const w = await turnOn("orientation.ndjson", {}, "#/segments");

    await useRun.getState().send("Show me Malakor's bible.");

    expect(useRun.getState().error).toBeNull();
    expect(w.calls.map((c) => c.name)).toEqual(["where_am_i", "go_to"]);
    expect(w.calls.every((c) => c.ok)).toBe(true);
    const where = JSON.parse(w.calls[0].output) as { view: string; page: string; tools_here: string[] };
    expect(where.view).toBe("#/segments");
    expect(where.page).toBe("segments");
    expect(await cp.hash()).toBe("#/characters/malakor/package/bible");
    expect(lastSaid()).toContain("Malakor's bible");
    // The manifest went first, and every turn said the app is not first sight.
    expect(w.wire.to("/manifest")[0].status).toBe(200);
    for (const run of w.wire.to("/run")) expect(run.body?.gated_origins ?? []).not.toContain(`host:${APP_ID}`);
  });

  // -- review walkthrough --------------------------------------------------------------------------

  it("walks a review: list_sessions, then open_moment on a real copied session", async () => {
    const sessions = await rpc<Array<{ session_id: string; started_ms: number; lines: number }>>(shadow.url, "review.sessions");
    expect(sessions.length).toBeGreaterThan(0);
    const latest = [...sessions].sort((a, b) => b.started_ms - a.started_ms)[0];
    const line = Math.max(1, Math.min(5, latest.lines));

    const w = await turnOn("review-walkthrough.ndjson", { SESSION: latest.session_id, LINE: line }, "#/characters");
    await useRun.getState().send("Walk me through the latest session.");

    expect(useRun.getState().error).toBeNull();
    expect(w.calls.map((c) => c.name)).toEqual(["list_sessions", "open_moment"]);
    const listedSessions = JSON.parse(w.calls[0].output) as { items: Array<{ session_id: string }>; total: number; footer: string };
    expect(listedSessions.items[0].session_id).toBe(latest.session_id);
    expect(listedSessions.footer).toMatch(/^showing \d+ of \d+/);
    const moment = JSON.parse(w.calls[1].output) as { session_id: string; line: number; lines: unknown[]; view: string };
    expect(moment.session_id).toBe(latest.session_id);
    expect(moment.line).toBe(line);
    expect(moment.lines.length).toBeGreaterThan(0);
    expect(await cp.hash()).toBe(`#/review/${latest.session_id}/timeline/${line}`);
    expect(lastSaid()).toContain("sagged");
  });

  // -- shaping Malakor -----------------------------------------------------------------------------

  it("shapes Malakor: an edit_character_doc card, approved once, lands one passage on the scratch bible with a backup", async () => {
    const before = readFileSync(bible(), "utf-8");
    const digest = digestOf(bible());
    // One exact, unique passage, as edit_character_doc requires: a long line that occurs once.
    const find = before.split("\n").find((l) => l.trim().length > 40 && before.split(l).length === 2) ?? "";
    expect(find).not.toBe("");
    const replace = `${find}\n\n- E2E: Malakor never apologises twice for the same joke.`;
    const text = before.replace(find, replace);
    const w = await turnOn("shape-approve.ndjson", { FIND: find, REPLACE: replace, DIGEST: digest }, "#/review");

    await useRun.getState().send("Read Malakor's bible and propose one sharper edit.");

    // The read ran; the write did not, and the file has not moved.
    expect(w.calls.map((c) => c.name)).toEqual(["read_character_doc"]);
    expect((JSON.parse(w.calls[0].output) as { digest: string }).digest).toBe(digest);
    expect(await cp.hash()).toBe("#/characters/malakor/package/bible");
    expect(digestOf(bible())).toBe(digest);
    const cards = useRun.getState().cards;
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.action).toBe(`host.${APP_ID}.edit_character_doc`);
    expect(card.origin).toBe(`host:${APP_ID}`);
    expect(card.params).toMatchObject({ id: "malakor", doc: "bible", find, replace, base_digest: digest });
    const pending = await w.api().decisions();
    expect(pending.total).toBe(1);

    await useRun.getState().answer(card.id, "approve");

    // POST /decisions/<id> answered `execute`, and the loop ran it exactly once.
    const decided = w.wire.to(`/decisions/${card.id}`);
    expect(decided).toHaveLength(1);
    expect(decided[0].status).toBe(200);
    const execute = (decided[0].reply?.execute ?? []) as Array<{ name: string }>;
    expect(execute).toHaveLength(1);
    expect(execute[0].name).toBe(`host.${APP_ID}.edit_character_doc`);
    const writes = w.calls.filter((c) => c.name === "edit_character_doc");
    expect(writes).toHaveLength(1);
    expect(writes[0].ok).toBe(true);
    const result = JSON.parse(writes[0].output) as { digest: string; previous_digest: string; backup?: string };
    expect(result.previous_digest).toBe(digest);

    // The real file on the scratch copy, and its backup under the scratch data dir.
    expect(readFileSync(bible(), "utf-8")).toBe(text);
    expect(digestOf(bible())).toBe(result.digest);
    expect(backups().length).toBeGreaterThanOrEqual(1);
    expect(backups().some((b) => b.endsWith("bible.md"))).toBe(true);
    expect(useRun.getState().cards).toEqual([]);
    expect(lastSaid()).toContain("updated");
  });

  it("a declined card changes nothing: no write, no backup, no second turn", async () => {
    const digest = digestOf(bible());
    const backupsBefore = backups().length;
    const text = `${readFileSync(bible(), "utf-8").trimEnd()}\n\n- E2E: this line must never land.\n`;
    const w = await turnOn("shape-decline.ndjson", { TEXT: text, DIGEST: digest }, "#/segments");

    await useRun.getState().send("Propose a bible edit.");
    const card = useRun.getState().cards[0];
    expect(card).toBeDefined();
    await useRun.getState().answer(card.id, "decline");

    expect(w.calls.map((c) => c.name)).toEqual(["read_character_doc"]);
    expect(w.wire.to("/run")).toHaveLength(2);
    expect(digestOf(bible())).toBe(digest);
    expect(backups().length).toBe(backupsBefore);
    expect(useRun.getState().cards).toEqual([]);
    const decided = w.wire.to(`/decisions/${card.id}`);
    expect(decided[0].reply?.execute ?? []).toEqual([]);
  });

  // -- a scripted sim ------------------------------------------------------------------------------

  it("starts a scripted sim: a run id comes back and the console shows the Simulator", async () => {
    const runId = "unhinged-roastmaster.sonnet.SEG-01.a30.s1";
    const w = await turnOn("scripted-sim.ndjson", { RUN_ID: runId }, "#/review");

    await useRun.getState().send("Start a scripted sim.");

    expect(useRun.getState().error).toBeNull();
    expect(w.calls.map((c) => c.name)).toEqual(["start_sim"]);
    expect(w.calls[0].ok).toBe(true);
    const started = JSON.parse(w.calls[0].output) as { run_id: string; view: string };
    expect(started.run_id).toBeTruthy();
    expect(started.view).toBe("#/simulator");
    expect(await cp.hash()).toMatch(/^#\/simulator/);
    // Every proposed call was answered by the page, none refused by the gate.
    expect(toolCallsOf(w.wire).every((c) => c.answered_by === "page" && c.ok === true)).toBe(true);
  });

  // -- the opt-out ---------------------------------------------------------------------------------

  it("switching the toggle off unregisters every tool: the relay lists none", async () => {
    const toggle = cp.page.locator('[data-role="athena-drive"]');
    expect(await toggle.getAttribute("aria-pressed")).toBe("true");
    await toggle.click();
    await cp.page.waitForFunction(() => document.querySelector('[data-role="athena-drive"]')?.getAttribute("aria-pressed") === "false");
    const listed = await cp.list();
    expect(listed.tools.filter((t) => t.name !== "")).toHaveLength(0);
    expect(await cp.page.evaluate((k) => localStorage.getItem(k), "shadowrunr.athena.drive")).toBe("0");
  });

  it("never touched the real characters/", () => {
    expect(treeDigest(REAL_CHARACTERS)).toBe(realBefore);
  });
});

