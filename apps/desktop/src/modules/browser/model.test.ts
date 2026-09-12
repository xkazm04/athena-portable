/**
 * The Browser module's selector — the store snapshot in, the view-model out.
 *
 * The selector is where every fact the surface shows is decided, so it is where they are
 * asserted: which tab is focused, what a tab with no title is called, and the difference between
 * "no tabs are open" and "nobody has answered yet" — a distinction the view renders two different
 * ways and the first build collapsed into one empty list.
 */
import { expect, test, vi } from "vitest";

import type { Tab } from "@/lib/ipc";

import { selectBrowser, type BrowserActions } from "./model";

const INERT: BrowserActions = { open: () => {}, focus: () => {}, close: () => {}, navigate: () => {} };

function tab(id: number, url: string, title = "", focused = false): Tab {
  return { id, label: `page-${id}`, url, title, focused };
}

test("the focused tab is the one Rust marked, and there is at most one", () => {
  const model = selectBrowser(
    [tab(1, "https://a.test/"), tab(2, "https://b.test/x", "B", true), tab(3, "https://c.test/")],
    true,
    INERT,
  );
  expect(model.tabs).toHaveLength(3);
  expect(model.focused?.id).toBe(2);
  expect(model.tabs.filter((t) => t.focused)).toHaveLength(1);
});

test("a tab with no title is called by its address, and every tab carries its host", () => {
  const model = selectBrowser([tab(1, "http://localhost:3004/invoices")], true, INERT);
  expect(model.tabs[0].title).toBe("http://localhost:3004/invoices");
  expect(model.tabs[0].host).toBe("localhost:3004");
});

test("no tabs is not the same fact as no answer", () => {
  const answered = selectBrowser([], true, INERT);
  expect(answered.focused).toBeNull();
  expect(answered.problem).toBeNull();

  const unanswered = selectBrowser([], false, INERT);
  expect(unanswered.problem).toBe("the shell has not answered tabs_list yet");
});

test("the actions are the view's only route out, and they are passed through untouched", () => {
  const actions: BrowserActions = {
    open: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    navigate: vi.fn(),
  };
  const model = selectBrowser([tab(1, "https://a.test/")], true, actions);
  model.actions.focus(1);
  model.actions.close(1);
  expect(actions.focus).toHaveBeenCalledWith(1);
  expect(actions.close).toHaveBeenCalledWith(1);
});
