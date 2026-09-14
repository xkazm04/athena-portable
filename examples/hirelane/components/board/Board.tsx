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
import {
  presenceOf,
  useLevelFlight,
  useZoomNav,
  type Focus,
  type Presence,
} from "@athena/demo-kit/zoom";

import { Carousel } from "./Carousel";
import { Columns } from "./Columns";
import { Dossier } from "./Dossier";
import { splitGroup, type BdBoard, type BdColumn, type BdRole } from "./model";
import { BoardTools } from "./tools";
import { BoardFoot } from "./shell/Foot";
import { BoardMast } from "./shell/Mast";
import { PULL, PUSH, instant, useBoardMotion } from "./motion";
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
  const m = useBoardMotion();

  /*
   * THE LEVEL CHANGE, AS THE KIT SEES IT — `from`, `to`, `moving`, and a `settle`.
   *
   * This used to be a `prev` ref compared inside a dep-less layout effect, which is
   * one of the three shapes round 1 produced for the same question (the kit's
   * `zoom/flight.ts` names all three). The requirement is unchanged and is why it
   * cannot be an ordinary effect: the level being LEFT has to be known on the very
   * frame the level changes, because that is the frame the echo is built from.
   *
   * `fallbackToken` is a SAFETY NET, not the clock — the echo's own
   * `onAnimationComplete` calls `settle` — and it is `--bd-dur-4` rather than
   * `--bd-zoom` because the zoom token is a `calc()` and a custom property that is
   * not registered keeps its `calc(...)` through computed style. 420ms is the step
   * above the zoom's 350, which is what a net should be.
   *
   * It also tells the nav it is moving, which is what makes Escape mid-zoom abort to
   * where the reader was standing instead of stepping up out of a level nobody
   * arrived at (formula §1 rule 6).
   */
  const flight = useLevelFlight(nav, { fallbackToken: "--bd-dur-4" });

  const level = nav.state.focus.level;
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
   * THE LEVEL CHANGE ITSELF: what just happened, read off the kit's flight.
   *
   * Every path into a level change ends here — the row, the back button, Escape,
   * the scrim, and every tool an agent calls — which is why the echo and the focus
   * restore are decided in one place rather than in five handlers.
   */
  const [inFlight, setInFlight] = useState<Zoom | null>(null);
  /** A selector for the control focus belongs on once the level change lands. */
  const restore = useRef<string | null>(null);

  /**
   * The role and column a group id names.
   *
   * This replaces half of what the old `prev` ref carried. `flight.from` already says
   * which group was left, and `board` is the same object it was a frame ago, so the
   * pair can be looked up rather than remembered — a ref that mirrors derivable state
   * is a second source of truth waiting to disagree with the first.
   */
  const groupAt = useCallback(
    (group: string | null) => {
      const { stage: s, roleId: r } = splitGroup(group);
      const found = board.roles.find((x) => x.id === r);
      return {
        role: found,
        column: found && s ? found.columns.find((c) => c.id === s) : undefined,
      };
    },
    [board.roles],
  );

  const { from, to } = flight;
  /*
   * Deps are the two foci and nothing else, and that is exact rather than lazy: the
   * nav re-creates its `focus` object only on a focus-changing action, so `from` and
   * `to` are referentially stable between level changes and this fires exactly once
   * per move (plus once at mount, where they are the same object).
   *
   * Everything else the body reads is deliberately absent. `nav` is a fresh identity
   * on every dispatch — listing it would re-run this on every hover, which is the bug
   * the old dep-less version was written around — and `nav.state.hover` read here IS
   * the hover at the moment of the change, because no level action touches it.
   *
   * A LAYOUT effect, still: the echo has to be in the same paint as the level it is a
   * picture of.
   */
  useLayoutEffect(() => {
    if (from === to) return;

    /* Where focus goes when a level closes. Set here rather than in five
       handlers, because every path — the row, the back button, Escape, the
       scrim, and every tool an agent calls — arrives at exactly this point.
       L2 → L1 is NOT here any more: the dossier is an overlay and owns its own
       focus return through the kit's `useOverlayEscape` (see `Dossier.tsx`). */
    const esc = (v: string) =>
      typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v;
    if (from.level === 1 && to.level === 0 && from.group) {
      restore.current = `[data-group="${esc(from.group)}"]`;
    }

    /*
     * THE ROW YOU CAME FROM KEEPS A LIGHT ON — the return trip's half of the
     * continuity the zoom already has going in.
     *
     * Going in, the reader's eye is ON the row when the board scales through it, so
     * the row IS the transition. Coming out there is nothing equivalent: the board
     * arrives whole and the echo is a picture of the carousel, so the one fact the
     * level change carries — which of these eight rows you were just inside — was
     * discarded at the moment it mattered.
     *
     * `highlight` is the kit's own word for "nodes something is pointing at", so this
     * is read from the model rather than invented here, exactly as `presenceOf()` is
     * three lines below. Any other move clears it: a light left on a row nobody came
     * back to is a selection, and this direction has no selection.
     */
    if (from.level === 1 && to.level === 0 && from.group) {
      nav.highlight([from.group]);
    } else if (nav.state.highlight.size > 0) {
      nav.highlight([]);
    }

    /* Under reduced motion no echo is ever built, so the whole block is skipped and
       the level change lands on its final state at frame zero (§9.16). */
    const key = flight.flight;
    if (!reduced) {
      if (from.level === 0 && to.level === 1 && to.group) {
        setInFlight({
          key,
          dir: "in",
          origin: origins.current.get(to.group) ?? centre.current,
          echo: { level: 0 },
        });
        return;
      }
      if (from.level === 1 && to.level === 0 && from.group) {
        const left = groupAt(from.group);
        if (left.role && left.column) {
          setInFlight({
            key,
            dir: "out",
            origin: origins.current.get(from.group) ?? centre.current,
            echo: {
              level: 1,
              role: left.role,
              column: left.column,
              focusId: nav.state.hover,
            },
          });
          return;
        }
      }
    }
    /* Every other move — L1 ⇄ L2 — has no echo, and says so rather than leaving the
       previous one behind for `moving` to put back on screen. */
    setInFlight(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  /*
   * A LEVEL CHANGE WITH NO CAMERA OF ITS OWN HAS ALREADY ARRIVED, and has to say so.
   *
   * `moving` is what tells the nav to treat Escape as "not that one after all" rather
   * than "up a level" (formula §1 rule 6). Only the two moves that build an echo have
   * anything to finish, and only those have an `onAnimationComplete` to finish it
   * with; everything else — L1 ⇄ L2, and every move under reduced motion — would
   * otherwise stay notionally in the air until the kit's fallback duration expired.
   *
   * That is not a tidiness fix. Escape twice in quick succession is how a reader
   * leaves a dossier and then the group, and with the second press landing inside a
   * flight that never ended, the abort would put them back in the dossier they had
   * just closed. L1 → L2 loses nothing by settling early either: abort and up are the
   * same place from there.
   *
   * Derived rather than read off `inFlight`, so it does not depend on a state update
   * from the effect above having landed first, and in its own effect so that neither
   * of them cascades a render out of the other.
   */
  const staged =
    !reduced &&
    ((from.level === 0 && to.level === 1) || (from.level === 1 && to.level === 0));
  useEffect(() => {
    if (flight.moving && !staged) flight.settle();
  }, [flight, staged]);

  /*
   * And it goes out on its own, one beat after the echo has cleared (`landMs`).
   *
   * Keyed on the SET's contents rather than on `nav`, whose identity is fresh on every
   * dispatch — a timer re-armed by every hover would keep the row lit for as long as
   * the pointer kept moving. The set changes identity only when a highlight is
   * dispatched, so this arms once per landing and a second landing cancels the first.
   */
  const litKey = useMemo(
    () => [...nav.state.highlight].sort().join(" "),
    [nav.state.highlight],
  );
  /* Kept current in an effect rather than in render: the nav is a fresh object on
     every dispatch and the timer below must not depend on it, but a ref written
     during render is a ref read at a moment React does not promise anything about. */
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });
  useEffect(() => {
    if (!litKey) return;
    const id = window.setTimeout(() => navRef.current.highlight([]), m.landMs);
    return () => window.clearTimeout(id);
  }, [litKey, m.landMs]);

  /* The local timer that used to clear the echo is gone: `useLevelFlight` owns the
     safety net now (`fallbackToken` above), and the echo is drawn only while the
     flight it belongs to is still moving — so an echo left on the surface, the one
     failure mode of this whole mechanism, is no longer this file's to prevent. */

  /*
   * FOCUS FOLLOWS THE LEVEL, and it is restored rather than dropped.
   *
   * This is the L1 → L0 half only. L2 → L1 belongs to the dossier, which is an
   * overlay and therefore owns both its Escape and the focus it owes its opener
   * (`useOverlayEscape`, formula §1 rule 5) — two places restoring focus after the
   * same close is one of them winning a race.
   *
   * The group row is where the reader was before they opened the group. `focus()`
   * and not a click, so `:focus-visible` stays false when the level was changed with
   * a pointer and the ring does not flash (the rail's entry focus is in
   * `Carousel.tsx`).
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

  /*
   * THE KIT'S RULE FOR WHAT RECEDES, and the kit's mapping of it.
   *
   * `emphasis()` was already read here rather than re-derived; what this direction
   * still owned was the mapping onto opacity and scale, with its own 0.94 floor. The
   * kit's `presenceOf()` is the same arithmetic — `opacity = e`,
   * `scale = 1 − (1 − e)·0.06` — arrived at from this file's own note about a row
   * that shrinks as far as it dims reading as falling rather than receding. So the
   * second number goes too, and two surfaces in this repo now recede at one rate.
   */
  const focus: Focus = nav.state.focus;
  const groupPresence = useCallback(
    (id: string): Presence => presenceOf(focus, id),
    [focus],
  );
  const itemPresence = useCallback(
    (group: string, id: string): Presence => presenceOf(focus, group, id),
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
                  /* The live board only. The echo is a picture of where the reader
                     WAS; lighting a row on it would say "here" twice, in two places,
                     about the same row. */
                  lit={nav.state.highlight}
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
              {inFlight && inFlight.key === flight.flight && flight.moving ? (
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
                  exit={{ opacity: 0, transition: m.leave }}
                  transition={m.zoom}
                  /* The move's own completion ends the flight — the kit's fallback
                     duration is only the net under it. Settling by key means a
                     completion belonging to a level change that has already been
                     superseded cannot declare the one that replaced it finished. */
                  onAnimationComplete={() => flight.settle(inFlight.key)}
                  style={{ transformOrigin: `${inFlight.origin.x}px ${inFlight.origin.y}px` }}
                >
                  {inFlight.echo.level === 0 ? (
                    <Columns
                      board={board}
                      roleFilter={roleFilter}
                      onlyBorderline={onlyBorderline}
                      onOpen={() => {}}
                      ghost
                      presence={groupPresence}
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
                      presence={itemPresence}
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
             * `dossierShell` in ./motion.ts).
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
                  transition={reduced ? instant : m.fade}
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
