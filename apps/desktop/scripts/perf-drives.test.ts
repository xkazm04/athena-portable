/**
 * The perf drives refuse a missing control — README section 3.1, ADR 0089.
 *
 * A drive that skips a step when its control is not there still finishes, and the gate then
 * judges a shorter path than the one its title names: green, and measuring less. Each drive is run
 * here against a stand-in page that has every element except one the drive steps through, and must
 * fail instead of carrying on.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error a plain .mjs scenario shared with the Node runner, no declarations
import apps from "./perf-apps.drive.mjs";
// @ts-expect-error a plain .mjs scenario shared with the Node runner, no declarations
import chores from "./perf-chores.drive.mjs";
// @ts-expect-error a plain .mjs scenario shared with the Node runner, no declarations
import mind from "./perf-mind.drive.mjs";

type Drive = (page: unknown) => Promise<void>;

/** A page where every selector matches three elements, except those `missing` names (by substring). */
function standIn(missing: string) {
  const gone = (selector: string) => selector.includes(missing);
  const absent = (selector: string) => Promise.reject(new Error(`timed out waiting for ${selector}`));
  const el = { click: async () => {}, hover: async () => {}, focus: async () => {} };
  const locator = (selector: string) => {
    const self = {
      first: () => self,
      nth: () => self,
      count: async () => (gone(selector) ? 0 : 3),
      click: async () => (gone(selector) ? absent(selector) : undefined),
      focus: async () => (gone(selector) ? absent(selector) : undefined),
    };
    return self;
  };
  return {
    waitForSelector: async (selector: string) => (gone(selector) ? absent(selector) : el),
    waitForTimeout: async () => {},
    $: async (selector: string) => (gone(selector) ? null : el),
    $$: async (selector: string) => (gone(selector) ? [] : [el, el, el]),
    click: async (selector: string) => (gone(selector) ? absent(selector) : undefined),
    fill: async () => {},
    locator,
    getByRole: (_role: string, o: { name: string }) => locator(o.name),
    keyboard: { press: async () => {}, down: async () => {}, up: async () => {} },
    mouse: { move: async () => {}, wheel: async () => {} },
  };
}

describe("a perf drive whose control is gone fails, never measures a shorter path", () => {
  const cases: [string, Drive, string][] = [
    ["apps: the tool it opens", apps, ".apps__tool"],
    ["mind: a look it picks", mind, '[role="radio"]'],
    ["chores: the still it enlarges", chores, ".pa-frame"],
  ];
  for (const [name, drive, selector] of cases) {
    it(name, async () => {
      await expect(drive(standIn("\u0000none"))).resolves.toBeUndefined();
      await expect(drive(standIn(selector))).rejects.toThrow(/timed out/);
    });
  }
});
