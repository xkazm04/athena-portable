"use client";

/**
 * THE TURN'S CONTROL: a scrubber in round 4, a scrubber AND a story in round 5.
 *
 * Round 3 scored the turn in beats because a light had to travel; round 4 drew the whole path at
 * once and gave the reader twelve discrete steps, which is the right shape for a *sequence a
 * reader is reading* and needed no clock at all. Round 5 keeps every bit of that and adds the one
 * thing a scrubber cannot do: **tell** it. Pressing Tell puts the drawing into the story's beat
 * states — past, active, next, and everything else dimmed to spatial reference — and pressing Play
 * walks the twelve beats once and stops. Stepping by hand still works, at any time, and stepping
 * pauses the play, because a reader who takes the wheel is driving (rule 6, one more time).
 *
 * THE CLOCK IS FINITE AND HAS ONE OWNER (study §4's motion governor). One timer in `story.ts`,
 * cancelled at the last beat, and under reduced motion there is no timer at all: Play lands on the
 * final beat at frame zero with every past state shown, which is the whole story's meaning in a
 * static frame — exactly what rule 8 asks and what the study means by "the static frame carries
 * the full meaning".
 */
import { GATE_STOP, LEDGER_STOP, TURN, stopAt } from "./turn";
import { beatOf, type Story } from "./story";

export function TurnBar({
  stop,
  setStop,
  story,
}: {
  stop: number;
  setStop: (index: number) => void;
  story: Story;
}) {
  const here = stopAt(stop);
  return (
    <div className="at-turnbar" role="group" aria-label="The turn" data-story={story.on ? "" : undefined}>
      <div className="at-turnbar-controls">
        <button
          type="button"
          className="at-step-btn"
          onClick={() => {
            story.pause();
            setStop(stop - 1);
          }}
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
            onChange={(e) => {
              story.pause();
              setStop(Number(e.target.value) - 1);
            }}
          />
        </label>
        <button
          type="button"
          className="at-step-btn"
          onClick={() => {
            story.pause();
            setStop(stop + 1);
          }}
          disabled={stop === TURN.length - 1}
          aria-label="Next stop"
        >
          &rarr;
        </button>

        <button
          type="button"
          className="at-story-btn"
          data-on={story.on ? "" : undefined}
          aria-pressed={story.on}
          onClick={story.toggle}
        >
          {story.on ? "Stop telling" : "Tell it"}
        </button>
        <button
          type="button"
          className="at-story-btn"
          data-playing={story.playing ? "" : undefined}
          onClick={story.playing ? story.pause : story.play}
          aria-label={story.playing ? "Pause the story" : "Play the story once"}
        >
          {story.playing ? "Pause" : "Play"}
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
              data-story-beat-state={story.on ? (beatOf(s.index, stop) ?? undefined) : undefined}
              data-gate={s.index === GATE_STOP ? "" : undefined}
              data-ledger={s.index === LEDGER_STOP ? "" : undefined}
              aria-current={s.index === stop ? "step" : undefined}
              aria-label={`Stop ${s.index + 1}: ${s.label}`}
              onClick={() => story.go(s.index)}
            >
              <span className="at-fig">{s.index + 1}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
