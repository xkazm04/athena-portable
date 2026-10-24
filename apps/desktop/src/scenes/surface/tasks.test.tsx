/** Her tasks under the bell on Main - fleet-surfaces, ADR 0141. Nothing when empty, at most four rows. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TaskView } from "@/lib/tasks";

import { SURFACE_ROWS, SurfaceTasks, SurfaceTasksView } from "./tasks";

const NOW = Date.parse("2026-10-24T12:10:00Z");

function task(n: number, over: Partial<TaskView> = {}): TaskView {
  const hex = n.toString(16).padStart(12, "0");
  return {
    id: `task_${hex}`,
    parent_conversation: "conv_000000000001",
    conversation_id: `conv_task_${hex}`,
    title: `Task ${n}`,
    app_id: "mail",
    origin: null,
    status: "queued",
    tab_id: null,
    position: n,
    result: null,
    error: null,
    created_at: "2026-10-24T12:00:00Z",
    started_at: null,
    finished_at: null,
    ...over,
  };
}

const view = (over: Partial<Parameters<typeof SurfaceTasksView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SurfaceTasksView, {
      shown: [],
      problem: null,
      now: NOW,
      all: false,
      onMore: () => {},
      onStop: () => {},
      onAsk: () => {},
      ...over,
    }),
  );

const SIX = [1, 2, 3, 4, 5, 6].map((n) => task(n));

describe("the tasks under the bell", () => {
  it("renders nothing when there is nothing to show, and nothing before the store has read", () => {
    expect(view()).toBe("");
    expect(renderToStaticMarkup(createElement(SurfaceTasks))).toBe("");
  });

  it("is one quiet line when the read failed", () => {
    const out = view({ problem: "Could not read her tasks: refused" });
    expect(out).toContain('role="status"');
    expect(out).toContain("Could not read her tasks: refused");
  });

  it("shows at most four rows, and says how many more", () => {
    const out = view({ shown: SIX });
    expect(SURFACE_ROWS).toBe(4);
    expect(out.match(/<li class="task-row"/g)).toHaveLength(4);
    expect(out).toContain("6 in line");
    expect(out).toContain(">2 more<");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Task 5");
  });

  it("opens to all of them, and offers to fold back", () => {
    const out = view({ shown: SIX, all: true });
    expect(out.match(/<li class="task-row"/g)).toHaveLength(6);
    expect(out).toContain(">Fewer<");
  });

  it("has no more-button when the rows fit", () => {
    const out = view({ shown: SIX.slice(0, 4) });
    expect(out).not.toContain("surface-tasks__more");
  });

  it("speaks the strip's language: title, app, status and place, Kill and Ask", () => {
    const out = view({ shown: [task(1, { status: "running", position: null, started_at: "2026-10-24T12:08:00Z" }), task(2, { position: 1 })] });
    expect(out).toContain("Task 1");
    expect(out).toContain("mail · 2 min");
    expect(out).toContain(">running<");
    expect(out).toContain("#1 in line");
    expect(out).toContain('aria-label="Kill Task 2"');
    expect(out).toContain('aria-label="Ask how Task 1 is going"');
  });
});
