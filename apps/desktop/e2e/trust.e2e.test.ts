/**
 * The shell's trust decision, over the real wire, against the real gate - README section 3.3,
 * ADR 0063, 0100.
 *
 * `stores/trust.test.ts` pins how the panel folds the origins table into the gate's lists, and
 * `tests/daemon/test_gated_origins.py` pins what the daemon's gate does with them. Neither can be
 * wrong about the hop between them: the `/run` body the panel really sends, and the card the real
 * daemon really files from it. Every case here wires the run loop through `support/shell.ts`,
 * which reads a seeded table, tab strip and tools store through the shell's own `snapshotOf`, so a
 * reader dropped from the snapshot, a renamed body field or a slug mixed up with an origin turns a
 * case red instead of shipping a panel that tells the gate nothing.
 *
 * The page is always the same ledgerbox tab; only the person's table changes. `list_overdue` is a
 * tool its page flags reversible and internal, which the catalog makes `AUTO`: each case below is
 * a reason, other than the page's own flags, that it does not run.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import { derivedIdOf } from "@/lib/manifest";
import { VoiceSetupApi } from "@/lib/voice-setup";
import type { SocketLike } from "@/lib/voice";
import type { TrustTable } from "@/stores/run";
import { resetRunForTests, setRunDeps, useRun } from "@/stores/run";
import { resetVoiceForTests, setVoiceDeps, startVoice, useVoice } from "@/stores/voice";

import { startDaemon, type Daemon } from "./support/daemon";
import { APP_ID, PAGE_ORIGIN, PAGE_TOOLS, READ_TOOL, WRITE_TOOL, fakePage, type FakePage } from "./support/page";
import { firstSight, pageShell, registered, shellDeps, switchedOff, voiceShellDeps } from "./support/shell";
import { recorder, type Recorder } from "./support/wire";

const ANSWERS = { list_overdue: "INV-118, INV-120, INV-131", pay: "paid" };

let running: Daemon | null = null;

afterEach(async () => {
  resetVoiceForTests();
  resetRunForTests();
  const daemon = running;
  running = null;
  await daemon?.stop();
});

/** One daemon, the ledgerbox page, and the run loop wired through the shell under `table`. */
async function live(
  transcript: string,
  table: TrustTable,
  tools: readonly BridgeTool[] = PAGE_TOOLS,
): Promise<{ page: FakePage; wire: Recorder }> {
  const daemon = await startDaemon({ transcript: `e2e/transcripts/${transcript}` });
  running = daemon;
  const page = fakePage(ANSWERS);
  const wire = recorder();
  setRunDeps(shellDeps({ ...pageShell(table, page.call, tools), daemon, fetchImpl: wire.fetchImpl }));
  return { page, wire };
}

/** `list_overdue` as the person accepted it before the page loosened its claim: irreversible, external. */
const STRICTER_LIST_OVERDUE: BridgeTool = {
  ...PAGE_TOOLS[0],
  annotations: { consequentialHint: true },
  athena: { reversible: false, side_effects: "external" },
};

describe("the trust table decides what the gate is told", () => {
  it("first sight: a tab with no origins row sends its app as gated, and the AUTO call becomes a card", async () => {
    const { page, wire } = await live("auto-turn.ndjson", firstSight());

    await useRun.getState().send("what is overdue?");

    const runs = wire.to("/run");
    expect(runs[0].body?.gated_origins).toEqual([`host:${APP_ID}`]);
    expect(page.calls).toEqual([]);
    const cards = useRun.getState().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].action).toBe(READ_TOOL);
  });

  it("registered and accepted: an enabled row with its contracts accepted gates nothing, and the AUTO call runs", async () => {
    // Guard: the AUTO claim of run.e2e, now reached through the deciding input.
    const { page, wire } = await live("auto-turn.ndjson", registered(PAGE_ORIGIN, PAGE_TOOLS));

    await useRun.getState().send("what is overdue?");

    const first = wire.to("/run")[0].body;
    expect(first?.gated_origins).toEqual([]);
    expect(first?.gated_tools).toEqual([]);
    expect(page.names()).toEqual(["list_overdue"]);
    expect(useRun.getState().cards).toEqual([]);
  });

  it("pinned: a GATED override on an enabled row gates that tool, and its call becomes a card", async () => {
    const table = registered(PAGE_ORIGIN, PAGE_TOOLS, { overrides: { list_overdue: "GATED" } });
    const { page, wire } = await live("auto-turn.ndjson", table);

    await useRun.getState().send("what is overdue?");

    expect(wire.to("/run")[0].body?.gated_tools).toEqual([READ_TOOL]);
    expect(page.calls).toEqual([]);
    const cards = useRun.getState().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].action).toBe(READ_TOOL);
  });

  it("contract drift (ADR 0100): a tool whose published contract is not the accepted one is gated", async () => {
    // The person accepted `list_overdue` as irreversible and external; the page now claims it is
    // reversible and internal, which its own flags would run without a card.
    const table = registered(PAGE_ORIGIN, PAGE_TOOLS, { accepted: [STRICTER_LIST_OVERDUE, PAGE_TOOLS[1]] });
    const { page, wire } = await live("auto-turn.ndjson", table);

    await useRun.getState().send("what is overdue?");

    expect(wire.to("/run")[0].body?.gated_tools).toContain(READ_TOOL);
    expect(wire.to("/run")[0].body?.gated_tools).not.toContain(WRITE_TOOL);
    expect(page.calls).toEqual([]);
    const cards = useRun.getState().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].action).toBe(READ_TOOL);
  });

  it("switched off: a disabled row is sent as disabled, and the gate refuses the call foreign_origin", async () => {
    const { page, wire } = await live("auto-turn.ndjson", switchedOff(PAGE_ORIGIN));

    await useRun.getState().send("what is overdue?");

    // The page's slug, and the id the origin derives (ADR 0065): a switched-off web origin refuses
    // both names its tools could be reached under.
    expect(wire.to("/run")[0].body?.disabled_origins).toEqual([`host:${APP_ID}`, `host:${derivedIdOf(PAGE_ORIGIN)}`].sort());
    const refused = useRun.getState().transcript.filter((e) => e.kind === "tool");
    expect(refused).toHaveLength(1);
    expect(refused[0].ok).toBe(false);
    expect(refused[0].text).toContain(READ_TOOL);
    expect(refused[0].text).toContain("foreign_origin");
    expect(page.calls).toEqual([]);
  });

  it("guard: a gated approval through the shell answers with the panel's own lists and runs the page once", async () => {
    const { page, wire } = await live("gated-approve.ndjson", registered(PAGE_ORIGIN, PAGE_TOOLS));

    await useRun.getState().send("pay INV-118");
    const card = useRun.getState().cards[0];
    expect(card?.action).toBe(WRITE_TOOL);
    expect(page.calls).toEqual([]);

    await useRun.getState().answer(card.id, "approve");

    const decided = wire.to(`/decisions/${card.id}`);
    expect(decided).toHaveLength(1);
    expect(decided[0].body).toEqual({ choice: "approve", origin: PAGE_ORIGIN, disabled_origins: [] });
    expect(page.names()).toEqual(["pay"]);
  });
});

describe("the spoken channel reads the same table", () => {
  it("spoken first sight: a voice turn on a tab with no origins row files a voice card and the page is not asked", async () => {
    const daemon = await startDaemon({ transcript: "e2e/transcripts/voice-first-sight.ndjson", voice: "scripted" });
    running = daemon;
    const page = fakePage(ANSWERS);
    const endpoint = () => ({ url: daemon.url, token: daemon.token });
    const seed = pageShell(firstSight(), page.call);
    setVoiceDeps(
      voiceShellDeps(seed, {
        endpoint,
        config: async () => {
          const out = await new VoiceSetupApi(endpoint()).config();
          if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
          return out.value;
        },
        socket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
        openMic: null,
        player: () => null,
      }),
    );
    // The panel's HTTP half holds the card the spoken turn files.
    setRunDeps(shellDeps({ ...seed, daemon }));
    await startVoice();

    await useVoice.getState().say("what is overdue?");

    const deadline = Date.now() + 20_000;
    while (useRun.getState().cards.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const cards = useRun.getState().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].action).toBe(READ_TOOL);
    expect(cards[0].surface).toBe("voice");
    expect(page.calls).toEqual([]);
  });
});
