// @vitest-environment jsdom
/**
 * The Chores front door does what it says — ADR 0098, README section 3.5.
 *
 * The Chores view is rendered with a fake intake client whose event stream the test feeds by hand,
 * and a person's gestures are played: the catalogue's "New chore" leads to chores/new; a template
 * verdict opens the studio with the need as its opening message; a custom verdict hands the edited
 * command to Athena's window or, with no shell, offers Copy; Escape asks first with unsent text;
 * the daemon's end (session_closed) is not reconnected; and each state is said in words.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import type { AdoptEvent, Answer, AnswerVia, StartReply } from "@/lib/adopt";
import type { AdoptClient } from "@/lib/adopt-client";
import { ApiError } from "@/lib/api";
import type { IntakeClient } from "@/lib/intake-client";
import type { PlaybooksModel } from "@/modules/playbooks/model";

import type { AdoptDeps, Dictation } from "../adopt/deps";
import { fixtures } from "../fixtures";
import { adoptPath, chorePath, newChorePath } from "../model";
import ChoresView from "../view";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Item = AdoptEvent | Error | "end";

class Stream {
  queue: Item[] = [];
  private wake: (() => void) | null = null;
  constructor(readonly after: number) {}
  push(x: Item) {
    this.queue.push(x);
    this.wake?.();
  }
  async *run(signal: AbortSignal): AsyncGenerator<AdoptEvent> {
    for (;;) {
      while (this.queue.length) {
        const x = this.queue.shift()!;
        if (x === "end") return;
        if (x instanceof Error) throw x;
        yield x;
      }
      if (signal.aborted) return;
      await new Promise<void>((r) => {
        this.wake = r;
        signal.addEventListener("abort", () => r());
      });
      this.wake = null;
    }
  }
}

class FakeIntake implements IntakeClient {
  calls: { route: string; body: unknown }[] = [];
  streams: Stream[] = [];
  starts = 0;
  startWith: () => Promise<{ ok: true; session_id: string }> = () =>
    Promise.resolve({ ok: true, session_id: `s${this.starts}` });
  start(need?: string) {
    this.starts += 1;
    this.calls.push({ route: "start", body: need ?? null });
    return this.startWith();
  }
  events(_sid: string, after: number, signal: AbortSignal) {
    const s = new Stream(after);
    this.streams.push(s);
    return s.run(signal);
  }
  answer(sid: string, answers: readonly Answer[], via: AnswerVia) {
    this.calls.push({ route: "answer", body: { sid, answers, via } });
    return Promise.resolve();
  }
  decide(sid: string) {
    this.calls.push({ route: "decide", body: sid });
    return Promise.resolve();
  }
  close(sid: string) {
    this.calls.push({ route: "close", body: sid });
    return Promise.resolve();
  }
  routes(route: string) {
    return this.calls.filter((c) => c.route === route).map((c) => c.body);
  }
  get live() {
    return this.streams.at(-1)!;
  }
}

/** The studio the front door opens: only what a session start needs. */
class FakeAdopt implements AdoptClient {
  starts: { playbookId: string; intro: string | undefined }[] = [];
  start(playbookId: string, intro?: string): Promise<StartReply> {
    this.starts.push({ playbookId, intro });
    return Promise.resolve({ ok: true, session_id: "a1", slots: [] });
  }
  events(_sid: string, _after: number, signal: AbortSignal) {
    return new Stream(0).run(signal);
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
  approve() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

let host: HTMLDivElement;
let root: Root;
let go: ReturnType<typeof vi.fn<(to: Path) => void>>;
let intake: FakeIntake;
let adopt: FakeAdopt;
let offer: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
let waits: number[];
let seq: number;

const dictation: Dictation = {
  check: () => Promise.resolve("Voice is not set up here"),
  start: () => Promise.resolve(),
  stop: () => Promise.resolve({ ok: false, reason: "no" }),
  canSpeak: () => Promise.resolve("no"),
  speak: () => Promise.resolve(),
};

const model = (): PlaybooksModel => fixtures.shipped!;
const FIT = "travel-credit-refunds";
const ALT = model().items.find((v) => v.id !== FIT)!.id;
const NEED = "I want my airline credits back.";

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

function deps(over: Partial<AdoptDeps> = {}): AdoptDeps {
  return {
    client: adopt,
    intake,
    dictation,
    wait: (ms) => (waits.push(ms), Promise.resolve()),
    ...over,
  };
}

let current: {
  path: Path;
  deps: AdoptDeps | undefined;
  offer: typeof offer | undefined;
};

function render() {
  act(() => {
    root.render(
      <ChoresView
        model={model()}
        path={current.path}
        go={go}
        adopt={current.deps}
        offer={current.offer}
      />,
    );
  });
}

async function show(
  over: {
    path?: Path;
    deps?: AdoptDeps | null;
    offer?: typeof offer | null;
  } = {},
) {
  current = {
    path: over.path ?? newChorePath(),
    deps: over.deps === null ? undefined : (over.deps ?? deps()),
    offer: over.offer === null ? undefined : (over.offer ?? offer),
  };
  render();
  await flush();
}

type Unseq<E> = E extends unknown ? Omit<E, "seq"> : never;

async function feed(...events: Unseq<AdoptEvent>[]) {
  for (const e of events)
    intake.live.push({ ...e, seq: (seq += 1) } as AdoptEvent);
  await flush();
}

const q = <T extends Element = HTMLElement>(sel: string) =>
  host.querySelector<T>(sel);
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const text = () => host.textContent ?? "";
const button = (label: string) =>
  qa("button").find((b) => b.textContent?.trim() === label) ?? null;
const sendIn = (where: string) =>
  qa(`${where} button`).find((b) => b.textContent?.trim() === "Send") ?? null;
const click = async (el: Element | null) => {
  expect(el, "the element to click").not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const escape = () =>
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });

const CARD = {
  kind: "adopt.questions" as const,
  round: 1,
  questions: [
    {
      id: "q-what",
      slot_ids: [],
      text: "What do you want back?",
      options: [
        { id: "money", label: "Money" },
        { id: "other", label: "Something else" },
      ],
      multi: false,
      allow_text: true,
    },
  ],
};

const TEMPLATE: Unseq<Extract<AdoptEvent, { kind: "adopt.verdict" }>> = {
  kind: "adopt.verdict",
  fit: "template",
  playbook_id: FIT,
  why: "It is the chore for credits that airlines owe you.",
  differs: "Your airlines are not the recorded ones.",
  alternates: [
    {
      playbook_id: ALT,
      title: "A near neighbour",
      why: "Close, but another job.",
    },
  ],
  need: NEED,
  command: "",
};

const CUSTOM: Unseq<Extract<AdoptEvent, { kind: "adopt.verdict" }>> = {
  kind: "adopt.verdict",
  fit: "custom",
  playbook_id: "",
  why: "No chore covers this.",
  differs: "",
  alternates: [],
  need: "I want my shared inbox sorted.",
  command: "Open my shared inbox and list who waits on me.",
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  go = vi.fn<(to: Path) => void>();
  intake = new FakeIntake();
  adopt = new FakeAdopt();
  offer = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  waits = [];
  seq = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

describe("the catalogue's way in", () => {
  it("is headed Chores and has a New chore button that leads to chores/new", async () => {
    await show({ path: { root: "chores" } });
    expect(q("h1")?.textContent).toBe("Chores");
    expect(q(".pa-head")?.contains(button("New chore"))).toBe(true);
    await click(button("New chore"));
    expect(go).toHaveBeenCalledWith({ root: "chores", item: "new" });
    expect(intake.starts).toBe(0);
  });

  it("draws the front door at chores/new before any chore is looked up", async () => {
    await show();
    expect(q(".pa-eyebrow")?.textContent).toBe("New chore");
    expect(q("h1")?.textContent).toBe("What do you need done?");
    expect(intake.routes("start")).toEqual([null]);
    expect(button("Just decide for me")).not.toBeNull();
    expect(button("Good enough")).toBeNull();
  });
});

describe("a template verdict", () => {
  it("opens the chore's studio with the need as the opening message", async () => {
    await show();
    await feed({ kind: "adopt.say", text: "Let me look." }, CARD, TEMPLATE);
    expect(text()).toContain("It is the chore for credits");
    expect(text()).toContain("What would differ");
    expect(text()).toContain("Your airlines are not the recorded ones.");
    // The verdict ends the conversation: the session is let go and no composer is left.
    expect(intake.routes("close")).toContain("s1");
    expect(q("#ad-say")).toBeNull();

    await click(button("Make it yours"));
    expect(go).toHaveBeenCalledWith(adoptPath(FIT));

    // The app moves the place; the studio's session start carries the need.
    current.path = adoptPath(FIT);
    render();
    await flush();
    expect(adopt.starts).toEqual([{ playbookId: FIT, intro: NEED }]);
  });

  it("offers the chore page and the alternates with the same two ways in", async () => {
    await show();
    await feed(TEMPLATE);
    await click(button("See the chore page"));
    expect(go).toHaveBeenLastCalledWith(chorePath(FIT));
    const alt = qa("button").find((b) =>
      b
        .getAttribute("aria-label")
        ?.startsWith("Make it yours: A near neighbour"),
    );
    await click(alt ?? null);
    expect(go).toHaveBeenLastCalledWith(adoptPath(ALT));
    current.path = adoptPath(ALT);
    render();
    await flush();
    expect(adopt.starts).toEqual([{ playbookId: ALT, intro: NEED }]);
  });

  it("does not carry the need into a studio opened later from the chore's own page", async () => {
    await show();
    await feed(TEMPLATE);
    await click(button("Make it yours"));
    current.path = adoptPath(FIT);
    render();
    await flush();
    current.path = chorePath(FIT);
    render();
    await flush();
    current.path = adoptPath(FIT);
    render();
    await flush();
    expect(adopt.starts.map((s) => s.intro)).toEqual([NEED, undefined]);
  });

  it("goes custom instead on the need, and back", async () => {
    await show();
    await feed(TEMPLATE);
    await click(button("Go custom instead"));
    expect(q<HTMLTextAreaElement>("#in-command")?.value).toBe(NEED);
    expect(button("Hand to Athena")).not.toBeNull();
    expect(button("Back to the chores")).not.toBeNull();
    await click(button("Show the chore that fits"));
    expect(button("Make it yours")).not.toBeNull();
  });
});

describe("a custom verdict", () => {
  it("hands the edited command to Athena's window and says it is there", async () => {
    await show();
    await feed(CUSTOM);
    const box = q<HTMLTextAreaElement>("#in-command")!;
    expect(box.value).toBe("Open my shared inbox and list who waits on me.");
    type(box, "Open my shared inbox and list who waits on me, oldest first.");
    await click(button("Hand to Athena"));
    expect(offer).toHaveBeenCalledWith(
      "Open my shared inbox and list who waits on me, oldest first.",
    );
    expect(text()).toContain(
      "It is in Athena's window. Read it and press send.",
    );
  });

  it("with no shell says so and leaves Copy, and Back to the chores always works", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    offer.mockRejectedValue(
      new Error("Athena's window is only there in the app."),
    );
    await show();
    await feed(CUSTOM);
    await click(button("Hand to Athena"));
    expect(text()).toContain("only there in the app");
    expect(text()).not.toContain("It is in Athena's window");
    await click(button("Copy"));
    expect(writeText).toHaveBeenCalledWith(
      "Open my shared inbox and list who waits on me.",
    );
    expect(text()).toContain("Copied.");
    await click(button("Back to the chores"));
    expect(go).toHaveBeenLastCalledWith({ root: "chores" });
  });

  it("with no offer wired at all behaves as no shell", async () => {
    await show({ offer: null });
    await feed(CUSTOM);
    await click(button("Hand to Athena"));
    expect(text()).toContain("only there in the app");
    expect(button("Copy")).not.toBeNull();
  });
});

describe("leaving", () => {
  it("goes straight back with Escape when nothing is unsent", async () => {
    await show();
    escape();
    expect(go).toHaveBeenCalledWith({ root: "chores" });
  });

  it("asks first with unsent text, and Stay keeps the page", async () => {
    await show();
    await feed(CARD);
    type(q<HTMLTextAreaElement>("#ad-say")!, "airline credits");
    escape();
    expect(go).not.toHaveBeenCalled();
    expect(q('[role="alertdialog"]')).not.toBeNull();
    await click(button("Stay"));
    expect(q('[role="alertdialog"]')).toBeNull();
    escape();
    await click(button("Leave"));
    expect(go).toHaveBeenCalledWith({ root: "chores" });
  });

  it("asks first with an edited command that was not handed over", async () => {
    await show();
    await feed(CUSTOM);
    type(q<HTMLTextAreaElement>("#in-command")!, "something else");
    escape();
    expect(q('[role="alertdialog"]')).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("closes the session when the page unmounts", async () => {
    await show();
    await feed({ kind: "adopt.say", text: "Hi" });
    act(() => root.render(<div />));
    await flush();
    expect(intake.routes("close")).toContain("s1");
    root = createRoot(host);
  });
});

describe("the conversation", () => {
  it("sends free words to no question, a card's answers to its questions, and Just decide for me", async () => {
    await show();
    await feed(CARD);
    type(q<HTMLTextAreaElement>("#ad-say")!, NEED);
    await click(sendIn(".ad-composer"));
    expect(intake.routes("answer")[0]).toEqual({
      sid: "s1",
      answers: [{ question_id: "", choice_ids: [], text: NEED }],
      via: "text",
    });
    await click(button("Money"));
    await click(sendIn(".ad-card"));
    expect(intake.routes("answer")[1]).toMatchObject({
      answers: [{ question_id: "q-what", choice_ids: ["money"], text: "" }],
    });
    await click(button("Just decide for me"));
    expect(intake.routes("decide")).toEqual(["s1"]);
  });

  it("follows a dropped stream from the last seq and stops at session_closed", async () => {
    await show();
    await feed(
      { kind: "adopt.say", text: "One." },
      { kind: "adopt.say", text: "Two." },
    );
    intake.live.push(new Error("reset"));
    await flush();
    expect(waits).toEqual([1000]);
    expect(intake.streams).toHaveLength(2);
    expect(intake.live.after).toBe(2);
    await feed({
      kind: "adopt.error",
      reason: "session_closed",
      detail: "idle",
    });
    expect(text()).toContain("This conversation has ended.");
    intake.live.push("end");
    await flush();
    expect(intake.streams).toHaveLength(2);
    expect(waits).toEqual([1000]);
    expect(button("Start again")).not.toBeNull();
  });
});

describe("the states, in words, each with a way back", () => {
  it("says the daemon is missing when there are no deps, or no intake client", async () => {
    for (const d of [null, deps({ intake: undefined })]) {
      await show({ deps: d });
      expect(text()).toContain("Athena needs the daemon for this");
      expect(button("Back to the chores")).not.toBeNull();
      expect(q('[role="alertdialog"]')).toBeNull();
    }
  });

  it("says it is connecting while the session starts", async () => {
    intake.startWith = () => new Promise(() => {});
    await show();
    expect(text()).toContain("Reading what she already knows");
    expect(button("Close")).not.toBeNull();
  });

  it("says reconnecting, then gives up with Retry that follows again", async () => {
    await show();
    await feed({ kind: "adopt.say", text: "Hi" });
    for (let i = 0; i < 6; i++) {
      intake.live.push(new Error("reset"));
      await flush();
    }
    expect(text()).toContain("The conversation lost its connection.");
    expect(waits).toEqual([1000, 2000, 4000, 4000, 4000]);
    const before = intake.streams.length;
    await click(button("Retry"));
    expect(intake.streams.length).toBe(before + 1);
    expect(intake.starts).toBe(1);
  });

  it("says busy plainly, with Try again that starts a new session", async () => {
    intake.startWith = () =>
      Promise.reject(
        new ApiError(429, "budget_exhausted", "busy: 3 sessions live"),
      );
    await show();
    expect(text()).toContain("Athena has all her conversations open");
    expect(text()).toContain("Close one, then try again.");
    intake.startWith = () => Promise.resolve({ ok: true, session_id: "s2" });
    await click(button("Try again"));
    expect(intake.starts).toBe(2);
    expect(text()).not.toContain("all her conversations open");
  });

  it("says offline when the daemon is not there", async () => {
    intake.startWith = () =>
      Promise.reject(new ApiError(0, "offline", "The daemon is not running."));
    await show();
    expect(text()).toContain("Athena needs the daemon for this");
    expect(text()).toContain("Start it from Mind");
  });

  it("says an engine fault with Retry, which starts a new session carrying the need", async () => {
    await show();
    await feed({ kind: "adopt.say", text: "Tell me more." });
    type(q<HTMLTextAreaElement>("#ad-say")!, NEED);
    await click(sendIn(".ad-composer"));
    await feed({
      kind: "adopt.error",
      reason: "engine_error",
      detail: "claude stopped answering",
    });
    expect(text()).toContain("Athena could not finish thinking about this.");
    expect(text()).toContain("claude stopped answering");
    await click(button("Retry"));
    expect(intake.routes("start")).toEqual([null, NEED]);
    expect(intake.routes("close")).toContain("s1");
    expect(text()).not.toContain("could not finish thinking");
  });

  it("fills a fault away once she goes on", async () => {
    await show();
    await feed(
      { kind: "adopt.error", reason: "engine_error", detail: "blip" },
      { kind: "adopt.say", text: "Back." },
    );
    expect(text()).not.toContain("could not finish thinking");
  });
});

describe("a verdict is drawn once", () => {
  it("ignores an event the stream resends", async () => {
    await show();
    await feed(TEMPLATE);
    intake.live.push({ ...TEMPLATE, seq: 1, playbook_id: ALT } as AdoptEvent);
    await flush();
    expect(text()).toContain("It is the chore for credits");
    const title = q(".in-verdict__title")?.textContent;
    expect(title).toBe(
      model().items.find((v) => v.id === FIT)!.playbook.shortTitle,
    );
  });
});
