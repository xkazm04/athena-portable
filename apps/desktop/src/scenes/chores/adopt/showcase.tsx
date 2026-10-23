/**
 * The showcase, once the brief is approved — ADR 0097, README section 3.5.
 *
 * Shown at once: the playbook's recorded bench run with the person's portal names in it, played
 * turn by turn, labelled for what it is. Meanwhile the daemon runs a practice run; while it runs a
 * line says which turn it is on, and when it is done its own trace takes the recorded one's place.
 *
 * Each label says what was really done (chores UAT 2026-10-23, theme 5):
 * - The shape changed nothing but the app names: it is the example's own data, so the label says
 *   "Practice run on the example's data, with your app names", and its figure is "$X back in the
 *   example". Only money-back cards sum into that figure; money protected and penalties avoided
 *   say so in their own words, and a count (a scoring weight) is never dollars.
 * - The shape changed rows or the date (ADR 0125): "Practice run adjusted to N things you told
 *   her", no dollar figure, and no card marked right or wrong — the example's answer key was
 *   written for other rows. The daemon sends such cards as `"proposed"`; they are drawn as plain
 *   cards here whatever the outcome they carry.
 * - The bench never approves a card (`approve: "none"`), so every card is one she would propose
 *   for an OK nobody gave: nothing was sent, and the words say "would propose", never "filed".
 *
 * A rehearsal that failed leaves the recorded run and says why. Then "Start for real" hands the
 * brief's command to Athena.
 */
import { useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import type { RawTraceTurn } from "@/lib/adopt";
import { parseTrace, usd, type TraceTurn, type ValueKind } from "@/lib/playbooks";
import { MONEY_KINDS, kindAmount } from "@/modules/playbooks/model";

import { REPLAY_STEP_MS } from "../replay";
import TurnView from "../turn";
import { withPortals, type ShowcaseEvent } from "./state";

export interface Shown {
  trace: TraceTurn[];
  tailored: boolean;
  /** The practice run's world was shaped beyond the app names: nothing in it is graded. */
  shaped: boolean;
  label: string;
}

const VALUE_KINDS: readonly ValueKind[] = ["money_back", "money_protected", "penalty_avoided", "count"];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The kind of each tool's cards as the daemon labelled them in the practice run's trace. Pure. */
export function kindsIn(raw: readonly RawTraceTurn[]): Record<string, ValueKind> {
  const out: Record<string, ValueKind> = {};
  for (const turn of raw) {
    for (const card of Array.isArray(turn.cards) ? turn.cards : []) {
      if (!isObj(card) || typeof card.action !== "string") continue;
      const kind = card.kind;
      if (typeof kind === "string" && (VALUE_KINDS as readonly string[]).includes(kind)) {
        out[card.action] = kind as ValueKind;
      }
    }
  }
  return out;
}

/** How many things the shape changed, from the practice run's first turn; `null` when unsaid. */
export function adjustedIn(raw: readonly RawTraceTurn[]): number | null {
  const n = raw[0]?.adjusted;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

/** Which run the showcase plays: the practice run once it is done with turns, the recorded one otherwise. */
export function shownRun(
  recorded: readonly TraceTurn[],
  portals: Readonly<Record<string, string>>,
  showcase: ShowcaseEvent | null,
): Shown {
  if (showcase?.status === "done") {
    const tailored = parseTrace(showcase.trace);
    if (tailored.length) {
      const shaped = showcase.found_reason === "shaped";
      if (!shaped) {
        return {
          trace: tailored,
          tailored: true,
          shaped: false,
          label:
            "Practice run on the example's data, with your app names — nothing was sent",
        };
      }
      const n = adjustedIn(showcase.trace);
      return {
        // The example's answer key no longer fits: no card is marked right or wrong, none priced.
        trace: tailored.map((t) => ({
          ...t,
          cards: t.cards.map((c) => ({ ...c, outcome: "other" as const, valueUsd: null })),
        })),
        tailored: true,
        shaped: true,
        label: `Practice run adjusted to ${
          n != null ? things(n) : "what"
        } you told her — nothing was sent`,
      };
    }
  }
  return {
    trace: withPortals(recorded, portals),
    tailored: false,
    shaped: false,
    label: "The benched run, shown with your portals",
  };
}

/** Cards proposed across a run's turns. */
export function cardsIn(trace: readonly TraceTurn[]): number {
  return trace.reduce((n, t) => n + t.cards.length, 0);
}

/**
 * What the right cards of a run on the example's data hold that is not money back, by kind, in the order
 * a line says them. A `count` is a weight and is never summed. Pure.
 */
export function otherKindsIn(
  trace: readonly TraceTurn[],
  kind: (tool: string) => ValueKind,
): { kind: Exclude<ValueKind, "count" | "money_back">; usd: number }[] {
  const sums = new Map<ValueKind, number>();
  for (const t of trace) {
    for (const c of t.cards) {
      const k = kind(c.action);
      if (c.outcome !== "correct" || !c.valueUsd || k === "count" || k === "money_back") continue;
      sums.set(k, (sums.get(k) ?? 0) + c.valueUsd);
    }
  }
  return MONEY_KINDS.filter(
    (k): k is Exclude<ValueKind, "count" | "money_back"> => k !== "money_back" && sums.has(k),
  ).map((k) => ({ kind: k, usd: Math.round((sums.get(k) ?? 0) * 100) / 100 }));
}

const cards = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

export default function Showcase({
  recorded,
  portals,
  showcase,
  kinds = {},
  handed = false,
  onStart,
}: {
  recorded: readonly TraceTurn[];
  portals: Readonly<Record<string, string>>;
  showcase: ShowcaseEvent | null;
  /** The playbook's `economics.kinds`; the practice run's own labels win over them. */
  kinds?: Readonly<Record<string, ValueKind>>;
  handed?: boolean;
  onStart: () => void;
}) {
  const shown = useMemo(
    () => shownRun(recorded, portals, showcase),
    [recorded, portals, showcase],
  );
  const kindOf = useMemo(() => {
    const labelled = { ...kinds, ...kindsIn(showcase?.trace ?? []) };
    return (tool: string): ValueKind => labelled[tool] ?? "money_back";
  }, [kinds, showcase]);
  const status = showcase?.status ?? "queued";
  const others = shown.tailored && !shown.shaped ? otherKindsIn(shown.trace, kindOf) : [];
  const proposed = cardsIn(shown.trace);

  return (
    <section
      className="ad-show"
      data-tailored={shown.tailored ? "" : undefined}
      data-shaped={shown.shaped ? "" : undefined}
      aria-label="The run, with your case"
    >
      <p className="ad-show__label">
        <span className="ad-show__tag">
          {shown.tailored ? "Your practice run" : "Recorded run"}
        </span>
        {shown.label}
      </p>
      {status === "queued" || status === "running" ? (
        <p className="ad-progress ad-show__line" role="status">
          <span className="ad-progress__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {showcase?.turn != null && showcase.total
            ? `Practice run on invented data… turn ${showcase.turn} of ${showcase.total}`
            : "Practice run on invented data…"}
        </p>
      ) : status === "failed" ? (
        <p className="ad-note ad-show__line">{`The rehearsal did not finish${showcase?.detail ? `: ${showcase.detail}` : ""}. The recorded run stays.`}</p>
      ) : shown.shaped ? (
        <p className="ad-show__found" data-reason="shaped">
          <span className="ad-show__n">{cards(proposed)}</span>
          <span className="ad-note">
            {`she would propose in the practice run${
              recorded.length
                ? `, against ${cards(cardsIn(recorded))} in the example's recorded run`
                : ""
            }. The example's answer key was written for other rows, so no dollar figure is claimed and no card is marked right or wrong.`}
          </span>
        </p>
      ) : shown.tailored && (showcase?.found_usd != null || others.length) ? (
        <p className="ad-show__found">
          {showcase?.found_usd != null ? (
            <>
              <span className="ad-show__n">{usd(showcase.found_usd)}</span>
              <span className="ad-note">
                back in the example — the example's invented case, not yours
              </span>
            </>
          ) : null}
          {others.map((o) => (
            <span key={o.kind} className="ad-note ad-show__kind" data-kind={o.kind}>
              {`${kindAmount(o.kind, o.usd)} in the example`}
            </span>
          ))}
        </p>
      ) : shown.tailored ? (
        <p className="ad-show__found">
          <span className="ad-show__n">{cards(proposed)}</span>
          <span className="ad-note">she would propose in the practice run</span>
        </p>
      ) : null}
      {shown.tailored ? (
        <p className="ad-note ad-show__scope">
          Every card here is one she would propose for your OK. In a practice run nobody gives
          it, so nothing was sent and nothing was filed.
        </p>
      ) : null}

      {/* The swap starts the new run from its first turn: a new key, a fresh player. */}
      <Player
        key={shown.tailored ? "tailored" : "recorded"}
        trace={shown.trace}
        kind={kindOf}
      />

      <div className="ad-show__go">
        <Button variant="primary" onClick={onStart}>
          Start for real
        </Button>
        {handed ? (
          <p className="ad-said" role="status">
            Handed to her with your case. It waits in her composer until you
            send it.
          </p>
        ) : (
          <p className="ad-note">
            Hands the brief's command to Athena. It waits in her composer until
            you send it.
          </p>
        )}
      </div>
    </section>
  );
}

function Player({
  trace,
  kind,
}: {
  trace: readonly TraceTurn[];
  kind: (tool: string) => ValueKind;
}) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = trace.length - 1;

  useEffect(() => {
    if (!playing || at >= last) return;
    const timer = window.setTimeout(
      () => setAt((i) => Math.min(last, i + 1)),
      REPLAY_STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, at, last]);

  const step = (i: number) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(last, i)));
  };
  const t = trace[Math.min(at, Math.max(0, last))];

  return (
    <>
      {t ? (
        <>
          <ol className="ad-route" aria-label="Turns">
            {trace.map((tt, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="ad-route__dot focus-ring"
                  aria-current={i === at ? "step" : undefined}
                  data-past={i < at ? "" : undefined}
                  data-cards={tt.cards.length ? "" : undefined}
                  aria-label={`Turn ${i + 1}, ${tt.portal}`}
                  title={tt.portal}
                  onClick={() => step(i)}
                />
              </li>
            ))}
          </ol>
          <p className="ad-show__where">
            <span className="ch-chip">{t.portal}</span>
            <span className="ad-note">{`Turn ${at + 1} of ${trace.length}`}</span>
            <span className="ad-composer__spacer" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => step(at - 1)}
              disabledReason={at === 0 ? "This is the first turn" : undefined}
            >
              Back
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                at >= last
                  ? (setAt(0), setPlaying(true))
                  : setPlaying((p) => !p)
              }
            >
              {at >= last ? "Replay" : playing ? "Pause" : "Play"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => step(at + 1)}
              disabledReason={at >= last ? "This is the last turn" : undefined}
            >
              Next
            </Button>
          </p>
          <TurnView
            key={at}
            turn={t}
            at={at}
            total={trace.length}
            className="ad-show__turn"
            kind={kind}
          />
        </>
      ) : (
        <p className="ad-note">
          This playbook kept no turn-by-turn record of its bench run.
        </p>
      )}
    </>
  );
}
