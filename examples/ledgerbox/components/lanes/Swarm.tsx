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

import type { LnFilter, LnLane, LnMark, LnSheet } from "./model";
import { Lane } from "./swarm/Lane";
import { Tip, type Hover } from "./swarm/Tip";


export function Swarm({
  sheet,
  filter,
  picked,
  onOpenLane,
  onOpenMark,
}: {
  sheet: LnSheet;
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

  return (
    <div className="ln-stack">
      <div className="ln-axis" style={{ "--todayX": todayX } as CSSProperties} aria-hidden>
        {months.map((m) => (
          <span
            key={`${m.label}-${m.x}`}
            className="ln-axis-month"
            style={{ "--x": m.x } as CSSProperties}
          >
            {m.label}
          </span>
        ))}
        <span className="ln-axis-now" />
      </div>

      {/* Shown only by the compact layout, which abandons the time axis. Saying
          so is cheaper than letting someone read a row of equal squares as if
          it were the swarm. */}
      <p className="ln-compact-note">
        Too narrow for the clock: each lane is a row of marks in due order, so
        lateness has colour here but no length.
      </p>

      <div className="ln-lanes">
        {sheet.lanes.map((lane, index) => (
          <Lane
            key={lane.id}
            lane={lane}
            index={index}
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
