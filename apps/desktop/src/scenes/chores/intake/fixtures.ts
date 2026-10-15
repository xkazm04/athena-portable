/**
 * The Chores front door's preview fixtures — ADR 0098, README section 3.5.
 *
 * A scripted client that plays a session the way the daemon would: her opening line and one card,
 * then on the answer (or on "Just decide for me") the verdict. `intake-template` ends on the
 * shipped "Airline credits" chore with a nearly-fitting alternate; `intake-custom` ends on a
 * command made for the need; `intake-error` fails the engine on the first answer, and the retry
 * (a new session) reaches the template verdict; `intake-offline` is a daemon that is not there.
 * Each `start` begins the script afresh.
 */
import { PLAYBOOKS } from "@/lib/playbooks.shipped";
import { ApiError } from "@/lib/api";
import type { AdoptEvent, Answer, Verdict } from "@/lib/adopt";
import type { IntakeClient } from "@/lib/intake-client";
import type { TraceTurn } from "@/lib/playbooks";

import {
  ADOPT_PLAYBOOK,
  ScriptedClient,
  scriptedDictation,
} from "../adopt/fixtures";
import type { AdoptDeps } from "../adopt/deps";

type Unseq<E> = E extends unknown ? Omit<E, "seq"> : never;
type Beat = { ms: number; e: Unseq<AdoptEvent> };

export const INTAKE_FIXTURES = [
  "intake-template",
  "intake-custom",
  "intake-error",
  "intake-offline",
] as const;

const NEED = "I want my airline credits back before they expire.";

const OTHER = PLAYBOOKS.find((p) => p.id !== ADOPT_PLAYBOOK);

const TEMPLATE: Verdict = {
  fit: "template",
  playbook_id: ADOPT_PLAYBOOK,
  why: "You are chasing credits and refunds that airlines owe you, which is exactly the job this chore was benched on.",
  differs:
    "Your airlines and the card you paid with are not the ones in the recorded run, so she asks for those first.",
  alternates: OTHER
    ? [
        {
          playbook_id: OTHER.id,
          title: OTHER.shortTitle,
          why: "Close if the money is owed by a carrier, not an airline.",
        },
      ]
    : [],
  need: NEED,
  command: "",
};

const CUSTOM: Verdict = {
  fit: "custom",
  playbook_id: "",
  why: "None of the chores in the library covers sorting a shared inbox by who owes you a reply.",
  differs: "",
  alternates: [],
  need: "I want to know who owes me a reply in my shared inbox.",
  command:
    "Open my shared inbox, list every thread from the last 30 days where the last message is not mine, " +
    "and give me the five oldest with who is waiting. Do not reply to anything.",
};

const opening = (): Beat[] => [
  { ms: 200, e: { kind: "adopt.progress", text: "Reading what you said…" } },
  {
    ms: 900,
    e: {
      kind: "adopt.say",
      text: "Let me check this against the chores you already have.",
    },
  },
  {
    ms: 700,
    e: {
      kind: "adopt.questions",
      round: 1,
      questions: [
        {
          id: "q-what",
          slot_ids: [],
          text: "What is it you want back or done?",
          options: [
            { id: "money", label: "Money or credits" },
            { id: "replies", label: "Replies I am owed" },
            { id: "other", label: "Something else" },
          ],
          multi: false,
          allow_text: true,
        },
      ],
    },
  },
];

const verdict = (v: Verdict, ms = 1200): Beat[] => [
  { ms: 100, e: { kind: "adopt.progress", text: "Deciding…" } },
  { ms, e: { kind: "adopt.verdict", ...v } },
];

export class ScriptedIntake implements IntakeClient {
  calls: { route: string; body: unknown }[] = [];
  private seq = 0;
  private played: AdoptEvent[] = [];
  private wake = new Set<() => void>();
  private run = 0;
  private starts = 0;
  constructor(
    private readonly fixture: (typeof INTAKE_FIXTURES)[number],
    private readonly speed = 1,
  ) {}

  private play(beats: Beat[]) {
    const run = this.run;
    let at = 0;
    for (const b of beats) {
      at += b.ms * this.speed;
      setTimeout(() => {
        if (run !== this.run) return;
        this.played.push({ ...b.e, seq: (this.seq += 1) } as AdoptEvent);
        for (const w of [...this.wake]) w();
      }, at);
    }
  }

  start(need?: string) {
    this.calls.push({ route: "start", body: need ?? null });
    if (this.fixture === "intake-offline")
      return Promise.reject(
        new ApiError(0, "offline", "The daemon is not running."),
      );
    this.run += 1;
    this.starts += 1;
    this.seq = 0;
    this.played = [];
    this.play(opening());
    return Promise.resolve({
      ok: true as const,
      session_id: `intake-${this.run}`,
    });
  }

  private async *eventsFrom(
    after: number,
    signal: AbortSignal,
  ): AsyncGenerator<AdoptEvent> {
    let at = after;
    while (!signal.aborted) {
      for (const e of this.played.filter((x) => x.seq > at)) {
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

  events(sid: string, after: number, signal: AbortSignal) {
    this.calls.push({ route: "events", body: { sid, after } });
    return this.eventsFrom(after, signal);
  }

  answer(sid: string, answers: readonly Answer[], via: string) {
    this.calls.push({ route: "answer", body: { sid, answers, via } });
    const card = answers.some((a) => a.question_id !== "");
    if (!card) {
      this.play([
        { ms: 600, e: { kind: "adopt.say", text: "Noted. That helps." } },
      ]);
    } else if (this.fixture === "intake-error" && this.starts === 1) {
      this.play([
        {
          ms: 800,
          e: {
            kind: "adopt.error",
            reason: "engine_error",
            detail: "The claude engine stopped answering.",
          },
        },
      ]);
    } else if (this.fixture === "intake-custom") this.play(verdict(CUSTOM));
    else this.play(verdict(TEMPLATE));
    return Promise.resolve();
  }

  decide(sid: string) {
    this.calls.push({ route: "decide", body: { sid } });
    this.play(
      verdict(this.fixture === "intake-custom" ? CUSTOM : TEMPLATE, 600),
    );
    return Promise.resolve();
  }

  close(sid: string) {
    this.calls.push({ route: "close", body: { sid } });
    return Promise.resolve();
  }
}

const made = new Map<string, AdoptDeps>();

/**
 * The deps a preview fixture hands the front door; the same object every render, so a session is not
 * restarted. The Adopt client beside it is the studio's scripted one, so "Make it yours" plays on.
 */
export function intakeDepsFor(
  fixture: string,
  recorded: readonly TraceTurn[],
): AdoptDeps | undefined {
  if (!(INTAKE_FIXTURES as readonly string[]).includes(fixture))
    return undefined;
  const known = made.get(fixture);
  if (known) return known;
  const deps: AdoptDeps = {
    client: new ScriptedClient(recorded),
    intake: new ScriptedIntake(fixture as (typeof INTAKE_FIXTURES)[number]),
    dictation: scriptedDictation,
  };
  made.set(fixture, deps);
  return deps;
}
