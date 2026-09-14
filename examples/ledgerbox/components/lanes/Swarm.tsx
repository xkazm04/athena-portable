"use client";

/**
 * L0 — the swarm.
 *
 * Six lanes, one per area of the practice, all reading one time axis. A mark is
 * worth its width and late by its tail length.
 *
 * WHAT IS LABELLED, AND WHY NOT EVERYTHING. The first cut of this level carried
 * no text at all, and the honest complaint was that you could not tell what you
 * were looking at. The answer is not a label on all hundred and twenty-four —
 * that is the noise this level exists to avoid — but a label on the ones worth
 * reading:
 *
 *   · the AMOUNT, on any mark wide enough to print one without colliding with
 *     its neighbour (the packing already guarantees the gap, so the test is a
 *     width threshold and nothing more);
 *   · a GLYPH, on the few that are asking for something. Three meanings only,
 *     so the legend fits in a person's head: `!` long overdue, `?` disputed,
 *     `+` an unapplied credit that would clear it.
 *
 * Everything else stays a bar, and hovering any mark gives the full read-out.
 */
import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { presenceOf, type Focus } from "@athena/demo-kit/zoom";

import type { LnFilter, LnLane, LnMark, LnSheet } from "./model";
import { Lane } from "./swarm/Lane";
import { Tip, type Hover } from "./swarm/Tip";


export function Swarm({
  sheet,
  focus,
  live,
  filter,
  picked,
  onOpenLane,
  onOpenMark,
}: {
  sheet: LnSheet;
  /** The focus the whole surface is on, which is what decides how present each
   *  lane still is once the reader has drilled past this level. */
  focus: Focus;
  /** True while L0 is the level you are on. False for the frames it is still
   *  mounted on its way out: it gives up its `layoutId`s to the level arriving
   *  and stops taking the pointer. */
  live: boolean;
  filter: LnFilter;
  /** Invoices ticked by `select` — ringed rather than lit, because a tick is a working set and
   *  not a state of the books. */
  picked: ReadonlySet<string>;
  onOpenLane: (laneId: string) => void;
  onOpenMark: (laneId: string, markId: string) => void;
}) {
  const { todayX, months } = sheet.axis;
  const [hover, setHover] = useState<Hover | null>(null);
  // Reading the pointer from the event rather than tracking it means the tip
  // costs one state write per mark entered, not one per pixel moved.
  const raf = useRef<number | null>(null);
  /**
   * Which mark in each lane is the lane's tab stop.
   *
   * A hundred and twenty-four marks were a hundred and twenty-four tab stops,
   * so reaching the footer from the first lane cost a hundred and forty-eight
   * presses and nobody ever did it. One stop per lane and the arrow keys inside
   * it is the pattern a toolbar uses, and it is the pattern this is: a row of
   * peers where only one needs to be in the sequence.
   */
  const [roving, setRoving] = useState<Record<string, number>>({});

  /** Marks in reading order, so Tab lands left and the arrows run forward in time. */
  const byDate = useMemo(
    () =>
      new Map<string, LnMark[]>(
        sheet.lanes.map((lane) => [lane.id, [...lane.marks].sort((a, b) => a.x - b.x)]),
      ),
    [sheet.lanes],
  );

  const rove = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>(".ln-mark")];
    if (nodes.length === 0) return;
    const here = nodes.indexOf(document.activeElement as HTMLElement);
    if (here < 0) return;
    let next = -1;
    if (event.key === "ArrowRight") next = Math.min(nodes.length - 1, here + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, here - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = nodes.length - 1;
    if (next < 0 || next === here) return;
    event.preventDefault();
    // Focusing is enough: the mark's own `onFocus` moves the lane's tab stop,
    // so there is exactly one place that decides where the stop is.
    nodes[next]?.focus();
  }, []);

  const enter = useCallback((mark: LnMark, lane: LnLane, el: HTMLElement) => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const box = el.getBoundingClientRect();
      setHover({
        mark,
        lane,
        x: box.left + box.width / 2,
        y: box.bottom,
        top: box.top,
      });
    });
  }, []);

  const leave = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setHover(null);
  }, []);

  /**
   * How many packed rows the whole sheet has, handed to CSS.
   *
   * The lane height used to be a flat 26px per row on every monitor, so the
   * swarm was 661px at 1440 and 661px at 2560 — half a screen of dead band and
   * marks the owner could not read at arm's length. `--ln-row` is now the height
   * left after the chrome divided by THIS, so the sheet grows with the frame
   * and the divisor is a fact about the books rather than a number in a
   * stylesheet. One write, on the element every lane inherits from.
   */
  const rowsAll = useMemo(
    () => sheet.lanes.reduce((n, lane) => n + lane.rows, 0),
    [sheet.lanes],
  );

  /**
   * The packed rows of the SHORTEST lane, which is what decides whether any lane
   * prints its blurb.
   *
   * The decision has to be one decision. Per-lane it is arithmetic CSS can do —
   * compare this lane's height against the room its head needs — but the result
   * is a gutter where three lanes carry a sentence and three do not, at whatever
   * viewport height happens to fall between them, which reads as a bug rather
   * than as a rule. The shortest lane is the binding one, so the whole sheet
   * says what its lanes are or none of them does.
   */
  const rowsMin = useMemo(
    () => sheet.lanes.reduce((n, lane) => Math.min(n, lane.rows), Number.POSITIVE_INFINITY),
    [sheet.lanes],
  );

  return (
    <div
      className="ln-stack"
      style={{ "--ln-rows-all": rowsAll, "--ln-rows-min": rowsMin } as CSSProperties}
    >
      {/*
       * THE AXIS IS NOW LABELLED, not implied.
       *
       * It used to be five month abbreviations floating on a hairline at 12px,
       * with nothing under them: no tick, so a reader had to guess whether the
       * label sat at the start of the month or in the middle of it, and no
       * statement anywhere that the horizontal position of a mark is its DUE
       * DATE. Both are now printed. The ticks are drawn from the same `m.x` the
       * label uses, so the label and the rule it names cannot drift apart.
       */}
      <div className="ln-axis" style={{ "--todayX": todayX } as CSSProperties}>
        <span className="ln-axis-caption">Due date, 2026 →</span>
        {months.map((m) => (
          <span
            key={`${m.label}-${m.x}`}
            className="ln-axis-tick"
            style={{ "--x": m.x } as CSSProperties}
          >
            <span className="ln-axis-month">{m.label}</span>
          </span>
        ))}
        <span className="ln-axis-now" aria-hidden />
      </div>

      {/* Shown only by the compact layout, which abandons the time axis. Saying
          so is cheaper than letting someone read a row of equal squares as if
          it were the swarm. */}
      <p className="ln-compact-note">
        Too narrow for the clock: each lane is a row of marks in due order, so
        lateness has colour here but no length.
      </p>

      <div className="ln-lanes">
        {/*
         * WHAT RECEDES WHEN YOU DRILL IN IS NOT THIS FILE'S OPINION. `presenceOf`
         * is the kit's one rule AND the kit's one mapping of it, shared by
         * every direction: at L0 every lane is fully present, and from inside a
         * lane the five you are not in fall back to 0.22 while the one you
         * opened holds at 1 — so the swarm visibly recedes behind the spread
         * instead of being cut away under it.
         *
         * ONLY THE OPACITY HALF IS TAKEN, and that is the one place this
         * surface cannot use the kit whole. `presenceStyle` also returns a
         * `scale`, and a lane's transform here is DATA: `.ln-lane` carries
         * `translateZ(--i * 4px)`, the stagger that makes the six read as a
         * stack under the tilt. motion owns an element's transform outright, so
         * animating `scale` on the same element would overwrite the depth the
         * lane is positioned at. Rule 7's own wording is the licence — a world
         * reads the model's presence and decides what to DO with it — and what
         * is not taken is the surface's decision, not a second opinion about
         * how far back 0.22 stands.
         */}
        {sheet.lanes.map((lane, index) => (
          <Lane
            key={lane.id}
            lane={lane}
            index={index}
            live={live}
            presence={presenceOf(focus, lane.id).opacity}
            /* The lane you opened has a stand-in: its name is the element that
               travels to the spread's head, so the copy left behind here would
               be the same word twice for the length of the flight. */
            traveling={!live && focus.group === lane.id}
            filter={filter}
            picked={picked}
            todayX={todayX}
            deck={{ byDate, enter, leave, rove, roving, setRoving, hoveredId: hover?.mark.id ?? null }}
            onOpenLane={onOpenLane}
            onOpenMark={onOpenMark}
          />
        ))}
      </div>

      {hover ? <Tip hover={hover} /> : null}
    </div>
  );
}
