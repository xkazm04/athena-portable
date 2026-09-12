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
 * WHAT EACH CARD SHOWS. The five criteria on one shared 0-4 baseline, the
 * weighted overall with its fit band, how much of the rubric the application
 * actually speaks to, and the one fact true in this stage and nowhere else.
 * That is the comparison the level exists for; the prose waits for L2.
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

import { comparisonOrder, type BdColumn, type BdRole } from "./model";
import { CARD, VISIBLE } from "./carousel/pose";
import {
  CARD_VARIANTS,
  CardSwitcher,
  criterionMedians,
  type CardSlug,
} from "./carousel/CardVariant";

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

  /*
   * WHICH CARD DESIGN. Scaffolding, and `carousel/CardVariant.tsx` says so at the top: when a
   * direction is chosen, this state, the switcher, the legend below and the losing variants go in
   * the commit that renames the winner to `Slide.tsx`.
   */
  const [cardSlug, setCardSlug] = useState<CardSlug>("card");
  const Card = (CARD_VARIANTS.find((v) => v.slug === cardSlug) ?? CARD_VARIANTS[0]).Component;

  /* Once per column, not once per card. Only the ledger reads it, but every variant is handed the
     same props so the deck never learns which one is mounted. */
  const medians = useMemo(() => criterionMedians(ordered), [ordered]);

  /* The rubric, in its own order, for the strip's shared legend. Taken from the first candidate
     because a column is one role and every applicant in it was read against the same five
     criteria in the same order — the fact the strip is built on. */
  const rubric = ordered[0]?.scores ?? [];

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
      /* The card width the two step sizes in pose.ts are solved from. It sits on the section
         rather than on the rail because the strip's legend has to line up with a card and so has
         to read the same number; declared on the rail it was out of reach. */
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
            <Card
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

      {/*
       * THE STRIP'S LEGEND — the five criterion names, printed once for the whole rail.
       *
       * This is the half of variant A that is not on the card. Every applicant in a column is read
       * against one role's rubric in one order, so the names were being rendered once per visible
       * card to say the same five things; here they are aligned to the same five segment positions
       * every card uses, with the same weight-driven widths, so a name sits under the part of the
       * signal it explains.
       */}
      {cardSlug === "strip" && rubric.length > 0 ? (
        <div className="bd-strip-legend" aria-hidden>
          {rubric.map((score) => (
            <span
              key={score.criterionId}
              style={{ "--w": score.weight } as CSSProperties}
            >
              {score.short}
            </span>
          ))}
        </div>
      ) : null}

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
        <CardSwitcher value={cardSlug} onChange={setCardSlug} />
      </div>
    </section>
  );
}
