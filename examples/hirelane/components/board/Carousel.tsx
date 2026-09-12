"use client";

/**
 * L1 — one group, as a carousel of cards.
 *
 * THE GEOMETRY. Every card sits at the centre of the rail and is then pushed
 * out along x by its distance from the focus. The three nearest the focus stay
 * at full size and barely turn — those are the ones you are actually choosing
 * between, and a head-to-head needs them at the same scale on the same plane.
 * Everything past them shrinks, turns away and recedes, so the rest of the
 * group is present without competing.
 *
 * `rotateY` on a card whose parent has `perspective` is genuinely dimensional,
 * which is what makes the bend read as a card turning rather than as a skew.
 * Nothing is encoded in that depth: the position in the queue is the only thing
 * it carries, and the ordering is stated in the dots below.
 *
 * WHAT EACH CARD SHOWS. The weighted overall with its fit band, then the five
 * criteria ordered by how far each sits from the median of the scored
 * candidates in this column — so the card's first line is what is most true
 * about this person relative to the people they are being chosen against. The
 * median is computed here, once per column, and handed down. That is the
 * comparison the level exists for; the prose waits for L2.
 *
 * KEYBOARD. Left and right move the focus, Enter opens. The rail is a listbox
 * so that reads correctly to a screen reader as well as to a pointer.
 *
 * One card is `carousel/Slide.tsx`, where it sits is `carousel/pose.ts`, and
 * the stage-specific line at its foot is `carousel/StageMeta.tsx`. What stays
 * here is the deck: which card is under the loupe, and the keys and arrows that
 * move it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { comparisonOrder, criterionMedians, type BdColumn, type BdRole } from "./model";
import { CARD, VISIBLE } from "./carousel/pose";
import { Slide } from "./carousel/Slide";

export function Carousel({
  role,
  column,
  focusId,
  onFocus,
  onOpen,
}: {
  role: BdRole;
  column: BdColumn;
  focusId: string | null;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const ordered = useMemo(() => comparisonOrder(column), [column]);
  const railRef = useRef<HTMLDivElement | null>(null);

  /* Once per column, not once per card: every card in the deck is scored against the same field. */
  const medians = useMemo(() => criterionMedians(ordered), [ordered]);

  const found = ordered.findIndex((c) => c.id === focusId);
  /** Arrive with one card either side, so the loupe is full on the first frame
   *  rather than after a keypress. */
  const opening = ordered.length >= 3 ? 1 : 0;
  const index = found >= 0 ? found : opening;
  const [live, setLive] = useState(opening);
  // The focus is owned by the parent so the dossier can move it, but the
  // carousel keeps its own copy for arrow keys, which must not wait on a round
  // trip through the level model.
  //
  // Clamped, because `live` indexes a column and the column can change under it:
  // `open-group` does not clear `hover`, so an index of 7 inherited from a
  // ten-person column, applied to a two-person one, culls EVERY slide at
  // `|offset| > VISIBLE` and the level renders empty with the forward arrow
  // disabled. Keying this component by its group makes that unreachable; the
  // clamp is the belt, because an index out of range must never draw zero cards.
  const at = Math.max(0, Math.min(found >= 0 ? index : live, ordered.length - 1));

  const move = useCallback(
    (delta: number) => {
      const next = Math.min(ordered.length - 1, Math.max(0, at + delta));
      setLive(next);
      const candidate = ordered[next];
      if (candidate) onFocus(candidate.id);
    },
    [at, ordered, onFocus],
  );

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [move]);

  return (
    <section
      className="bd-carousel"
      /* The card width the two step sizes in pose.ts are solved from. The rail draws at the
         width the poses assume, or the loupe set gains a gap it was never given. */
      style={{ "--card": `${CARD}px` } as CSSProperties}
    >
      <div className="bd-carousel-head">
        <div>
          <h2 className="bd-carousel-title">
            {role.title} · {column.label}
          </h2>
          <p className="bd-carousel-wait">{column.wait}</p>
        </div>
        <p className="bd-hand">
          {column.scored === 0
            ? "nobody here has been scored yet — the bars stay empty until someone files one"
            : `${column.scored} of ${column.candidates.length} scored, ${column.borderline} still arguable`}
        </p>
      </div>

      <div
        className="bd-rail-3d"
        ref={railRef}
        role="listbox"
        aria-label={`${role.title} at ${column.label}`}
        tabIndex={0}
      >
        {ordered.map((candidate, i) => {
          const offset = i - at;
          if (Math.abs(offset) > VISIBLE) return null;
          return (
            <Slide
              key={candidate.id}
              candidate={candidate}
              column={column}
              offset={offset}
              medians={medians}
              onFocus={() => {
                setLive(i);
                onFocus(candidate.id);
              }}
              onOpen={() => onOpen(candidate.id)}
            />
          );
        })}
      </div>

      <div className="bd-carousel-nav">
        <button
          type="button"
          className="bd-arrow"
          onClick={() => move(-1)}
          disabled={at === 0}
          aria-label="Previous candidate"
        >
          ←
        </button>
        <div className="bd-dots">
          {ordered.map((candidate, i) => (
            <button
              key={candidate.id}
              type="button"
              className="bd-dot"
              aria-current={i === at}
              aria-label={`Show ${candidate.name}`}
              onClick={() => {
                setLive(i);
                onFocus(candidate.id);
              }}
            />
          ))}
        </div>
        <button
          type="button"
          className="bd-arrow"
          onClick={() => move(1)}
          disabled={at >= ordered.length - 1}
          aria-label="Next candidate"
        >
          →
        </button>
        <span className="bd-hint">
          ← → to move · click the centre card to open
        </span>
      </div>
    </section>
  );
}
