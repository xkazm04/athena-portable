"use client";

/**
 * The Board — the host of the three spatial directions, and the only stateful
 * component in the app.
 *
 * It owns the level (through the kit's shared L0/L1/L2 model, so "open a group"
 * means here exactly what it means everywhere else in this repo), the role
 * filter, which candidate is under the loupe, and WHICH DIRECTION IS MOUNTED.
 * Everything else is a pure child.
 *
 * ROUND 3 IS A CONCEPT TEST, and this file is the shape of it. Round 2 was
 * reviewed as "too careful": every change was a correction to the surface
 * already on the page, so the rounds were learning craft and not concepts. So
 * three spatial directions are built on the same baseline, one mounted at a
 * time, behind a switcher remembered in `?dir=` and in `localStorage`:
 *
 *   board          the shipped columns/carousel, with the kit's Echo carrying
 *                  rule 1 and a free camera over L0. The control.
 *   rooms          five rooms seen from above; opening a group flies into one,
 *                  and the rooms you are not in stay on screen.
 *   constellation  one field of points; camera distance IS the level.
 *
 * WHAT THE HOST KEEPS, AND WHY IT IS EXACTLY THIS. The masthead, the filters and
 * the foot, because the chrome must not change under the reader when they switch
 * drawings — otherwise the comparison is about the page rather than about the
 * picture. The scrim and the DOSSIER, because L2 is the same pane in all three:
 * the round is a test of how you get to an item, not of what an item says, and
 * three dossiers would have made the one thing that is constant the one thing
 * that varied. And the tools, because an agent's `open_group` has to mean the
 * same thing whichever picture is in the frame.
 *
 * WHAT EACH DIRECTION OWNS: its own L0 and L1, its own camera, its own focus
 * choreography, and nothing of any other direction's. They share `dir/contract.ts`
 * and nothing else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, MotionConfig, motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  presenceOf,
  useLevelFlight,
  useZoomNav,
  type Focus,
  type Presence,
} from "@athena/demo-kit/zoom";

import { Dossier } from "./Dossier";
import { splitGroup, type BdBoard } from "./model";
import { BoardTools } from "./tools";
import { BoardFoot } from "./shell/Foot";
import { BoardMast } from "./shell/Mast";
import { instant, useBoardMotion } from "./motion";
import { groupsOf, type DirProps } from "./dir/contract";
import { DirectionSwitcher } from "./dir/Switcher";
import { useDirection } from "./dir/useDirection";
import { BoardDirection } from "./dir/board/BoardDirection";
import { Rooms } from "./dir/rooms/Rooms";
import { Constellation } from "./dir/constellation/Constellation";
import "./style/index.css";

/** One entry per direction. Only the chosen one is ever constructed. */
const PICTURE = {
  board: BoardDirection,
  rooms: Rooms,
  constellation: Constellation,
} as const;

export function Board({ board }: { board: BdBoard }) {
  const nav = useZoomNav();
  const [direction, chooseDirection] = useDirection();
  const [roleFilter, setRoleFilter] = useState("all");
  const [onlyBorderline, setOnlyBorderline] = useState(false);
  const reduced = useReducedMotion();
  const m = useBoardMotion();

  /*
   * THE LEVEL CHANGE, AS THE KIT SEES IT — `from`, `to`, `moving`, and a `settle`.
   *
   * `fallbackToken` is a SAFETY NET, not the clock: whichever direction is
   * mounted claims the flight and ends it — the echo's `animationend` in `board`,
   * the camera's arrival in `rooms` and `constellation`. It is `--bd-dur-4` rather
   * than `--bd-zoom` because the zoom token is a `calc()` and an unregistered
   * custom property keeps its `calc(...)` through computed style.
   *
   * It also tells the nav it is moving, which is what makes Escape mid-move abort
   * to where the reader was standing instead of stepping up out of a level nobody
   * arrived at (formula §1 rule 6).
   */
  const flight = useLevelFlight(nav, { fallbackToken: "--bd-dur-4" });

  const level = nav.state.focus.level;
  const { stage, roleId } = splitGroup(nav.state.focus.group);

  const role = useMemo(() => board.roles.find((r) => r.id === roleId), [board.roles, roleId]);
  const column = useMemo(
    () => (role && stage ? role.columns.find((c) => c.id === stage) : undefined),
    [role, stage],
  );
  const candidate = useMemo(
    () => column?.candidates.find((c) => c.id === nav.state.focus.item),
    [column, nav.state.focus.item],
  );

  /*
   * A move out of the column is a legitimate act taken FROM the dossier, and it makes the person
   * the dossier is about leave the column the dossier is inside. Without this the level model says
   * 2 while nothing at level 2 is mounted. Come up a level instead, which is where the act left
   * the reader anyway.
   */
  const orphaned = level === 2 && !candidate;
  const up = nav.up;
  useEffect(() => {
    if (orphaned) up();
  }, [orphaned, up]);

  /*
   * SWITCHING THE DRAWING IS NOT A NAVIGATION, so the reader is put back at L0
   * when they do it. A direction mounted at L1 would arrive with a camera parked
   * at a pose it never flew to and a deck standing on a table nobody walked to —
   * and, worse, the two pictures disagree about what "you are here" looks like,
   * which is the one thing a comparison must not do.
   *
   * `direction` IS THE ONLY DEPENDENCY, and that is not laziness — it is the bug
   * this comment exists to name. `nav.home` is a fresh identity on every dispatch
   * (the nav re-creates its action object each time), so listing it re-ran this
   * effect after EVERY nav action: every `open_group` was followed, one commit
   * later, by a `home()`, and all three directions sat at L0 forever while the
   * tools reported success. The current `home` is kept in a ref instead, and the
   * first run is skipped so a page that loads with `?dir=rooms` is not sent home
   * before the reader has done anything.
   */
  const homeRef = useRef(nav.home);
  useEffect(() => {
    homeRef.current = nav.home;
  });
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    homeRef.current();
  }, [direction]);

  const totals = useMemo(() => {
    const rows = board.roles.filter((r) => roleFilter === "all" || r.id === roleFilter);
    return {
      /* Counted, not `board.roles.length`. Filtered to one role the crumb read
         "2 roles · 16 applicants" — the applicant count obeying the filter and
         the role count ignoring it, in the same sentence. */
      roles: rows.length,
      applicants: rows.reduce((n, r) => n + r.totals.applicants, 0),
      scored: rows.reduce((n, r) => n + r.totals.scored, 0),
      borderline: rows.reduce((n, r) => n + r.totals.borderline, 0),
    };
  }, [board.roles, roleFilter]);

  /*
   * THE KIT'S RULE FOR WHAT RECEDES, and the kit's mapping of it.
   *
   * `presenceOf()` is `emphasis()` put onto the two channels a level change may
   * animate — `opacity = e`, `scale = 1 − (1 − e)·0.06`. No direction re-derives
   * it; each one decides only what it paints with it (formula §1 rule 7).
   */
  const focus: Focus = nav.state.focus;
  const presence = useCallback(
    (group: string, item?: string): Presence => presenceOf(focus, group, item),
    [focus],
  );

  const filters = useMemo(() => ({ roleFilter, onlyBorderline }), [roleFilter, onlyBorderline]);
  const groups = useMemo(() => groupsOf(board, filters), [board, filters]);

  const dirProps: DirProps = {
    board,
    groups,
    nav,
    flight,
    focus,
    filters,
    role,
    column,
    candidate,
    lit: nav.state.highlight,
    onOpenGroup: useCallback((group: string) => nav.openGroup(group), [nav]),
    onOpenItem: useCallback((group: string, item: string) => nav.openItem(group, item), [nav]),
    presence,
    reduced: reduced === true,
  };

  const Picture = PICTURE[direction] ?? BoardDirection;
  const showDossier = level === 2 && role && column && candidate;

  return (
    <MotionConfig reducedMotion="user">
      <div className="bd-root h-root" data-variant="board" data-level={level} data-dir={direction}>
        {/* The ingest layer: this direction's three levels, offered to an agent
            beside the page on `document.modelContext`. Renders nothing, and every
            tool it registers reads or moves — none of them writes. The tools are
            the HOST's, so `open_group` does the same thing in all three pictures
            and produces the same flight a click does. */}
        <BoardTools
          board={board}
          nav={nav}
          roleFilter={roleFilter}
          setRoleFilter={setRoleFilter}
          onlyBorderline={onlyBorderline}
          setOnlyBorderline={setOnlyBorderline}
        />

        <div className="bd-blooms" aria-hidden />
        <div className="bd-grain" aria-hidden />

        <BoardMast totals={totals} />
        <DirectionSwitcher direction={direction} onChoose={chooseDirection} />

        <LayoutGroup>
          {/* One picture at a time. The other two are not rendered at all, so a
              camera rig exists only for the direction on screen. */}
          <Picture {...dirProps} />

          {/*
           * THE TWO OVERLAY LAYERS, INSIDE A `display: contents` WRAPPER.
           *
           * They used to live inside `.bd-stage`, and moving the stage into the
           * direction made them direct children of `.bd-root` — where
           * `.bd-root > *:not(.bd-blooms):not(.bd-grain) { position: relative }`
           * outweighs a class selector and quietly overrode `position: fixed` on
           * both. The scrim stopped covering anything and the dossier opened as a
           * block at the bottom of a scrolling page. The wrapper takes that rule
           * and `display: contents` makes it disappear from layout, so the scrim
           * and the pane are fixed again and nothing else about the tree moves.
           *
           * THE SCRIM IS ITS OWN LAYER, and that is what makes the dossier a grow
           * rather than a flash: it darkens on its own timer while the box morphs
           * from the card, and what is written in the box waits for the box to land.
           */}
          <div className="bd-overlays">
          <AnimatePresence>
            {showDossier ? (
              <motion.div
                key="scrim"
                className="bd-scrim-layer"
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={reduced ? instant : m.fade}
              />
            ) : null}
          </AnimatePresence>

          {/*
           * NOT inside `AnimatePresence`. On close the dossier has to release
           * `candidate-<id>` in the same commit the card takes it back, or there are
           * two claimants again and the box does not morph home (rule 2).
           *
           * SHARED BY ALL THREE DIRECTIONS, deliberately: see the note at the top.
           */}
          {showDossier ? (
            <Dossier
              role={role}
              column={column}
              candidate={candidate}
              openSlots={board.openSlots}
              onFocus={(id) => {
                nav.hover(id);
                nav.openItem(nav.state.focus.group ?? "", id);
              }}
              onClose={up}
            />
          ) : null}
          </div>
        </LayoutGroup>

        <BoardFoot
          totals={totals}
          role={role}
          column={column}
          candidate={candidate}
          level={level}
          nav={nav}
        />
      </div>
    </MotionConfig>
  );
}
