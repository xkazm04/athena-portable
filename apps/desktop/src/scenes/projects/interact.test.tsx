/**
 * @vitest-environment jsdom
 *
 * The Projects depth, driven — README section 3.5, ADR 0087, 0090 and 0225.
 *
 * What a static render cannot prove: that entering a project makes it the one Athena works in (and
 * core makes core), that a new project is made by name and lands in its level, that the marquee
 * follows the attention, that Erase takes two presses and says what goes, that the brief is saved
 * when its box is left, and that the memory level filters, says what it cut and asks once before
 * making a line core. Each action is a spy, so "wired" means the right call with the right
 * arguments.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import { CORE } from "@/lib/spaces";
import { useSpaces } from "@/stores/spaces";

import { FIXTURE_ACTIONS, PATHS, RENOVATION, fixtures } from "./fixtures";
import { useEnterSpace } from "./live";
import type { ProjectsActions, ProjectsModel } from "./model";
import ProjectsView from "./view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

type Spies = { [K in keyof ProjectsActions]: ReturnType<typeof vi.fn> } & ProjectsActions;

function spies(): Spies {
  return {
    create: vi.fn(FIXTURE_ACTIONS.create),
    update: vi.fn(FIXTURE_ACTIONS.update),
    erase: vi.fn(FIXTURE_ACTIONS.erase),
    memory: vi.fn(FIXTURE_ACTIONS.memory),
    promote: vi.fn(FIXTURE_ACTIONS.promote),
    linkCase: vi.fn(FIXTURE_ACTIONS.linkCase),
  } as never;
}

async function mount(fixture: string, at: Path, go: (to: Path) => void = () => {}) {
  const actions = spies();
  const model: ProjectsModel = { ...fixtures[fixture]!, actions };
  await act(async () => root.render(<ProjectsView model={model} path={at} go={go} />));
  return actions;
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) as
    | HTMLButtonElement
    | undefined;

async function click(el: Element | null | undefined) {
  expect(el, "the control exists").toBeTruthy();
  await act(async () => (el as HTMLElement).click());
}

/** React tracks the value it last set, so a plain `.value =` is swallowed; use the native setter. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const marquee = () => host.querySelector(".projects__marquee")?.textContent;

describe("entering a project is entering it", () => {
  function Probe({ path }: { path: Path }) {
    useEnterSpace(path);
    return null;
  }
  const setActive = vi.fn();
  beforeEach(() => {
    setActive.mockReset();
    useSpaces.setState({ spaces: [RENOVATION], loaded: true, problem: "", activeId: CORE, pending: null, setActive });
  });

  it("makes the project the active space", () => {
    act(() => root.render(<Probe path={{ root: "projects", item: RENOVATION.id }} />));
    expect(setActive).toHaveBeenCalledExactlyOnceWith(RENOVATION.id);
  });

  it("makes it active from its memory level too", () => {
    act(() => root.render(<Probe path={{ root: "projects", item: RENOVATION.id, sub: { kind: "memory" } }} />));
    expect(setActive).toHaveBeenCalledExactlyOnceWith(RENOVATION.id);
  });

  it("returns her to core at projects/core", () => {
    useSpaces.setState({ activeId: RENOVATION.id });
    act(() => root.render(<Probe path={{ root: "projects", item: "core" }} />));
    expect(setActive).toHaveBeenCalledExactlyOnceWith(CORE);
  });

  it("asks nothing on the field, for a space already active, or for an id the list does not hold", () => {
    act(() => root.render(<Probe path={{ root: "projects" }} />));
    act(() => root.render(<Probe path={{ root: "projects", item: "core" }} />));
    act(() => root.render(<Probe path={{ root: "projects", item: "spc_999999999999" }} />));
    expect(setActive).not.toHaveBeenCalled();
  });

  it("waits for the list before making a project active, then does", () => {
    useSpaces.setState({ spaces: [], loaded: false });
    act(() => root.render(<Probe path={{ root: "projects", item: RENOVATION.id }} />));
    expect(setActive).not.toHaveBeenCalled();
    act(() => useSpaces.setState({ spaces: [RENOVATION], loaded: true }));
    expect(setActive).toHaveBeenCalledExactlyOnceWith(RENOVATION.id);
  });
});

describe("the field", () => {
  it("puts the project under the focus or the pointer in the marquee, and lets it go", async () => {
    await mount("typical", PATHS.field!);
    expect(marquee()).toBe("Your projects");
    const taxes = host.querySelector<HTMLButtonElement>('button[aria-label^="Taxes 2026:"]')!;
    act(() => taxes.focus());
    expect(marquee()).toBe("Taxes 2026");
    expect(host.querySelector(".projects__eyebrow")?.textContent).toBe("2 apps · 1 chore · 48 memories");
    expect(host.querySelector(".projects__line")?.textContent).toBe("Receipts, deductions and the filing in April.");
    // Its ring brightens and the others step back.
    expect(host.querySelectorAll('.orbit[data-hot="1"]')).toHaveLength(1);
    expect(host.querySelectorAll('.orbit[data-dim="1"]')).toHaveLength(2);
    act(() => taxes.blur());
    expect(marquee()).toBe("Your projects");
    act(() => host.querySelector(".orrery__sun")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(marquee()).toBe("Core");
  });

  it("opens a project, core, and every app from the door", async () => {
    const go = vi.fn();
    await mount("typical", PATHS.field!, go);
    await click(host.querySelector('button[aria-label^="Garden club:"]'));
    expect(go).toHaveBeenLastCalledWith({ root: "projects", item: "spc_2c3d4e5f6071" });
    await click(host.querySelector(".orrery__sun"));
    expect(go).toHaveBeenLastCalledWith({ root: "projects", item: "core" });
    await click(button("All apps"));
    expect(go).toHaveBeenLastCalledWith({ root: "apps" });
  });

  it("makes a new project by name on Enter and goes to its level", async () => {
    const go = vi.fn();
    const a = await mount("empty", PATHS.field!, go);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Name of the new project"]')!;
    type(input, "  Wedding  ");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(a.create).toHaveBeenCalledExactlyOnceWith({ name: "Wedding" });
    expect(go).toHaveBeenCalledExactlyOnceWith({ root: "projects", item: "spc_ffffffffffff" });
    expect(input.value).toBe("");
  });

  it("keeps the name and says the refusal verbatim when the daemon will not make it", async () => {
    const go = vi.fn();
    const a = await mount("typical", PATHS.field!, go);
    a.create.mockRejectedValueOnce(new Error("bad_request: name is over 60 characters"));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Name of the new project"]')!;
    type(input, "Wedding");
    await click(button("Create"));
    expect(go).not.toHaveBeenCalled();
    expect(host.textContent).toContain("It was not made: bad_request: name is over 60 characters");
    expect(input.value).toBe("Wedding");
  });
});

describe("a project", () => {
  it("erases only on the second press, which says what goes, and rises to the field", async () => {
    const go = vi.fn();
    const a = await mount("typical", PATHS.project!, go);
    await click(button("Erase Renovation"));
    expect(a.erase).not.toHaveBeenCalled();
    const second = button("Erase 212 memories and unlink 4 chores — this cannot be undone");
    expect(second).toBeTruthy();
    expect(document.activeElement).toBe(button("Keep it"));
    await click(button("Keep it"));
    expect(a.erase).not.toHaveBeenCalled();
    await click(button("Erase Renovation"));
    await click(button("Erase 212 memories and unlink 4 chores — this cannot be undone"));
    expect(a.erase).toHaveBeenCalledExactlyOnceWith(RENOVATION.id);
    expect(go).toHaveBeenCalledWith({ root: "projects" });
  });

  it("says a refused erase verbatim and stays", async () => {
    const go = vi.fn();
    const a = await mount("typical", PATHS.project!, go);
    a.erase.mockRejectedValueOnce(new Error("space_busy: a turn is running in this project"));
    await click(button("Erase Renovation"));
    await click(button("Erase 212 memories and unlink 4 chores — this cannot be undone"));
    expect(host.textContent).toContain("It was not erased: space_busy: a turn is running in this project");
    expect(go).not.toHaveBeenCalled();
  });

  it("saves the brief when its box is left, and counts it down to its cap", async () => {
    const a = await mount("typical", PATHS.project!);
    const box = host.querySelector("textarea")!;
    act(() => box.focus());
    type(box, "Only the kitchen now.");
    expect(host.textContent).toContain("21/1600");
    expect(a.update).not.toHaveBeenCalled();
    await act(async () => box.blur());
    expect(a.update).toHaveBeenCalledExactlyOnceWith(RENOVATION.id, { brief: "Only the kitchen now." });
    expect(host.textContent).toContain("Saved.");
  });

  it("renames in place on Enter", async () => {
    const a = await mount("typical", PATHS.project!);
    await click(button("Rename Renovation"));
    const field = host.querySelector<HTMLInputElement>('input[aria-label="The project\'s name"]')!;
    type(field, "Kitchen");
    await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(a.update).toHaveBeenCalledExactlyOnceWith(RENOVATION.id, { name: "Kitchen" });
  });

  it("adds a registered app it lacks and takes one out", async () => {
    const a = await mount("typical", { root: "projects", item: "spc_1b2c3d4e5f60" });
    await click(button("Add app"));
    await click(button("+ crm.example.test"));
    expect(a.update).toHaveBeenLastCalledWith("spc_1b2c3d4e5f60", {
      apps: ["https://example.test", "http://localhost:3004", "https://crm.example.test"],
    });
    await click(button("Take example.test out of Taxes 2026"));
    expect(a.update).toHaveBeenLastCalledWith("spc_1b2c3d4e5f60", { apps: ["http://localhost:3004"] });
  });

  it("links a chore from core, unlinks one back to core, and opens a chore at its case", async () => {
    const go = vi.fn();
    const a = await mount("typical", PATHS.project!, go);
    await click(button("Link a chore"));
    expect(host.textContent).toContain("in core");
    await click([...host.querySelectorAll(".projects__pick")].find((b) => b.textContent?.startsWith("+ Claim flight delays")));
    expect(a.linkCase).toHaveBeenCalledExactlyOnceWith("proj_000000000006", RENOVATION.id);
    await click(button("Unlink Compare contractor quotes: it goes back to core"));
    expect(a.linkCase).toHaveBeenLastCalledWith("proj_000000000001", CORE);
    await click(button("Compare contractor quotes"));
    expect(go).toHaveBeenLastCalledWith({ root: "chores", item: "contractor-quotes", sub: { kind: "case", arg: "proj_000000000001" } });
  });

  it("opens an app's layer from its orb", async () => {
    const go = vi.fn();
    await mount("typical", PATHS.project!, go);
    await click(button("localhost:3004. Open its layer."));
    expect(go).toHaveBeenLastCalledWith({ root: "apps", item: "http://localhost:3004" });
  });
});

describe("memory", () => {
  it("reads the rows, says what it cut, and filters by kind", async () => {
    const a = await mount("typical", PATHS.memory!);
    expect(a.memory).toHaveBeenCalledWith(RENOVATION.id, undefined);
    expect(host.querySelectorAll(".projects__memory-row")).toHaveLength(5);
    expect(host.textContent).toContain("(showing 5 of 212)");
    await click([...host.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.trim() === "facts"));
    expect(a.memory).toHaveBeenLastCalledWith(RENOVATION.id, "fact");
    expect(host.querySelectorAll(".projects__memory-row")).toHaveLength(2);
    expect(host.textContent).not.toContain("(showing");
  });

  it("asks once before making a fact core, then reads the page again", async () => {
    const a = await mount("typical", PATHS.memory!);
    const calls = a.memory.mock.calls.length;
    expect(host.querySelectorAll(".projects__memory-row")[2]!.textContent).not.toContain("Make core"); // an episode
    await click(button("Make core"));
    expect(a.promote).not.toHaveBeenCalled();
    await click(button("Make it core"));
    expect(a.promote).toHaveBeenCalledExactlyOnceWith(RENOVATION.id, "fct_000000000001");
    expect(a.memory.mock.calls.length).toBe(calls + 1);
  });

  it("reads core's memory by `core`, with no Make core", async () => {
    const a = await mount("typical", PATHS.coreMemory!);
    expect(a.memory).toHaveBeenCalledWith("core", undefined);
    expect(host.querySelectorAll(".projects__memory-row").length).toBeGreaterThan(0);
    expect(button("Make core")).toBeUndefined();
  });

  it("says a refused read verbatim, with a way to ask again", async () => {
    const actions = spies();
    actions.memory.mockRejectedValueOnce(new Error("offline: The daemon is not running."));
    await act(async () =>
      root.render(<ProjectsView model={{ ...fixtures.typical!, actions }} path={PATHS.memory!} go={() => {}} />),
    );
    expect(host.textContent).toContain("offline: The daemon is not running.");
    await click(button("Ask again"));
    expect(host.querySelectorAll(".projects__memory-row")).toHaveLength(5);
  });
});
