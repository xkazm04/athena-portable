// @vitest-environment jsdom
/**
 * "Your case" on a chore's topic page, and the studio opened on it — ADR 0123.
 *
 * The page asks the studio's client for the chore's saved cases and says every answer: no daemon in
 * this window, looking, none yet, the daemon not running, a refusal, one case (opened by "Open your
 * case" beside "Talk it through with her"), two cases (each its own "Open this case"). The studio
 * opened at `chores/<id>/case/<proj>` starts its session with that case id and says whose case it is.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import { ApiError } from "@/lib/api";
import type { AdoptEvent, CaseSummary, CasesReply, Receipt, RunsReply, StartReply } from "@/lib/adopt";
import type { AdoptClient } from "@/lib/adopt-client";
import { fixtures as moduleFixtures } from "@/modules/playbooks/fixtures";

import type { AdoptDeps } from "./adopt/deps";
import { ADOPT_PLAYBOOK, PREVIEW_RECEIPT } from "./adopt/fixtures";
import { fixtures } from "./fixtures";
import { forgetChores } from "./memory";
import { adoptPath, casePath, chorePath } from "./model";
import ChoresView from "./view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CASE: CaseSummary = {
  case_id: "proj_0123456789ab",
  playbook_id: ADOPT_PLAYBOOK,
  title: "Airline credits, my 2026 trips",
  approved_rev: 2,
  approved_at: "2026-10-08T17:42:00+00:00",
  created: "2026-10-01T09:00:00+00:00",
  confirmed: 7,
  slots: 9,
  space_id: "",
};

class FakeClient implements AdoptClient {
  starts: { playbookId: string; caseId: string | undefined }[] = [];
  asked: string[] = [];
  ran: string[] = [];
  constructor(
    private readonly listing: () => Promise<CasesReply>,
    private readonly running: (caseId: string) => Promise<RunsReply> = (caseId) => runsOf(caseId, null, []),
  ) {}
  runs(caseId: string) {
    this.ran.push(caseId);
    return this.running(caseId);
  }
  start(playbookId: string, _intro?: string, caseId?: string): Promise<StartReply> {
    this.starts.push({ playbookId, caseId });
    return Promise.resolve({ ok: true, session_id: "s1", slots: [], case: caseId ? CASE : null });
  }
  cases(playbookId: string) {
    this.asked.push(playbookId);
    return this.listing();
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
    return Promise.resolve({ rev, case_id: CASE.case_id, case_problem: "" });
  }
  close() {
    return Promise.resolve();
  }
}

const runsOf = (caseId: string, open: Receipt | null, receipts: Receipt[], footer = ""): Promise<RunsReply> =>
  Promise.resolve({
    ok: true,
    case_id: caseId,
    open,
    receipts,
    showing: receipts.length,
    total: receipts.length,
    footer,
  });

const found = (cases: CaseSummary[], footer = ""): (() => Promise<CasesReply>) =>
  () => Promise.resolve({ ok: true, cases, showing: cases.length, total: cases.length, footer });

let host: HTMLDivElement;
let root: Root;
let go: ReturnType<typeof vi.fn<(to: Path) => void>>;

const model = () => fixtures.shipped!;
const deps = (client: AdoptClient): AdoptDeps => ({ client, dictation: null });

async function show(path: Path, adopt?: AdoptDeps) {
  await act(async () => {
    root.render(<ChoresView model={model()} path={path} go={go} adopt={adopt} />);
  });
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

const text = () => host.textContent ?? "";
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
const press = (label: string) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.trim() === label);
  expect(b, label).toBeDefined();
  act(() => b!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

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

describe("Your case, on the topic page", () => {
  it("names the saved case and opens it beside Talk it through with her", async () => {
    const client = new FakeClient(found([CASE]));
    await show(chorePath(ADOPT_PLAYBOOK), deps(client));
    expect(client.asked).toEqual([ADOPT_PLAYBOOK]);
    expect(text()).toContain("Your case");
    expect(text()).toContain("Airline credits, my 2026 trips");
    expect(text()).toContain("Last approved 2026-10-08 · draft 2 · 7 of 9 confirmed");
    const row = buttons();
    expect(row.indexOf("Open your case")).toBeGreaterThanOrEqual(0);
    expect(row.indexOf("Open your case") + 1).toBe(row.indexOf("Talk it through with her"));
    expect(row).not.toContain("Open this case");
    press("Open your case");
    expect(go).toHaveBeenLastCalledWith(casePath(ADOPT_PLAYBOOK, CASE.case_id));
    press("Talk it through with her");
    expect(go).toHaveBeenLastCalledWith(adoptPath(ADOPT_PLAYBOOK));
  });

  it("keeps two cases of one chore apart, each with its own Open", async () => {
    const other = { ...CASE, case_id: "proj_ffffffffffff", title: "Airline credits, the 2025 trips", approved_at: "2026-09-01T00:00:00+00:00" };
    await show(chorePath(ADOPT_PLAYBOOK), deps(new FakeClient(found([CASE, other], "(showing 2 of 3)"))));
    expect(buttons().filter((b) => b === "Open this case")).toHaveLength(2);
    expect(text()).toContain("(showing 2 of 3)");
    press("Open your case");
    expect(go).toHaveBeenLastCalledWith(casePath(ADOPT_PLAYBOOK, CASE.case_id));
    const opens = [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Open this case");
    act(() => opens[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(go).toHaveBeenLastCalledWith(casePath(ADOPT_PLAYBOOK, other.case_id));
  });

  it("says when none is saved yet, and offers only the conversation", async () => {
    await show(chorePath(ADOPT_PLAYBOOK), deps(new FakeClient(found([]))));
    expect(text()).toContain("No saved case yet.");
    expect(buttons()).not.toContain("Open your case");
    expect(buttons()).toContain("Talk it through with her");
  });

  it("says there is no daemon, and that it is not running, and a refusal in its own words", async () => {
    await show(chorePath(ADOPT_PLAYBOOK));
    expect(text()).toContain("no daemon is connected to this window");
    act(() => root.unmount());
    root = createRoot(host);
    const offline = new FakeClient(() => Promise.reject(new ApiError(0, "offline", "The daemon is not running.")));
    await show(chorePath(ADOPT_PLAYBOOK), deps(offline));
    expect(text()).toContain("Your saved case could not be looked up: the daemon is not running.");
    act(() => root.unmount());
    root = createRoot(host);
    const refused = new FakeClient(() => Promise.reject(new ApiError(503, "engine_error", "no brain is wired")));
    await show(chorePath(ADOPT_PLAYBOOK), deps(refused));
    expect(text()).toContain("Your saved case could not be looked up: no brain is wired");
    expect(buttons()).not.toContain("Open your case");
  });

  it("case 7 (guard): says it is looking while the answer is on its way, on a first ever visit", async () => {
    await show(chorePath(ADOPT_PLAYBOOK), deps(new FakeClient(() => new Promise(() => {}))));
    expect(text()).toContain("Looking for a case you saved…");
  });
});

describe("Your runs, under the case", () => {
  it("says there is no run yet rather than a row of zeros", async () => {
    const client = new FakeClient(found([CASE]));
    await show(chorePath(ADOPT_PLAYBOOK), deps(client));
    expect(client.ran).toEqual([CASE.case_id]);
    expect(text()).toContain("Your runs");
    expect(text()).toContain("No run yet. Start it for real with her");
    expect(text()).not.toMatch(/\b0 approved\b|\$0\.00/);
  });

  it("lists each receipt and says where every number comes from", async () => {
    const receipt = { ...PREVIEW_RECEIPT, case_id: CASE.case_id };
    const open: Receipt = {
      ...PREVIEW_RECEIPT,
      case_id: CASE.case_id,
      since: receipt.until,
      until: "",
      first_at: "2026-10-10T08:00:00+00:00",
      last_at: "2026-10-10T08:05:00+00:00",
      approved: 0,
      consumed: 0,
      declined: 0,
      pending: 1,
      asked_usd: null,
      asked_cards: 0,
      calls: 2,
      errors: 0,
      unpriced: 1,
      cards: [],
      cards_total: 1,
      notes: [{ episode_id: "ep_00000001", at: "2026-10-10T08:04:00+00:00", text: "host.x.pay may have completed <i>x</i>" }],
      notes_total: 1,
      closed_by: "",
      closed_at: "",
    };
    const client = new FakeClient(found([CASE]), (id) => runsOf(id, open, [receipt], "(showing 1 of 4)"));
    await show(chorePath(ADOPT_PLAYBOOK), deps(client));
    const t = text();
    expect(t).toContain("Running now, since 2026-10-10 08:00–08:05 UTC");
    expect(t).toContain("1 still waiting: of the 1 card filed in this run, from the approval table.");
    expect(t).toContain("1 call may have completed");
    expect(t).toContain("(1 row unpriced, so at least this)");
    expect(t).toContain("Run closed 2026-10-09 · active 09:02–10:14 UTC");
    expect(t).toContain("2 approved (2 let through by the gate), 1 declined: of the 3 cards filed in this run, from the approval table.");
    expect(t).toContain("$712.40 asked, from 2 cards you approved (each card's own amount).");
    expect(t).toContain("Spent: $0.41 and 6.3 min, over 9 ledger rows, 1 of them failed or refused.");
    // The receipts never call money "recovered" (the author's basis, one click away, may).
    const receipts = [...host.querySelectorAll(".pa-run")].map((r) => r.textContent ?? "").join(" ");
    expect(receipts).toContain("$712.40 asked");
    expect(receipts).not.toContain("recovered");
    expect(t).toContain("(showing 1 of 4)");
    // The page's parameters are text in a fence, never markup.
    expect(host.querySelector(".pa-run__params b")).toBeNull();
    expect(host.querySelector(".pa-run__params i")).toBeNull();
    expect(t).toContain("reason: <b>cancelled by the airline</b>");
    expect(t).toContain("(and 1 more parameter)");
  });

  it("says when the runs could not be looked up", async () => {
    const offline = new FakeClient(found([CASE]), () => Promise.reject(new ApiError(0, "offline", "down")));
    await show(chorePath(ADOPT_PLAYBOOK), deps(offline));
    expect(text()).toContain("Your runs could not be looked up: the daemon is not running.");
  });
});

/** Render `path` once, synchronously: what the first frame after a move draws, before any answer lands. */
const firstFrame = (path: Path, adopt?: AdoptDeps) => {
  act(() => {
    root.render(<ChoresView model={model()} path={path} go={go} adopt={adopt} />);
  });
};

/** Settle what is on its way. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

describe("warm across a move (ADR 0159)", () => {
  it("case 2: back from the studio, the first frame names the case and offers Open your case, and asks again", async () => {
    const client = new FakeClient(found([CASE]));
    const d = deps(client);
    await show(chorePath(ADOPT_PLAYBOOK), d);
    await show(adoptPath(ADOPT_PLAYBOOK), d);
    firstFrame(chorePath(ADOPT_PLAYBOOK), d);
    expect(text()).toContain("Airline credits, my 2026 trips");
    expect(buttons()).toContain("Open your case");
    expect(text()).not.toContain("Looking for a case you saved");
    expect(client.asked).toEqual([ADOPT_PLAYBOOK, ADOPT_PLAYBOOK]);
    await settle();
  });

  it("case 3: back from the studio, Your runs draws its receipt at once and asks once more", async () => {
    const receipt = { ...PREVIEW_RECEIPT, case_id: CASE.case_id };
    const client = new FakeClient(found([CASE]), (id) => runsOf(id, null, [receipt]));
    const d = deps(client);
    await show(chorePath(ADOPT_PLAYBOOK), d);
    expect(client.ran).toEqual([CASE.case_id]);
    await show(adoptPath(ADOPT_PLAYBOOK), d);
    firstFrame(chorePath(ADOPT_PLAYBOOK), d);
    expect(text()).toContain("Run closed 2026-10-09");
    expect(text()).not.toContain("Looking for your runs");
    expect(client.ran).toEqual([CASE.case_id, CASE.case_id]);
    await settle();
    expect(client.ran).toEqual([CASE.case_id, CASE.case_id]);
  });

  it("case 4: a refresh that fails keeps the case drawn and says it could not be refreshed", async () => {
    let up = true;
    const client = new FakeClient(() =>
      up
        ? found([CASE])()
        : Promise.reject(new ApiError(0, "offline", "The daemon is not running.")),
    );
    const d = deps(client);
    await show(chorePath(ADOPT_PLAYBOOK), d);
    await show(adoptPath(ADOPT_PLAYBOOK), d);
    up = false;
    await show(chorePath(ADOPT_PLAYBOOK), d);
    expect(text()).toContain("Airline credits, my 2026 trips");
    expect(buttons()).toContain("Open your case");
    expect(text()).toContain("Your saved case could not be refreshed: the daemon is not running.");
    expect(text()).not.toContain("could not be looked up");
  });

  it("case 5: a refresh that brings a newer approval replaces the draft with no Looking in between", async () => {
    let rev = 2;
    const client = new FakeClient(() => found([{ ...CASE, approved_rev: rev }])());
    const d = deps(client);
    await show(chorePath(ADOPT_PLAYBOOK), d);
    await show(adoptPath(ADOPT_PLAYBOOK), d);
    rev = 3;
    firstFrame(chorePath(ADOPT_PLAYBOOK), d);
    expect(text()).toContain("draft 2");
    expect(text()).not.toContain("Looking for a case you saved");
    await settle();
    expect(text()).toContain("draft 3");
    expect(text()).not.toContain("draft 2");
    expect(text()).not.toContain("Looking for a case you saved");
  });

  it("case 6 (guard): forgetChores clears the reads, so the next mount starts cold", async () => {
    const client = new FakeClient(found([CASE]));
    const d = deps(client);
    await show(chorePath(ADOPT_PLAYBOOK), d);
    act(() => root.unmount());
    root = createRoot(host);
    forgetChores();
    firstFrame(chorePath(ADOPT_PLAYBOOK), d);
    expect(text()).toContain("Looking for a case you saved…");
    await settle();
  });

  it("rising to the catalogue draws Your chores at once, and asks again behind it", async () => {
    const client = new FakeClient(found([CASE]));
    const d = deps(client);
    await show({ root: "chores" }, d);
    expect(client.asked).toEqual([""]);
    await show(chorePath(ADOPT_PLAYBOOK), d);
    firstFrame({ root: "chores" }, d);
    expect(host.querySelectorAll(".pa-yours__row")).toHaveLength(1);
    expect(text()).not.toContain("Looking for the cases you saved");
    expect(client.asked).toEqual(["", ADOPT_PLAYBOOK, ""]);
    await settle();
  });
});

describe("the studio, opened on a case", () => {
  it("starts its session with the case id and says whose case it is", async () => {
    const client = new FakeClient(found([CASE]));
    await show(casePath(ADOPT_PLAYBOOK, CASE.case_id), deps(client));
    expect(client.starts).toEqual([{ playbookId: ADOPT_PLAYBOOK, caseId: CASE.case_id }]);
    expect(text()).toContain("Your case, as you approved it on 2026-10-08 (draft 2).");
  });

  it("starts a fresh conversation, with no case id, from Make it yours", async () => {
    const client = new FakeClient(found([]));
    await show(adoptPath(ADOPT_PLAYBOOK), deps(client));
    expect(client.starts).toEqual([{ playbookId: ADOPT_PLAYBOOK, caseId: undefined }]);
    expect(text()).not.toContain("Your case, as you approved it");
  });
});

describe("the runs behind the verdict (ADR 0128)", () => {
  it("case 8: the open-short topic page opens the verdict on its counted run and the lines left out, each with why", async () => {
    await act(async () => {
      root.render(<ChoresView model={moduleFixtures["open-short"]!} path={chorePath("chargeback-evidence")} go={go} />);
    });
    const details = host.querySelector<HTMLDetailsElement>("details.pa-behind");
    expect(details, "a disclosure under the verdict").not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.previousElementSibling?.classList.contains("pa-verdict")).toBe(true);
    expect(details!.querySelector("summary")?.textContent).toContain("The runs behind it");
    const counted = [...details!.querySelectorAll(".pa-behind__list--counted > li")];
    const left = [...details!.querySelectorAll(".pa-behind__list--left > li")];
    expect(counted).toHaveLength(1);
    expect(counted[0]!.textContent).toContain("Latest");
    expect(left).toHaveLength(2);
    for (const li of left) expect(li.textContent).toContain("benched before runs were keyed");
    // An earlier line that never measured traps says so with a dash, not a zero.
    expect(left.some((li) => li.textContent?.includes("traps –"))).toBe(true);
  });
});

describe("a case's Project (ADR 0225)", () => {
  const space = (id: string, name: string, hue: number) => ({
    id,
    name,
    brief: "",
    apps: [],
    hue,
    created: "",
    updated: "",
    counts: { episodes: 0, facts: 0, procedurals: 0, chores: 0 },
  });
  const TRAVEL = space("spc_0123456789ab", "Travel", 30);
  const TAXES = space("spc_ba9876543210", "Taxes", 200);

  async function showWith(cases: () => CaseSummary[], link = vi.fn(async () => {})) {
    const client = new FakeClient(() => found(cases())());
    await act(async () => {
      root.render(
        <ChoresView
          model={model()}
          path={chorePath(ADOPT_PLAYBOOK)}
          go={go}
          adopt={deps(client)}
          spaces={{ list: [TRAVEL, TAXES], link }}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    return { client, link };
  }

  it("shows the linked case's chip, which opens its Project", async () => {
    await showWith(() => [{ ...CASE, space_id: TRAVEL.id }]);
    const chip = host.querySelector<HTMLButtonElement>('[aria-label="Open the project Travel"]');
    expect(chip?.textContent).toBe("Travel");
    act(() => chip!.click());
    expect(go).toHaveBeenLastCalledWith({ root: "projects", item: TRAVEL.id });
    expect(buttons()).toContain("Change project");
  });

  it("shows no chip for a case in core, and links it, then asks for the cases again", async () => {
    let linked = "";
    const { client, link } = await showWith(() => [{ ...CASE, space_id: linked }]);
    expect(host.querySelector(".project-chip")).toBeNull();
    press("Link to a project");
    const pick = host.querySelector<HTMLButtonElement>(`[aria-label="Link ${CASE.title} to Taxes"]`)!;
    linked = TAXES.id;
    await act(async () => {
      pick.click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(link).toHaveBeenCalledWith(CASE.case_id, TAXES.id);
    expect(client.asked).toHaveLength(2);
    expect(host.querySelector('[aria-label="Open the project Taxes"]')).not.toBeNull();
  });

  it("returns a linked case to core", async () => {
    const { link } = await showWith(() => [{ ...CASE, space_id: TRAVEL.id }]);
    press("Change project");
    press("Back to core");
    expect(link).toHaveBeenCalledWith(CASE.case_id, "");
  });
});
