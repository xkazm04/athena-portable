// @vitest-environment jsdom
/**
 * The Chores depth does what it says — README section 3.5, ADR 0040, 0087, 0090 and 0096.
 *
 * `view.test.tsx` proves every level is drawn; this proves each is wired. The view is rendered
 * into a DOM with the module's actions as spies and `go` as a spy, and a person's gestures are
 * played: the area tabs, the job chips and the order switch re-arrange the catalogue and the
 * filters survive a trip to a topic and back; a press on a row opens its topic while an arrow only
 * walks; on the topic page a still opens the lightbox, Escape closes it and then goes back, "Talk it
 * through with her" opens the Adopt studio, Copy reaches the module's own action; the replay steps by button, by
 * dot, by arrow and by itself, and stops when told.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Path } from "@/depth/model";
import { type PlaybookActions, type PlaybooksModel } from "@/modules/playbooks/model";

import { fixtures } from "./fixtures";
import { forgetChores } from "./memory";
import { adoptPath, chorePath, runPath } from "./model";
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

function show(model: PlaybooksModel, path: Path) {
  act(() => {
    root.render(<ChoresView model={model} path={path} go={go} />);
  });
}

/** A move as the app makes it: the stage mounts a fresh layer, so a fresh view (ADR 0090). */
function move(model: PlaybooksModel, path: Path) {
  act(() => root.unmount());
  root = createRoot(host);
  show(model, path);
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const click = (el: Element | null) => {
  expect(el, "the element to click").not.toBeNull();
  act(() => {
    el!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const button = (text: string) => qa("button").find((b) => b.textContent?.trim() === text) ?? null;
const key = (k: string, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  forgetChores();
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

describe("the catalogue", () => {
  const ledger = () => fixtures.ledger!;
  const rows = () => qa("tbody tr[aria-selected]");
  const titles = () => qa(".pa-name__title").map((t) => t.textContent);
  const tab = (name: string) => qa(".pa-tab").find((b) => b.title === name) ?? null;
  const tabCount = (name: string) => tab(name)?.querySelector(".pa-tab__count")?.textContent;
  const chip = (name: string) => qa(".pa-jobchip").find((b) => b.textContent === name) ?? null;

  it("renders a row for every playbook in the fixture", () => {
    show(ledger(), { root: "chores" });
    expect(rows()).toHaveLength(3);
    expect(titles()).toEqual(ledger().items.map((v) => v.playbook.shortTitle));
  });

  it("narrows the rows to an area from its tab, and marks the tab in force", () => {
    show(ledger(), { root: "chores" });
    click(tab("Freight & trade"));
    expect(titles()).toEqual(["Late-parcel refunds"]);
    expect(tab("Freight & trade")!.getAttribute("aria-current")).toBe("page");
    expect(tab("All")!.getAttribute("aria-current")).toBeNull();
    expect(q(".pa-shown")!.textContent).toBe("1 playbook in Freight & trade");
  });

  it("filters by job with a chip, and the tabs' counts follow the job", () => {
    show(ledger(), { root: "chores" });
    click(chip("Claim a benefit"));
    expect(chip("Claim a benefit")!.getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual(["Delayed-flight compensation"]);
    expect(tabCount("All")).toBe("1");
    expect(tabCount("Consumer & money")).toBe("1");
    expect(tabCount("Freight & trade")).toBe("0");
    expect((tab("Freight & trade") as HTMLButtonElement).disabled).toBe(true);
  });

  it("reorders by the switch: the most value first, the most time by hand first, the edge back", () => {
    show(ledger(), { root: "chores" });
    const edge = titles();
    click(button("Most value"));
    expect(button("Most value")!.getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual(["Chargeback evidence packs", "Late-parcel refunds", "Delayed-flight compensation"]);
    click(button("Most time saved"));
    expect(titles()).toEqual(["Late-parcel refunds", "Delayed-flight compensation", "Chargeback evidence packs"]);
    click(button("Best edge"));
    expect(titles()).toEqual(edge);
  });

  it("says which area and job leave nothing, and gives every playbook back in one press", () => {
    show(ledger(), { root: "chores" });
    click(tab("Freight & trade"));
    click(chip("Claim a benefit"));
    expect(rows()).toHaveLength(0);
    expect(q(".pa-empty")!.textContent).toContain("No playbook in Freight & trade whose job is to claim a benefit.");
    click(button("Show all"));
    expect(rows()).toHaveLength(3);
    expect(tab("All")!.getAttribute("aria-current")).toBe("page");
    expect(chip("All jobs")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens a playbook's topic from a click or Enter on its row, while an arrow only walks", () => {
    show(ledger(), { root: "chores" });
    click(rows()[1]!);
    expect(go).toHaveBeenLastCalledWith(chorePath("chargeback-evidence"));
    go.mockClear();
    key("ArrowDown", rows()[1]!);
    expect(go).not.toHaveBeenCalled();
    expect(rows()[2]!.getAttribute("aria-selected")).toBe("true");
    key("Enter", rows()[2]!);
    expect(go).toHaveBeenLastCalledWith(chorePath("flight-compensation"));
  });

  it("finds its filters and the row it opened as they were, coming back from the topic", () => {
    show(ledger(), { root: "chores" });
    click(tab("Freight & trade"));
    click(rows()[0]!);
    expect(go).toHaveBeenLastCalledWith(chorePath("carrier-refunds"));
    move(ledger(), chorePath("carrier-refunds"));
    expect(q(".pa-title")!.textContent).toBe("Late-parcel refunds");
    move(ledger(), { root: "chores" });
    expect(titles()).toEqual(["Late-parcel refunds"]);
    expect(rows()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(rows()[0]);
  });
});

describe("a chore's topic page", () => {
  const refunds = () => fixtures.ledger!.items.find((v) => v.id === "carrier-refunds")!.playbook;
  const at = chorePath("carrier-refunds");

  it("goes back to the catalogue from its crumb and from Escape", () => {
    show(fixtures.ledger!, at);
    click(button("← All playbooks"));
    expect(go).toHaveBeenLastCalledWith({ root: "chores" });
    go.mockClear();
    key("Escape");
    expect(go).toHaveBeenLastCalledWith({ root: "chores" });
  });

  it("claims Escape, so the stage does not rise a second time, and leaves a typed field's Escape alone", () => {
    show(fixtures.ledger!, at);
    const seen: boolean[] = [];
    const after = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    document.addEventListener("keydown", after);
    key("Escape");
    expect(seen).toEqual([true]);
    document.removeEventListener("keydown", after);
    go.mockClear();
    const input = document.createElement("input");
    document.body.append(input);
    key("Escape", input);
    input.remove();
    expect(go).not.toHaveBeenCalled();
  });

  it("comes back from its studio or its replay where it was left, and opens from the catalogue at the top", () => {
    const page = () => q(".pa-page")!;
    const scrollTo = (top: number) =>
      act(() => {
        page().scrollTop = top;
        page().dispatchEvent(new Event("scroll"));
      });
    show(fixtures.ledger!, at);
    scrollTo(900);
    move(fixtures.ledger!, adoptPath("carrier-refunds"));
    move(fixtures.ledger!, at);
    expect(page().scrollTop).toBe(900);
    scrollTo(640);
    move(fixtures.ledger!, runPath("carrier-refunds", 0));
    move(fixtures.ledger!, at);
    expect(page().scrollTop).toBe(640);
    // Back to the catalogue and in again from its row: a fresh visit starts at the top.
    move(fixtures.ledger!, { root: "chores" });
    act(() => {
      qa("tbody tr[aria-selected]")
        .find((r) => r.textContent?.includes(refunds().shortTitle))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    move(fixtures.ledger!, at);
    expect(page().scrollTop).toBe(0);
  });

  it("does not answer Escape while it is a leaving layer (inert)", () => {
    show(fixtures.ledger!, at);
    host.setAttribute("inert", "");
    key("Escape");
    expect(go).not.toHaveBeenCalled();
    host.removeAttribute("inert");
  });

  it("opens a still in the lightbox, steps it, and Escape closes the lightbox before it goes back", () => {
    show(fixtures.ledger!, at);
    click(qa(".pa-frame")[1]!);
    const box = () => q('.lbx[role="dialog"]');
    expect(box()).not.toBeNull();
    expect(box()!.textContent).toContain("2 / 3");
    expect(box()!.textContent).toContain("Turn 2 - Carrier billing centre: list the invoice");
    expect(document.activeElement).toBe(box());
    key("ArrowRight", box()!);
    expect(box()!.textContent).toContain("3 / 3");
    key("ArrowRight", box()!);
    expect(box()!.textContent).toContain("1 / 3");
    key("Escape", box()!);
    expect(box()).toBeNull();
    expect(go).not.toHaveBeenCalled();
    key("Escape");
    expect(go).toHaveBeenLastCalledWith({ root: "chores" });
  });

  it("keeps Tab inside an open lightbox, and an Escape from outside it closes the still, not the page", () => {
    show(fixtures.ledger!, at);
    click(qa(".pa-frame")[0]!);
    const box = q('.lbx[role="dialog"]')!;
    const close = q<HTMLButtonElement>(".lbx__close")!;
    const prev = q<HTMLButtonElement>(".lbx__nav--prev")!;
    // Tab on the last control wraps to the first; Shift+Tab on the first wraps to the last.
    close.focus();
    const tab = (target: HTMLElement, shiftKey = false) => {
      const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      act(() => {
        target.dispatchEvent(e);
      });
      return e;
    };
    expect(tab(close).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(prev);
    expect(tab(prev, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(box.contains(document.activeElement)).toBe(true);
    // Focus taken elsewhere by the pointer: Escape still closes the still and leaves the page be.
    document.body.focus();
    key("Escape");
    expect(q(".lbx")).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("opens the hero still too, and closes the lightbox from its Close and its backdrop", () => {
    show(fixtures.ledger!, at);
    click(q(".pa-shot"));
    expect(q(".lbx")!.textContent).toContain("1 / 3");
    click(q('button[aria-label="Close"]'));
    expect(q(".lbx")).toBeNull();
    click(q(".pa-frame"));
    act(() => {
      q(".lbx")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(q(".lbx")).toBeNull();
  });

  it("opens the Adopt studio from \"Make it yours\"", () => {
    show(fixtures.ledger!, at);
    click(button("Talk it through with her"));
    expect(go).toHaveBeenLastCalledWith(adoptPath("carrier-refunds"));
  });

  it("copies the playbook's own command, and goes down to the replay at its first turn", () => {
    const a = actions();
    show(withActions(fixtures.ledger!, a), at);
    click(button("Copy the command"));
    expect(a.copy).toHaveBeenCalledWith(refunds().command);
    expect(q(".pa-said")!.textContent).toBe("Sent the command to the clipboard.");
    click(button("Watch the run turn by turn"));
    expect(go).toHaveBeenLastCalledWith(runPath("carrier-refunds", 0));
  });

  it("offers the way back from a place that is not there", () => {
    show(fixtures.typical!, chorePath("nope"));
    click(button("All playbooks"));
    expect(go).toHaveBeenLastCalledWith({ root: "chores" });
  });
});

describe("the replay", () => {
  const at = (turn: number) => runPath("carrier-refunds", turn);

  it("is what the run sub-path draws, not the topic page", () => {
    show(fixtures.typical!, at(0));
    expect(q(".ch-run")).not.toBeNull();
    expect(q(".pa-topic")).toBeNull();
  });

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

  it("offers the way back to the topic from a run that is not there", () => {
    show(fixtures.typical!, runPath("flight-compensation", 0));
    click(button("Back to the chore"));
    expect(go).toHaveBeenLastCalledWith(chorePath("flight-compensation"));
  });
});
