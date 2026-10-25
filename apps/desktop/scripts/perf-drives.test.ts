/**
 * The perf drives refuse a missing control — README section 3.1, ADR 0089.
 *
 * A drive that skips a step when its control is not there still finishes, and the gate then
 * judges a shorter path than the one its title names: green, and measuring less. Every drive on
 * disk (the same list `perf:all` runs, from `drivesIn`) is run once on a stand-in page through the
 * gate's recorder, which says every selector it touched; it is then rerun once per selector with
 * that one selector gone, and must fail instead of carrying on.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error a plain .mjs scenario shared with the Node runner, no declarations
import accounts from "./perf-accounts.drive.mjs";
// @ts-expect-error a plain .mjs runner, no declarations
import { drivesIn } from "./perf-gate.mjs";
// @ts-expect-error a plain .mjs helper shared with the Node runner, no declarations
import { recordingPage } from "./perf-trace.mjs";

type Drive = (page: unknown) => Promise<void>;
type Action = { selector?: string };

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
    fill: async (selector: string) => (gone(selector) ? absent(selector) : undefined),
    locator,
    getByRole: (_role: string, o: { name: string }) => locator(o.name),
    keyboard: { press: async () => {}, down: async () => {}, up: async () => {} },
    mouse: { move: async () => {}, wheel: async () => {} },
  };
}

const NONE = "\u0000none";
const scenes = drivesIn(new URL(".", import.meta.url)) as string[];

describe("a perf drive whose control is gone fails, never measures a shorter path", () => {
  it("holds every drive on disk, not a hand-picked few", () => {
    expect(scenes.length).toBeGreaterThanOrEqual(10);
  });

  it("the stand-in's fill honours a missing input: accounts without its allow-list input rejects", async () => {
    const drive = accounts as Drive;
    await expect(drive(standIn(NONE))).resolves.toBeUndefined();
    await expect(drive(standIn("input.input"))).rejects.toThrow(/timed out/);
  });

  for (const scene of scenes) {
    it(`${scene}: every selector it touches is required`, async () => {
      const drive = (await import(`./perf-${scene}.drive.mjs`)).default as Drive;
      const { page, actions } = recordingPage(standIn(NONE)) as { page: unknown; actions: Action[] };
      await expect(drive(page)).resolves.toBeUndefined();
      const touched = [...new Set(actions.map((a) => a.selector).filter((s): s is string => Boolean(s)))];
      expect(touched.length, scene).toBeGreaterThan(0);
      for (const selector of touched) {
        let finished = false;
        try {
          await drive(standIn(selector));
          finished = true;
        } catch {
          /* any error: the drive refused the gone control */
        }
        expect(finished, `${scene} finished with ${selector} gone`).toBe(false);
      }
    });
  }
});
