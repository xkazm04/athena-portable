// @vitest-environment jsdom
/**
 * The Adopt studio does what it says — ADR 0097, README section 3.5.
 *
 * The Chores view is rendered at a chore's studio with a fake client whose event stream the test
 * feeds by hand, and a person's gestures are played: every event kind is drawn, a card sends its
 * picks and words and collapses to a receipt that "change" reopens, a dropped stream is followed
 * again from the last seq, Approve opens only for the cleared revision or after "Good enough",
 * the showcase plays the recorded run with the person's portals and swaps on done (and keeps it on
 * failed), "Start for real" hands the brief's command, Close leaves and leaving deletes the
 * session, and a spoken take lands in the box unsent.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import { ApiError } from "@/lib/api";
import type {
  AdoptEvent,
  Answer,
  AnswerVia,
  Slot,
  StartReply,
} from "@/lib/adopt";
import { DOCUMENT_MIMES, type AdoptClient, type AdoptDocument } from "@/lib/adopt-client";
import type {
  PlaybookActions,
  PlaybooksModel,
} from "@/modules/playbooks/model";

import { fixtures } from "../fixtures";
import { rememberIntro } from "../memory";
import { adoptPath, chorePath } from "../model";
import ChoresView from "../view";
import type { AdoptDeps, Dictation } from "./deps";
import { PARK_LIMIT_MS, forgetParked, parked } from "./park";
import { MAX_TRIES } from "./session";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "travel-credit-refunds";

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

class FakeClient implements AdoptClient {
  calls: { route: string; body: unknown }[] = [];
  intros: (string | undefined)[] = [];
  streams: Stream[] = [];
  startWith: () => Promise<StartReply> = () =>
    Promise.resolve({ ok: true, session_id: "s1", slots: [], case: null });
  start(playbookId: string, intro?: string) {
    this.calls.push({ route: "start", body: playbookId });
    this.intros.push(intro);
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
  document(_sid: string, doc: AdoptDocument) {
    this.calls.push({ route: "document", body: doc.name });
    return Promise.resolve("d");
  }
  enough(sid: string) {
    this.calls.push({ route: "enough", body: sid });
    return Promise.resolve();
  }
  approve(sid: string, rev: number) {
    this.calls.push({ route: "approve", body: { sid, rev } });
    return Promise.resolve({ rev, case_id: "proj_0123456789ab", case_problem: "" });
  }
  cases(playbookId: string) {
    this.calls.push({ route: "cases", body: playbookId });
    return Promise.resolve({ ok: true as const, cases: [], showing: 0, total: 0, footer: "" });
  }
  runs(caseId: string) {
    this.calls.push({ route: "runs", body: caseId });
    const none = { ok: true as const, case_id: caseId, open: null };
    return Promise.resolve({ ...none, receipts: [], showing: 0, total: 0, footer: "" });
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

let host: HTMLDivElement;
let root: Root;
let go: ReturnType<typeof vi.fn<(to: Path) => void>>;
let client: FakeClient;
let hand: ReturnType<typeof vi.fn<PlaybookActions["hand"]>>;
let dictation: Dictation;
let waits: number[];
let seq: number;

function model(): PlaybooksModel {
  const m = fixtures.shipped!;
  return { ...m, actions: { copy: vi.fn(), open: vi.fn(), hand } };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

async function show(
  deps: AdoptDeps | null = {
    client,
    dictation,
    wait: (ms) => (waits.push(ms), Promise.resolve()),
  },
  path: Path = adoptPath(ID),
) {
  act(() => {
    root.render(
      <ChoresView
        model={model()}
        path={path}
        go={go}
        adopt={deps ?? undefined}
      />,
    );
  });
  await flush();
}

/** Feed the live stream events with the next seqs. */
type Unseq<E> = E extends unknown ? Omit<E, "seq"> : never;

async function feed(...events: Unseq<AdoptEvent>[]) {
  for (const e of events)
    client.live.push({ ...e, seq: (seq += 1) } as AdoptEvent);
  await flush();
}

const q = <T extends Element = HTMLElement>(sel: string) =>
  host.querySelector<T>(sel);
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => q(sel)?.textContent ?? "";
const button = (label: string) =>
  qa("button").find((b) => b.textContent?.trim() === label) ?? null;
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

const SLOTS: Slot[] = [
  {
    id: "p1",
    kind: "portal",
    label: "Mail",
    status: "confirmed",
    value: "Gmail",
    source: "user",
  },
  {
    id: "p2",
    kind: "portal",
    label: "Card",
    status: "guessed",
    value: "Chase",
    source: "research",
  },
  {
    id: "f1",
    kind: "fact",
    label: "Window",
    status: "open",
    value: "",
    source: "default",
  },
  {
    id: "t1",
    kind: "trap",
    label: "Own changes",
    status: "open",
    value: "",
    source: "default",
  },
];

const CARD = {
  kind: "adopt.questions" as const,
  round: 1,
  questions: [
    {
      id: "q-mail",
      slot_ids: ["p1"],
      text: "Where do notices land?",
      options: [
        { id: "gmail", label: "Gmail" },
        { id: "outlook", label: "Outlook" },
      ],
      multi: false,
      allow_text: false,
    },
    {
      id: "q-air",
      slot_ids: [],
      text: "Which airlines?",
      options: [
        { id: "a", label: "Aerolark" },
        { id: "d", label: "Delta" },
      ],
      multi: true,
      allow_text: true,
    },
  ],
};

const BRIEF = (rev: number) => ({
  kind: "adopt.brief" as const,
  rev,
  md: "You hold **credits** at Delta.",
  command: "Go through my Gmail and ask Delta for refunds.",
  portals: { Postwren: "Gmail", Cardhollow: "Chase Sapphire" },
  open_slot_ids: ["f1"],
});

beforeEach(() => {
  forgetParked();
  rememberIntro(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  go = vi.fn<(to: Path) => void>();
  hand = vi.fn<PlaybookActions["hand"]>();
  client = new FakeClient();
  waits = [];
  seq = 0;
  dictation = {
    check: () => Promise.resolve(null),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() =>
      Promise.resolve({ ok: true as const, text: "We also flew Skylindle." }),
    ),
    canSpeak: () => Promise.resolve("no voice in tests"),
    speak: vi.fn(() => Promise.resolve()),
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the session", () => {
  it("starts one for the playbook and follows its events from the start", async () => {
    await show();
    expect(client.routes("start")).toEqual([ID]);
    expect(client.streams.map((s) => s.after)).toEqual([0]);
    expect(text(".ad-title")).toBe(
      fixtures.shipped!.items.find((v) => v.id === ID)!.playbook.shortTitle,
    );
  });

  it("draws every kind of event", async () => {
    await show();
    await feed({ kind: "adopt.say", text: "Let's fit it **to you**." });
    expect(q(".ad-her strong")!.textContent).toBe("to you");

    await feed(
      { kind: "adopt.progress", text: "Writing questions…" },
      { kind: "adopt.progress", text: "Almost…" },
    );
    expect(qa(".ad-progress")).toHaveLength(1);
    expect(text(".ad-progress")).toBe("Almost…");

    await feed(CARD);
    expect(q(".ad-progress")).toBeNull();
    expect(qa(".ad-q")).toHaveLength(2);
    expect(text(".ad-card__round")).toBe("Round 1");

    await feed({ kind: "adopt.slots", slots: SLOTS });
    // Only a confirmed slot is counted as known; the guess is named beside it, as the legend names it.
    expect(text(".ad-count")).toBe("1 of 4 confirmed, 1 guessed");
    expect(qa(".ad-meter .ad-meter__seg").map((s) => s.dataset.status)).toEqual(
      ["confirmed", "guessed", "open", "open"],
    );
    expect(qa(".ad-group__h").map((h) => h.textContent)).toEqual([
      "Portals",
      "Facts",
      "Traps",
    ]);
    expect(qa(".ad-tile")[1]!.textContent).toContain("my guess");
    expect(qa(".ad-tile")[1]!.textContent).toContain("from research");

    await feed(
      {
        kind: "adopt.lane",
        lane: {
          id: "r",
          kind: "rules",
          title: "The refund rule",
          status: "running",
          summary: "",
          findings: [],
        },
      },
      {
        kind: "adopt.lane",
        lane: {
          id: "m",
          kind: "memory",
          title: "Memory",
          status: "done",
          summary: "From Boston.",
          findings: [
            {
              text: "3 h rule",
              source_url: "https://www.transportation.gov/x",
              slot_ids: [],
            },
          ],
        },
      },
      {
        kind: "adopt.lane",
        lane: {
          id: "r",
          kind: "rules",
          title: "The refund rule",
          status: "failed",
          summary: "timeout",
          findings: [],
        },
      },
    );
    expect(qa(".ad-lane")).toHaveLength(2);
    expect(text(".ad-harvest")).toBe(
      "1 of 2 lanes done · 1 failed (rules: timeout)",
    );
    // A lane's state is a word for people, not the wire's enum.
    expect(qa(".ad-lane__status").map((s) => s.textContent)).toEqual(["could not finish", "done"]);
    const link = q<HTMLAnchorElement>(".ad-findings a")!;
    expect(link.href).toBe("https://www.transportation.gov/x");
    expect(link.target).toBe("_blank");

    await feed({
      kind: "adopt.usage",
      leg: "interview",
      model: "claude-sonnet-5-5",
      effort: "low",
      ms: 2500,
      first_text_ms: 800,
    });
    expect(text(".ad-usage")).toBe("1 model call so far · 2.5 s");

    await feed({
      kind: "adopt.error",
      reason: "engine_error",
      detail: "The interviewer answered nothing.",
    });
    expect(text(".ad-error")).toContain("engine_error");
    expect(text(".ad-error")).toContain("The interviewer answered nothing.");

    await feed(BRIEF(1));
    expect(q(".ad-brief strong")!.textContent).toBe("credits");
    expect(text(".ad-brief")).toContain("Still her guess: Window.");
    // The brief folds the slots to a line a kind; they open again on request.
    expect(q(".ad-tile")).toBeNull();
    expect(qa(".ad-folded__v").map((v) => v.textContent)).toEqual([
      "Gmail",
      "Chase",
      "Window",
      "Own changes",
    ]);
    // The toggle says whether the slots are open, and shows focus like its sibling links.
    const more = button("Show every slot (4)")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.classList.contains("focus-ring")).toBe(true);
    await click(more);
    expect(qa(".ad-tile")).toHaveLength(4);
    expect(button("Fold the slots")!.getAttribute("aria-expanded")).toBe("true");
    await feed({ kind: "adopt.clear", rev: 1 });
    expect(button("Approve")!.hasAttribute("disabled")).toBe(false);

    await click(button("Approve"));
    await feed({
      kind: "adopt.showcase",
      status: "running",
      turn: 4,
      total: 11,
      trace: [],
      found_usd: null,
      detail: "",
    });
    expect(text(".ad-show")).toContain(
      "Practice run on invented data… turn 4 of 11",
    );
  });

  it("stops following when the daemon says the session closed, and says so", async () => {
    await show();
    await feed({
      kind: "adopt.error",
      reason: "session_closed",
      detail: "idle for two hours",
    });
    client.live.push("end");
    await flush();
    expect(client.streams).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(host.textContent).toContain(
      "This conversation has ended (idle for two hours)",
    );
  });

  it("counts its reconnects against the hook's own limit", async () => {
    await show({ client, dictation, wait: () => new Promise(() => {}) });
    client.live.push(new Error("reset"));
    await flush();
    expect(text(".ad-banner")).toBe(`The stream dropped. Reconnecting (try 1 of ${MAX_TRIES})…`);
  });

  it("follows a dropped stream again from the last seq, backing off, and gives up after five tries with a Retry", async () => {
    await show();
    await feed(
      { kind: "adopt.say", text: "a" },
      { kind: "adopt.say", text: "b" },
      { kind: "adopt.say", text: "c" },
    );
    client.live.push(new Error("reset"));
    await flush();
    expect(client.streams.map((s) => s.after)).toEqual([0, 3]);
    expect(waits).toEqual([1000]);
    // A resend of what was drawn is dropped; a new event is drawn and resets the count.
    await feed({ kind: "adopt.say", text: "d" });
    client.live.push({ kind: "adopt.say", seq: 2, text: "b again" });
    await flush();
    expect(qa(".ad-her").map((h) => h.textContent)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);

    for (let i = 0; i < 6; i++) {
      client.live.push(new ApiError(0, "offline", "Failed to fetch"));
      await flush();
    }
    expect(waits).toEqual([1000, 1000, 2000, 4000, 4000, 4000]);
    expect(client.streams.every((s, i) => i < 2 || s.after === 4)).toBe(true);
    expect(text(".ad-banner--lost")).toContain(
      "The conversation lost its connection.",
    );
    expect(text(".ad-banner--lost")).toContain("Failed to fetch");
    const before = client.streams.length;
    await click(button("Retry"));
    expect(client.streams).toHaveLength(before + 1);
    expect(client.live.after).toBe(4);
  });

  it("says the daemon is not running when the session cannot start, with a way back", async () => {
    client.startWith = () =>
      Promise.reject(new ApiError(0, "offline", "The daemon is not running."));
    await show();
    expect(text('[role="alert"], .problem, .ad-problem')).toContain(
      "The studio needs Athena's daemon",
    );
    await click(button("Back to the playbook"));
    expect(go).toHaveBeenLastCalledWith(chorePath(ID));
  });

  it("says why when the daemon refuses to start one (no engine)", async () => {
    client.startWith = () =>
      Promise.reject(
        new ApiError(503, "engine_missing", "No claude CLI on PATH."),
      );
    await show();
    expect(text(".ad-problem")).toContain("The studio could not start.");
    expect(text(".ad-problem")).toContain("No claude CLI on PATH.");
  });

  it("asks for the daemon when it is handed no client at all", async () => {
    await show(null);
    expect(text(".ad-problem")).toContain(
      "No daemon is connected to this window.",
    );
  });
});

describe("a question card", () => {
  it("sends every question's picks and words in one answer, then collapses to a receipt", async () => {
    await show();
    await feed(CARD);
    await click(button("Gmail"));
    expect(button("Gmail")!.getAttribute("aria-pressed")).toBe("true");
    await click(button("Outlook")); // one pick: the other lets go
    expect(button("Gmail")!.getAttribute("aria-pressed")).toBe("false");
    await click(button("Gmail"));
    await click(button("Aerolark"));
    await click(button("Delta")); // several picks: both stay
    type(q<HTMLInputElement>(".ad-q__input")!, "and Skylindle once");
    await click(button("Send"));
    expect(client.routes("answer")).toEqual([
      {
        sid: "s1",
        via: "text",
        answers: [
          { question_id: "q-mail", choice_ids: ["gmail"], text: "" },
          {
            question_id: "q-air",
            choice_ids: ["a", "d"],
            text: "and Skylindle once",
          },
        ],
      },
    ]);
    expect(q(".ad-card")).toBeNull();
    expect(text(".ad-receipt__line")).toBe(
      "Gmail · Aerolark, Delta, and Skylindle once",
    );
  });

  it("reopens on change with the earlier answer, and sends a new answer for the same questions", async () => {
    await show();
    await feed(CARD);
    await click(button("Gmail"));
    await click(button("Send"));
    await click(button("change"));
    expect(button("Gmail")!.getAttribute("aria-pressed")).toBe("true");
    await click(button("Outlook"));
    await click(button("Send"));
    const sent = client.routes("answer") as { answers: Answer[] }[];
    expect(sent).toHaveLength(2);
    expect(sent[1]!.answers[0]).toEqual({
      question_id: "q-mail",
      choice_ids: ["outlook"],
      text: "",
    });
    expect(text(".ad-receipt__line")).toBe("Outlook");
  });

  it("sends on Enter in the last field, and not before something is picked or written", async () => {
    await show();
    await feed(CARD);
    expect(button("Send")!.hasAttribute("disabled")).toBe(true);
    const input = q<HTMLInputElement>(".ad-q__input")!;
    type(input, "Delta only");
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();
    expect(
      (client.routes("answer")[0] as { answers: Answer[] }).answers[1]!.text,
    ).toBe("Delta only");
  });

  it("sends the composer's words as an answer to no question", async () => {
    await show();
    type(q<HTMLTextAreaElement>("#ad-say")!, "I paid with two cards.");
    await click(button("Send"));
    expect(client.routes("answer")).toEqual([
      {
        sid: "s1",
        via: "text",
        answers: [
          { question_id: "", choice_ids: [], text: "I paid with two cards." },
        ],
      },
    ]);
    expect(text(".ad-you")).toBe("I paid with two cards.");
  });

  it("keeps the composer's words when Enter is pressed before the session has started", async () => {
    client.startWith = () => new Promise(() => {});
    await show();
    const box = q<HTMLTextAreaElement>("#ad-say")!;
    type(box, "I paid with two cards.");
    act(() => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(q<HTMLTextAreaElement>("#ad-say")!.value).toBe("I paid with two cards.");
    expect(client.routes("answer")).toEqual([]);
  });

  it("refuses a document it cannot read, in the conversation, without sending it", async () => {
    await show();
    const input = q<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["x"], "notes.docx", { type: "application/msword" });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(text(".ad-doc")).toContain(
      "notes.docx is not a PDF, an image or a text file.",
    );
    // The picker offers exactly the kinds the refusal admits: one list, not two.
    expect(input.accept).toBe(DOCUMENT_MIMES.join(","));
    expect(client.routes("document")).toEqual([]);
  });
});

describe("the brief and the showcase", () => {
  it("opens Approve only for the cleared revision, or after Good enough", async () => {
    await show();
    await feed(BRIEF(1));
    expect(button("Approve")!.hasAttribute("disabled")).toBe(true);
    await feed({ kind: "adopt.clear", rev: 1 }, BRIEF(2));
    expect(button("Approve")!.hasAttribute("disabled")).toBe(true);
    await click(button("Good enough"));
    expect(client.routes("enough")).toEqual(["s1"]);
    expect(button("Approve")!.hasAttribute("disabled")).toBe(false);
    await click(button("Approve"));
    expect(client.routes("approve")).toEqual([{ sid: "s1", rev: 2 }]);
    expect(button("Approve")).toBeNull();
  });

  it("opens Good enough again when the daemon refused it, and says why", async () => {
    client.enough = () => Promise.reject(new ApiError(0, "offline", "The daemon is not running."));
    await show();
    await feed(BRIEF(1));
    await click(button("Good enough"));
    expect(text(".ad-error")).toContain("not running");
    expect(button("Good enough")!.hasAttribute("disabled")).toBe(false);
    expect(button("Approve")!.hasAttribute("disabled")).toBe(true);
  });

  it("plays the recorded run with the person's portals at once, and swaps to the rehearsal when it is done", async () => {
    await show();
    await feed(BRIEF(1), { kind: "adopt.clear", rev: 1 });
    await click(button("Approve"));
    expect(text(".ad-show__label")).toContain(
      "The benched run, shown with your portals",
    );
    expect(text(".ad-show__where .ch-chip")).toBe("Gmail"); // the recorded run opens on Postwren
    expect(text(".ad-show")).not.toContain("Postwren");
    await feed({
      kind: "adopt.showcase",
      status: "queued",
      turn: null,
      total: null,
      trace: [],
      found_usd: null,
      detail: "",
    });
    expect(text(".ad-show")).toContain(
      "Practice run on invented data…",
    );
    await feed({
      kind: "adopt.showcase",
      status: "done",
      turn: 2,
      total: 2,
      trace: [
        {
          portal: "Gmail",
          user: "Start.",
          said: "Reading the notices.",
          reads: [],
          cards: [],
        },
        {
          portal: "Delta",
          user: "",
          said: "Filed one.",
          reads: [],
          cards: [
            {
              action: "request_refund",
              key: "DL1",
              outcome: "correct",
              value_usd: 212,
            },
          ],
        },
      ],
      found_usd: 212,
      detail: "",
    });
    expect(text(".ad-show__label")).toContain(
      "Practice run on the example's data, with your app names — nothing was sent",
    );
    expect(text(".ad-show__n")).toBe("$212");
    expect(qa(".ad-route__dot")).toHaveLength(2);
    expect(text(".ad-show__where")).toContain("Turn 1 of 2");
  });

  it("keeps the recorded run when the rehearsal fails, and says why", async () => {
    await show();
    await feed(BRIEF(1), { kind: "adopt.clear", rev: 1 });
    await click(button("Approve"));
    const turns = qa(".ad-route__dot").length;
    await feed({
      kind: "adopt.showcase",
      status: "failed",
      turn: null,
      total: null,
      trace: [],
      found_usd: null,
      detail: "the world did not validate",
    });
    expect(text(".ad-show")).toContain(
      "The rehearsal did not finish: the world did not validate. The recorded run stays.",
    );
    expect(text(".ad-show__label")).toContain(
      "The benched run, shown with your portals",
    );
    expect(qa(".ad-route__dot")).toHaveLength(turns);
  });

  it("hands the brief's command to Athena on Start for real, with the case it was saved to", async () => {
    await show();
    await feed(BRIEF(1), { kind: "adopt.clear", rev: 1 });
    await click(button("Approve"));
    await click(button("Start for real"));
    const p = fixtures.shipped!.items.find((v) => v.id === ID)!;
    // The approve saved the case (ADR 0123); its id rides the hand-off (ADR 0124).
    expect(hand).toHaveBeenCalledWith(
      "Go through my Gmail and ask Delta for refunds.",
      { id: ID, title: p.title, caseId: "proj_0123456789ab" },
    );
    expect(text(".ad-said")).toContain(
      "It waits in her composer until you send it.",
    );
  });
});

describe("the brief's lifecycle, keyed by rev", () => {
  const answerCard = async () => {
    await feed(CARD);
    await click(button("Gmail"));
    await click(button("Send"));
  };

  it("case 5: a hand-off for draft 2 does not claim draft 3 was handed", async () => {
    await show();
    await feed(BRIEF(2), { kind: "adopt.clear", rev: 2 });
    await click(button("Approve"));
    await click(button("Start for real"));
    expect(text(".ad-said")).toContain("Handed to her with your case");
    await answerCard();
    await feed(BRIEF(3), { kind: "adopt.clear", rev: 3 });
    await click(button("Approve"));
    expect(client.routes("approve")).toEqual([
      { sid: "s1", rev: 2 },
      { sid: "s1", rev: 3 },
    ]);
    expect(text(".ad-show")).toContain("Hands the brief's command to Athena");
    expect(text(".ad-show")).not.toContain("Handed to her with your case");
  });

  it("case 6: a brief answered past cannot be approved, so no stage flashes for a stale rev", async () => {
    client.approve = () =>
      Promise.reject(
        new ApiError(409, "conflict", "stale_rev: brief 2 was answered past; a new one is being written"),
      );
    await show();
    await feed(BRIEF(2), { kind: "adopt.clear", rev: 2 });
    let drawn = false;
    const watch = new MutationObserver(() => {
      if (host.querySelector(".ad-show")) drawn = true;
    });
    watch.observe(host, { childList: true, subtree: true });
    await answerCard();
    expect(button("Approve")!.hasAttribute("disabled")).toBe(true);
    await click(button("Approve"));
    watch.disconnect();
    expect(client.routes("approve")).toEqual([]);
    expect(drawn).toBe(false);
    expect(button("Approve")!.parentElement!.getAttribute("title")).toMatch(/redraft/);
  });

  it("case 7: an answer the daemon refused does not leave the brief stale, so Approve opens again", async () => {
    client.answer = () =>
      Promise.reject(new ApiError(400, "validator_failed", "answers: no question 'q-mail' was asked"));
    await show();
    await feed(BRIEF(2), { kind: "adopt.clear", rev: 2 });
    await answerCard();
    expect(text(".ad-error")).toContain("no question");
    expect(button("Approve")!.hasAttribute("disabled")).toBe(false);
  });

  it("case 8: composer words the daemon refused do not leave the brief stale either", async () => {
    client.answer = () => Promise.reject(new ApiError(0, "offline", "The daemon is not running."));
    await show();
    await feed(BRIEF(2), { kind: "adopt.clear", rev: 2 });
    type(q<HTMLTextAreaElement>("#ad-say")!, "We also flew Delta.");
    await click(qa(".ad-composer button").find((b) => b.textContent?.trim() === "Send") ?? null);
    expect(text(".ad-error")).toContain("not running");
    expect(button("Approve")!.hasAttribute("disabled")).toBe(false);
  });

  it("a composer line the daemon refused is drawn not sent, and Send again posts it", async () => {
    const sent: string[] = [];
    let up = false;
    client.answer = (_sid, answers) => {
      if (!up) return Promise.reject(new ApiError(0, "offline", "The daemon is not running."));
      sent.push(answers[0]!.text);
      return Promise.resolve();
    };
    await show();
    type(q<HTMLTextAreaElement>("#ad-say")!, "We also flew Delta.");
    await click(qa(".ad-composer button").find((b) => b.textContent?.trim() === "Send") ?? null);
    expect(q(".ad-you")!.getAttribute("data-status")).toBe("failed");
    expect(text(".ad-you__not-sent")).toContain("Not sent");
    expect(sent).toEqual([]);
    up = true;
    await click(button("Send again"));
    await vi.waitFor(() => expect(sent).toEqual(["We also flew Delta."]), { timeout: 5000 });
    expect(q(".ad-you")!.getAttribute("data-status")).toBe("sent");
    expect(q(".ad-you__not-sent")).toBeNull();
  });

  it("guard: one refused send among two keeps the brief stale, since the other one landed", async () => {
    let n = 0;
    client.answer = () =>
      (n += 1) === 2 ? Promise.reject(new ApiError(0, "offline", "gone")) : Promise.resolve();
    await show();
    await feed(BRIEF(2), { kind: "adopt.clear", rev: 2 });
    await answerCard();
    type(q<HTMLTextAreaElement>("#ad-say")!, "And Delta.");
    await click(qa(".ad-composer button").find((b) => b.textContent?.trim() === "Send") ?? null);
    expect(button("Approve")!.hasAttribute("disabled")).toBe(true);
  });
});

describe("leaving parks the interview, and coming back offers Continue", () => {
  const OTHER = fixtures.shipped!.items.find((v) => v.id !== ID)!.id;

  /** Seven of her events, one answered card and one composer line: something worth keeping. */
  const talk = async (deps?: AdoptDeps) => {
    await show(deps);
    await feed({ kind: "adopt.say", text: "Let us start." }, CARD);
    await click(button("Gmail"));
    await click(button("Send"));
    type(q<HTMLTextAreaElement>("#ad-say")!, "I paid with two cards.");
    await click(button("Send"));
    await feed(
      { kind: "adopt.progress", text: "Looking it up" },
      { kind: "adopt.slots", slots: SLOTS },
      { kind: "adopt.say", text: "Thanks, that settles the mail." },
      { kind: "adopt.progress", text: "Drafting" },
      BRIEF(2),
    );
  };
  const leave = async () => {
    act(() => root.render(<div />));
    await flush();
  };

  it("case 1: leaving after something was said parks the conversation instead of closing it", async () => {
    await talk();
    await leave();
    expect(client.routes("close")).toEqual([]);
    const p = parked(`${ID}/`)!;
    expect(p.sid).toBe("s1");
    expect(p.lastSeq).toBe(7);
    expect(p.state.feed.some((f) => f.kind === "card" && f.answers !== null)).toBe(true);
    expect(
      p.state.feed.some((f) => f.kind === "you" && f.text === "I paid with two cards."),
    ).toBe(true);
  });

  it("case 2: coming back offers Continue, which follows the same session from where it stopped", async () => {
    await talk();
    await leave();
    await show();
    expect(client.routes("start")).toEqual([ID]);
    expect(text(".ad-resume")).toContain("2 answers, draft 2");
    expect(button("Start over")).not.toBeNull();
    await click(button("Continue"));
    expect(client.streams.map((s) => s.after)).toEqual([0, 7]);
    expect(text(".ad-receipt__line")).toBe("Gmail");
    expect(text(".ad-you")).toBe("I paid with two cards.");
    expect(text(".ad-convo")).toContain("Let us start.");
    await feed({ kind: "adopt.say", text: "Welcome back." });
    expect(text(".ad-convo")).toContain("Welcome back.");
    type(q<HTMLTextAreaElement>("#ad-say")!, "One more thing.");
    await click(button("Send"));
    expect(client.routes("answer").at(-1)).toMatchObject({ sid: "s1" });
  });

  it("case 3: Start over closes the parked session and starts one fresh", async () => {
    await talk();
    await leave();
    await show();
    await click(button("Start over"));
    expect(
      client.calls.filter((c) => c.route === "start" || c.route === "close").map((c) => c.route),
    ).toEqual(["start", "close", "start"]);
    expect(client.routes("close")).toEqual(["s1"]);
    expect(qa(".ad-you")).toHaveLength(0);
    expect(q(".ad-receipt__line")).toBeNull();
    expect(parked()).toBeNull();
  });

  it("case 4: opening another chore's studio closes the parked one before it starts", async () => {
    await talk();
    await leave();
    expect(client.routes("close")).toEqual([]);
    await show(undefined, adoptPath(OTHER));
    expect(
      client.calls.filter((c) => c.route === "start" || c.route === "close"),
    ).toEqual([
      { route: "start", body: ID },
      { route: "close", body: "s1" },
      { route: "start", body: OTHER },
    ]);
    expect(q(".ad-resume")).toBeNull();
    expect(parked()).toBeNull();
  });

  it("case 5: Continue on a session the daemon no longer knows starts fresh with the intro, and says so", async () => {
    rememberIntro({ id: ID, text: "I flew Delta twice." });
    await talk();
    await leave();
    rememberIntro(null);
    await show();
    await click(button("Continue"));
    client.live.push(new ApiError(404, "unknown_ref", "no adopt session 's1'"));
    await flush();
    expect(waits).toEqual([]);
    expect(client.streams.map((s) => s.after)).toEqual([0, 7, 0]);
    expect(client.intros).toEqual(["I flew Delta twice.", "I flew Delta twice."]);
    expect(text(".ad-page")).toContain("earlier conversation had ended");
    expect(button("Retry")).toBeNull();
    expect(qa(".ad-you")).toHaveLength(0);
  });

  it("case 6: a conversation parked past the local limit is closed on return, with no offer", async () => {
    let clock = 1_000;
    const deps: AdoptDeps = {
      client,
      dictation,
      wait: (ms) => (waits.push(ms), Promise.resolve()),
      now: () => clock,
    };
    await talk(deps);
    await leave();
    expect(parked()).not.toBeNull();
    clock += PARK_LIMIT_MS + 1;
    await show(deps);
    expect(client.routes("close")).toEqual(["s1"]);
    expect(client.routes("start")).toEqual([ID, ID]);
    expect(q(".ad-resume")).toBeNull();
    expect(parked()).toBeNull();
  });
});

describe("leaving, and the voice", () => {
  it("goes back on Close, and deletes the session when the studio goes", async () => {
    await show();
    await click(button("Close"));
    expect(go).toHaveBeenLastCalledWith(chorePath(ID));
    expect(client.routes("close")).toEqual([]);
    act(() => root.render(<div />));
    await flush();
    expect(client.routes("close")).toEqual(["s1"]);
    expect(parked()).toBeNull();
  });

  it("closes a session whose start was still in flight when the studio went", async () => {
    let resolve: (r: StartReply) => void = () => {};
    client.startWith = () => new Promise((r) => (resolve = r));
    await show();
    act(() => root.render(<div />));
    resolve({ ok: true, session_id: "late", slots: [], case: null });
    await flush();
    expect(client.routes("close")).toEqual(["late"]);
    expect(client.streams).toHaveLength(0);
  });

  it("asks before Escape leaves an unsent answer, and leaves at once otherwise", async () => {
    await show();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(go).toHaveBeenLastCalledWith(chorePath(ID));
    go.mockClear();
    type(q<HTMLTextAreaElement>("#ad-say")!, "half a thought");
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(go).not.toHaveBeenCalled();
    expect(text(".ad-ask")).toContain("Leave anyway?");
    // The question takes the focus, on the answer that loses nothing.
    expect(document.activeElement?.textContent?.trim()).toBe("Stay");
  });

  it("puts a spoken take in the box and never sends it on its own", async () => {
    await show();
    const mic = q(".ad-mic")!;
    act(() => {
      mic.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await flush();
    expect(dictation.start).toHaveBeenCalled();
    act(() => {
      mic.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    await flush();
    expect(q<HTMLTextAreaElement>("#ad-say")!.value).toBe(
      "We also flew Skylindle.",
    );
    expect(text(".ad-composer")).toContain("Heard from your voice.");
    expect(client.routes("answer")).toEqual([]);
    await click(button("Send"));
    expect(client.routes("answer")).toEqual([
      {
        sid: "s1",
        via: "voice",
        answers: [
          { question_id: "", choice_ids: [], text: "We also flew Skylindle." },
        ],
      },
    ]);
  });

  it("says why when hearing the take failed, and lets the microphone be held again", async () => {
    dictation.stop = vi.fn(() => Promise.reject(new Error("the listener stopped answering")));
    await show();
    const mic = q(".ad-mic")!;
    act(() => {
      mic.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await flush();
    act(() => {
      mic.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    await flush();
    expect(q(".ad-mic")!.getAttribute("data-phase")).toBe("idle");
    expect(text(".ad-mic")).toContain("Hold to talk");
    expect(text(".ad-mic__problem")).toContain("the listener stopped answering");
    expect(q<HTMLTextAreaElement>("#ad-say")!.value).toBe("");
  });

  it("disables the microphone with the reason when voice is not available", async () => {
    dictation.check = () =>
      Promise.resolve("Set up a listener in Mind → Voice first");
    await show();
    expect(q(".ad-mic")).toBeNull();
    expect(
      q('[aria-label="Set up a listener in Mind → Voice first"]'),
    ).not.toBeNull();
  });
});
