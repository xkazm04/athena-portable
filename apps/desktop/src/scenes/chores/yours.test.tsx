// @vitest-environment jsdom
/**
 * "Your chores" on the catalogue — README section 3.5.
 *
 * With the daemon's deps, the catalogue asks for every saved case once (`cases('')`) and each case's
 * open review, and draws a band above the area tabs: the chore's name opens its page, "Open your
 * case" opens the case in the studio, the daemon's cut is printed under the rows. A `Yours` toggle
 * narrows the ledger to the chores with a case, and is remembered across a move. Without deps the
 * catalogue is exactly as it was; a daemon that is not running is one line and the ledger stands.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import { ApiError } from "@/lib/api";
import type { AdoptEvent, CaseSummary, CasesReply, DueReview, RunsReply, StartReply } from "@/lib/adopt";
import type { AdoptClient } from "@/lib/adopt-client";
import type { ChoresClient } from "@/lib/chores-client";

import type { AdoptDeps } from "./adopt/deps";
import { ADOPT_PLAYBOOK } from "./adopt/fixtures";
import { fixtures } from "./fixtures";
import { forgetChores } from "./memory";
import { casePath, chorePath } from "./model";
import ChoresView from "./view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OTHER = "baggage-delay-claims";
const model = () => fixtures.shipped!;
const titleOf = (id: string) => model().items.find((v) => v.id === id)!.playbook.shortTitle;

const CREDITS: CaseSummary = {
  case_id: "proj_aaaaaaaaaaaa",
  playbook_id: ADOPT_PLAYBOOK,
  title: "Airline credits, my 2026 trips",
  approved_rev: 2,
  approved_at: "2026-10-08T17:42:00+00:00",
  created: "2026-10-01T09:00:00+00:00",
  confirmed: 7,
  slots: 9,
};
const BAGS: CaseSummary = {
  case_id: "proj_bbbbbbbbbbbb",
  playbook_id: OTHER,
  title: "The lost suitcase in Lisbon",
  approved_rev: 1,
  approved_at: "2026-10-12T08:00:00+00:00",
  created: "2026-10-12T08:00:00+00:00",
  confirmed: 4,
  slots: 6,
};

class FakeClient implements AdoptClient {
  asked: string[] = [];
  constructor(private readonly listing: () => Promise<CasesReply>) {}
  cases(playbookId: string) {
    this.asked.push(playbookId);
    return this.listing();
  }
  runs(caseId: string): Promise<RunsReply> {
    return Promise.resolve({
      ok: true,
      case_id: caseId,
      open: null,
      receipts: [],
      showing: 0,
      total: 0,
      footer: "",
    });
  }
  start(): Promise<StartReply> {
    return Promise.resolve({
      ok: true,
      session_id: "s1",
      slots: [],
      case: null,
    });
  }
  // eslint-disable-next-line require-yield
  async *events(_sid: string, _after: number, signal: AbortSignal): AsyncGenerator<AdoptEvent> {
    await new Promise<void>((r) => signal.addEventListener("abort", () => r()));
  }
  answer() {
    return Promise.resolve();
  }
  document() {
    return Promise.resolve("d");
  }
  enough() {
    return Promise.resolve();
  }
  approve(_sid: string, rev: number) {
    return Promise.resolve({ rev, case_id: "", case_problem: "" });
  }
  close() {
    return Promise.resolve();
  }
}

/** A chores client whose only answer that matters is the open review of `due` (when given). */
function choresOf(due?: { caseId: string; at: string }): ChoresClient & { reviewed: string[] } {
  const reviewed: string[] = [];
  const never = () => Promise.reject(new ApiError(500, "unknown", "not in this test"));
  return {
    reviewed,
    cadence: never,
    setCadence: never,
    answer: never,
    due: never,
    review: (caseId: string): Promise<DueReview | null> => {
      reviewed.push(caseId);
      if (!due || due.caseId !== caseId) return Promise.resolve(null);
      return Promise.resolve({
        case_id: caseId,
        playbook_id: ADOPT_PLAYBOOK,
        title: "",
        command: "",
        enabled: true,
        rule_text: "",
        timezone: "",
        next_run_at: "",
        review: {
          due_at: due.at,
          opened_at: due.at,
          missed: 0,
          missed_at: [],
          delivered_at: "",
          held_at: "",
          answer: "",
          answered_at: "",
          first_turn_id: "",
        },
        unanswered: 0,
        ask_slow: false,
        last_run_at: "",
        lines: [],
        lines_total: 0,
        lines_footer: "",
        portals: [],
      });
    },
  };
}

const found =
  (cases: CaseSummary[], footer = ""): (() => Promise<CasesReply>) =>
  () =>
    Promise.resolve({
      ok: true,
      cases,
      showing: cases.length,
      total: cases.length,
      footer,
    });

let host: HTMLDivElement;
let root: Root;
let go: ReturnType<typeof vi.fn<(to: Path) => void>>;

async function show(path: Path, adopt?: AdoptDeps) {
  await act(async () => {
    root.render(<ChoresView model={model()} path={path} go={go} adopt={adopt} />);
  });
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

/** A move as the app makes it: the stage mounts a fresh view. */
async function move(path: Path, adopt?: AdoptDeps) {
  act(() => root.unmount());
  root = createRoot(host);
  await show(path, adopt);
}

const text = () => host.textContent ?? "";
const band = () => host.querySelector<HTMLElement>(".pa-yours");
const bandRows = () => [...host.querySelectorAll<HTMLElement>(".pa-yours__row")];
const ledgerRows = () => [...host.querySelectorAll<HTMLElement>(".pa-ledger tbody tr[aria-selected]")];
const toggle = () => host.querySelector<HTMLButtonElement>(".pa-yours-toggle");
const click = (el: Element | null | undefined) => {
  expect(el, "the element to click").toBeTruthy();
  act(() => {
    el!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const within = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

beforeEach(() => {
  forgetChores();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  go = vi.fn<(to: Path) => void>();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Your chores, on the catalogue", () => {
  it("case 3: a band above the area tabs lists every saved case, asked for once with no playbook", async () => {
    const client = new FakeClient(found([CREDITS, BAGS]));
    await show({ root: "chores" }, { client, dictation: null });
    expect(client.asked).toEqual([""]);
    expect(band()).not.toBeNull();
    expect(band()!.textContent).toContain("Your chores");
    const tabs = host.querySelector(".pa-tabs")!;
    expect(band()!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bandRows()).toHaveLength(2);
    expect(bandRows()[0]!.textContent).toContain("The lost suitcase in Lisbon");
    expect(bandRows()[0]!.textContent).toContain(titleOf(OTHER));
    expect(bandRows()[1]!.textContent).toContain("Airline credits, my 2026 trips");
    expect(bandRows()[1]!.textContent).toContain("Last approved 2026-10-08");
  });

  it("case 1 (drawn): the case whose review is open comes first and says it is due", async () => {
    const chores = choresOf({
      caseId: CREDITS.case_id,
      at: "2026-10-24T12:00:00+00:00",
    });
    await show(
      { root: "chores" },
      {
        client: new FakeClient(found([BAGS, CREDITS])),
        chores,
        dictation: null,
      },
    );
    expect(chores.reviewed.sort()).toEqual([BAGS.case_id, CREDITS.case_id].sort());
    expect(bandRows()[0]!.textContent).toContain("Due 2026-10-24");
  });

  it("case 4: Open your case opens the case; the chore's name opens its page and is picked on the way back", async () => {
    await show({ root: "chores" }, { client: new FakeClient(found([CREDITS, BAGS])), dictation: null });
    const credits = bandRows()[1]!;
    click(within(credits, "Open your case"));
    expect(go).toHaveBeenLastCalledWith(casePath(ADOPT_PLAYBOOK, CREDITS.case_id));
    click(within(credits, titleOf(ADOPT_PLAYBOOK)));
    expect(go).toHaveBeenLastCalledWith(chorePath(ADOPT_PLAYBOOK));
    await move({ root: "chores" }, { client: new FakeClient(found([CREDITS, BAGS])), dictation: null });
    const picked = host.querySelector('.pa-ledger tr[aria-selected="true"]');
    expect(picked?.textContent).toContain(titleOf(ADOPT_PLAYBOOK));
  });

  it("case 5: Yours narrows the ledger to the chores with a case, and survives a move to a topic and back", async () => {
    const deps: AdoptDeps = {
      client: new FakeClient(found([CREDITS, BAGS])),
      dictation: null,
    };
    await show({ root: "chores" }, deps);
    const all = ledgerRows().length;
    expect(all).toBeGreaterThan(2);
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
    click(toggle());
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(ledgerRows()).toHaveLength(2);
    expect(host.querySelector(".pa-shown")!.textContent).toContain("2 playbooks you have a case for");
    await move(chorePath(ADOPT_PLAYBOOK), deps);
    await move({ root: "chores" }, deps);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(ledgerRows()).toHaveLength(2);
    click(toggle());
    expect(ledgerRows()).toHaveLength(all);
  });

  it("case 6: the daemon's cut is printed under the band's rows", async () => {
    await show(
      { root: "chores" },
      {
        client: new FakeClient(found([CREDITS, BAGS], "(showing 20 of 23)")),
        dictation: null,
      },
    );
    expect(band()!.textContent).toContain("(showing 20 of 23)");
  });

  it("case 7 (guard): with no deps there is no band, no toggle and the ledger as it was", async () => {
    await show({ root: "chores" });
    expect(band()).toBeNull();
    expect(toggle()).toBeNull();
    expect(text()).not.toContain("Your chores");
    expect(ledgerRows()).toHaveLength(model().items.length);
    expect(host.querySelector(".pa-shown")!.textContent).toBe(`${model().items.length} playbooks in all areas`);
  });

  it("case 7: a daemon that is not running is one line, and the ledger is unaffected", async () => {
    const offline = new FakeClient(() => Promise.reject(new ApiError(0, "offline", "The daemon is not running.")));
    await show({ root: "chores" }, { client: offline, dictation: null });
    expect(band()!.textContent).toContain("Your chores could not be looked up: the daemon is not running.");
    expect(bandRows()).toHaveLength(0);
    expect(toggle()).toBeNull();
    expect(ledgerRows()).toHaveLength(model().items.length);
  });
});
