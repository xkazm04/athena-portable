"use client";

/**
 * `board` — the control variant. The shipped surface, unchanged in look.
 *
 * Five stage columns with a row per role (L0), a carousel of cards (L1), the
 * host's dossier over both (L2). Everything visible here was reviewed in rounds
 * 1 and 2 and is deliberately NOT redesigned: this is the control against which
 * `rooms` and `constellation` are read, so the only two things round 3 changes
 * are underneath the paint.
 *
 *   1. THE ECHO IS THE KIT'S. Rule 1 — "the level you leave carries the camera;
 *      the level you arrive at carries the continuity" — was about thirty lines
 *      of app code here and in every other app in the repo, which is exactly
 *      what the round-2 gap list said about it. `useEcho` now decides which
 *      changes get an echo, keys it to the flight, measures the origin and
 *      settles the flight when the move ends. What is left in this file is the
 *      two things that are genuinely this direction's: WHICH element the origin
 *      is measured off, and WHAT the outgoing copy looks like (`./Echo.tsx`).
 *   2. THE BOARD HAS A CAMERA (`./camera.ts`).
 *
 * THE THREE LAYERS, and why they are siblings rather than nested. The camera
 * scene holds L0 alone; the carousel and the echo sit beside it, untransformed.
 * A `layoutId` morph measured inside an animating ancestor projects wrong — the
 * whole reason rule 1 exists — and a camera is an animating ancestor whenever
 * the reader is touching it.
 *
 * Everything else — the masthead, the filters, the foot, the scrim and the
 * dossier — belongs to `Board.tsx`, the host of all three directions.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { Carousel } from "../../Carousel";
import { Columns } from "../../Columns";
import { splitGroup } from "../../model";
import { useBoardMotion } from "../../motion";
import type { DirProps } from "../contract";
import { useBoardCamera } from "./camera";
import { BoardEcho } from "./Echo";

export function BoardDirection(props: DirProps) {
  const { board, nav, flight, focus, filters, lit, onOpenGroup, onOpenItem } = props;
  const level = focus.level;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const m = useBoardMotion();

  const { stage, roleId } = splitGroup(focus.group);
  const role = useMemo(() => board.roles.find((r) => r.id === roleId), [board.roles, roleId]);
  const column = useMemo(
    () => (role && stage ? role.columns.find((c) => c.id === stage) : undefined),
    [role, stage],
  );

  /*
   * WHERE EVERY GROUP ROW IS, kept up to date while L0 is on screen.
   *
   * This is what the kit's `useEcho` asks a consumer for, and the reason it asks
   * rather than measuring itself: the origin has to be known BEFORE the state
   * change, and a group is opened from four places — a click on the row, a wheel
   * past the camera's band, the agent's `open_group`, and the reverse on the way
   * back — only one of which passes through a handler this component owns. So the
   * map is refreshed after every L0 render and after a resize, and the level
   * change reads the value the last L0 frame recorded.
   */
  const origins = useRef(new Map<string, DOMRect>());
  const measure = useCallback(() => {
    const el = sceneRef.current;
    if (!el || level !== 0) return;
    const next = new Map<string, DOMRect>();
    for (const row of el.querySelectorAll<HTMLElement>("[data-group]")) {
      const id = row.dataset.group;
      if (id) next.set(id, row.getBoundingClientRect());
    }
    origins.current = next;
  }, [level]);

  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const rectFor = useCallback(
    (group: string | null): DOMRect | null => (group ? (origins.current.get(group) ?? null) : null),
    [],
  );

  /** A selector for the control focus belongs on once the level change lands. */
  const restore = useRef<string | null>(null);
  const { from, to } = flight;

  /*
   * WHAT THE LEVEL CHANGE OWES THE READER BESIDE THE CAMERA: where focus goes,
   * and which row keeps a light on for one beat.
   *
   * Both were in `Board.tsx` and both are this direction's rather than the
   * host's — a room and a field have no rows to light. Going in, the reader's eye
   * is ON the row when the board scales through it, so the row IS the transition;
   * coming out the board arrives whole and the one fact the move carries — which
   * of these eight rows you were just inside — would otherwise be discarded at
   * the moment it mattered. `highlight` is the kit's own word for it, so this is
   * read from the model rather than invented here.
   */
  useLayoutEffect(() => {
    if (from === to) return;
    const esc = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v);
    if (from.level === 1 && to.level === 0 && from.group) {
      restore.current = `[data-group="${esc(from.group)}"]`;
      nav.highlight([from.group]);
    } else if (nav.state.highlight.size > 0) {
      nav.highlight([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  /* And the light goes out on its own, one beat after the echo has cleared.
     Keyed on the SET's contents rather than on `nav`, whose identity is fresh on
     every dispatch — a timer re-armed by every hover would keep the row lit for
     as long as the pointer kept moving. */
  const litKey = useMemo(() => [...nav.state.highlight].sort().join(" "), [nav.state.highlight]);
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });
  useEffect(() => {
    if (!litKey) return;
    const id = window.setTimeout(() => navRef.current.highlight([]), m.landMs);
    return () => window.clearTimeout(id);
  }, [litKey, m.landMs]);

  /*
   * FOCUS FOLLOWS THE LEVEL. The L1 → L0 half only: L2 → L1 belongs to the
   * dossier, which is an overlay and owns both its Escape and the focus it owes
   * its opener (formula §1 rule 5). Two places restoring focus after one close is
   * one of them winning a race.
   */
  useEffect(() => {
    const sel = restore.current;
    restore.current = null;
    if (!sel) return;
    const el = stageRef.current?.querySelector<HTMLElement>(sel);
    (el ?? stageRef.current?.querySelector<HTMLElement>(".bd-rail-3d"))?.focus({
      preventScroll: true,
    });
  });

  const camera = useBoardCamera({ nav, flight, sceneRef });
  const { ref: rigRef, ...rigProps } = camera.bind;

  return (
    <div className="bd-stage" ref={stageRef} data-cam={level === 0 ? "live" : "parked"}>
      <div className="bd-layer bd-cam-frame">
        <div
          className="bd-cam-scene"
          ref={(el) => {
            sceneRef.current = el;
            rigRef(el);
          }}
          {...rigProps}
          aria-label="The board. Drag to pan, wheel to zoom into a group."
        >
          {/* The LIVE L0. Nothing else is inside the camera: see the note above. */}
          {level === 0 ? (
            <Columns
              board={board}
              roleFilter={filters.roleFilter}
              onlyBorderline={filters.onlyBorderline}
              onOpen={onOpenGroup}
              lit={lit}
            />
          ) : null}
        </div>
      </div>

      {/* L1, beside the camera rather than under it, at its designed size. */}
      {level >= 1 && role && column ? (
        <div className="bd-layer">
          <Carousel
            key={`${role.id}:${column.id}`}
            role={role}
            column={column}
            focusId={nav.state.hover}
            owns={level === 1}
            onFocus={(id) => nav.hover(id)}
            onOpen={(id) => {
              nav.hover(id);
              onOpenItem(focus.group ?? "", id);
            }}
          />
        </div>
      ) : null}

      <BoardEcho {...props} rectFor={rectFor} container={() => stageRef.current} />

      {/*
       * NOT conditioned on reduced motion, and that was a hydration mismatch as
       * well as a wrong reading: `useReducedMotion()` answers null on the server
       * and true in a browser that asks for less motion, so the hint was in the
       * server HTML and absent from the client tree. A camera is not an
       * animation — a reader who wants less motion still pans and still zooms —
       * so the line belongs on the page either way.
       */}
      {level === 0 && !camera.touched ? (
        <p className="bd-cam-hint" aria-hidden>
          drag to pan · wheel to zoom into a group · Esc to fly out
        </p>
      ) : null}
    </div>
  );
}
