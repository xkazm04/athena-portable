/**
 * The Adopt studio's preview fixtures — ADR 0097, README section 3.5.
 *
 * A scripted client that plays a session the way the daemon would: an opening (her first line,
 * the slots, the research lanes setting off, the first card), then one stage per answer, a brief
 * the auditor clears, and on Approve a rehearsal that runs turn by turn and finishes (or fails, in
 * `adopt-show-failed`). `adopt-offline` is a daemon that is not there. Each `start` begins the
 * script afresh, so leaving the studio and coming back plays it again. The script is written for
 * the shipped "Airline credits" playbook; its rehearsal is the recorded run renamed to the
 * person's portals and cut short, so the swap is visible.
 *
 * Saved cases (ADR 0123): `case` is the topic page with one saved case to open, `case-offline` the
 * topic page with no daemon to ask, `adopt-case` the studio reopened on that case (its approved
 * brief at once, and only the date-like slot asked again).
 */
import { ApiError } from "@/lib/api";
import type {
  AdoptEvent,
  ApproveReply,
  CaseSummary,
  CasesReply,
  Lane,
  Question,
  RawTraceTurn,
  Receipt,
  RunsReply,
  Slot,
  StartReply,
} from "@/lib/adopt";
import type { AdoptClient } from "@/lib/adopt-client";
import type { TraceTurn } from "@/lib/playbooks";

import type { AdoptDeps, Dictation } from "./deps";
import { withPortals } from "./state";

type Unseq<E> = E extends unknown ? Omit<E, "seq"> : never;
type Beat = { ms: number; e: Unseq<AdoptEvent> };

export const ADOPT_PLAYBOOK = "travel-credit-refunds";

const PORTALS = {
  Postwren: "Gmail",
  Cardhollow: "Chase Sapphire",
  Aerolark: "",
  Skylindle: "Delta",
  Tripcairn: "Expedia",
};

const slot = (
  id: string,
  kind: Slot["kind"],
  label: string,
  status: Slot["status"] = "open",
  value = "",
  source: Slot["source"] = "default",
): Slot => ({
  id,
  kind,
  label,
  status,
  value,
  source,
});

const SLOTS_0: Slot[] = [
  slot("p-mail", "portal", "Where the notices arrive"),
  slot("p-card", "portal", "The card the fares were paid with"),
  slot("p-air1", "portal", "First airline", "guessed", "Aerolark"),
  slot("p-air2", "portal", "Second airline"),
  slot("p-agency", "portal", "Travel agency"),
  slot(
    "g-sign",
    "gate",
    "Who signs each refund request",
    "guessed",
    "You, one at a time",
  ),
  slot("f-home", "fact", "Where you fly from", "guessed", "Boston", "memory"),
  slot("f-window", "fact", "How far back to look"),
  slot("t-self", "trap", "Changes you made yourself"),
  slot("t-chose", "trap", "Credits you chose in writing"),
];

const SLOTS_1: Slot[] = SLOTS_0.map((s) => {
  switch (s.id) {
    case "p-mail":
      return { ...s, status: "confirmed", value: "Gmail", source: "user" };
    case "p-card":
      return {
        ...s,
        status: "confirmed",
        value: "Chase Sapphire",
        source: "user",
      };
    case "p-air1":
      return { ...s, status: "confirmed", source: "user" };
    case "p-air2":
      return { ...s, status: "confirmed", value: "Delta", source: "user" };
    case "f-window":
      return {
        ...s,
        status: "guessed",
        value: "The last 12 months",
        source: "research",
      };
    default:
      return s;
  }
});

const SLOTS_2: Slot[] = SLOTS_1.map((s) => {
  switch (s.id) {
    case "p-agency":
      return { ...s, status: "confirmed", value: "Expedia", source: "user" };
    case "f-window":
      return { ...s, status: "confirmed", source: "user" };
    case "t-self":
      return {
        ...s,
        status: "confirmed",
        value: "One: the March Delta flight",
        source: "user",
      };
    case "t-chose":
      return {
        ...s,
        status: "guessed",
        value: "None found in Gmail",
        source: "account",
      };
    default:
      return s;
  }
});

const ROUND_1: Question[] = [
  {
    id: "q-mail",
    slot_ids: ["p-mail"],
    text: "Where do the airlines' notices land?",
    options: [
      { id: "gmail", label: "Gmail" },
      { id: "outlook", label: "Outlook" },
      { id: "postwren", label: "Postwren, as in the playbook" },
    ],
    multi: false,
    allow_text: true,
  },
  {
    id: "q-airlines",
    slot_ids: ["p-air1", "p-air2"],
    text: "Which airlines hold credits or fees of yours?",
    options: [
      { id: "aerolark", label: "Aerolark" },
      { id: "delta", label: "Delta" },
      { id: "united", label: "United" },
      { id: "jetblue", label: "JetBlue" },
    ],
    multi: true,
    allow_text: true,
  },
  {
    id: "q-card",
    slot_ids: ["p-card"],
    text: "Which card paid for the fares?",
    options: [],
    multi: false,
    allow_text: true,
  },
];

const ROUND_2: Question[] = [
  {
    id: "q-agency",
    slot_ids: ["p-agency"],
    text: "Did a travel agency book any of them?",
    options: [
      { id: "expedia", label: "Expedia" },
      { id: "none", label: "No agency" },
    ],
    multi: false,
    allow_text: true,
  },
  {
    id: "q-self",
    slot_ids: ["t-self", "f-window"],
    text: "Did you change or cancel any of these flights yourself in the last year?",
    options: [
      { id: "no", label: "No" },
      { id: "one", label: "Yes, one" },
      { id: "several", label: "Yes, several" },
    ],
    multi: false,
    allow_text: true,
  },
];

const lane = (
  id: string,
  kind: Lane["kind"],
  title: string,
  status: Lane["status"],
  summary = "",
  findings: Lane["findings"] = [],
): Lane => ({
  id,
  kind,
  title,
  status,
  summary,
  findings,
});

const BRIEF_MD = [
  "You hold **credits and fees from Aerolark and Delta**, and two tickets Expedia charged to your **Chase Sapphire**.",
  "",
  "**She will ask for a refund to your card where:**",
  "- the airline moved a flight 3 hours or more, or changed its airport or stops",
  "- you paid for a seat the plane did not have",
  "",
  "**She will leave alone:**",
  "- the March Delta flight you changed yourself",
  "- anything already refunded or spent",
].join("\n");

function opening(): Beat[] {
  return [
    {
      ms: 200,
      e: {
        kind: "adopt.say",
        text: "Let's fit **Airline credits turned back into card refunds** to your case. I'll ask only what differs; the rest I'll look up.",
      },
    },
    { ms: 300, e: { kind: "adopt.slots", slots: SLOTS_0 } },
    {
      ms: 200,
      e: {
        kind: "adopt.lane",
        lane: lane(
          "rules",
          "rules",
          "The refund rule, from public sources",
          "running",
        ),
      },
    },
    {
      ms: 100,
      e: {
        kind: "adopt.lane",
        lane: lane("accounts", "accounts", "Your Gmail, read only", "running"),
      },
    },
    {
      ms: 100,
      e: {
        kind: "adopt.lane",
        lane: lane("memory", "memory", "What Athena already knows", "running"),
      },
    },
    {
      ms: 300,
      e: { kind: "adopt.progress", text: "Writing the first questions…" },
    },
    {
      ms: 200,
      e: {
        kind: "adopt.usage",
        leg: "interview",
        model: "claude-sonnet-5-5",
        effort: "low",
        ms: 2400,
        first_text_ms: 900,
      },
    },
    { ms: 500, e: { kind: "adopt.questions", round: 1, questions: ROUND_1 } },
    {
      ms: 400,
      e: {
        kind: "adopt.lane",
        lane: lane(
          "memory",
          "memory",
          "What Athena already knows",
          "done",
          "You fly from Boston.",
          [
            {
              text: "Home airport: Boston Logan",
              source_url: "",
              slot_ids: ["f-home"],
            },
          ],
        ),
      },
    },
  ];
}

function afterRound1(): Beat[] {
  return [
    { ms: 200, e: { kind: "adopt.progress", text: "Reading your answers…" } },
    { ms: 400, e: { kind: "adopt.slots", slots: SLOTS_1 } },
    {
      ms: 300,
      e: {
        kind: "adopt.lane",
        lane: lane(
          "rules",
          "rules",
          "The refund rule, from public sources",
          "done",
          "A refund is owed for a change of 3 hours or more on a domestic flight.",
          [
            {
              text: "Significant change: 3 h domestic, 6 h international.",
              source_url: "https://www.transportation.gov/airconsumer/refunds",
              slot_ids: ["f-window"],
            },
          ],
        ),
      },
    },
    {
      ms: 300,
      e: {
        kind: "adopt.lane",
        lane: lane(
          "accounts",
          "accounts",
          "Your Gmail, read only",
          "failed",
          "timeout",
        ),
      },
    },
    {
      ms: 200,
      e: {
        kind: "adopt.usage",
        leg: "audit",
        model: "claude-sonnet-5-5",
        effort: "medium",
        ms: 3100,
        first_text_ms: null,
      },
    },
    {
      ms: 300,
      e: {
        kind: "adopt.say",
        text: "Thanks. Gmail did not answer in time, so two things are still open.",
      },
    },
    { ms: 300, e: { kind: "adopt.questions", round: 2, questions: ROUND_2 } },
  ];
}

function brief(rev: number, open: string[]): Beat[] {
  return [
    { ms: 200, e: { kind: "adopt.progress", text: "Drafting the brief…" } },
    { ms: 400, e: { kind: "adopt.slots", slots: SLOTS_2 } },
    {
      ms: 300,
      e: {
        kind: "adopt.say",
        text: "That is all I need. **The brief is on the right**; approve it and I'll show you the run with your portals.",
      },
    },
    {
      ms: 200,
      e: {
        kind: "adopt.brief",
        rev,
        md: BRIEF_MD,
        command:
          "Go through my Gmail, my Chase Sapphire statement, and the credits and fees at Aerolark, Delta and Expedia. Ask for a refund to my card of each one the refund rule says is owed, with the reason. Leave out the March Delta flight I changed myself.",
        portals: PORTALS,
        open_slot_ids: open,
      },
    },
  ];
}

/** The saved case the case fixtures hold. */
export const PREVIEW_CASE: CaseSummary = {
  case_id: "proj_0a1b2c3d4e5f",
  playbook_id: ADOPT_PLAYBOOK,
  title: "Airline credits turned back into card refunds",
  approved_rev: 1,
  approved_at: "2026-10-08T17:42:00+00:00",
  created: "2026-10-08T17:42:00+00:00",
  confirmed: 8,
  slots: 10,
};

/** A closed run of the preview case (ADR 0124): what its cards and the ledger came to. */
export const PREVIEW_RECEIPT: Receipt = {
  case_id: PREVIEW_CASE.case_id,
  conversation_id: `conv_${PREVIEW_CASE.case_id}`,
  since: "",
  until: "2026-10-09T10:20:00+00:00",
  first_at: "2026-10-09T09:02:11+00:00",
  last_at: "2026-10-09T10:14:40+00:00",
  approved: 2,
  consumed: 2,
  declined: 1,
  expired: 0,
  pending: 0,
  asked_usd: 712.4,
  asked_cards: 2,
  calls: 9,
  errors: 1,
  cost_usd: 0.4123,
  unpriced: 0,
  ms: 381000,
  cards: [
    {
      id: "apr_0a0a0a0a0a01",
      action: "host.skylindle.request_refund",
      status: "approved",
      consumed: true,
      created_at: "2026-10-09T09:10:02+00:00",
      resolved_at: "2026-10-09T09:11:30+00:00",
      params: { amount_usd: "412.4", booking: "SKY-4QX2" },
      more_params: 0,
      amount_usd: 412.4,
    },
    {
      id: "apr_0a0a0a0a0a02",
      action: "host.aerovale.request_refund",
      status: "approved",
      consumed: true,
      created_at: "2026-10-09T09:40:19+00:00",
      resolved_at: "2026-10-09T09:41:02+00:00",
      params: { amount_usd: "300", booking: "AV-77810", reason: "<b>cancelled by the airline</b>" },
      more_params: 1,
      amount_usd: 300,
    },
    {
      id: "apr_0a0a0a0a0a03",
      action: "host.aerovale.convert_credit",
      status: "declined",
      consumed: false,
      created_at: "2026-10-09T09:52:44+00:00",
      resolved_at: "2026-10-09T09:53:01+00:00",
      params: { credit: "AV-C-118" },
      more_params: 0,
      amount_usd: null,
    },
  ],
  cards_total: 3,
  cards_footer: "",
  notes: [],
  notes_total: 0,
  notes_footer: "",
  closed_by: "done",
  closed_at: "2026-10-09T10:20:00+00:00",
  schema: 1,
};

/** A reopened case: what she confirmed carries over from memory; the look-back window is asked again. */
function reopened(): Beat[] {
  const slots = SLOTS_2.map((s): Slot => {
    if (s.id === "f-window") return { ...s, status: "guessed", source: "memory" };
    return s.source === "user" ? { ...s, source: "memory" } : s;
  });
  return [
    { ms: 200, e: { kind: "adopt.slots", slots } },
    {
      ms: 200,
      e: {
        kind: "adopt.say",
        text: "Your case is back as you approved it on 2026-10-08. 6 things you told me carry over. 1 date or amount may have changed since, so I'll ask about that one again.",
      },
    },
    ...brief(1, ["f-window", "t-chose"]).slice(3),
    {
      ms: 500,
      e: {
        kind: "adopt.questions",
        round: 1,
        questions: [
          {
            id: "r1q1",
            slot_ids: ["f-window"],
            text: "Still the last 12 months, counted from today?",
            options: [
              { id: "a", label: "Yes, from today" },
              { id: "b", label: "From when I last ran it" },
            ],
            multi: false,
            allow_text: true,
          },
        ],
      },
    },
  ];
}

function toRaw(t: TraceTurn): RawTraceTurn {
  return {
    portal: t.portal,
    user: t.user,
    continued: t.continued,
    said: t.said,
    said_chars: t.saidChars,
    reads: [...t.reads],
    cards: t.cards.map((c) => ({
      action: c.action,
      key: c.key,
      outcome: c.outcome,
      value_usd: c.valueUsd,
    })),
  };
}

function rehearsal(recorded: readonly TraceTurn[], fail: boolean): Beat[] {
  const tailored = withPortals(recorded, PORTALS).slice(
    0,
    Math.max(1, Math.min(6, recorded.length)),
  );
  const total = tailored.length;
  const beats: Beat[] = [
    {
      ms: 200,
      e: {
        kind: "adopt.showcase",
        status: "queued",
        turn: null,
        total: null,
        trace: [],
        found_usd: null,
        detail: "",
      },
    },
  ];
  for (let i = 1; i <= (fail ? 2 : total); i++) {
    beats.push({
      ms: 900,
      e: {
        kind: "adopt.showcase",
        status: "running",
        turn: i,
        total,
        trace: [],
        found_usd: null,
        detail: "",
      },
    });
  }
  beats.push(
    fail
      ? {
          ms: 600,
          e: {
            kind: "adopt.showcase",
            status: "failed",
            turn: null,
            total,
            trace: [],
            found_usd: null,
            detail: "the shaped world did not pass the spec check",
          },
        }
      : {
          ms: 600,
          e: {
            kind: "adopt.showcase",
            status: "done",
            turn: total,
            total,
            trace: tailored.map(toRaw),
            found_usd: 612.4,
            detail: "",
          },
        },
  );
  return beats;
}

/** A session the preview plays; every call the studio makes is logged for a test to read. */
export class ScriptedClient implements AdoptClient {
  calls: { route: string; body: unknown }[] = [];
  private seq = 0;
  private played: AdoptEvent[] = [];
  private wake = new Set<() => void>();
  private answers = 0;
  private briefed = false;
  private reopenedCase = false;
  private run = 0;
  constructor(
    private readonly recorded: readonly TraceTurn[],
    private readonly opts: {
      offline?: boolean;
      showFails?: boolean;
      speed?: number;
      /** The saved cases `cases()` answers (ADR 0123). */
      cases?: CaseSummary[];
      /** The receipts `runs()` answers, latest first, for every case (ADR 0124). */
      receipts?: Receipt[];
    } = {},
  ) {}

  private play(beats: Beat[]) {
    const run = this.run;
    const speed = this.opts.speed ?? 1;
    let at = 0;
    for (const b of beats) {
      at += b.ms * speed;
      setTimeout(() => {
        if (run !== this.run) return;
        this.played.push({ ...b.e, seq: (this.seq += 1) } as AdoptEvent);
        for (const w of [...this.wake]) w();
      }, at);
    }
  }

  start(playbookId: string, _intro?: string, caseId?: string): Promise<StartReply> {
    this.calls.push({
      route: "start",
      body: caseId ? { playbook_id: playbookId, case_id: caseId } : { playbook_id: playbookId },
    });
    if (this.opts.offline)
      return Promise.reject(
        new ApiError(0, "offline", "The daemon is not running."),
      );
    this.run += 1;
    this.seq = 0;
    this.played = [];
    this.answers = 0;
    this.briefed = false;
    const held = caseId ? (this.opts.cases ?? []).find((c) => c.case_id === caseId) : undefined;
    if (caseId && !held)
      return Promise.reject(new ApiError(404, "unknown_ref", `no saved case '${caseId}'`));
    this.briefed = held !== undefined;
    this.reopenedCase = held !== undefined;
    this.play(held ? reopened() : opening());
    return Promise.resolve({
      ok: true,
      session_id: `preview-${this.run}`,
      slots: [],
      case: held ?? null,
    });
  }

  cases(playbookId: string): Promise<CasesReply> {
    this.calls.push({ route: "cases", body: { playbook_id: playbookId } });
    if (this.opts.offline)
      return Promise.reject(new ApiError(0, "offline", "The daemon is not running."));
    const cases = (this.opts.cases ?? []).filter((c) => c.playbook_id === playbookId);
    return Promise.resolve({ ok: true, cases, showing: cases.length, total: cases.length, footer: "" });
  }

  runs(caseId: string): Promise<RunsReply> {
    this.calls.push({ route: "runs", body: { case_id: caseId } });
    if (this.opts.offline)
      return Promise.reject(new ApiError(0, "offline", "The daemon is not running."));
    const receipts = (this.opts.receipts ?? []).filter((r) => r.case_id === caseId);
    return Promise.resolve({
      ok: true,
      case_id: caseId,
      conversation_id: `conv_${caseId}`,
      open: null,
      receipts,
      showing: receipts.length,
      total: receipts.length,
      footer: "",
    });
  }

  async *events_(
    after: number,
    signal: AbortSignal,
  ): AsyncGenerator<AdoptEvent> {
    let at = after;
    while (!signal.aborted) {
      const next = this.played.filter((e) => e.seq > at);
      for (const e of next) {
        at = e.seq;
        yield e;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          this.wake.delete(done);
          resolve();
        };
        this.wake.add(done);
        signal.addEventListener("abort", done);
      });
    }
  }

  events(
    sid: string,
    after: number,
    signal: AbortSignal,
  ): AsyncGenerator<AdoptEvent> {
    this.calls.push({ route: "events", body: { sid, after } });
    return this.events_(after, signal);
  }

  answer(sid: string, answers: readonly unknown[], via: string): Promise<void> {
    this.calls.push({ route: "answer", body: { sid, answers, via } });
    const cards = (answers as { question_id: string }[]).some(
      (a) => a.question_id !== "",
    );
    if (cards) {
      this.answers += 1;
      if (this.reopenedCase && this.answers === 1)
        this.play([
          ...brief(2, ["t-chose"]),
          { ms: 500, e: { kind: "adopt.clear", rev: 2 } },
        ]);
      else if (this.answers === 1) this.play(afterRound1());
      else if (this.answers === 2 && !this.briefed) {
        this.briefed = true;
        this.play([
          ...brief(1, ["t-chose"]),
          { ms: 500, e: { kind: "adopt.clear", rev: 1 } },
        ]);
      }
    } else
      this.play([
        {
          ms: 600,
          e: { kind: "adopt.say", text: "Noted. I'll keep that in the brief." },
        },
      ]);
    return Promise.resolve();
  }

  document(sid: string, doc: { name: string }): Promise<string> {
    this.calls.push({ route: "document", body: { sid, name: doc.name } });
    this.play([
      {
        ms: 300,
        e: {
          kind: "adopt.lane",
          lane: lane(
            `doc-${doc.name}`,
            "document",
            `Reading ${doc.name}`,
            "running",
          ),
        },
      },
    ]);
    return Promise.resolve(`doc-${this.calls.length}`);
  }

  enough(sid: string): Promise<void> {
    this.calls.push({ route: "enough", body: { sid } });
    if (!this.briefed) {
      this.briefed = true;
      this.play(brief(1, ["p-agency", "t-self", "t-chose"]));
    }
    return Promise.resolve();
  }

  approve(sid: string, rev: number): Promise<ApproveReply> {
    this.calls.push({ route: "approve", body: { sid, rev } });
    this.play(rehearsal(this.recorded, this.opts.showFails === true));
    return Promise.resolve({ rev, case_id: PREVIEW_CASE.case_id, case_problem: "" });
  }

  close(sid: string): Promise<void> {
    this.calls.push({ route: "close", body: { sid } });
    this.run += 1;
    return Promise.resolve();
  }
}

/** A preview's voice: always available, hears a fixed sentence. */
export const scriptedDictation: Dictation = {
  check: () => Promise.resolve(null),
  start: () => Promise.resolve(),
  stop: () =>
    Promise.resolve({ ok: true, text: "We also flew Skylindle once, in May." }),
  canSpeak: () => Promise.resolve("Voice is not played in the preview"),
  speak: () => Promise.resolve(),
};

export const ADOPT_FIXTURES = [
  "adopt",
  "adopt-show-failed",
  "adopt-offline",
] as const;

/**
 * The saved-case fixtures (ADR 0123): the topic page with a case (no run yet), with no daemon, and the
 * reopened studio; and the topic page whose case has a closed run (ADR 0124).
 */
export const CASE_FIXTURES = ["case", "case-offline", "adopt-case", "case-runs"] as const;

const made = new Map<string, AdoptDeps>();

/** The deps a preview fixture hands the studio; the same object every render, so a session is not restarted. */
export function adoptDepsFor(
  fixture: string,
  recorded: readonly TraceTurn[],
): AdoptDeps | undefined {
  const all = [...ADOPT_FIXTURES, ...CASE_FIXTURES] as readonly string[];
  if (!all.includes(fixture)) return undefined;
  const known = made.get(fixture);
  if (known) return known;
  const deps: AdoptDeps = {
    client: new ScriptedClient(recorded, {
      offline: fixture === "adopt-offline" || fixture === "case-offline",
      showFails: fixture === "adopt-show-failed",
      cases: (CASE_FIXTURES as readonly string[]).includes(fixture) ? [PREVIEW_CASE] : [],
      receipts: fixture === "case-runs" ? [PREVIEW_RECEIPT] : [],
    }),
    dictation: scriptedDictation,
  };
  made.set(fixture, deps);
  return deps;
}
