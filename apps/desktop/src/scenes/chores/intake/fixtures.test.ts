/** The front door's scripted client plays the three endings the preview shows — ADR 0098. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdoptEvent } from "@/lib/adopt";

import { INTAKE_FIXTURES, ScriptedIntake } from "./fixtures";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Play `ms` of the script and read what has arrived. */
async function run(client: ScriptedIntake, ms: number): Promise<AdoptEvent[]> {
  const seen: AdoptEvent[] = [];
  const ctl = new AbortController();
  const done = (async () => {
    for await (const e of client.events("s", 0, ctl.signal)) seen.push(e);
  })();
  await vi.advanceTimersByTimeAsync(ms);
  ctl.abort();
  await vi.advanceTimersByTimeAsync(1);
  await done;
  return seen;
}

const card = [{ question_id: "q-what", choice_ids: ["money"], text: "" }];

describe("the scripted front door", () => {
  it("opens with a line and a card, then ends on a template verdict with an alternate", async () => {
    const c = new ScriptedIntake("intake-template");
    await c.start();
    await c.answer("s", card, "text");
    const seen = await run(c, 10_000);
    const v = seen.find((e) => e.kind === "adopt.verdict");
    expect(seen.map((e) => e.kind)).toContain("adopt.questions");
    expect(v).toMatchObject({
      fit: "template",
      playbook_id: "travel-credit-refunds",
      command: "",
    });
    expect(
      v?.kind === "adopt.verdict" && v.alternates.length,
    ).toBeLessThanOrEqual(2);
    expect(seen.map((e) => e.seq)).toEqual(seen.map((_, i) => i + 1));
  });

  it("ends on a custom verdict with a command and no chore", async () => {
    const c = new ScriptedIntake("intake-custom");
    await c.start();
    await c.decide("s");
    const v = (await run(c, 10_000)).find((e) => e.kind === "adopt.verdict");
    expect(v).toMatchObject({ fit: "custom", playbook_id: "" });
    expect(v?.kind === "adopt.verdict" && v.command).not.toBe("");
  });

  it("fails the engine once, and the retry reaches the verdict", async () => {
    const c = new ScriptedIntake("intake-error");
    await c.start();
    await c.answer("s", card, "text");
    expect((await run(c, 10_000)).map((e) => e.kind)).toContain("adopt.error");
    await c.start("again");
    await c.answer("s", card, "text");
    expect((await run(c, 10_000)).map((e) => e.kind)).toContain(
      "adopt.verdict",
    );
  });

  it("is a daemon that is not there for intake-offline", async () => {
    await expect(
      new ScriptedIntake("intake-offline").start(),
    ).rejects.toMatchObject({ reason: "offline" });
    expect(INTAKE_FIXTURES).toContain("intake-offline");
  });
});
