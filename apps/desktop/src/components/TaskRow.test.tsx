/**
 * @vitest-environment jsdom
 *
 * One delegated task on a line - fleet-surfaces, ADR 0141. The six statuses as a person reads them,
 * and Kill's two presses.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskView } from "@/lib/tasks";

import TaskRow, { KILL_ARM_MS, RESULT_HEAD_CHARS, appOf, elapsedOf, headOf, statusWordOf } from "./TaskRow";

const NOW = Date.parse("2026-10-24T12:10:00Z");

function task(over: Partial<TaskView> = {}): TaskView {
  return {
    id: "task_00000000000a",
    parent_conversation: "conv_000000000001",
    conversation_id: "conv_task_00000000000a",
    title: "Pay the October invoices",
    app_id: "shadowrunr",
    origin: "https://app.shadowrunr.test",
    status: "queued",
    tab_id: null,
    position: 2,
    result: null,
    error: null,
    created_at: "2026-10-24T12:00:00Z",
    started_at: null,
    finished_at: null,
    ...over,
  };
}

const html = (t: TaskView, onAsk: (() => void) | null = () => {}) =>
  renderToStaticMarkup(createElement(TaskRow, { task: t, now: NOW, onStop: () => {}, onAsk }));

describe("the six statuses", () => {
  it("queued: its place in line, the app's host, no time yet, and Kill and Ask", () => {
    const out = html(task());
    expect(out).toContain("status-dot--pending");
    expect(out).toContain("#2 in line");
    expect(out).toContain("app.shadowrunr.test");
    expect(out).toContain('aria-label="Kill Pay the October invoices"');
    expect(out).toContain('aria-label="Ask how Pay the October invoices is going"');
  });

  it("running: how long it has run, ticking with the caller's clock", () => {
    const out = html(task({ status: "running", position: null, started_at: "2026-10-24T12:07:00Z" }));
    expect(out).toContain("status-dot--info");
    expect(out).toContain(">running<");
    expect(out).toContain("app.shadowrunr.test · 3 min");
    expect(out).toContain(">Kill<");
  });

  it("done: when it ended and the first line of what it found, and no buttons", () => {
    const out = html(
      task({
        status: "done",
        position: null,
        started_at: "2026-10-24T12:01:00Z",
        finished_at: "2026-10-24T12:08:00Z",
        result: "Paid 4 invoices, 1 260 EUR in all.\nThe receipts are in the record.",
      }),
    );
    expect(out).toContain("status-dot--success");
    expect(out).toContain("2 min ago");
    expect(out).toContain("Paid 4 invoices, 1 260 EUR in all.");
    expect(out).not.toContain("The receipts are in the record.");
    expect(out).not.toContain("<button");
  });

  it("failed: the error's first line", () => {
    const out = html(task({ status: "failed", position: null, finished_at: "2026-10-24T12:09:50Z", error: "The app asked for a login." }));
    expect(out).toContain("status-dot--error");
    expect(out).toContain(">failed<");
    expect(out).toContain("just now");
    expect(out).toContain("The app asked for a login.");
  });

  it("killed: a word with no colour of its own, and nothing under it", () => {
    const out = html(task({ status: "killed", position: null, finished_at: "2026-10-24T12:05:00Z" }));
    expect(out).toContain("status-dot--neutral");
    expect(out).toContain(">killed<");
    expect(out).not.toContain("task-row__head");
  });

  it("interrupted: says why", () => {
    const out = html(task({ status: "interrupted", position: null, finished_at: "2026-10-24T12:05:00Z" }));
    expect(out).toContain("status-dot--warning");
    expect(out).toContain("Athena restarted while it ran.");
  });

  it("a task with no app says so, and Ask is left out when the caller gives none", () => {
    const out = html(task({ app_id: null, origin: null }), null);
    expect(out).toContain("no app");
    expect(out).not.toContain(">Ask<");
  });
});

describe("the words", () => {
  it("names a queued task without a place by the plain word", () => {
    expect(statusWordOf({ status: "queued", position: null })).toBe("in line");
  });

  it("names the app by its host, then its id", () => {
    expect(appOf({ origin: "https://mail.example.test:8443", app_id: "mail" })).toBe("mail.example.test:8443");
    expect(appOf({ origin: null, app_id: "mail" })).toBe("mail");
    expect(appOf({ origin: null, app_id: null })).toBeNull();
  });

  it("says a length of time in seconds, minutes and hours", () => {
    expect(elapsedOf(-5)).toBe("0 s");
    expect(elapsedOf(42_000)).toBe("42 s");
    expect(elapsedOf(3 * 60_000 + 59_000)).toBe("3 min");
    expect(elapsedOf(60 * 60_000)).toBe("1 h");
    expect(elapsedOf(64 * 60_000)).toBe("1 h 4 min");
  });

  it("cuts a long result to its head", () => {
    const head = headOf(task({ status: "done", result: "x".repeat(400) }))!;
    expect(head).toHaveLength(RESULT_HEAD_CHARS);
    expect(head.endsWith("…")).toBe(true);
    expect(headOf(task({ status: "done", result: "   " }))).toBeNull();
  });

  it("says why a task failed in words, without the runner's closed-vocabulary code before them", () => {
    // The runner stores `reason: detail` (`stores/task-runner.ts` failureOf); a person reads the detail.
    expect(headOf(task({ status: "failed", error: "no_page: the tab opened for shadowrunr never appeared" }))).toBe(
      "the tab opened for shadowrunr never appeared",
    );
    expect(headOf(task({ status: "failed", error: "budget_exhausted: the page answered 8 times" }))).toBe(
      "the page answered 8 times",
    );
    // An error with no code, as an orphaned task's, is said as it is; a done result is never trimmed.
    expect(headOf(task({ status: "failed", error: "her window closed while this task ran, so it stopped" }))).toBe(
      "her window closed while this task ran, so it stopped",
    );
    expect(headOf(task({ status: "done", result: "note: paid 3 invoices" }))).toBe("note: paid 3 invoices");
  });
});

describe("Kill takes two presses", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const kill = () => [...host.querySelectorAll("button")].find((b) => /Kill/.test(b.textContent ?? ""))!;

  it("arms on the first, kills on the second", () => {
    const onStop = vi.fn();
    act(() => root.render(createElement("ul", null, createElement(TaskRow, { task: task(), now: NOW, onStop, onAsk: null }))));
    act(() => kill().click());
    expect(onStop).not.toHaveBeenCalled();
    expect(kill().textContent).toBe("Kill?");
    expect(kill().getAttribute("aria-label")).toBe("Kill Pay the October invoices? Press again to kill it");
    act(() => kill().click());
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(kill().textContent).toBe("Kill");
  });

  it("disarms by itself after the arm time, so a late second press only arms again", () => {
    const onStop = vi.fn();
    act(() => root.render(createElement("ul", null, createElement(TaskRow, { task: task(), now: NOW, onStop, onAsk: null }))));
    act(() => kill().click());
    act(() => vi.advanceTimersByTime(KILL_ARM_MS));
    expect(kill().textContent).toBe("Kill");
    act(() => kill().click());
    expect(onStop).not.toHaveBeenCalled();
  });

  it("asks with one press", () => {
    const onAsk = vi.fn();
    act(() => root.render(createElement("ul", null, createElement(TaskRow, { task: task(), now: NOW, onStop: () => {}, onAsk }))));
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Ask")!.click());
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
