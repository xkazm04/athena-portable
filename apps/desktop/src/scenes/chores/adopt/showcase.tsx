/**
 * The showcase, once the brief is approved — ADR 0097, README section 3.5.
 *
 * Shown at once: the playbook's recorded bench run with the person's portal names in it, played
 * turn by turn, labelled for what it is. Meanwhile the daemon rehearses a real bench run on a world
 * shaped like their case; while it runs a line says which turn it is on, and when it is done its
 * own trace takes the recorded one's place with what it found. A rehearsal that failed leaves the
 * recorded run and says why. Then "Start for real" hands the brief's command to Athena.
 */
import { useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import { parseTrace, usd, type TraceTurn } from "@/lib/playbooks";

import { REPLAY_STEP_MS } from "../replay";
import TurnView from "../turn";
import { withPortals, type ShowcaseEvent } from "./state";

export interface Shown {
  trace: TraceTurn[];
  tailored: boolean;
  label: string;
}

/** Which run the showcase plays: the rehearsal once it is done with turns, the recorded one otherwise. */
export function shownRun(
  recorded: readonly TraceTurn[],
  portals: Readonly<Record<string, string>>,
  showcase: ShowcaseEvent | null,
): Shown {
  if (showcase?.status === "done") {
    const tailored = parseTrace(showcase.trace);
    if (tailored.length) {
      return {
        trace: tailored,
        tailored: true,
        label:
          "Rehearsal on invented data shaped like your case — nothing was sent",
      };
    }
  }
  return {
    trace: withPortals(recorded, portals),
    tailored: false,
    label: "The benched run, shown with your portals",
  };
}

export default function Showcase({
  recorded,
  portals,
  showcase,
  handed = false,
  onStart,
}: {
  recorded: readonly TraceTurn[];
  portals: Readonly<Record<string, string>>;
  showcase: ShowcaseEvent | null;
  handed?: boolean;
  onStart: () => void;
}) {
  const shown = useMemo(
    () => shownRun(recorded, portals, showcase),
    [recorded, portals, showcase],
  );
  const status = showcase?.status ?? "queued";

  return (
    <section
      className="ad-show"
      data-tailored={shown.tailored ? "" : undefined}
      aria-label="The run, with your case"
    >
      <p className="ad-show__label">
        <span className="ad-show__tag">
          {shown.tailored ? "Your rehearsal" : "Recorded run"}
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
            ? `Rehearsing on a world shaped like yours… turn ${showcase.turn} of ${showcase.total}`
            : "Rehearsing on a world shaped like yours…"}
        </p>
      ) : status === "failed" ? (
        <p className="ad-note ad-show__line">{`The rehearsal did not finish${showcase?.detail ? `: ${showcase.detail}` : ""}. The recorded run stays.`}</p>
      ) : shown.tailored && showcase?.found_usd != null ? (
        <p className="ad-show__found">
          <span className="ad-show__n">{usd(showcase.found_usd)}</span>
          <span className="ad-note">
            found in the rehearsal, on invented data
          </span>
        </p>
      ) : null}

      {/* The swap starts the new run from its first turn: a new key, a fresh player. */}
      <Player
        key={shown.tailored ? "tailored" : "recorded"}
        trace={shown.trace}
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

function Player({ trace }: { trace: readonly TraceTurn[] }) {
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
