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

import { comparisonOrder, criterionMedians, groupId, type BdColumn, type BdRole } from "./model";
import { CARD, VISIBLE } from "./carousel/pose";
import { Slide } from "./carousel/Slide";

export function Carousel({
  role,
  column,
  focusId,
  owns,
  onFocus,
  onOpen,
  ghost = false,
  dim,
}: {
  role: BdRole;
  column: BdColumn;
  focusId: string | null;
  /**
   * Whether this rail holds the candidates' `layoutId`s.
   *
   * False while the dossier is open, because two mounted elements claiming one
   * identity is the failure `Board.tsx` carries a note about: motion has two
   * claimants and animates neither, so the card stops becoming the dossier. The
   * rail gives the ids up on the way in and takes them back on the way out,
   * which is also what makes the box morph HOME when the dossier closes.
   */
  owns: boolean;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
  /** The inert copy the zoom leaves behind — see the note in `Columns.tsx`. */
  ghost?: boolean;
  dim?: (group: string, id: string) => number;
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

  /*
   * THE RAIL TAKES FOCUS WHEN THE LEVEL ARRIVES.
   *
   * The level's whole instruction is "← → to move" and, until this pass, the
   * arrows did nothing until you had clicked a card or tabbed past the entire
   * masthead first — the keyboard affordance the surface advertises was two
   * interactions away from working. This component is keyed by its group, so a
   * mount is exactly "a group was opened" and the focus lands once per arrival.
   *
   * `focus()` rather than a click: a programmatic focus keeps the modality of
   * the last real interaction, so `:focus-visible` stays false when the group
   * was opened with a pointer and the ring does not flash. Every focus style in
   * this direction is `:focus-visible` (`base/the-room.css`), so that is the
   * whole of the fix.
   */
  useEffect(() => {
    if (ghost) return;
    railRef.current?.focus({ preventScroll: true });
  }, [ghost]);

  /*
   * TRUE WHEN THE CARDS TAKE THE IDENTITIES BACK from a closing dossier.
   *
   * A card remounts whenever `owns` flips (see the key below), but only one of the
   * two directions has a 1180px box to shrink out of, and only that one has to keep
   * its own type out of the way while it does. "This rail was already here" is the
   * whole of the difference: `arrived` is false for exactly the first render — the
   * render in which a card is mounting because the LEVEL arrived rather than because
   * the dossier gave it back.
   */
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    /* After the first PAINT, not synchronously in the effect body: this is a fact
       about the rail having been drawn once, and setting it inside the effect would
       be a cascading render for something no frame ever sees. */
    const frame = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const returning = owns && arrived;


  return (
    <section
      className="bd-carousel"
      aria-hidden={ghost || undefined}
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
        tabIndex={ghost ? -1 : 0}
      >
        {ordered.map((candidate, i) => {
          const offset = i - at;
          if (Math.abs(offset) > VISIBLE) return null;
          return (
            <Slide
              /*
               * KEYED BY WHETHER IT HOLDS THE IDENTITY, and that is load-bearing.
               *
               * Dropping `layoutId` on a mounted element is not the same event as
               * the element leaving: motion snapshots a shared identity when its
               * claimant UNMOUNTS, and that snapshot is what the next claimant
               * grows out of. Changing the key makes the handover an unmount and a
               * mount in one commit, which is the case the library is built for —
               * so the dossier grows from the card's own box, and on close the card
               * grows back out of the dossier's.
               */
              key={owns ? candidate.id : `${candidate.id}:plain`}
              candidate={candidate}
              column={column}
              offset={offset}
              medians={medians}
              owns={owns}
              /* Only the card the dossier was ABOUT has a box to shrink out of.
                 The other two take their identities back without moving, so
                 staging them would blank two thirds of the level for no gesture. */
              staged={returning && candidate.id === focusId}
              dim={dim?.(groupId(column.id, role.id), candidate.id)}
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
