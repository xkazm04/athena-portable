"use client";

/**
 * The board's outgoing copy: what rule 1 looks like once the kit holds the rule.
 *
 * WHAT THE KIT DOES NOW. `useEcho` decides which level changes get an echo, keys
 * it to the flight counter so a second action replaces rather than stacks,
 * measures the origin through the `measure` callback below, claims the flight
 * and settles it when the move ends — with a net under it, so a missing
 * `@keyframes` cannot strand the nav in a move nobody can see. `<Echo>` renders
 * the children once, frozen, inert, `aria-hidden`, with `--echo-ox`/`--echo-oy`
 * and `data-direction` as its whole interface to the CSS.
 *
 * WHAT IS LEFT HERE, and it is the right two things. WHICH element the origin is
 * measured off — the group row, which only this direction has — and WHAT the
 * copy contains: the board at L0, the carousel at L1, both with no `layoutId`
 * anywhere in them so the live layer is always the only claimant of a
 * candidate's identity (rule 2), and both receding by `presenceOf()` so the rest
 * of the surface leaves before the part you picked does (rule 7).
 *
 * THE ONE BEHAVIOURAL CHANGE from the shipped board: the gesture is a CSS
 * animation on `.bd-echo` rather than a motion `animate` prop, because the kit's
 * container reports the end of the move through `animationend` — which means the
 * move has to BE an animation. It is on the direction's own `--bd-zoom` clock,
 * so the JS budget and the CSS move still cannot disagree (rule 4).
 */
import { useCallback } from "react";
import { Echo, useEcho, type RectLike } from "@athena/demo-kit/zoom";

import { Carousel } from "../../Carousel";
import { Columns } from "../../Columns";
import { splitGroup } from "../../model";
import type { DirProps } from "../contract";

export function BoardEcho({
  board,
  nav,
  flight,
  filters,
  presence,
  reduced,
  rectFor,
  container,
}: DirProps & {
  rectFor: (group: string | null) => RectLike | null;
  /** The echo's own box. Without it the kit has nothing to take a fraction OF
   *  and falls back to the viewport, which is right for a full-bleed scene and
   *  wrong for a stage that sits under a masthead. */
  container: () => Element | null;
}) {
  /*
   * The origin is the row that was opened on the way IN and the row being
   * returned to on the way OUT — the same row either way, which is why the echo
   * falls back into the point it grew out of. A focus with no node on screen (L0
   * itself has none) answers null, and the kit falls back to the centre.
   */
  const measure = useCallback(
    (focus: { group: string | null }) => rectFor(focus.group),
    [rectFor],
  );

  const { echo } = useEcho(nav, flight, {
    measure,
    container,
    /* Only L0 ⇄ L1. L1 ⇄ L2 is a shared-element grow and has no camera to carry;
       under reduced motion nothing is staged at all, so the level change lands on
       its final state at frame zero rather than on a faster animation (rule 8). */
    stages: (from, to) =>
      !reduced && from.level !== to.level && from.level < 2 && to.level < 2,
  });

  if (!echo) return null;

  /* The level being LEFT. `from` is the kit's; this is the one place the app
     still has to say what its own outgoing level looks like. */
  const { stage, roleId } = splitGroup(echo.from.group);
  const role = board.roles.find((r) => r.id === roleId);
  const column = role && stage ? role.columns.find((c) => c.id === stage) : undefined;

  return (
    <Echo echo={echo} className="bd-layer bd-echo">
      {echo.from.level === 0 || !role || !column ? (
        <Columns
          board={board}
          roleFilter={filters.roleFilter}
          onlyBorderline={filters.onlyBorderline}
          onOpen={() => {}}
          ghost
          presence={(group) => presence(group)}
        />
      ) : (
        <Carousel
          role={role}
          column={column}
          focusId={nav.state.hover}
          owns={false}
          onFocus={() => {}}
          onOpen={() => {}}
          ghost
          presence={(group, id) => presence(group, id)}
        />
      )}
    </Echo>
  );
}
