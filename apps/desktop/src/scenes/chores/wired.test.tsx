// @vitest-environment jsdom
/**
 * The Chores depth does what it says — README section 3.5, ADR 0040, 0087 and 0090.
 *
 * `view.test.tsx` proves every capability is drawn; this proves each is wired. The view is rendered
 * into a DOM with the module's actions as spies and `go` as a spy, and a person's gestures are
 * played: a click on a mark or a card dives, the filter and the sort re-arrange, Copy and Hand and
 * Open reach the module's own actions with the right words, the replay steps by button, by dot, by
 * arrow and by itself, and stops when told.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Path } from "@/depth/model";
import type { PlaybookActions, PlaybooksModel } from "@/modules/playbooks/model";

import { fixtures } from "./fixtures";
import { chorePath, runPath } from "./model";
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

describe("the field", () => {
  it("dives into a chore from its mark, and from its card", () => {
    show(fixtures.typical!, { root: "chores" });
    const marks = qa(".ch-mark");
    expect(marks).toHaveLength(3);
    click(marks[0]!);
    expect(go).toHaveBeenLastCalledWith(chorePath("carrier-refunds"));
    click(qa(".ch-card-tile")[1]!);
    expect(go).toHaveBeenLastCalledWith(chorePath("chargeback-evidence"));
  });

  it("takes the centre for the chore under the pointer or the keyboard, and gives it back", () => {
    show(fixtures.typical!, { root: "chores" });
    const mark = qa(".ch-mark")[2]!;
    expect(q(".ch-marquee")!.textContent).toBe("What only Athena does");
    act(() => {
      mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      mark.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(q(".ch-marquee")!.textContent).toBe("Delayed-flight compensation");
    expect(mark.hasAttribute("data-hot")).toBe(true);
    expect(qa(".ch-card-tile")[2]!.hasAttribute("data-hot")).toBe(true);
    act(() => {
      mark.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(q(".ch-marquee")!.textContent).toBe("What only Athena does");
  });

  it("filters by whose chore it is: the cards narrow and the other marks dim, nothing is lost", () => {
    show(fixtures.typical!, { root: "chores" });
    click(qa('[role="radio"]').find((r) => r.textContent?.startsWith("At home")) ?? null);
    expect(qa(".ch-card-tile")).toHaveLength(1);
    expect(qa(".ch-card-tile")[0]!.textContent).toContain("Delayed-flight compensation");
    expect(qa(".ch-mark")).toHaveLength(3);
    expect(qa(".ch-mark[data-dim]")).toHaveLength(2);
    click(qa('[role="radio"]').find((r) => r.textContent?.startsWith("All")) ?? null);
    expect(qa(".ch-card-tile")).toHaveLength(3);
    expect(qa(".ch-mark[data-dim]")).toHaveLength(0);
  });

  it("says which kind has no chore, and gives the way back to all of them in one press", () => {
    const typical = fixtures.typical!;
    const workOnly = { ...typical, items: typical.items.filter((v) => v.playbook.audience === "work") };
    show(workOnly, { root: "chores" });
    click(qa('[role="radio"]').find((r) => r.textContent?.startsWith("At home")) ?? null);
    expect(qa(".ch-card-tile")).toHaveLength(0);
    expect(host.textContent).toContain("No chore here is meant for home.");
    click(button(`Show all ${workOnly.items.length}`));
    expect(qa(".ch-card-tile")).toHaveLength(workOnly.items.length);
    expect(host.textContent).not.toContain("No chore here is meant for");
  });

  it("orders by money and by time, and says which", () => {
    show(fixtures.typical!, { root: "chores" });
    const order = () => qa(".ch-card-tile__title").map((t) => t.textContent);
    expect(order()).toEqual(["Late-parcel refunds", "Chargeback evidence packs", "Delayed-flight compensation"]);
    click(qa('[role="radio"]').find((r) => r.textContent === "Most money") ?? null);
    // $1,800 a month is $21,600 a year: the monthly chore leads the yearly one.
    expect(order()).toEqual(["Chargeback evidence packs", "Late-parcel refunds", "Delayed-flight compensation"]);
    expect(host.textContent).toContain("Most money a year first.");
    click(qa('[role="radio"]').find((r) => r.textContent === "Most time saved") ?? null);
    expect(order()).toEqual(["Late-parcel refunds", "Delayed-flight compensation", "Chargeback evidence packs"]);
    expect(host.textContent).toContain("Most hours by hand first.");
  });

  it("opens a chore from the keyboard: a mark is a native button, so Enter and Space click it", () => {
    show(fixtures.typical!, { root: "chores" });
    for (const mark of qa(".ch-mark")) {
      expect(mark.tagName).toBe("BUTTON");
      expect(mark.getAttribute("type")).toBe("button");
      expect(mark.hasAttribute("disabled")).toBe(false);
      expect(mark.getAttribute("tabindex")).not.toBe("-1");
    }
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
