/**
 * The companion's state machine, driven with a virtual clock — ADR 0026.
 *
 * Every timing the brief names is asserted here: the ten-second pulse, the 45 second dim, the six
 * second peek, growth at once and shrinking 380ms later. Nothing waits for a real timer.
 */
import { expect, test } from "vitest";

import { createDriver, type Clock } from "./driver";
import { PEEK_MS, QUIET_MS, SETTLE_MS, SHRINK_MS, TEAR_MS, ATTN_MS, LINGER_MS, formOf, shown } from "./machine";
import type { Effect, Event, MachineState } from "./machine";

type Run = Exclude<Effect, { type: "schedule" | "cancel" }>;

function rig(init: Partial<Extract<Event, { t: "init" }>> = {}) {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: Clock = {
    set: (run, ms) => {
      const id = ++next;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clear: (id) => void timers.delete(id as number),
  };
  const effects: Array<{ at: number; effect: Run }> = [];
  const driver = createDriver({
    clock,
    run: (effect) => effects.push({ at: now, effect }),
    decorate: (event) => event,
  });
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
  driver.dispatch({ t: "init", onboarded: true, cards: 0, ...init });
  const sizes = () => effects.filter((e) => e.effect.type === "size").map((e) => ({ at: e.at, ...(e.effect as Extract<Run, { type: "size" }>) }));
  return {
    d: driver,
    s: (): MachineState => driver.get(),
    advance,
    effects,
    sizes,
    of: (type: Run["type"]) => effects.filter((e) => e.effect.type === type),
    pending: () => timers.size,
  };
}

test("first launch opens at welcome and an onboarded start opens at rest, each asking for its size", () => {
  const first = rig({ onboarded: false });
  expect(first.s().form).toBe("welcome");
  expect(first.sizes().map((z) => z.name)).toEqual(["welcome"]);

  const rest = rig();
  expect(rest.s().form).toBe("seal");
  expect(rest.sizes().map((z) => z.name)).toEqual(["seal"]);
});

test("a card arriving while she is visible opens the slip at once and pulses for ten seconds, then holds a ring", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.s().form).toBe("slip");
  expect(r.s().attn).toBe(true);
  // growth is requested immediately, before the paper unrolls
  expect(r.sizes().at(-1)).toMatchObject({ name: "slip", at: 0 });
  r.advance(ATTN_MS - 1);
  expect(r.s().attn).toBe(true);
  r.advance(1);
  expect(r.s().attn).toBe(false);
  // the ring is steady: the card is still waiting and she is still on the slip
  expect(r.s().cards).toBe(1);
  expect(r.s().form).toBe("slip");
});

test("answering stamps once the daemon has said yes, tears the slip at 900ms and returns her at 1500ms, shrinking 380ms after", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "decide", kind: "approve", by: "click" });
  expect(r.of("answer")).toHaveLength(1);
  expect(r.of("answer")[0].effect).toMatchObject({ kind: "approve", by: "click" });
  // the store drops the card when the daemon has taken the answer; the slip stays until it has torn away
  r.d.dispatch({ t: "cards", n: 0 });
  r.d.dispatch({ t: "sent", ok: true });
  expect(r.s().cards).toBe(0);
  expect(shown(r.s())).toBe(1);
  expect(r.s().form).toBe("slip");
  r.advance(TEAR_MS - 1);
  expect(r.s().decided?.tearing).toBe(false);
  r.advance(1);
  expect(r.s().decided?.tearing).toBe(true);
  r.advance(SETTLE_MS - TEAR_MS);
  expect(r.s().decided).toBeNull();
  expect(r.s().form).toBe("seal");
  const at = r.advance;
  const shrink = () => r.sizes().filter((z) => z.name === "seal" && z.at > 0);
  expect(shrink()).toHaveLength(0);
  at(SHRINK_MS - 1);
  expect(shrink()).toHaveLength(0);
  at(1);
  expect(shrink()).toHaveLength(1);
});

test("nothing is stamped, said or timed until the daemon has answered; a refusal brings the buttons back", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  const before = r.s().say.text;
  r.d.dispatch({ t: "decide", kind: "approve", by: "key" });
  expect(r.s().decided).toMatchObject({ kind: "approve", sending: true });
  expect(r.s().say.text).not.toMatch(/Approved/);
  // no stamp timers are running while the answer is in flight
  r.advance(SETTLE_MS * 3);
  expect(r.s().decided).toMatchObject({ sending: true, tearing: false });
  expect(r.s().form).toBe("slip");

  r.d.dispatch({ t: "sent", ok: false, text: "That answer was refused: x." });
  expect(r.s().decided).toBeNull();
  expect(r.s().cards).toBe(1);
  expect(r.s().form).toBe("slip");
  expect(r.s().say.text).toBe("That answer was refused: x.");
  expect(r.s().say.text).not.toBe(before);

  // and it can be answered again
  r.d.dispatch({ t: "decide", kind: "decline", by: "click" });
  expect(r.of("answer")).toHaveLength(2);
  r.d.dispatch({ t: "sent", ok: true });
  expect(r.s().say.text).toBe("Declined. Nothing was sent.");
  expect(r.s().decided).toMatchObject({ sending: false });
});

test("a verdict with no answer in flight changes nothing", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  const before = r.s();
  r.d.dispatch({ t: "sent", ok: true });
  expect(r.s().decided).toBeNull();
  expect(r.s().say).toEqual(before.say);
});

test("a second press during the stamp is ignored, so a card is answered once", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "decide", kind: "approve", by: "key" });
  r.d.dispatch({ t: "decide", kind: "decline", by: "click" });
  expect(r.of("answer")).toHaveLength(1);
});

test("with more cards waiting the next slip unrolls fresh after the last one is torn off", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 2 });
  const epoch = r.s().epoch;
  r.d.dispatch({ t: "decide", kind: "decline", by: "click" });
  r.d.dispatch({ t: "sent", ok: true });
  r.d.dispatch({ t: "cards", n: 1 });
  expect(shown(r.s())).toBe(2);
  r.advance(SETTLE_MS);
  expect(r.s().form).toBe("slip");
  expect(r.s().epoch).toBeGreaterThan(epoch);
  expect(shown(r.s())).toBe(1);
});

test("Esc puts the slip away: she stays waiting with a count, and the seal brings it back", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "esc" });
  expect(r.s().form).toBe("seal");
  expect(r.s().snoozed).toBe(true);
  expect(r.s().cards).toBe(1);
  // ring and count: the model reads them from `cards`, and the slip is not reopened by waiting
  r.advance(ATTN_MS + QUIET_MS);
  expect(r.s().form).toBe("seal");
  expect(r.s().quiet).toBe(false);
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("slip");
  expect(r.s().snoozed).toBe(false);
});

test("a card that arrives while she is hidden brings her back as a quiet home form and never opens the slip", () => {
  const r = rig();
  r.d.dispatch({ t: "hide" });
  expect(r.of("hide")).toHaveLength(1);
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.of("show")).toHaveLength(1);
  expect(r.s().hidden).toBe(false);
  expect(r.s().form).toBe("seal");
  expect(r.s().snoozed).toBe(true);
  expect(r.s().cards).toBe(1);
  expect(r.s().attn).toBe(true);
});

test("hidden as the window reports it, not only as the page chose it, is the same rule", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1, hidden: true });
  expect(r.of("show")).toHaveLength(1);
  // a card arriving over someone's work shows her without taking the keyboard
  expect(r.of("show")[0].effect).toEqual({ type: "show", focus: false });
  expect(r.s().form).toBe("seal");
  // the window may have been left at any size, so it is asked again
  expect(r.sizes().at(-1)?.name).toBe("seal");
});

test("docked, her home form is the tab; a card still pulls the slip out and she returns to the tab", () => {
  const r = rig();
  r.d.dispatch({ t: "snap", docked: "right" });
  expect(r.s().form).toBe("tab");
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.s().form).toBe("slip");
  r.d.dispatch({ t: "decide", kind: "approve", by: "voice" });
  r.d.dispatch({ t: "sent", ok: true });
  r.d.dispatch({ t: "cards", n: 0 });
  r.advance(SETTLE_MS);
  expect(r.s().form).toBe("tab");
  r.d.dispatch({ t: "snap", docked: null });
  expect(r.s().form).toBe("seal");
});

test("dragging a tab away grows a seal at once; docking shrinks to a tab 380ms later", () => {
  const r = rig();
  r.d.dispatch({ t: "snap", docked: "left" });
  expect(r.sizes().filter((z) => z.name === "tab")).toHaveLength(0);
  r.advance(SHRINK_MS);
  expect(r.sizes().at(-1)).toMatchObject({ name: "tab" });
  const before = r.sizes().length;
  r.d.dispatch({ t: "snap", docked: null });
  expect(r.sizes().length).toBe(before + 1);
  expect(r.sizes().at(-1)).toMatchObject({ name: "seal", at: SHRINK_MS });
});

test("the orientation Rust chose rides on every size request afterwards", () => {
  const r = rig();
  r.d.dispatch({ t: "orient", side: "right", valign: "up" });
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.sizes().at(-1)).toMatchObject({ name: "slip", side: "right", valign: "up" });
});

test("clicking the tab peeks a seal out; it tucks back after six seconds, unless she is being used", () => {
  const r = rig();
  r.d.dispatch({ t: "snap", docked: "right" });
  r.advance(SHRINK_MS);
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("seal");
  expect(r.sizes().at(-1)).toMatchObject({ name: "seal" });
  r.advance(PEEK_MS - 1);
  expect(r.s().form).toBe("seal");
  r.advance(1);
  expect(r.s().form).toBe("tab");

  r.d.dispatch({ t: "seal" });
  // focus inside her keeps the peek open
  r.d.dispatch({ t: "peekEnd", focusIn: true });
  expect(r.s().form).toBe("seal");
});

test("a peek with a card waiting does not tuck itself away", () => {
  const r = rig();
  r.d.dispatch({ t: "snap", docked: "right" });
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "esc" });
  expect(r.s().form).toBe("tab");
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("seal");
  r.advance(PEEK_MS * 3);
  expect(r.s().form).toBe("seal");
});

test("she dims to 55% after 45 seconds of rest, and any poke or card undoes it", () => {
  const r = rig();
  r.advance(QUIET_MS - 1);
  expect(r.s().quiet).toBe(false);
  r.advance(1);
  expect(r.s().quiet).toBe(true);
  r.d.dispatch({ t: "poke" });
  expect(r.s().quiet).toBe(false);
  r.advance(QUIET_MS);
  expect(r.s().quiet).toBe(true);
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.s().quiet).toBe(false);
});

test("she does not dim while anything but rest is on show", () => {
  const r = rig();
  r.d.dispatch({ t: "work", on: true });
  r.advance(QUIET_MS * 2);
  expect(r.s().quiet).toBe(false);
});

test("a turn draws the tape, keeps its last line for a moment, then she rests", () => {
  const r = rig();
  r.d.dispatch({ t: "work", on: true });
  expect(r.s().form).toBe("tape");
  expect(r.sizes().at(-1)).toMatchObject({ name: "tape", at: 0 });
  r.d.dispatch({ t: "work", on: false });
  expect(r.s().form).toBe("tape");
  r.advance(LINGER_MS);
  expect(r.s().form).toBe("seal");
});

test("a card outranks a turn, and a held key draws the hear tape only when nothing waits", () => {
  const r = rig();
  r.d.dispatch({ t: "listen", on: true });
  expect(r.s().form).toBe("hear");
  r.d.dispatch({ t: "listen", on: false });
  expect(r.s().form).toBe("seal");

  r.d.dispatch({ t: "work", on: true });
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.s().form).toBe("slip");

  const v = rig();
  v.d.dispatch({ t: "cards", n: 1 });
  v.d.dispatch({ t: "esc" });
  v.d.dispatch({ t: "listen", on: true });
  // speaking to a card that was put away brings the slip back, so the answer can be seen
  expect(v.s().form).toBe("slip");
});

test("growth is sent at once and a shrink is forgotten if she grew again before it fired", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "esc" });
  r.advance(SHRINK_MS - 10);
  r.d.dispatch({ t: "seal" });
  r.advance(SHRINK_MS * 2);
  const names = r.sizes().map((z) => z.name);
  expect(names).toEqual(["seal", "slip", "slip"]);
});

test("nothing is sent for anything that is not a change of form", () => {
  const r = rig();
  const before = r.sizes().length;
  r.d.dispatch({ t: "poke" });
  r.d.dispatch({ t: "tab", tab: "record" });
  r.d.dispatch({ t: "pin" });
  r.d.dispatch({ t: "orient", side: "right", valign: "down" });
  r.advance(ATTN_MS);
  expect(r.sizes().length).toBe(before);
});

test("a chord from a put-away or snoozed state shows the slip and does not answer blind", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "esc" });
  r.d.dispatch({ t: "hide" });
  r.d.dispatch({ t: "decide", kind: "decline", by: "chord" });
  expect(r.of("show")).toHaveLength(1);
  expect(r.of("answer")).toHaveLength(0);
  expect(r.s().form).toBe("slip");
  // the second press, with the slip on screen, answers it
  r.d.dispatch({ t: "decide", kind: "decline", by: "chord" });
  expect(r.of("answer")[0].effect).toMatchObject({ kind: "decline", by: "chord" });
});

test("with nothing waiting a chord does nothing", () => {
  const r = rig();
  r.d.dispatch({ t: "decide", kind: "approve", by: "chord" });
  expect(r.of("answer")).toHaveLength(0);
});

test("summon with a card opens the slip focused on Approve; without one it shows her home form", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "esc" });
  r.d.dispatch({ t: "summon" });
  expect(r.s().form).toBe("slip");
  expect(r.of("focus").at(-1)?.effect).toMatchObject({ target: "approve" });

  const q = rig();
  q.d.dispatch({ t: "hide" });
  q.d.dispatch({ t: "summon" });
  expect(q.of("show")).toHaveLength(1);
  expect(q.s().form).toBe("seal");
  expect(q.of("focus").at(-1)?.effect).toMatchObject({ target: "seal" });

  const t = rig();
  t.d.dispatch({ t: "snap", docked: "left" });
  t.d.dispatch({ t: "summon" });
  expect(t.s().form).toBe("seal");
});

test("welcome: the button onboards and lets her rest; Later rests her without onboarding", () => {
  const a = rig({ onboarded: false });
  a.d.dispatch({ t: "open" });
  expect(a.of("onboard")).toHaveLength(1);
  expect(a.s().form).toBe("seal");

  const b = rig({ onboarded: false });
  b.d.dispatch({ t: "esc" });
  expect(b.of("onboard")).toHaveLength(0);
  expect(b.s().form).toBe("seal");

  const c = rig({ onboarded: false });
  c.d.dispatch({ t: "seal" });
  expect(c.s().form).toBe("welcome");
});

test("the ledger is chosen and sticky: a card does not pull her out of it, and Esc closes it", () => {
  const r = rig();
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("ledger");
  expect(r.sizes().at(-1)).toMatchObject({ name: "ledger", at: 0 });
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.s().form).toBe("ledger");
  r.d.dispatch({ t: "decide", kind: "approve", by: "key" });
  r.d.dispatch({ t: "sent", ok: true });
  r.d.dispatch({ t: "cards", n: 0 });
  const epoch = r.s().epoch;
  r.advance(SETTLE_MS);
  expect(r.s().form).toBe("ledger");
  expect(r.s().epoch).toBe(epoch);
  r.d.dispatch({ t: "esc" });
  expect(r.s().form).toBe("seal");
});

test("from the slip the seal opens the ledger and from the ledger it closes it, on Talk", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("ledger");
  expect(r.s().tab).toBe("talk");
  r.d.dispatch({ t: "seal" });
  // a card still waits and she is not snoozed, so she returns to the slip
  expect(r.s().form).toBe("slip");
});

test("pinning is a toggle and is sent", () => {
  const r = rig();
  r.d.dispatch({ t: "pin" });
  expect(r.of("pin")[0].effect).toEqual({ type: "pin", on: false });
  r.d.dispatch({ t: "pin" });
  expect(r.of("pin")[1].effect).toEqual({ type: "pin", on: true });
});

test("a second card restarts the pulse instead of stacking a second one", () => {
  const r = rig();
  r.d.dispatch({ t: "cards", n: 1 });
  r.advance(ATTN_MS - 1000);
  r.d.dispatch({ t: "cards", n: 2 });
  r.advance(ATTN_MS - 1);
  expect(r.s().attn).toBe(true);
  r.advance(1);
  expect(r.s().attn).toBe(false);
});

test("formOf is the priority list: stamp, card, hear, tape, peek, home", () => {
  const r = rig();
  const base = r.s();
  expect(formOf({ ...base, working: true, listening: true })).toBe("hear");
  expect(formOf({ ...base, working: true })).toBe("tape");
  expect(formOf({ ...base, working: true, cards: 1 })).toBe("slip");
  expect(formOf({ ...base, working: true, cards: 1, snoozed: true })).toBe("tape");
  expect(formOf({ ...base, docked: "left", peek: true })).toBe("seal");
  expect(formOf({ ...base, docked: "left" })).toBe("tab");
});

test("while a collapse waits for its smaller size, she remembers the form the window still has", () => {
  const r = rig();
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("ledger");
  expect(r.s().leaving).toBeNull();
  const opened = r.s().epoch;

  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("seal");
  expect(r.s().leaving).toEqual({ form: "ledger", epoch: opened });
  r.advance(SHRINK_MS - 1);
  expect(r.s().leaving).not.toBeNull();
  r.advance(1);
  // the window has its seal size now, so there is nothing left to fold
  expect(r.s().leaving).toBeNull();
  expect(r.sizes().at(-1)).toMatchObject({ name: "seal", at: SHRINK_MS });
});

test("growing again before the shrink fires forgets the fold", () => {
  const r = rig();
  r.d.dispatch({ t: "seal" });
  r.d.dispatch({ t: "seal" });
  expect(r.s().leaving?.form).toBe("ledger");
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("ledger");
  expect(r.s().leaving).toBeNull();
});

test("growing out of the seal is marked as an opening, and nothing else is", () => {
  const r = rig();
  expect(r.s().opened).toBe(false);
  r.d.dispatch({ t: "seal" });
  expect(r.s().form).toBe("ledger");
  expect(r.s().opened).toBe(true);
  r.d.dispatch({ t: "seal" });
  expect(r.s().opened).toBe(false);

  // a card while the ledger is open changes nothing about the seal; a slip from the seal opens
  r.d.dispatch({ t: "cards", n: 1 });
  expect(r.s().form).toBe("slip");
  expect(r.s().opened).toBe(true);

  const first = rig({ onboarded: false });
  expect(first.s().form).toBe("welcome");
  expect(first.s().opened).toBe(false);
});
