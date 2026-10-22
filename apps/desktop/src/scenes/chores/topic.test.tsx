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
import type { AdoptEvent, CaseSummary, CasesReply, StartReply } from "@/lib/adopt";
import type { AdoptClient } from "@/lib/adopt-client";

import type { AdoptDeps } from "./adopt/deps";
import { ADOPT_PLAYBOOK } from "./adopt/fixtures";
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
};

class FakeClient implements AdoptClient {
  starts: { playbookId: string; caseId: string | undefined }[] = [];
  asked: string[] = [];
  constructor(private readonly listing: () => Promise<CasesReply>) {}
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

  it("says it is looking while the answer is on its way", async () => {
    await show(chorePath(ADOPT_PLAYBOOK), deps(new FakeClient(() => new Promise(() => {}))));
    expect(text()).toContain("Looking for a case you saved…");
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
