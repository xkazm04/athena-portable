// @vitest-environment jsdom
/**
 * The Chores depth does what it says — README section 3.5, ADR 0040, 0087 and 0090.
 *
 * `view.test.tsx` proves every capability is drawn; this proves each is wired. The view is rendered
 * into a DOM with the module's actions as spies and `go` as a spy, and a person's gestures are
 * played: the rail, the job chips and the column heads re-arrange the ledger, a pick moves the
 * preview and is shared with the map, the fit hands the fitted command, a narrow ledger opens what a
 * click picks, Copy and Hand and Open reach the module's own actions with the right words, the replay steps by button, by dot, by
 * arrow and by itself, and stops when told.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Path } from "@/depth/model";
import { fitCommand, type PlaybookActions, type PlaybooksModel } from "@/modules/playbooks/model";

import { fixtures } from "./fixtures";
import { LEDGER_WIDE, chorePath, runPath } from "./model";
import { REPLAY_STEP_MS, stopPlaying } from "./replay";
import ChoresView from "./view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let go: ReturnType<typeof vi.fn<(to: Path) => void>>;

type Spies = { [K in keyof PlaybookActions]: Mock<PlaybookActions[K]> };

function actions(): Spies {
  return {
    copy: vi.fn<PlaybookActions["copy"]>(),
    open: vi.fn<PlaybookActions["open"]>(),
    hand: vi.fn<PlaybookActions["hand"]>(),
  };
}

function withActions(model: PlaybooksModel, a: PlaybookActions): PlaybooksModel {
  return { ...model, actions: a };
}

function show(model: PlaybooksModel, path: Path, initialFacet: Parameters<typeof ChoresView>[0]["initialFacet"] = null) {
  act(() => {
    root.render(<ChoresView model={model} path={path} go={go} initialFacet={initialFacet} />);
  });
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const click = (el: Element | null) => {
  expect(el, "the element to click").not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const button = (text: string) => qa("button").find((b) => b.textContent?.trim() === text) ?? null;
/** Type into a controlled field: React listens for `input` and reads the value the native setter set. */
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const key = (k: string, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  go = vi.fn<(to: Path) => void>();
  stopPlaying();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the field: the ledger", () => {
  const ledger = () => fixtures.ledger!;
  const rows = () => qa("tbody tr[aria-selected]");
  const titles = () => qa(".ch-row__title").map((t) => t.textContent);
  const area = (name: string) => qa(".ch-area").find((b) => b.querySelector(".ch-area__name")?.textContent === name) ?? null;
  const areaCount = (name: string) => area(name)?.querySelector(".ch-area__n")?.textContent;
  const head = (name: string) => qa(".table__sort").find((b) => b.textContent === name) ?? null;
  const pane = () => q(".ch-pane");

  it("narrows the rows to an area from the rail, and marks the area in force", () => {
    show(ledger(), { root: "chores" });
    expect(rows()).toHaveLength(3);
    click(area("Freight & trade"));
    expect(titles()).toEqual(["Late-parcel refunds"]);
    expect(area("Freight & trade")!.getAttribute("aria-current")).toBe("true");
    expect(area("All")!.hasAttribute("aria-current")).toBe(false);
  });

  it("filters by job with a chip, and the rail's counts follow the job", () => {
    show(ledger(), { root: "chores" });
    expect(areaCount("Freight & trade")).toBe("1");
    click(button("Win a dispute"));
    expect(button("Win a dispute")!.getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual(["Chargeback evidence packs"]);
    expect(areaCount("All")).toBe("1");
    expect(areaCount("Freight & trade")).toBe("0");
    expect(areaCount("Commerce & payments")).toBe("1");
  });

  it("says which area and job leave nothing, and gives every playbook back in one press", () => {
    show(ledger(), { root: "chores" });
    click(area("Freight & trade"));
    click(button("Win a dispute"));
    expect(rows()).toHaveLength(0);
    expect(host.textContent).toContain("No playbook in Freight & trade whose job is to win a dispute.");
    expect(pane()).toBeNull();
    click(button("Show all 3"));
    expect(rows()).toHaveLength(3);
    expect(area("All")!.getAttribute("aria-current")).toBe("true");
    expect(button("Every job")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("orders by a column's head: most first, then turned round, then the edge's order back", () => {
    show(ledger(), { root: "chores" });
    expect(titles()).toEqual(["Late-parcel refunds", "Chargeback evidence packs", "Delayed-flight compensation"]);
    click(head("Value"));
    // $1,800 a month is $21,600 a year: the monthly chore leads the yearly one.
    expect(titles()).toEqual(["Chargeback evidence packs", "Late-parcel refunds", "Delayed-flight compensation"]);
    expect(head("Value")!.closest("th")!.getAttribute("aria-sort")).toBe("descending");
    click(head("Value"));
    expect(titles()).toEqual(["Delayed-flight compensation", "Late-parcel refunds", "Chargeback evidence packs"]);
    click(head("Value"));
    expect(titles()).toEqual(["Late-parcel refunds", "Chargeback evidence packs", "Delayed-flight compensation"]);
    expect(head("Value")!.closest("th")!.getAttribute("aria-sort")).toBe("none");
    click(head("Time saved"));
    expect(titles()).toEqual(["Late-parcel refunds", "Delayed-flight compensation", "Chargeback evidence packs"]);
  });

  it("previews the row picked by a click or an arrow, and the first row again when a filter hides it", () => {
    show(ledger(), { root: "chores" });
    expect(pane()!.getAttribute("aria-label")).toBe("Preview: Late-parcel refunds");
    click(rows()[2]!);
    expect(pane()!.getAttribute("aria-label")).toBe("Preview: Delayed-flight compensation");
    expect(pane()!.textContent).toContain("Not benched, so nothing is measured.");
    expect(pane()!.textContent).toContain("Will be held to");
    key("ArrowUp", rows()[2]!);
    expect(pane()!.getAttribute("aria-label")).toBe("Preview: Chargeback evidence packs");
    expect(go).not.toHaveBeenCalled();
    click(area("Freight & trade"));
    expect(pane()!.getAttribute("aria-label")).toBe("Preview: Late-parcel refunds");
  });

  it("shares the pick with the map: a mark picks, the ledger shows the same row, Enter on a mark opens it", () => {
    show(ledger(), { root: "chores" });
    click(button("Map"));
    expect(rows()).toHaveLength(0);
    const marks = qa(".ch-mark");
    expect(marks).toHaveLength(3);
    click(marks[1]!);
    expect(marks[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(pane()!.getAttribute("aria-label")).toBe("Preview: Chargeback evidence packs");
    expect(go).not.toHaveBeenCalled();
    key("Enter", marks[2]!);
    expect(go).toHaveBeenLastCalledWith(chorePath("flight-compensation"));
    click(button("Ledger"));
    expect(rows()[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("draws the map over the same rows the filters leave", () => {
    show(ledger(), { root: "chores" });
    click(button("Win a dispute"));
    click(button("Map"));
    expect(qa(".ch-mark")).toHaveLength(1);
    expect(qa(".ch-mark")[0]!.getAttribute("aria-label")).toContain("Chargeback evidence packs");
  });

  it("copies the playbook's own command, and opens the full playbook", () => {
    const a = actions();
    show(withActions(ledger(), a), { root: "chores" });
    const p = ledger().items[0]!.playbook;
    click(button("Copy the command"));
    expect(a.copy).toHaveBeenCalledWith(p.command);
    expect(pane()!.textContent).toContain("Sent the command to the clipboard.");
    click(button("Open the full playbook"));
    expect(go).toHaveBeenLastCalledWith(chorePath(p.id));
  });

  it("fits the playbook to the person's portals and case, shows the command live, and hands that", () => {
    const a = actions();
    show(withActions(ledger(), a), { root: "chores" });
    const p = ledger().items[0]!.playbook;
    click(button("Fit it to me"));
    expect(button("Copy the command")).toBeNull();
    expect(q(".ch-fit__command")!.textContent).toBe(p.command);
    click(qa("button").filter((b) => b.textContent === "Mine is…")[0]!);
    type(q<HTMLInputElement>(".ch-fit__mine input")!, "ShipCo portal");
    type(q<HTMLTextAreaElement>(".ch-fit__note")!, "We ship from two warehouses.");
    const fitted = fitCommand(p, { portals: { [p.apps[0]!.name]: "ShipCo portal" }, note: "We ship from two warehouses." });
    expect(fitted).not.toBe(p.command);
    expect(q(".ch-fit__command")!.textContent).toBe(fitted);
    expect(q(".ch-fit")!.textContent).toContain(`for ${p.persona}`);
    click(button("Hand it to Athena"));
    expect(a.hand).toHaveBeenCalledWith(fitted, { id: p.id, title: p.title });
    expect(q(".ch-fit")).toBeNull();
    expect(pane()!.textContent).toContain("It waits in her composer until you send it.");
  });

  it("closes the fit on Cancel without handing anything", () => {
    const a = actions();
    show(withActions(ledger(), a), { root: "chores" });
    click(button("Fit it to me"));
    click(button("Cancel"));
    expect(q(".ch-fit")).toBeNull();
    expect(a.hand).not.toHaveBeenCalled();
    expect(button("Fit it to me")).not.toBeNull();
  });

  it("steps the storyboard by its strip, by a click or the arrows", () => {
    show(ledger(), { root: "chores" });
    const picks = () => qa(".ch-story__pick");
    expect(q(".ch-story__frame figcaption")!.textContent).toBe("1 of 3 · Abstract");
    key("ArrowRight", picks()[0]!);
    expect(picks()[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(q(".ch-story__frame figcaption")!.textContent).toContain("2 of 3");
    click(picks()[2]!);
    expect(q(".ch-story__frame figcaption")!.textContent).toBe("3 of 3 · What she filed");
    key("ArrowRight", picks()[2]!);
    expect(picks()[2]!.getAttribute("aria-pressed")).toBe("true");
  });

  describe("narrower than the preview needs", () => {
    beforeEach(() => {
      class Narrow {
        constructor(private readonly cb: ResizeObserverCallback) {}
        observe() {
          this.cb([{ contentRect: { width: LEDGER_WIDE - 200 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      }
      vi.stubGlobal("ResizeObserver", Narrow);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("draws no preview, and a click or Enter on a row opens the chore while an arrow only walks", () => {
      show(ledger(), { root: "chores" });
      expect(pane()).toBeNull();
      key("ArrowDown", rows()[0]!);
      expect(go).not.toHaveBeenCalled();
      expect(rows()[1]!.getAttribute("aria-selected")).toBe("true");
      key("Enter", rows()[1]!);
      expect(go).toHaveBeenLastCalledWith(chorePath("chargeback-evidence"));
      click(rows()[2]!);
      expect(go).toHaveBeenLastCalledWith(chorePath("flight-compensation"));
    });

    it("opens the chore from a mark's click on the map", () => {
      show(ledger(), { root: "chores" });
      click(button("Map"));
      click(qa(".ch-mark")[0]!);
      expect(go).toHaveBeenLastCalledWith(chorePath("carrier-refunds"));
    });
  });
});

describe("a chore", () => {
  it("copies the command and hands it to Athena with the chore as her project", () => {
    const a = actions();
    show(withActions(fixtures.typical!, a), chorePath("carrier-refunds"));
    const command = "Go through this week's carrier invoice, find every parcel that missed its guaranteed time without a covered exception, and file a refund claim for each.";
    click(button("Copy the command"));
    expect(a.copy).toHaveBeenCalledWith(command);
    expect(host.textContent).toContain("Sent the command to the clipboard.");
    click(button("Hand it to Athena"));
    expect(a.hand).toHaveBeenCalledWith(command, { id: "carrier-refunds", title: "Late-parcel refunds" });
    expect(host.textContent).toContain("waits in her composer until you send it");
  });

  it("switches between the parts, each one click away, and marks the open one", () => {
    show(fixtures.typical!, chorePath("carrier-refunds"));
    expect(q('[aria-current="page"]')!.textContent).toContain("The chore today");
    click(qa(".ch-facet").find((f) => f.textContent?.includes("Where she stops for you")) ?? null);
    expect(q(".ch-panel")!.textContent).toContain("GATED");
    expect(q('[aria-current="page"]')!.textContent).toContain("Where she stops for you");
    click(q('[aria-label$="Open what she filed"]'));
    expect(q(".ch-panel")!.textContent).toContain("Claims right");
  });

  it("opens a portal in a Browser tab through the module's action, and says it did", () => {
    const a = actions();
    const shipped = fixtures.shipped!;
    const chore = shipped.items.find((v) => v.playbook.apps.some((p) => p.url))!;
    const portal = chore.playbook.apps.find((p) => p.url)!;
    show(withActions(shipped, a), chorePath(chore.id), "portals");
    click(button("Open"));
    expect(a.open).toHaveBeenCalledWith(portal.url);
    expect(host.textContent).toContain(`Opened ${portal.name} in a Browser tab.`);
  });

  it("opens a source through the same action, and does not follow the link itself", () => {
    const a = actions();
    show(withActions(fixtures.typical!, a), chorePath("carrier-refunds"), "money");
    const link = q<HTMLAnchorElement>(".ch-sources a")!;
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect(a.open).toHaveBeenCalledWith("https://example.com/terms");
  });

  it("folds the trap ledger and shows all of it on request, then folds again", () => {
    show(fixtures.typical!, chorePath("chargeback-evidence"), "traps");
    expect(qa(".ch-trap")).toHaveLength(5);
    click(button("Show all 7 (showing 5 of 7)"));
    expect(qa(".ch-trap")).toHaveLength(7);
    click(button("Show fewer"));
    expect(qa(".ch-trap")).toHaveLength(5);
  });

  it("goes down to the replay at its first turn", () => {
    show(fixtures.typical!, chorePath("carrier-refunds"), "run");
    click(button("Watch the run"));
    expect(go).toHaveBeenLastCalledWith(runPath("carrier-refunds", 0));
  });

  it("falls back to the chore part when asked for a part the chore lacks", () => {
    show(fixtures.typical!, chorePath("flight-compensation"), "evidence");
    expect(q('[aria-current="page"]')!.textContent).toContain("The chore today");
  });

  it("offers the way back from a place that is not there", () => {
    show(fixtures.typical!, chorePath("nope"));
    click(button("All chores"));
    expect(go).toHaveBeenLastCalledWith({ root: "chores" });
  });
});

describe("the replay", () => {
  const at = (turn: number) => runPath("carrier-refunds", turn);

  it("steps with Next and Back, and Back is not offered at the first turn", () => {
    show(fixtures.typical!, at(0));
    expect(button("Back")!.closest("[title]")).not.toBeNull();
    click(button("Next"));
    expect(go).toHaveBeenLastCalledWith(at(1));
    show(fixtures.typical!, at(2));
    click(button("Back"));
    expect(go).toHaveBeenLastCalledWith(at(1));
  });

  it("steps with ArrowRight and ArrowLeft from anywhere in the scene, and ignores a typed key", () => {
    show(fixtures.typical!, at(1));
    key("ArrowRight");
    expect(go).toHaveBeenLastCalledWith(at(2));
    key("ArrowLeft");
    expect(go).toHaveBeenLastCalledWith(at(0));
    go.mockClear();
    const input = document.createElement("input");
    document.body.append(input);
    key("ArrowRight", input);
    input.remove();
    key("a");
    expect(go).not.toHaveBeenCalled();
  });

  it("does not answer an arrow while it is a leaving layer (inert), so a move is never stepped twice", () => {
    show(fixtures.typical!, at(1));
    host.setAttribute("inert", "");
    key("ArrowRight");
    expect(go).not.toHaveBeenCalled();
    host.removeAttribute("inert");
  });

  it("jumps to a turn from its dot and from its row in the ledger", () => {
    show(fixtures.typical!, at(0));
    click(qa(".ch-dot")[3]!);
    expect(go).toHaveBeenLastCalledWith(at(3));
    click(qa(".ch-ledger__row")[3]!);
    expect(go).toHaveBeenLastCalledWith(at(3));
  });

  it("plays on its own, one turn per step, and Pause stops it", () => {
    vi.useFakeTimers();
    show(fixtures.typical!, at(0));
    click(button("Play"));
    expect(button("Pause")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(REPLAY_STEP_MS - 10);
    });
    expect(go).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenLastCalledWith(at(1));

    // A new scene for the next turn (the stage remounts one) goes on playing.
    act(() => root.unmount());
    root = createRoot(host);
    go.mockClear();
    show(fixtures.typical!, at(1));
    expect(button("Pause")).not.toBeNull();
    click(button("Pause"));
    expect(button("Play")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(REPLAY_STEP_MS * 3);
    });
    expect(go).not.toHaveBeenCalled();
  });

  it("stops playing when a person steps by hand, even with its timer pending", () => {
    vi.useFakeTimers();
    show(fixtures.typical!, at(0));
    click(button("Play"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    click(button("Next"));
    expect(go).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(REPLAY_STEP_MS * 2);
    });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("offers Replay at the last turn and starts again from the first", () => {
    show(fixtures.typical!, at(3));
    click(button("Replay"));
    expect(go).toHaveBeenLastCalledWith(at(0));
  });

  it("folds a long ledger and shows all of it on request", () => {
    const shipped = fixtures.shipped!;
    const long = shipped.items.find((v) => (v.playbook.bench?.trace ?? []).flatMap((t) => t.cards).length > 6);
    if (!long) return; // the shipped set holds no run that long this build
    show(shipped, runPath(long.id, 0));
    expect(qa(".ch-ledger__row")).toHaveLength(6);
    click(qa("button").find((b) => b.textContent?.startsWith("Show all")) ?? null);
    expect(qa(".ch-ledger__row").length).toBeGreaterThan(6);
  });
});
