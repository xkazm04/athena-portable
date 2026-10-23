/**
 * The real Athena desktop app drives Shadowrunr, end to end, through her own UI.
 *
 * Nothing here substitutes a piece of Athena: the shell is a built `athena-desktop.exe` (its own
 * identifier, so its store, brain, token file and WebView2 profiles are not the user's), her
 * daemon is the one that shell spawns on her signed-in Claude CLI, and every step is a person's
 * step taken through `drive/athena-drive.mjs` over CDP: the Apps register form, the console's
 * own "Athena" toggle (pressed with the shell's DOM hand), the Origins tab, the message box and
 * the card's own Approve and Decline buttons. Shadowrunr is the scripted daemon on scratch copies
 * plus its built console, as in `../shadowrunr`.
 *
 * Attach mode: with `ATHENA_CDP` (e.g. `http://127.0.0.1:9222`) it drives an Athena that is already
 * running instead, the user's own included. Nothing is launched or stopped then, the console is
 * served on a fixed port (`SHADOWRUNR_CONSOLE_PORT`, default 5193) so repeat runs reuse one origin
 * row, and teardown closes only the tab it opened. What it leaves in that Athena: the origin
 * registered and trusted, the conversation in her brain, and its ledger rows. Shadowrunr's writes
 * still land on scratch copies.
 *
 * It spends quota (four short real turns), so it runs only with `ATHENA_DESKTOP=1`, and skips
 * with a reason when a piece is missing. Each run writes transcripts, the ledger and screenshots
 * to `out/<UTC stamp>/`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attach, launch, type AthenaDriver, type Settled, type Slip } from "../../drive/athena-drive.mjs";
import {
  OVERLORD,
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
} from "../shadowrunr/support/shadowrunr";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE =
  process.env.ATHENA_DESKTOP_EXE ??
  resolve(HERE, "..", "..", "src-tauri", "target", "debug", process.platform === "win32" ? "athena-desktop.exe" : "athena-desktop");

const LIVE = process.env.ATHENA_DESKTOP === "1";
const ATTACH = process.env.ATHENA_CDP;
const CONSOLE_PORT = Number(process.env.SHADOWRUNR_CONSOLE_PORT ?? (ATTACH ? 5193 : 0));
const missing = [...missingPieces(), ...(ATTACH || existsSync(EXE) ? [] : [`no Athena exe at ${EXE} (drive/README.md builds one)`])];
const skipWhy = !LIVE ? "set ATHENA_DESKTOP=1 (spends quota)" : missing.join("; ");
if (skipWhy) console.warn(`[athena-desktop e2e] skipped: ${skipWhy}`);

const TURN_MS = 420_000;

describe.skipIf(Boolean(skipWhy))("the Athena desktop app drives Shadowrunr through her own UI", () => {
  let scratch: Scratch;
  let shadow: ShadowDaemon;
  let web: ConsoleServer;
  let d: AthenaDriver;
  let tabId = 0;
  let host = "";
  let outDir = "";
  let realBefore = "";
  let startedAt = "";
  const log: Array<{ step: string; settled?: Settled; note?: string }> = [];

  const shot = async (name: string) => {
    await d.shot("chrome", join(outDir, `${name}-chrome.png`)).catch(() => undefined);
    await d.shot("athena", join(outDir, `${name}-athena.png`)).catch(() => undefined);
  };
  const pendingFor = (settled: Settled, action: string): Slip | undefined =>
    settled.cards.find((c) => c.pending && c.label.includes(action));
  const acted = (settled: Settled) => settled.messages.flatMap((m) => m.acts.map((a) => a.text));

  beforeAll(async () => {
    realBefore = treeDigest(join(OVERLORD, "characters"));
    outDir = join(HERE, "out", new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(outDir, { recursive: true });
    scratch = makeScratch();
    shadow = await startShadowDaemon(scratch);
    web = await serveConsole(undefined, CONSOLE_PORT);
    host = new URL(web.origin).host;
    startedAt = new Date().toISOString();
    if (ATTACH) {
      d = await attach({ cdp: ATTACH });
      await d.ready();
    } else {
      d = await launch({ exe: EXE });
      await d.ready();
      await d.onboard();
    }
  }, 300_000);

  afterAll(async () => {
    if (outDir) {
      // Only this run's rows: an attached Athena's ledger holds the user's other conversations.
      const all = await d?.daemon<{ rows?: Array<{ created_at?: string; origin?: string; cost_usd?: number }> }>("/ledger?limit=200").catch(() => null);
      const rows = (all?.rows ?? []).filter((r) => (r.created_at ?? "") >= startedAt && r.origin === "host:shadowrunr");
      const cost = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
      writeFileSync(join(outDir, "run.json"), JSON.stringify({ mode: ATTACH ? "attach" : "launch", log, ledger: { rows, cost_usd: cost } }, null, 2));
    }
    if (ATTACH) {
      if (tabId) await d?.invoke("tabs_close", { id: tabId }).catch(() => undefined);
      await d?.close().catch(() => undefined);
    } else await d?.close({ stop: true }).catch(() => undefined);
    await web?.stop().catch(() => undefined);
    await shadow?.stop().catch(() => undefined);
    if (scratch) removeScratch(scratch.root);
  }, 120_000);

  it("pairs in the real UI: register, switch the console's toggle on, trust its tools", async () => {
    const tab = await d.register(`${web.origin}/?daemon=${shadow.url}`);
    tabId = tab.id;
    // The tab has just opened: wait for the console to render its toggle ("Athena" when off,
    // "Athena driving" when on) before looking for it.
    const TOGGLE = /^(ref_\S+)\s+button\s+(Athena(?: driving)?)$/m;
    let found = await d.hand(tabId, "page_find", { query: "Athena" });
    for (let i = 0; i < 60 && !TOGGLE.test(found.output ?? ""); i++) {
      await new Promise((r) => setTimeout(r, 500));
      found = await d.hand(tabId, "page_find", { query: "Athena" });
    }
    const [, ref, label] = TOGGLE.exec(found.output ?? "") ?? [];
    expect(ref, found.output ?? found.error ?? "").toBeTruthy();
    // The opt-in persists in the browsing profile: an Athena that ran this suite before (attach
    // mode) already has it on. Off, the console publishes nothing until it is pressed.
    if (label === "Athena") {
      expect((await d.tools(tabId)).tools ?? []).toHaveLength(0);
      const clicked = await d.hand(tabId, "page_click", { ref, expect: "Athena" });
      expect(clicked.ok).toBe(true);
    }
    const listed = await (async () => {
      for (let i = 0; i < 40; i++) {
        const l = await d.tools(tabId);
        if ((l.tools ?? []).length >= 25) return l;
        await new Promise((r) => setTimeout(r, 250));
      }
      return d.tools(tabId);
    })();
    const names = (listed.tools ?? []).map((t) => t.name);
    expect(names).toContain("where_am_i");
    expect(names).toContain("edit_character_doc");
    expect(listed.page?.app_id).toBe("shadowrunr");

    // Registered while the tab listed nothing, so every tool "appeared after you trusted this
    // app" (ADR 0100). Enabling the origin again accepts the contracts the tab lists now.
    const origin = await d.retrust(host);
    expect(origin?.enabled).toBe(true);
    // Trusted again with the contracts listed now: a read runs unattended, a write still asks.
    expect(origin?.tools["app_map"]).toBe("AUTO");
    expect(origin?.tools["edit_character_doc"]).toBe("GATED");
    await shot("01-paired");
    log.push({ step: "pair", note: JSON.stringify({ tools: names.length, origin }) });
  });

  it("orients: a read runs without a card and the answer names the page", async () => {
    await d.call(tabId, "go_to", { view: "#/segments" });
    const s = await d.say("Using only the where_am_i tool, tell me in one sentence which Shadowrunr page is open.", { timeout: TURN_MS });
    log.push({ step: "orient", settled: s });
    await shot("02-orient");
    expect(s.errors).toEqual([]);
    expect(s.cards.filter((c) => c.pending)).toEqual([]);
    expect(acted(s).some((a) => a.startsWith("host.shadowrunr.where_am_i →") && !a.includes("pending_approval"))).toBe(true);
    expect(s.reply?.text.toLowerCase()).toMatch(/segment/);
  });

  it("walks a session: she opens the moment and the console shows it", async () => {
    const sessions = await rpc<{ sessions?: Array<{ session_id: string }> } | Array<{ session_id: string }>>(shadow.url, "review.sessions", {});
    const list = Array.isArray(sessions) ? sessions : (sessions.sessions ?? []);
    const session = list[0]?.session_id;
    expect(session).toBeTruthy();
    const s = await d.say(
      `Open Shadowrunr review session ${session} at transcript line 20 with open_moment, then tell me in one sentence what happens there.`,
      { timeout: TURN_MS },
    );
    log.push({ step: "walk", settled: s });
    await shot("03-walk");
    expect(s.errors).toEqual([]);
    expect(acted(s).some((a) => a.startsWith("host.shadowrunr.open_moment →") && !a.includes("pending_approval"))).toBe(true);
    // The console moved: its own where_am_i says so (called through the shell, not the model).
    const where = await d.call(tabId, "where_am_i", {});
    expect(JSON.stringify(where)).toContain(`#/review/${session}/timeline/20`);
  });

  it("shapes Malakor through a real card: approved once, one passage lands on the scratch bible", async () => {
    const biblePath = join(scratch.characters, "malakor", "bible.md");
    const before = readFileSync(biblePath, "utf-8");
    const find = before.split("\n").find((l) => l.trim().length > 40 && before.split(l).length === 2) ?? "";
    expect(find).not.toBe("");
    const added = "E2E: he never apologises twice for the same joke.";
    const s = await d.say(
      `Use edit_character_doc on Malakor's bible (id malakor, doc bible): replace exactly this line\n${find}\nwith the same line followed by a space and: ${added}\nRead the document first for its digest. File the card now; I will approve it.`,
      { timeout: TURN_MS },
    );
    log.push({ step: "shape:proposed", settled: s });
    const card = pendingFor(s, "edit_character_doc");
    await shot("04-card");
    expect(card, JSON.stringify(s.cards)).toBeTruthy();
    expect(readFileSync(biblePath, "utf-8")).toBe(before);

    await d.approve(card!.id);
    const after = await d.settle({ timeout: TURN_MS });
    log.push({ step: "shape:approved", settled: after });
    await shot("05-approved");
    const text = readFileSync(biblePath, "utf-8");
    expect(text).toContain(added);
    expect(text).toBe(before.replace(find, `${find} ${added}`));
    const backups = join(scratch.data, "character-backups", "malakor");
    expect(existsSync(backups) && readdirSync(backups).some((f) => f.endsWith("bible.md"))).toBe(true);
  });

  it("a declined card changes nothing", async () => {
    const tone = async () => (await rpc<{ active_tone: string }>(shadow.url, "character.get", { id: "malakor" })).active_tone;
    const was = await tone();
    const target = was === "deadpan-bureaucrat" ? "theatrical" : "deadpan-bureaucrat";
    const s = await d.say(`Use set_tone to set Malakor's active tone to ${target}. File the card now.`, { timeout: TURN_MS });
    log.push({ step: "decline:proposed", settled: s });
    const card = pendingFor(s, "set_tone");
    expect(card, JSON.stringify(s.cards)).toBeTruthy();
    await d.decline(card!.id);
    await d.settle({ timeout: TURN_MS }).catch(() => undefined);
    await shot("06-declined");
    expect(await tone()).toBe(was);
  });

  it("never touched the real characters/", () => {
    expect(treeDigest(join(OVERLORD, "characters"))).toBe(realBefore);
  });
});
