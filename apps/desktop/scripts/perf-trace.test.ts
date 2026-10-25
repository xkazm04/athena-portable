/**
 * What a perf drive did and when, and which step a long task ran under — README section 3.1,
 * ADR 0089. No browser: the drive runs on a stand-in page and the attribution is pure.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error a plain .mjs scenario shared with the Node runner, no declarations
import stage from "./perf-stage.drive.mjs";
// @ts-expect-error a plain .mjs helper shared with the Node runner, no declarations
import { IDLE, PAGE_LOAD, attributeTasks, recordingPage } from "./perf-trace.mjs";

type Action = { t: number; kind: string; selector?: string; key?: string; what: string };
type Attributed = { duration: number; step: string; offset: number | null };

/** A page on which every action resolves at once. */
function standIn() {
  const el = { click: async () => {}, hover: async () => {}, focus: async () => {} };
  const locator = () => {
    const self = { first: () => self, nth: () => self, click: async () => {}, focus: async () => {} };
    return self;
  };
  return {
    waitForSelector: async () => el,
    waitForTimeout: async () => {},
    $$: async () => [el, el],
    click: async () => {},
    fill: async () => {},
    locator,
    getByRole: () => locator(),
    keyboard: { press: async () => {}, down: async () => {}, up: async () => {} },
    mouse: { move: async () => {}, wheel: async () => {} },
  };
}

describe("attributeTasks", () => {
  const actions = [
    { t: 1000, what: 'click [data-go="notion"]' },
    { t: 1400, what: "press Escape" },
  ];

  it("ties a task to the last step at or before its start, with the offset", () => {
    const [task] = attributeTasks([{ start: 1250, duration: 54 }], actions) as Attributed[];
    expect(task).toEqual({ duration: 54, step: 'click [data-go="notion"]', offset: 250 });
  });

  it("names page load before the first step, and the idle second after the drive", () => {
    const [early, idle] = attributeTasks(
      [
        { start: 900, duration: 61 },
        { start: 3000, duration: 70, idle: true },
      ],
      actions,
    ) as Attributed[];
    expect(early!.step).toBe("before the first step (page load)");
    expect(early!.step).toBe(PAGE_LOAD);
    expect(idle!.step).toBe("the idle second");
    expect(idle!.step).toBe(IDLE);
  });

  it("adds the page's time origin to a start on the page's own clock", () => {
    const [task] = attributeTasks([{ start: 450, duration: 54 }], actions, 1000) as Attributed[];
    expect(task).toEqual({ duration: 54, step: "press Escape", offset: 50 });
  });
});

describe("recordingPage", () => {
  it("records the stage drive's steps in order, each with a monotonic time", async () => {
    let tick = 0;
    const { page, actions } = recordingPage(standIn(), () => (tick += 1)) as { page: unknown; actions: Action[] };
    await stage(page);
    const selectors = actions.map((a) => a.selector).filter(Boolean);
    expect(selectors).toContain('[data-go="apps"]');
    expect(selectors).toContain('[data-go="host-1"]');
    expect(selectors).toContain('[data-go="mind"]');
    expect(actions.map((a) => a.key).filter(Boolean)).toContain("Escape");
    expect(actions.findIndex((a) => a.selector === '[data-go="host-1"]')).toBeGreaterThan(
      actions.findIndex((a) => a.selector === '[data-go="apps"]'),
    );
    for (let i = 1; i < actions.length; i++) expect(actions[i]!.t).toBeGreaterThan(actions[i - 1]!.t);
    expect(actions.map((a) => a.what)).toContain('click [data-go="mind"]');
    // a pause is not a step
    expect(actions.some((a) => /timeout/i.test(a.what))).toBe(false);
  });

  it("records an element found by a query and a locator found by role under their selector", async () => {
    const { page, actions } = recordingPage(standIn()) as { page: Record<string, (...a: unknown[]) => unknown>; actions: Action[] };
    const [first] = (await page.$$!(".apps__orb")) as { hover: () => Promise<void> }[];
    await first!.hover();
    await (page.getByRole!("button", { name: "Close" }) as { click: () => Promise<void> }).click();
    expect(actions.map((a) => a.what)).toEqual(["query .apps__orb", "hover .apps__orb #0", 'click button "Close"']);
    expect(actions.map((a) => a.selector)).toEqual([".apps__orb", ".apps__orb", "Close"]);
  });
});
