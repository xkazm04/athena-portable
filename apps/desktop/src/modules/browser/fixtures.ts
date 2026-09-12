/**
 * The Browser module's fixtures — four view-models, no store, no shell.
 *
 * `heavy` is twelve tabs because the tab rail's whole design question is what happens when the
 * chips stop fitting (it scrolls; it does not squeeze), and a fixture that never asks it would
 * let that regress silently. `degraded` is the shell not having answered — the one failure this
 * module has before a daemon exists.
 */
import type { BrowserActions, BrowserModel, BrowserTab } from "./model";

/** A fixture acts on nothing. Wiring an action to a store is the selector's job, never a
 *  fixture's — that is what makes a preview safe to click. */
const INERT: BrowserActions = {
  open: () => {},
  focus: () => {},
  close: () => {},
  navigate: () => {},
};

function tab(id: number, title: string, url: string, focused = false): BrowserTab {
  return { id, title, url, host: new URL(url).host, focused };
}

const TYPICAL: BrowserTab[] = [
  tab(1, "Invoices — March", "http://localhost:3004/invoices", true),
  tab(2, "Athena — the gate in one page", "https://example.test/docs/gate"),
  tab(3, "about:blank", "http://example.test/blank"),
];

const HEAVY: BrowserTab[] = Array.from({ length: 12 }, (_, i) =>
  tab(
    i + 1,
    i % 3 === 0
      ? `A title long enough that the chip has to elide it — number ${i + 1}`
      : `Tab ${i + 1}`,
    `https://host-${i + 1}.example.test/a/path/that/is/not/short?page=${i + 1}`,
    i === 4,
  ),
);

function model(tabs: BrowserTab[], problem: string | null = null): BrowserModel {
  return {
    tabs,
    focused: tabs.find((t) => t.focused) ?? null,
    problem,
    actions: INERT,
  };
}

export const fixtures: Record<string, BrowserModel> = {
  empty: model([]),
  typical: model(TYPICAL),
  heavy: model(HEAVY),
  degraded: model([], "the shell has not answered tabs_list yet"),
};

export const fixtureIds = ["empty", "typical", "heavy", "degraded"] as const;
