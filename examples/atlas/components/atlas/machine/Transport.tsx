"use client";

/**
 * THE TRANSPORT — play, pause, scrub, step.
 *
 * The turn is the argument this round is making, so the reader needs to be able to stop it and
 * look. Which means a transport, and a transport is a small thing that is easy to get wrong in
 * two specific ways, both of which this one avoids on purpose:
 *
 *   1. A scrubber must be a real `<input type="range">`. A div with a drag handler is a control
 *      no keyboard, no screen reader and no touch assistive technology can work, and the native
 *      one already knows arrows, Home, End, PageUp and PageDown. The cost is that it is styled
 *      through `::-webkit-slider-thumb`, which is a chore; the chore is the right trade.
 *   2. The stop list is not eleven tabs. It is a list of buttons with the labels ON them, because
 *      the labels ARE the turn — eleven short sentences that together are README §3.2 — and a
 *      reader who never presses play should still be able to read the turn by walking the list.
 *
 * The beat itself is never React state (see `scene/useTurn.ts`), so the range's `value` is driven
 * imperatively from the same subscription the renderers use. React re-renders this component
 * eleven times in a turn, not six hundred.
 */
import { useEffect, useRef } from "react";

import { TURN_BEATS } from "../scene/turn";
import type { Transport as TransportModel } from "../scene/useTurn";

/** How many steps the scrubber has per beat. Fine enough that a drag feels continuous. */
const STEPS_PER_BEAT = 20;

export function Transport({ transport }: { transport: TransportModel }) {
  const range = useRef<HTMLInputElement | null>(null);
  const { subscribe, stops, stop, playing, waiting } = transport;

  useEffect(() => {
    return subscribe((beat) => {
      const el = range.current;
      if (!el || document.activeElement === el) return;
      el.value = String(Math.round(beat * STEPS_PER_BEAT));
    });
  }, [subscribe]);

  const current = stops[stop];

  return (
    <section className="at-transport" aria-label="The turn">
      <div className="at-transport-bar">
        <button
          type="button"
          className="at-t-btn"
          onClick={transport.rewind}
          aria-label="Back to the start of the turn"
        >
          <span aria-hidden>&#9198;</span>
        </button>
        <button
          type="button"
          className="at-t-btn"
          onClick={() => transport.step(-1)}
          aria-label="Previous stop"
        >
          <span aria-hidden>&#9664;</span>
        </button>
        <button
          type="button"
          className="at-t-btn at-t-play"
          onClick={transport.toggle}
          aria-pressed={playing}
          data-playing={playing ? "" : undefined}
        >
          <span aria-hidden>{playing ? "⏸" : "▶"}</span>
          <span className="at-t-play-word">{playing ? "Pause" : "Play the turn"}</span>
        </button>
        <button
          type="button"
          className="at-t-btn"
          onClick={() => transport.step(1)}
          aria-label="Next stop"
        >
          <span aria-hidden>&#9654;</span>
        </button>

        <label className="at-t-scrub">
          <span className="at-vh">Scrub the turn</span>
          <input
            ref={range}
            type="range"
            min={0}
            max={Math.round(TURN_BEATS * STEPS_PER_BEAT)}
            step={1}
            defaultValue={0}
            onChange={(e) => transport.seek(Number(e.currentTarget.value) / STEPS_PER_BEAT)}
            aria-valuetext={current ? `${current.index + 1} of ${stops.length}: ${current.label}` : undefined}
          />
        </label>

        <output className="at-t-read" data-waiting={waiting ? "" : undefined}>
          <span className="at-t-count">
            {stop + 1}&thinsp;/&thinsp;{stops.length}
          </span>
          <span className="at-t-label">{current?.label}</span>
        </output>
      </div>

      <ol className="at-t-stops">
        {stops.map((s) => (
          <li key={s.index}>
            <button
              type="button"
              className="at-t-stop"
              data-kind={s.kind}
              aria-current={s.index === stop ? "step" : undefined}
              onClick={() => transport.goTo(s.index)}
            >
              <span className="at-t-stop-n">{String(s.index + 1).padStart(2, "0")}</span>
              <span className="at-t-stop-label">{s.label}</span>
              <span className="at-t-stop-cite">{s.cite}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
