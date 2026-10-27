// @vitest-environment jsdom
/**
 * Ask on Main's task card (ADR 0141): when her window does not come forward the card says so, and
 * that sentence goes as soon as the card has something newer to say - the list moved on, or the
 * mirror has a problem of its own - instead of standing until the next Ask.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskView } from "@/lib/tasks";
import { resetTasksForTests, setTasksDeps, useTasks } from "@/stores/tasks";

const athenaOffer = vi.fn<(text: string) => Promise<void>>();
vi.mock("@/lib/companion", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  athenaOffer: (t: string) => athenaOffer(t),
}));

const { SurfaceTasks } = await import("./tasks");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-24T12:10:00Z");

function task(status: TaskView["status"], over: Partial<TaskView> = {}): TaskView {
  return {
    id: "task_00000000000a",
    parent_conversation: "conv_000000000001",
    conversation_id: "conv_task_00000000000a",
    title: "Pay the invoices",
    app_id: "mail",
    origin: null,
    status,
    tab_id: null,
    position: null,
    result: null,
    error: null,
    created_at: "2026-10-24T12:00:00Z",
    started_at: "2026-10-24T12:01:00Z",
    finished_at: status === "running" ? null : "2026-10-24T12:09:00Z",
    ...over,
  };
}

const REFUSED = "Her window did not come forward";
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setTasksDeps({ api: () => null, now: () => NOW });
  useTasks.setState({ tasks: [task("running")], held: null, problem: null });
  athenaOffer.mockReset().mockRejectedValue(new Error("no window"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetTasksForTests();
});

async function askFails() {
  act(() => root.render(<SurfaceTasks />));
  const ask = [...host.querySelectorAll("button")].find((b) => b.textContent === "Ask");
  await act(async () => ask!.click());
  expect(host.textContent).toContain(REFUSED);
}

describe("a failed Ask on Main's task card", () => {
  it("is let go once the list moves on", async () => {
    await askFails();
    act(() => useTasks.setState({ tasks: [task("done", { result: "Paid." })] }));
    expect(host.textContent).not.toContain(REFUSED);
  });

  it("gives way to the mirror's own problem instead of hiding it", async () => {
    await askFails();
    act(() => useTasks.setState({ problem: "Could not read her tasks: the ledger is locked" }));
    expect(host.textContent).not.toContain(REFUSED);
    expect(host.textContent).toContain("Could not read her tasks: the ledger is locked");
  });
});
