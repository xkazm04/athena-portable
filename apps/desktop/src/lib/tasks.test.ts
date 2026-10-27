/**
 * The task contract's TS mirror against the daemon's own - ADR 0141 (`src/athena/daemon/tasks.py`).
 *
 * lib/tasks.ts restates the daemon's caps and its six statuses by hand, and both windows draw a
 * word for each status (`components/TaskRow.tsx` TASK_WORDS). The Python is the truth: this reads
 * it, so a cap moved or a status added on the daemon fails here instead of drawing a row with no
 * word, or a strip that counts a queue the daemon no longer keeps.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TASK_WORDS } from "@/components/TaskRow";

import { TASKS_QUEUED_CAP, TASKS_RUNNING_CAP, isActive, type TaskStatus } from "./tasks";

// A checkout may hold the file with CRLF endings: `$` is read against a bare newline.
const PY = readFileSync(resolve(__dirname, "../../../../src/athena/daemon/tasks.py"), "utf8").replaceAll("\r\n", "\n");

/** `NAME = 3` at the module's top level. */
const intOf = (name: string) => Number(new RegExp(String.raw`^${name} = (\d+)$`, "m").exec(PY)?.[1]);
/** The quoted names of a top-level `NAME: tuple[str, ...] = ("a", "b")`. */
const namesOf = (name: string) => [
  ...(new RegExp(String.raw`^${name}: tuple\[str, \.\.\.\] = \(([^)]*)\)`, "m").exec(PY)?.[1] ?? "").matchAll(/"([a-z_]+)"/g),
].map((m) => m[1]);

describe("the task contract, as the daemon states it", () => {
  it("holds the daemon's caps: 3 running, 10 queued", () => {
    expect(intOf("TASKS_RUNNING_CAP")).toBe(TASKS_RUNNING_CAP);
    expect(intOf("TASKS_QUEUED_CAP")).toBe(TASKS_QUEUED_CAP);
  });

  it("draws a word for every status the daemon writes, and none it does not", () => {
    const statuses = namesOf("TASK_STATUSES");
    expect(statuses.length).toBeGreaterThan(0);
    expect(Object.keys(TASK_WORDS).sort()).toEqual([...statuses].sort());
  });

  it("counts as active exactly the statuses the daemon holds a place for", () => {
    const active = namesOf("ACTIVE");
    expect(active.length).toBeGreaterThan(0);
    const all = Object.keys(TASK_WORDS) as TaskStatus[];
    expect(all.filter((status) => isActive({ status })).sort()).toEqual([...active].sort());
  });
});
