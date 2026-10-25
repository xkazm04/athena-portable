/**
 * The perf gate's runner — README section 3.1, ADR 0089.
 *
 * `perf:all` is the gate the overlay and the round briefs name. It must judge every scene that has a
 * drive, and one scene that fails, or whose drive throws, must not hide the verdicts of the scenes
 * after it.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// @ts-expect-error a plain .mjs runner, no declarations
import { drivesIn, formatLine, report, runScenes } from "./perf-gate.mjs";
// @ts-expect-error a plain .mjs helper shared with the Node runner, no declarations
import { BUDGETS, judge, verdict } from "./perf-budgets.mjs";

const here = new URL(".", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("the scenes perf:all judges", () => {
  it("are every drive on disk, and each has its own perf:<scene> script", () => {
    const scenes = drivesIn(here) as string[];
    expect(scenes.length).toBeGreaterThanOrEqual(8);
    for (const s of scenes) expect(pkg.scripts[`perf:${s}`], s).toBe(`node scripts/perf-gate.mjs --scene ${s}`);
    const scripted = Object.keys(pkg.scripts)
      .filter((k) => /^perf:/.test(k) && k !== "perf:all")
      .map((k) => k.slice("perf:".length));
    expect(scripted.sort()).toEqual([...scenes].sort());
  });

  it("are run by perf:all from one build, after the self-test", () => {
    expect(pkg.scripts["perf:all"]).toBe("pnpm perf && node scripts/perf-gate.mjs --all");
  });
});

describe("runScenes", () => {
  it("judges every scene even when one fails and one throws, and says the run failed", async () => {
    const lines: string[] = [];
    const failed = await runScenes(
      ["a", "b", "c", "d"],
      async (name: string) => {
        if (name === "b") throw new Error("locator.click: Timeout 30000ms exceeded");
        return { ok: name !== "c", metrics: { frames: 1 }, failures: name === "c" ? ["slow"] : [] };
      },
      (label: string, r: { ok: boolean; failures: string[] }) => lines.push(`${r.ok ? "pass" : "FAIL"} ${label} ${r.failures.join(";")}`),
    );
    expect(failed).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^pass a/);
    expect(lines[1]).toMatch(/^FAIL b .*the drive did not finish: locator\.click: Timeout/);
    expect(lines[2]).toMatch(/^FAIL c slow/);
    expect(lines[3]).toMatch(/^pass d/);
  });

  it("passes when every scene passes", async () => {
    const ok = { ok: true, metrics: {}, failures: [] };
    expect(await runScenes(["a", "b"], async () => ok, () => {})).toBe(false);
  });
});

describe("the gate reads each scene beside its still control", () => {
  const smooth = { frames: Array.from({ length: 60 }, () => 16.7), longTasks: [], loopsPerFrame: 1, idleFrameRequests: 0, idleLongTasks: [] };
  const clean = judge(smooth);
  const noisy = judge({ ...smooth, longTasks: [61] });
  const pass = verdict(judge(smooth), clean);
  const inconclusive = verdict(judge({ ...smooth, longTasks: [54] }), noisy);

  it("an inconclusive scene never exits green, and the summary counts each state", async () => {
    let summary = "";
    const failed = await runScenes(
      ["a", "b", "c"],
      async (name: string) => (name === "b" ? inconclusive : pass),
      () => {},
      (line: string) => {
        summary = line;
      },
    );
    expect(failed).toBe(true);
    expect(summary).toBe("2 passed, 0 failed, 1 inconclusive (the machine: re-run)");
  });

  it("shows each line with its headroom, and an inconclusive one with its reason", () => {
    expect(formatLine("stage", pass)).toMatch(/^pass {2}stage .*headroom/);
    const line = formatLine("chores", inconclusive);
    expect(line).toMatch(/^INCONCLUSIVE {2}chores/);
    expect(line).toMatch(/a 54 ms task is over the 50 ms budget/);
    expect(line).toMatch(/61 ms task.*the machine/);
  });

  it("writes a report with the budgets and, per scene, its state, metrics, headroom and control", async () => {
    const results: { name: string }[] = [];
    await runScenes(
      ["a", "b"],
      async (name: string) => (name === "b" ? inconclusive : pass),
      () => {},
      (_line: string, rs: { name: string }[]) => results.push(...rs),
    );
    const r = report(results);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.budgets).toEqual(BUDGETS);
    expect(r.scenes).toEqual([
      { name: "a", state: "pass", metrics: pass.metrics, headroom: pass.headroom, control: clean.metrics },
      { name: "b", state: "inconclusive", metrics: inconclusive.metrics, headroom: inconclusive.headroom, control: noisy.metrics },
    ]);
  });

  it("a drive that throws is a fail in the summary, never inconclusive", async () => {
    let summary = "";
    await runScenes(
      ["a"],
      async () => {
        throw new Error("gone");
      },
      () => {},
      (line: string) => {
        summary = line;
      },
    );
    expect(summary).toBe("0 passed, 1 failed, 0 inconclusive");
  });
});
