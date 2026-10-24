/**
 * The task strip above her composer - fleet-surfaces, ADR 0141. Quiet when there is nothing, one
 * summary line that opens into the rows, and Ask through her composer's own entry point.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { classifyMidTurn } from "@/lib/midturn";
import type { TaskView } from "@/lib/tasks";
import { useRun } from "@/stores/run";
import { askAbout } from "@/stores/tasks";

import { TaskStripView, askHer } from "./tasks";

const NOW = Date.parse("2026-10-24T12:10:00Z");

function task(n: number, over: Partial<TaskView> = {}): TaskView {
  const hex = n.toString(16).padStart(12, "0");
  return {
    id: `task_${hex}`,
    parent_conversation: "conv_000000000001",
    conversation_id: `conv_task_${hex}`,
    title: `Task ${n}`,
    app_id: null,
    origin: null,
    status: "running",
    tab_id: null,
    position: null,
    result: null,
    error: null,
    created_at: "2026-10-24T12:00:00Z",
    started_at: "2026-10-24T12:05:00Z",
    finished_at: null,
    ...over,
  };
}

const strip = (over: Partial<Parameters<typeof TaskStripView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TaskStripView, {
      shown: [],
      problem: null,
      now: NOW,
      open: false,
      onToggle: () => {},
      onStop: () => {},
      onAsk: () => {},
      ...over,
    }),
  );

const SHOWN = [task(1), task(2), task(3), task(4, { status: "queued", position: 1, started_at: null })];

describe("the strip", () => {
  it("renders nothing when there is nothing to show", () => {
    expect(strip()).toBe("");
  });

  it("is one quiet line when the read failed and there is nothing to show", () => {
    const out = strip({ problem: "Could not read her tasks: the ledger is locked" });
    expect(out).toContain('role="status"');
    expect(out).toContain("Could not read her tasks: the ledger is locked");
    expect(out).not.toContain("<button");
  });

  it("closed: the summary and no rows", () => {
    const out = strip({ shown: SHOWN });
    expect(out).toContain("3 running · 1 in line");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("task-row");
  });

  it("open: a row per task, Ask on the active ones only", () => {
    const out = strip({ shown: [...SHOWN, task(5, { status: "done", finished_at: "2026-10-24T12:09:00Z", result: "Sent." })], open: true });
    expect(out).toContain('aria-expanded="true"');
    expect(out.match(/<li class="task-row"/g)).toHaveLength(5);
    expect(out.match(/>Ask</g)).toHaveLength(4);
    expect(out).toContain("#1 in line");
    expect(out).toContain("Sent.");
  });

  it("keeps a problem under the rows it already has", () => {
    const out = strip({ shown: SHOWN, problem: "Could not kill the task: the door would not close" });
    expect(out).toContain("3 running · 1 in line");
    expect(out).toContain("Could not kill the task: the door would not close");
  });

  it("says why the queue waits, under the summary, closed or open, while a task is in line (ADR 0143)", () => {
    const held = "Waiting for room: memory is 94% used; tasks start again under 85%.";
    for (const open of [false, true]) {
      const out = strip({ shown: SHOWN, held, open });
      expect(out).toContain(`<p class="aw-tasks__held">${held}</p>`);
    }
    // Nothing in line: the gate holds nothing a person is waiting on, so nothing is said.
    expect(strip({ shown: [task(1)], held })).not.toContain("aw-tasks__held");
    expect(strip({ shown: SHOWN, held: null })).not.toContain("aw-tasks__held");
  });
});

describe("Ask", () => {
  it("sends the question into her main thread through the composer's entry point", () => {
    const send = vi.fn(async () => {});
    useRun.setState({ send });
    askHer({ title: "Task 1" });
    expect(send).toHaveBeenCalledWith("How is Task 1 going?");
  });

  it("is read as a question to put in line, not as a correction, while a turn runs", () => {
    for (const title of ["Pay the October invoices", "Check the flights", "Cancel the old subscriptions"]) {
      expect(classifyMidTurn(askAbout({ title })), title).toBe("queue");
    }
  });
});
