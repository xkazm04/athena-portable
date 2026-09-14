"use client";

/**
 * The world — one scene element, never unmounted, drawn at four bands.
 *
 * THIS FILE REPLACES FOUR. `Swarm.tsx`, `swarm/Lane.tsx`, `Spread.tsx` and `spread/Head.tsx`
 * were two levels rendering the same hundred and twenty-five invoices twice, in two coordinate
 * systems, handing `layoutId`s to each other across a level change. There is one coordinate
 * system now (`world/layout.ts`), so an invoice is one element that is sometimes a bar and
 * sometimes a card, and the level change is the camera moving rather than the page changing.
 *
 * WHAT A BAND SWITCHES, AND WHAT IT MAY NOT. `data-band` on the scene root is the only thing
 * that changes between far, mid, near and closest, and the stylesheet answers it with `opacity`
 * and `transform` and nothing else — so a band change is a tokenised crossfade that costs no
 * layout and, crucially, no remount. Every element below is present in every band. What the
 * far band does with a card is draw it at zero opacity.
 *
 * WHY EVERY POSITION IS A CUSTOM PROPERTY AND NOT A STYLE. `--x`, `--y`, `--w`, `--h` are world
 * units; the stylesheet decides what to do with them. That is the same rule the round-2 sheet
 * kept and it is what lets the narrow layout abandon the time axis without this file knowing.
 *
 * TEXT IS SCREEN-SPACE. Nothing here sets a font size: `--ln-inv` (1/zoom, written on the scene
 * root by `Lanes.tsx` on the same commit as the transform) is in the cascade, and every rule
 * that sets type multiplies a token by it. A lane's name is the same number of pixels tall at
 * zoom 1 and at zoom 8 — see `design/round3-map-brief.md` §6 for why that is the hybrid rather
 * than either extreme.
 */
import type { CSSProperties } from "react";
import { presenceOf, type Focus } from "@athena/demo-kit/zoom";

/**
 * How present a lane stays when the reader has flown past it.
 *
 * The kit's `emphasis()` takes an unfocused lane to 0.22, which is the right READING — three
 * quarters gone — and, on a near-black ground, close enough to nothing that the first capture of
 * the near band looked as though the map had ended at the area's edge. The whole promise of the
 * round is that it has not. `floor` is the kit's own spelling for this: it raises the bottom of
 * the ramp without changing its shape, so a receded lane is a visible shape you can drag to and
 * the ORDER of the presences is untouched.
 */
const PRESENCE_FLOOR = 0.14;

import { formatMoneyShort } from "@/lib/format";
import {
  markPresence,
  statusOf,
  type LnFilter,
  type LnMark,
} from "../model";
import { flagOf } from "./marks";
import { StatusGlyph } from "./Glyph";
import type { LnWorld, WorldMark } from "./layout";

export function World({
  world,
  focus,
  filter,
  picked,
  onOpenLane,
  onOpenMark,
  onHover,
}: {
  world: LnWorld;
  /** Where the reader is standing — the only thing that decides what recedes (rule 7). */
  focus: Focus;
  filter: LnFilter;
  /** Invoices ticked by `select` — ringed rather than lit, because a tick is a working set. */
  picked: ReadonlySet<string>;
  onOpenLane: (laneId: string) => void;
  onOpenMark: (laneId: string, markId: string) => void;
  onHover: (mark: LnMark | null, el: HTMLElement | null) => void;
}) {
  return (
    <>
      {/*
       * The axis, IN THE WORLD rather than pinned above it. It is part of the map — the month
       * ticks pan and zoom with everything else, and a reader who has dragged to June is looking
       * at the word JUN. What does not scale is the type, which is what `--ln-inv` is for.
       */}
      <div className="ln-waxis" aria-hidden>
        <span className="ln-waxis-caption">Due date →</span>
        {world.months.map((m) => (
          <span key={`${m.label}-${m.x}`} className="ln-waxis-tick" style={{ "--x": m.x } as CSSProperties}>
            <span className="ln-waxis-month">{m.label}</span>
          </span>
        ))}
      </div>

      {/* The now-line is FIXED IN THE WORLD: it stands at the first of September whatever the
          camera does, which is what makes panning read as travelling rather than as scrolling
          a list. Full height, behind everything, taking no pointer. */}
      <span className="ln-wnow" style={{ "--x": world.nowX } as CSSProperties} aria-hidden>
        <span className="ln-wnow-label">NOW</span>
      </span>

      {world.lanes.map((wl) => {
        const lane = wl.lane;
        const open = focus.group === lane.id;
        const shown = wl.marks.filter((m) => markPresence(m.mark, filter) !== "dim").length;
        const lateShare = lane.owedCents > 0 ? lane.lateCents / lane.owedCents : 0;
        return (
          <div
            key={lane.id}
            className="ln-wlane"
            data-lane={lane.id}
            data-heat={lane.heat}
            data-open={open || undefined}
            /*
             * WHAT RECEDES IS THE MODEL'S ANSWER, NOT THIS FILE'S. `presenceOf` is the kit's one
             * rule: every lane is fully present at L0, the five you are not in fall to 0.22
             * from inside a lane, and further again from inside an invoice. The lanes never
             * leave the world — a receding lane is dimmer and still there to drag to, which is
             * the whole reason the reader cannot lose the place.
             *
             * `{ scale: false }` IS THE ROUND-2 GAP, CLOSED. A scale on this element would fight
             * the camera: the world's own transform IS the scale, and a lane that shrank inside
             * it would sit at a different world position than the one `layout.ts` computed and
             * `resolveGroup` reads back. Round 2 had to take `.opacity` off the returned object
             * and drop the rest on the floor; the kit now has a spelling for "this channel does
             * not speak for the transform", and it emits no `scale` key at all.
             */
            style={
              {
                "--y": wl.y,
                "--h": wl.h,
                "--late": lateShare,
                opacity: presenceOf(focus, lane.id, null, { scale: false, floor: PRESENCE_FLOOR }).opacity,
              } as CSSProperties
            }
          >
            <span className="ln-wlane-spine" aria-hidden />

            {/* The gutter. A real button, so the keyboard can open a lane without the camera. */}
            <button
              type="button"
              className="ln-wlane-head"
              onClick={() => onOpenLane(lane.id)}
              aria-label={`Open the ${lane.label} area, ${lane.count} invoices, ${formatMoneyShort(lane.owedCents)} outstanding`}
            >
              <span className="ln-wlane-name">{lane.label}</span>
              <span className="ln-wlane-figures num">
                {shown === lane.count ? lane.count : `${shown}/${lane.count}`} ·{" "}
                {formatMoneyShort(lane.owedCents)}
              </span>
              {lane.lateCount > 0 ? (
                <span className="ln-wlane-figures ln-wlane-late num">
                  {lane.lateCount} late · {formatMoneyShort(lane.lateCents)}
                </span>
              ) : (
                <span className="ln-wlane-figures">nothing late</span>
              )}
              {/* The lane's own sentence. It arrives at the mid band, which is the whole of what
                  that band is: the same population, told more about. */}
              <span className="ln-wlane-reading">{lane.blurb}</span>
            </button>

            {/*
             * The track is a GROUP, not a button: a hundred real buttons inside a button is
             * invalid and was the reason L0 once had a hundred and forty-eight tab stops. The
             * click here is a pointer convenience; the keyboard path is the head beside it.
             */}
            <div
              className="ln-wtrack"
              role="group"
              aria-label={`${lane.label}, ${lane.count} invoices on the time axis`}
              onClick={() => onOpenLane(lane.id)}
            >
              {wl.marks.map((wm) => (
                <Mark
                  key={wm.id}
                  wm={wm}
                  laneY={wl.y}
                  filter={filter}
                  picked={picked.has(wm.id)}
                  open={focus.item === wm.id}
                  onOpen={() => onOpenMark(lane.id, wm.id)}
                  onHover={onHover}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * One invoice, at every band.
 *
 * The button IS the cell — the card's footprint — at every band, so the hit target does not move
 * under the reader's pointer as the camera closes in and the thing they clicked at zoom 1 is the
 * thing they clicked at zoom 8. What changes with the band is what is drawn inside it: a bar, a
 * bar with its amount, or the card.
 */
function Mark({
  wm,
  laneY,
  filter,
  picked,
  open,
  onOpen,
  onHover,
}: {
  wm: WorldMark;
  /** The lane's own top in scene coordinates. A mark is drawn inside its lane, so its `--y` is
   *  the cell's scene y MINUS this — the geometry is absolute, the box it is drawn in is not. */
  laneY: number;
  filter: LnFilter;
  picked: boolean;
  open: boolean;
  onOpen: () => void;
  onHover: (mark: LnMark | null, el: HTMLElement | null) => void;
}) {
  const mark = wm.mark;
  /* One dimming system: the filter, and whether the invoice wants a decision, answered once in
     `model/attention.ts`. Nothing writes an inline opacity on this element any more — the round-2
     note about motion overruling `[data-presence]` died with the `layoutId` it was about — so the
     tokens in the stylesheet are the whole of it. */
  const presence = markPresence(mark, filter);
  const flag = flagOf(mark);
  const money = formatMoneyShort(mark.balanceCents > 0 ? mark.balanceCents : mark.amountCents);

  return (
    <button
      type="button"
      className="ln-wmark"
      data-heat={mark.heat}
      data-presence={presence}
      data-picked={picked || undefined}
      data-open={open || undefined}
      data-mark={mark.id}
      style={
        {
          "--x": wm.cell.x,
          "--y": wm.cell.y - laneY,
          "--w": wm.cell.w,
          "--h": wm.cell.h,
          "--bw": wm.bar.w,
          "--bh": wm.bar.h,
          "--tw": wm.tail.w,
        } as CSSProperties
      }
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onMouseEnter={(event) => onHover(mark, event.currentTarget)}
      onFocus={(event) => onHover(mark, event.currentTarget)}
      onMouseLeave={() => onHover(null, null)}
      onBlur={() => onHover(null, null)}
      aria-label={`${mark.number}, ${mark.clientName}, ${money}. ${mark.status}${picked ? " Ticked." : ""}`}
    >
      {/* Lateness as physical length: from the bar's right edge to the now-line. Zero-width when
          the invoice is not late, so there is nothing to hide. */}
      <span className="ln-wtail" aria-hidden />
      {/* The bar. Its width is what the invoice is worth; it thickens at the mid band and fades
          as the card takes its place, which is the same object gaining detail. */}
      <span className="ln-wbar" aria-hidden />
      {/* The glyph: three meanings and no more. `!` long overdue, `?` disputed, `+` a credit
          that would clear it. Drawn from the far band, because it is the reason to look. */}
      {flag ? (
        <span className="ln-wflag" aria-hidden>
          {flag}
        </span>
      ) : null}
      {/* The amount, at the mid band: the same population, told more about. */}
      <span className="ln-wamount num" aria-hidden>
        {money}
      </span>

      {/*
       * THE CARD. It is here at every band, at zero opacity until the camera is near enough to
       * read it, and it fills the cell the bar was sitting in the middle of — so the bar does
       * not become a card, it IS one, seen from further away.
       */}
      <span className="ln-wcard" aria-hidden>
        <span className="ln-wcard-top">
          <StatusGlyph status={statusOf(mark)} />
          <span className="ln-wcard-money num">{money}</span>
        </span>
        <span className="ln-wcard-client">{mark.clientName}</span>
        <span className="ln-wcard-no num">{mark.number}</span>
        <span className="ln-wcard-status">{mark.status}</span>
      </span>
    </button>
  );
}
