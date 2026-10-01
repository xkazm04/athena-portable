/**
 * The runtime, against fakes — ADR 0026 ("Hide means put away, not mute"), README section 3.1.
 *
 * The machine is tested on its own; this is what joins it to the run store's cards and to Rust:
 * which command is asked for, when, and with what orientation.
 */
import { expect, test } from "vitest";

import type { Settled } from "@/stores/run";

import type { DecisionRequested } from "@/lib/events";

import type { Clock } from "./driver";
import { SETTLE_MS, SHRINK_MS } from "./machine";
import { choiceFor, createRuntime, lineOf, LINE_MAX, type RuntimeDeps } from "./runtime";
import { CARDS } from "./fixtures";

function harness(opts: { visible?: boolean } = {}) {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: Clock = {
    set: (run, ms) => {
      timers.set(++next, { at: now + ms, run });
      return next;
    },
    clear: (id) => void timers.delete(id as number),
  };
  const log: string[] = [];
  let store: DecisionRequested[] = [];
  let verdict: ((r: Settled) => void) | null = null;
  let answered: string | null = null;
  const deps: RuntimeDeps = {
    clock,
    size: (name, side, valign) => log.push(`size ${name} ${side} ${valign}`),
    show: (focus) => log.push(focus === false ? "show quietly" : "show"),
    hide: () => log.push("hide"),
    pin: (on) => log.push(`pin ${on}`),
    cards: () => store,
    // the real run store keeps the card until the daemon has answered, then drops it and says so
    answer: (id, choice, settled) => {
      log.push(`answer ${id} ${choice}`);
      answered = id;
      verdict = settled;
    },
    onboard: () => log.push("onboard"),
    focus: (target) => log.push(`focus ${target}`),
    visible: async () => opts.visible ?? true,
    focusIn: () => false,
  };
  const rt = createRuntime(deps);
  rt.dispatch({ t: "init", onboarded: true, cards: 0 });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].run();
    }
    now = end;
  };
  return {
    rt,
    log,
    advance,
    setCards: async (next: DecisionRequested[]) => {
      store = next;
      rt.cardsChanged(next);
      await rt.idle();
    },
    /** The daemon took the answer: the store drops the card, then tells the runtime. */
    accept: async () => {
      store = store.filter((c) => c.id !== answered);
      rt.cardsChanged(store);
      verdict?.({ ok: true, sentence: "" });
      await rt.idle();
      await Promise.resolve();
    },
    /** The daemon refused: the card stays. */
    refuse: async (sentence: string) => {
      verdict?.({ ok: false, sentence });
      await rt.idle();
      await Promise.resolve();
    },
  };
}

test("a card arriving while she is visible opens the slip and asks Rust to grow, once", async () => {
  const h = harness();
  await h.setCards([CARDS[0]]);
  expect(h.rt.getSnapshot().machine.form).toBe("slip");
  expect(h.log.filter((l) => l.startsWith("size"))).toEqual(["size seal left down", "size slip left down"]);
});

test("a card arriving while the window is hidden brings her back quiet, without opening the slip", async () => {
  const h = harness({ visible: false });
  await h.setCards([CARDS[0]]);
  // she comes back without taking the keyboard from whatever the person was doing
  expect(h.log).toContain("show quietly");
  expect(h.rt.getSnapshot().machine.form).toBe("seal");
  expect(h.rt.getSnapshot().machine.snoozed).toBe(true);
});

test("answering sends the choice at once, stamps only once the daemon has said yes, then lets the card go", async () => {
  const h = harness();
  await h.setCards([CARDS[0], CARDS[1]]);
  h.rt.dispatch({ t: "decide", kind: "approve", by: "click" });
  await h.rt.idle();
  expect(h.log).toContain(`answer ${CARDS[0].id} approve`);
  let s = h.rt.getSnapshot();
  expect(s.held?.id).toBe(CARDS[0].id);
  // in flight: the card is still on the slip and nothing is stamped
  expect(s.machine.decided).toMatchObject({ sending: true });
  expect(s.machine.say.text).not.toMatch(/Approved/);
  h.advance(SETTLE_MS * 2);
  expect(h.rt.getSnapshot().machine.decided).toMatchObject({ sending: true });

  await h.accept();
  s = h.rt.getSnapshot();
  expect(s.machine.decided).toMatchObject({ sending: false });
  expect(s.machine.say.text).toBe("Approved. Stamped and sent to the record.");
  expect(s.machine.form).toBe("slip");
  h.advance(SETTLE_MS);
  expect(h.rt.getSnapshot().held).toBeNull();
  // the second card's slip is now the one on show
  expect(h.rt.getSnapshot().machine.form).toBe("slip");
});

test("a refused answer keeps the card and the slip, says why, and lets her answer again", async () => {
  const h = harness();
  await h.setCards([CARDS[0]]);
  h.rt.dispatch({ t: "decide", kind: "approve", by: "key" });
  await h.rt.idle();
  await h.refuse("That answer was refused: nothing.");
  const s = h.rt.getSnapshot();
  expect(s.machine.decided).toBeNull();
  expect(s.machine.cards).toBe(1);
  expect(s.machine.form).toBe("slip");
  expect(s.held).toBeNull();
  expect(s.machine.say.text).toBe("That answer was refused: nothing.");
  h.rt.dispatch({ t: "decide", kind: "decline", by: "click" });
  expect(h.log.filter((l) => l.startsWith("answer"))).toHaveLength(2);
});

test("a decline sends the card's own option id and is stamped only after the daemon takes it", async () => {
  const h = harness();
  await h.setCards([CARDS[0]]);
  h.rt.dispatch({ t: "decide", kind: "decline", by: "chord" });
  await h.rt.idle();
  expect(h.log).toContain(`answer ${CARDS[0].id} decline`);
  await h.accept();
  expect(h.rt.getSnapshot().machine.say.text).toBe("Declined. Nothing was sent.");
  h.advance(SETTLE_MS + SHRINK_MS);
  expect(h.log.at(-1)).toBe("size seal left down");
});

test("the option id is the card's own when it spells the choice differently", () => {
  const odd = { ...CARDS[0], options: [{ id: "yes", label: "approve" }] };
  expect(choiceFor(odd, "approve")).toBe("approve");
  expect(choiceFor(CARDS[0], "decline")).toBe("decline");
});

test("the line for the tray is the step she is on, bounded and saying so", () => {
  expect(lineOf("seal", { app: "a", what: "b" })).toBe("");
  expect(lineOf("hear", null)).toBe("listening");
  expect(lineOf("tape", { app: "ledgerbox", what: "list overdue" })).toBe("ledgerbox: list overdue");
  const long = lineOf("tape", { app: "x", what: "y".repeat(200) });
  expect(long).toContain(`(showing ${LINE_MAX} of 203)`);
});

test("a subscriber hears changes until it unsubscribes", async () => {
  const h = harness();
  let heard = 0;
  const off = h.rt.subscribe(() => (heard += 1));
  h.rt.dispatch({ t: "poke" });
  const after = heard;
  off();
  await h.setCards([CARDS[0]]);
  expect(heard).toBe(after);
});

test("a turn that is running is work in any form; the ledger with nothing running says nothing", () => {
  const step = { app: "Athena", what: "thinking" };
  expect(lineOf("ledger", step)).toBe("");
  expect(lineOf("ledger", step, false)).toBe("");
  expect(lineOf("ledger", step, true)).toBe("Athena: thinking");
  expect(lineOf("welcome", step)).toBe("");
  expect(lineOf("tab", step, true)).toBe("Athena: thinking");
  expect(lineOf("ledger", null, true)).toBe("");
});
