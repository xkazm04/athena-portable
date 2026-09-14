"use client";

/**
 * The Board — the whole surface, and the only stateful component in the
 * direction.
 *
 * It owns the level (through the kit's shared L0/L1/L2 model, so "open a group"
 * means here exactly what it means everywhere else in this repo), the role
 * filter, and which candidate the carousel is holding. Everything else is a
 * pure child.
 *
 * THE ZOOM, AS BUILT. The level change is one gesture in three parts, all on
 * the same 350ms curve (`zoom` in ./motion.ts, `--hl-dur-3 + --hl-dur-1`):
 *
 *   1. THE ECHO. The level being left is re-rendered once, beside the live
 *      layer, as an inert copy with no `layoutId` on anything in it. That copy
 *      scales THROUGH the centre of the group row that was opened — measured
 *      off its own element the frame before the level changed, which is what
 *      `origins` below keeps — and fades. Going back out it falls the other
 *      way, into the same point.
 *   2. THE RECEDE. Inside the echo, every group that is not the one being
 *      opened dims and shrinks by `emphasis()` from the kit, so the rest of the
 *      board leaves before the part you picked does. The rule is the kit's; all
 *      this direction decides is that it maps to opacity and scale.
 *   3. THE IDENTITY. The live layer never scales, and that is deliberate: a
 *      `layoutId` morph measured inside an animating ancestor projects wrong.
 *      So the faces keep growing into the cards exactly as before, at full
 *      size, while the echo does the camera move around them.
 *
 * WHY AN ECHO RATHER THAN KEEPING BOTH LEVELS MOUNTED. Two mounted elements
 * claiming one `layoutId` is the failure this file used to carry a comment
 * about: motion has two claimants for one identity and animates neither, so the
 * faces stop becoming the cards. The echo has no ids at all, so there is always
 * exactly one claimant per candidate and the morph is never ambiguous. The same
 * rule is what makes L1→L2 work: the carousel DROPS the identities while the
 * dossier holds them (`owns` below), and takes them back when it closes.
 *
 * Interruptible: the echo is keyed by the nav's flight counter, is
 * `pointer-events: none`, and is cleared by whichever comes first, the
 * animation completing or a timer. A second nav action mid-flight replaces it
 * rather than queueing behind it, and nothing is ever left on screen.
 *
 * The group id is `stage:role`, because a stage in this app is two queues that
 * happen to be at the same point and the comparison worth making is inside one
 * of them.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import { emphasis, useZoomNav, type Focus } from "@athena/demo-kit/zoom";

import { Carousel } from "./Carousel";
import { Columns } from "./Columns";
import { Dossier } from "./Dossier";
import { splitGroup, type BdBoard, type BdColumn, type BdRole } from "./model";
import { BoardTools } from "./tools";
import { BoardFoot } from "./shell/Foot";
import { BoardMast } from "./shell/Mast";
import { PULL, PUSH, ZOOM_MS, fade, instant, leave, zoom } from "./motion";
import "./style/index.css";

/** Stage-box coordinates. The echo's `transform-origin`. */
interface Origin {
  x: number;
  y: number;
}

/** One level change, in flight. `key` is the nav's flight counter, so a second
 *  action replaces this rather than stacking a second echo behind it. */
interface Zoom {
  key: number;
  dir: "in" | "out";
  origin: Origin;
  /** The level being left, as an inert copy. */
  echo:
    | { level: 0 }
    | { level: 1; role: BdRole; column: BdColumn; focusId: string | null };
}

export function Board({ board }: { board: BdBoard }) {
  const nav = useZoomNav();
  const [roleFilter, setRoleFilter] = useState("all");
  const [onlyBorderline, setOnlyBorderline] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  const level = nav.state.focus.level;
  const flight = nav.state.flight;
  const { stage, roleId } = splitGroup(nav.state.focus.group);

  const role = useMemo(
    () => board.roles.find((r) => r.id === roleId),
    [board.roles, roleId],
  );
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
   * 2 while nothing at level 2 is mounted: L1 renders under an L2 rail and the toolbar still marks
   * rung III as here. Come up a level instead, which is where the act left the reader anyway.
   *
   * `nav.up` rather than `nav` in the deps: the whole object is a fresh identity on every dispatch,
   * so depending on it re-ran this effect on every hover.
   */
  const orphaned = level === 2 && !candidate;
  const up = nav.up;
  useEffect(() => {
    if (orphaned) up();
  }, [orphaned, up]);

  /*
   * WHERE EVERY GROUP ROW IS, kept up to date while L0 is on screen.
   *
   * The zoom's origin has to be measured BEFORE the state change, and a group is
   * opened from three places — a click on the row, the agent's `open_group`, and
   * the reverse on the way back out — only one of which passes through a handler
   * this component owns. So the measurement is not taken at the click: the map is
   * refreshed after every L0 render and after a resize, and the level change reads
   * the value the last L0 frame recorded. Ten rows of `getBoundingClientRect` on a
   * level that re-renders on filter changes is not a budget worth defending.
   */
  const origins = useRef(new Map<string, Origin>());
  const centre = useRef<Origin>({ x: 0, y: 0 });
  const measure = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    centre.current = { x: box.width / 2, y: box.height / 2 };
    if (level !== 0) return;
    const next = new Map<string, Origin>();
    for (const row of el.querySelectorAll<HTMLElement>("[data-group]")) {
      const r = row.getBoundingClientRect();
      const id = row.dataset.group;
      if (id) next.set(id, { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top });
    }
    origins.current = next;
  }, [level]);

  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  /*
   * THE LEVEL CHANGE ITSELF: what just happened, read off the flight counter.
   *
   * Every path into a level change ends here — the row, the back button, Escape,
   * the scrim, and every tool an agent calls — which is why the echo and the focus
   * restore are decided in one place rather than in five handlers.
   */
  const [inFlight, setInFlight] = useState<Zoom | null>(null);
  /** A selector for the control focus belongs on once the level change lands. */
  const restore = useRef<string | null>(null);
  const prev = useRef({
    flight,
    level,
    group: nav.state.focus.group,
    item: nav.state.focus.item,
    role,
    column,
    hover: nav.state.hover,
  });

  /* Deliberately dep-less: it compares the render it is running for against the
     previous one and must therefore run after EVERY render. A dependency list
     would mean "run when these change", which is the question this effect is
     asking rather than the answer — and `flight` is monotonic, so the guard
     below is the real gate. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const was = prev.current;
    const group = nav.state.focus.group;
    const moved = was.flight !== flight;
    prev.current = {
      flight,
      level,
      group,
      item: nav.state.focus.item,
      role,
      column,
      hover: nav.state.hover,
    };
    if (!moved) return;

    /* Where focus goes when a level closes. Set here rather than in five
       handlers, because every path — the row, the back button, Escape, the
       scrim, and every tool an agent calls — arrives at exactly this point. */
    const esc = (v: string) =>
      typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v;
    if (was.level === 2 && level === 1 && was.item) {
      restore.current = `[data-candidate="${esc(was.item)}"]`;
    } else if (was.level === 1 && level === 0 && was.group) {
      restore.current = `[data-group="${esc(was.group)}"]`;
    }

    if (reduced) return;

    if (was.level === 0 && level === 1 && group) {
      setInFlight({
        key: flight,
        dir: "in",
        origin: origins.current.get(group) ?? centre.current,
        echo: { level: 0 },
      });
    } else if (was.level === 1 && level === 0 && was.group && was.role && was.column) {
      setInFlight({
        key: flight,
        dir: "out",
        origin: origins.current.get(was.group) ?? centre.current,
        echo: { level: 1, role: was.role, column: was.column, focusId: was.hover },
      });
    }
  });

  /* Cleared by a timer as well as by the animation, because an echo left on the
     surface is the one failure mode of this whole mechanism. Keyed, so a second
     action mid-flight cancels the first clear rather than clearing the second. */
  useEffect(() => {
    if (!inFlight) return;
    const id = window.setTimeout(
      () => setInFlight((z) => (z && z.key === inFlight.key ? null : z)),
      ZOOM_MS * 2,
    );
    return () => window.clearTimeout(id);
  }, [inFlight]);

  /*
   * FOCUS FOLLOWS THE LEVEL, and it is restored rather than dropped.
   *
   * Closing the dossier used to leave focus on a detached button, i.e. on
   * `document.body`, so the next Tab started at the top of the page and the next
   * arrow key did nothing. The card that opened it is where the reader was; the
   * group row is where they were before that. `focus()` and not a click, so
   * `:focus-visible` stays false when the level was changed with a pointer and
   * the ring does not flash (the rail's entry focus is in `Carousel.tsx`).
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

  /* The kit's rule for what recedes when you drill in, read and never re-derived.
     This direction's only decision is that presence is opacity and scale. */
  const focus: Focus = nav.state.focus;
  const dimGroup = useCallback((id: string) => emphasis(focus, id, null), [focus]);
  const dimItem = useCallback(
    (group: string, id: string) => emphasis(focus, group, id),
    [focus],
  );

  const showDossier = level === 2 && role && column && candidate;

  return (
    <MotionConfig reducedMotion="user">
      <div className="bd-root h-root" data-variant="board" data-level={level}>
        {/* The ingest layer: this direction's three levels, offered to an
            agent beside the page on `document.modelContext`. Renders nothing,
            and every tool it registers reads or moves — none of them writes. */}
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

        {/*
         * The masthead reads `totals` because its headline is STATE now rather
         * than a slogan — the same three figures the crumb carries, at the top
         * of the page where the reader arrives. DESIGN-LAW §4.1 still allows
         * exactly one orienting line above the fold, and that is now the deck
         * under the headline rather than the headline itself.
         */}
        <BoardMast totals={totals} />


        <div className="bd-stage" ref={stageRef}>
          <LayoutGroup>
            {/*
             * The LIVE layer. Exactly one level is interactive at a time and it
             * never scales — see the note at the top of this file: an ancestor
             * transform and a `layoutId` morph cannot both be right.
             */}
            {level === 0 || !role || !column ? (
              <div className="bd-layer">
                <Columns
                  board={board}
                  roleFilter={roleFilter}
                  onlyBorderline={onlyBorderline}
                  onOpen={(group) => nav.openGroup(group)}
                />
              </div>
            ) : (
              <div className="bd-layer">
                {/* Keyed by the group it indexes: a group change made while already at L1 (the
                    agent's `open_group` does exactly this) would otherwise leave the carousel
                    mounted with a focus index belonging to the previous column. */}
                <Carousel
                  key={`${role.id}:${column.id}`}
                  role={role}
                  column={column}
                  focusId={nav.state.hover}
                  /* The dossier holds the candidates' identities while it is open, so the
                     rail gives them up: one claimant per id, always. */
                  owns={level === 1}
                  onFocus={(id) => nav.hover(id)}
                  onOpen={(id) => {
                    /* Set the hover too, so the rail is still centred on this person when the
                       dossier closes and hands focus back to their card. */
                    nav.hover(id);
                    nav.openItem(nav.state.focus.group ?? "", id);
                  }}
                />
              </div>
            )}

            {/*
             * THE ECHO — the level being left, inert, scaling through the group's
             * own centre. No `layoutId` anywhere inside it, no pointer events, and
             * `aria-hidden`: it is a picture of where the reader just was.
             */}
            <AnimatePresence>
              {inFlight ? (
                <motion.div
                  key={inFlight.key}
                  className="bd-layer bd-echo"
                  aria-hidden
                  /* Not reachable by pointer (the stylesheet) nor by Tab (here):
                     a picture of a level must never take a keystroke meant for
                     the level that has arrived. */
                  inert
                  initial={{ opacity: 1, scale: 1 }}
                  animate={{ opacity: 0, scale: inFlight.dir === "in" ? PUSH : PULL }}
                  /* Cancelled mid-flight by a second nav action: §1.3 removal,
                     not a second copy of the entrance. */
                  exit={{ opacity: 0, transition: leave }}
                  transition={zoom}
                  onAnimationComplete={() =>
                    setInFlight((z) => (z && z.key === inFlight.key ? null : z))
                  }
                  style={{ transformOrigin: `${inFlight.origin.x}px ${inFlight.origin.y}px` }}
                >
                  {inFlight.echo.level === 0 ? (
                    <Columns
                      board={board}
                      roleFilter={roleFilter}
                      onlyBorderline={onlyBorderline}
                      onOpen={() => {}}
                      ghost
                      dim={dimGroup}
                    />
                  ) : (
                    <Carousel
                      role={inFlight.echo.role}
                      column={inFlight.echo.column}
                      focusId={inFlight.echo.focusId}
                      owns={false}
                      onFocus={() => {}}
                      onOpen={() => {}}
                      ghost
                      dim={dimItem}
                    />
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/*
             * THE SCRIM IS ITS OWN LAYER, and that is what makes the dossier a
             * grow rather than a flash. It used to be the dossier's own
             * backdrop, inside a wrapper that faded the whole overlay in over
             * 180ms — so while the box was still travelling, its prose and the
             * carousel card underneath were both legible through the blur. Now
             * the scrim darkens on its own timer, the box morphs from the card,
             * and what is written in the box waits for it to land (see
             * `DOSSIER_SHELL` in ./motion.ts).
             */}
            <AnimatePresence>
              {showDossier ? (
                <motion.div
                  key="scrim"
                  className="bd-scrim-layer"
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={reduced ? instant : fade}
                />
              ) : null}
            </AnimatePresence>

            {/*
             * NOT inside `AnimatePresence`. On close the dossier has to release
             * `candidate-<id>` in the same commit the carousel card takes it
             * back, or there are two claimants again and the box does not morph
             * home. The scrim above is what carries the exit.
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
          </LayoutGroup>
        </div>

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
