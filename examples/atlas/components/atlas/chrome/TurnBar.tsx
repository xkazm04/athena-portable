"use client";

/**
 * THE STEP CONTROL — twelve stops, one at a time, and the one that waits.
 *
 * This is what round 3's transport became. The turn was a light travelling routed pipes on a
 * clock scored in beats; on a drawing the whole path is visible at once, so there is nothing to
 * interpolate and the only question left is *which stop are we talking about*. Twelve discrete
 * steps, a slider, `←`/`→`, and a label. No clock, no beat token, no rAF, and — the part that is
 * a finding rather than a simplification — **no reduced-motion branch**, because a sequence a
 * reader steps through is not a transition and never was. Round 3 needed a whole paragraph in
 * `tokens.css` to say that; round 4 does not need the paragraph.
 *
 * It appears only in the turn view, because a control for something that is not on the sheet is a
 * control for nothing.
 */
import { GATE_STOP, LEDGER_STOP, TURN, stopAt } from "../canvas/turn";

export function TurnBar({
  stop,
  setStop,
}: {
  stop: number;
  setStop: (index: number) => void;
}) {
  const here = stopAt(stop);
  return (
    <div className="at-turnbar" role="group" aria-label="The turn">
      <div className="at-turnbar-controls">
        <button
          type="button"
          className="at-step-btn"
          onClick={() => setStop(stop - 1)}
          disabled={stop === 0}
          aria-label="Previous stop"
        >
          &larr;
        </button>
        <label className="at-turnbar-scrub">
          <span className="at-label at-sr">Stop</span>
          <input
            type="range"
            min={1}
            max={TURN.length}
            step={1}
            value={stop + 1}
            onChange={(e) => setStop(Number(e.target.value) - 1)}
          />
        </label>
        <button
          type="button"
          className="at-step-btn"
          onClick={() => setStop(stop + 1)}
          disabled={stop === TURN.length - 1}
          aria-label="Next stop"
        >
          &rarr;
        </button>
      </div>

      <p className="at-turnbar-read" aria-live="polite">
        <span className="at-fig at-turnbar-n">
          {stop + 1}/{TURN.length}
        </span>
        <span className="at-turnbar-label" data-kind={here.kind}>
          {here.label}
        </span>
        <span className="at-cite">{here.cite}</span>
      </p>

      <ol className="at-turnbar-stops">
        {TURN.map((s) => (
          <li key={s.index}>
            <button
              type="button"
              className="at-turnbar-dot"
              data-kind={s.kind}
              data-here={s.index === stop ? "" : undefined}
              data-gate={s.index === GATE_STOP ? "" : undefined}
              data-ledger={s.index === LEDGER_STOP ? "" : undefined}
              aria-current={s.index === stop ? "step" : undefined}
              aria-label={`Stop ${s.index + 1}: ${s.label}`}
              onClick={() => setStop(s.index)}
            >
              <span className="at-fig">{s.index + 1}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
