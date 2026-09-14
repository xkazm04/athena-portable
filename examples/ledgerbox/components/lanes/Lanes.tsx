"use client";

/**
 * The Lanes — the whole surface, and the only stateful component in the
 * direction.
 *
 * It owns the level (through the kit's shared L0/L1/L2 model, so "open a
 * group" means here exactly what it means in Hirelane's Board and TidyCRM's
 * Blocks), the filter, the tick and the period, and the two view switches.
 * Everything else is a pure child.
 *
 * Every one of those pieces of state is also something a tool moves — which is
 * the reason they are here rather than in the tool files: an agent's call and a
 * person's click have to end in the same setState, or the two are looking at
 * different pages.
 *
 * THE ZOOM, AS BUILT. L0 and L1 occupy the same grid cell and BOTH STAY MOUNTED
 * for the length of a level change, so the change is a move and not a cut. One
 * rule decides who does what:
 *
 *   the level you are LEAVING carries the camera — it scales through the
 *   transform origin measured off the lane you actually clicked, and fades;
 *   the level you are ARRIVING at carries the continuity — it starts at its
 *   final pose and its members travel into place, staggered.
 *
 * That split is what keeps the two jobs from fighting. Layout projection
 * measures boxes in viewport space, so an ancestor animating its own `scale`
 * hands motion the projection of a scaled plane and every morph inside it
 * lands in the wrong place. Only the outgoing layer ever holds a transform, and
 * the outgoing layer has nothing left to morph.
 *
 * ONE ELEMENT CLAIMS A `layoutId` AT A TIME, and that is what the two mounted
 * levels cost. A `layoutId` claimed by two live elements animates neither — the
 * marks stop being the cards. So the layer matching the current level is LIVE
 * and keeps its ids, and the layer on its way out renders the same markup
 * without them: the ids deregister in the same commit the arriving layer claims
 * them, which is exactly the handoff an unmount would have given.
 *
 * L2 is a different gesture on purpose: it is not a zoom but a lift, and it is
 * handled by matched `layoutId`s between the L1 node and the card.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { useZoomNav, type Focus } from "@athena/demo-kit/zoom";

import { Card } from "./Card";
import type { Period } from "@/lib/constants";
import {
  NO_FILTER,
  laneById,
  markById,
  type LnBooks,
  type LnFilter,
  type LnSheet,
} from "./model";
import { fade, instant, lift, move } from "./motion";
import { Spread, type SpreadMode } from "./Spread";
import { Swarm } from "./Swarm";
import { Foot } from "./shell/Foot";
import { Mast } from "./shell/Mast";
import { BooksTools, LanesTools } from "./tools";
import "./style/index.css";

/** What a level change is: the focus it left and the focus it is going to. */
interface Flight {
  id: number;
  from: Focus;
  to: Focus;
}

export function Lanes({ sheet, books }: { sheet: LnSheet; books: LnBooks }) {
  const nav = useZoomNav();
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<LnFilter>(NO_FILTER);
  /**
   * Invoices ticked by `select`, and the period the close readout is pointed at by `set_period`.
   *
   * Both are here rather than in the tool file for the same reason the filter is: a tool that
   * moves the view has to move the SAME state a click moves, or the agent and the person are
   * looking at two different pages. A ticked mark is ringed at L0 and L1; the period is a control
   * on the toolbar.
   */
  const [picked, setPicked] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>("2026-08");
  /*
   * The two view switches lost their controls with the bar, and neither was ever reachable by a
   * tool — grep `components/lanes/tools/` and `lib/manifest.ts`: nothing registers them. So they
   * are the defaults they always opened at, held as constants rather than as state nothing can
   * move. If an agent is ever given a `set_view`, these become state again and the tool is what
   * moves them.
   */
  const flat = false;
  const mode: SpreadMode = "flat";

  const focus = nav.state.focus;
  const level = focus.level;
  const flightId = nav.state.flight;

  /**
   * The flight in progress, derived during render rather than in an effect.
   *
   * The outgoing level has to be known on the very frame the level changes —
   * that is the frame the layer it is leaving has to still be mounted for, and
   * the frame the arriving layer measures its morph against. An effect is one
   * frame late, which is a cut with extra steps. Adjusting state during render
   * is the one React-sanctioned way to read "what changed": the guard is the
   * kit's monotonic `flight`, so this settles in a single extra pass.
   */
  const [flight, setFlight] = useState<Flight>(() => ({ id: flightId, from: focus, to: focus }));
  if (flight.id !== flightId) setFlight({ id: flightId, from: flight.to, to: focus });

  /**
   * The flight that has FINISHED. Everything about "are we mid-move" is derived
   * from the difference, so it is true on the very frame the level changes
   * rather than a `setState` in an effect body later.
   */
  const [settled, setSettled] = useState(-1);
  const moving = settled !== flightId;

  /**
   * Flatten for the length of EVERY level change, whoever asked for it.
   *
   * Three buttons used to flatten the stack themselves, which meant the fourth
   * way of changing level — the Escape key, which the kit's nav owns and this
   * component never sees — projected the morph through a tilted plane and the
   * marks arrived skewed. `flight` counts level changes from all four paths, so
   * hanging the flatten off it is the only version that cannot be forgotten by
   * a new call site.
   *
   * IT ENDS WHEN THE MOVE ENDS, not on a timer. This used to be a bare
   * `setTimeout(…, 700)` — a number with no relation to the spring it was
   * guessing at and no token anywhere near it. `.ln-flight` below runs the move
   * that is actually in flight and says when it has settled, so the tilt comes
   * back on the frame the morph stops and not a moment either side.
   */
  const lands = flight.to.level === 2 || flight.from.level === 2 ? lift : move();
  const signal = reduced ? instant : lands;

  const lane = laneById(sheet, focus.group);
  const mark = markById(sheet, focus.item);
  const detail = mark ? sheet.details[mark.id] : undefined;

  /**
   * Which layers are on the stage, and which of them is live.
   *
   * Live means "this is the level you are on": it keeps the `layoutId`s and it
   * takes the pointer. The other one is scenery for the length of the move.
   */
  const swarmLive = level === 0;
  const spreadLive = level > 0;
  const leavingSwarm = moving && flight.from.level === 0 && level > 0;
  const leavingSpread = moving && flight.from.level > 0 && level === 0;
  const spreadLane = lane ?? (leavingSpread ? laneById(sheet, flight.from.group) : undefined);
  const showSwarm = swarmLive || leavingSwarm;
  const showSpread = Boolean(spreadLane) && (spreadLive || leavingSpread);

  /**
   * THE TRANSFORM ORIGIN IS MEASURED, not assumed.
   *
   * Both layers scale through the centre of the lane you actually clicked,
   * taken off that lane's own element in the frame before it leaves — which is
   * possible only because the outgoing layer is still mounted when this runs.
   * Without it the zoom pushes through the middle of the stage, which is the
   * one point on the sheet the reader was not looking at.
   */
  const stageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const group = flight.to.group ?? flight.from.group;
    const el = group
      ? stage.querySelector<HTMLElement>(`.ln-lane[data-lane="${CSS.escape(group)}"]`)
      : null;
    const box = stage.getBoundingClientRect();
    const from = el?.getBoundingClientRect();
    if (!from || box.width === 0 || box.height === 0) return;
    stage.style.setProperty(
      "--ln-zoom-x",
      `${((from.left + from.width / 2 - box.left) / box.width) * 100}%`,
    );
    stage.style.setProperty(
      "--ln-zoom-y",
      `${((from.top + from.height / 2 - box.top) / box.height) * 100}%`,
    );
  }, [flight]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="ln-root"
        data-variant="lanes"
        data-level={level}
        data-flat={flat || moving}
      >
        {/* The ingest layer: this direction's three levels, offered to an
            agent beside the page on `document.modelContext`. Renders nothing,
            and every tool it registers reads or moves — none of them writes. */}
        <LanesTools sheet={sheet} nav={nav} filter={filter} setFilter={setFilter} />
        {/* The books' own layer: the reads, and the seven acts — three of them
            gated. Mounted beside the view layer, on the one shipped route, so
            the union in `lib/manifest.ts` is what an agent finds. */}
        <BooksTools
          sheet={sheet}
          books={books}
          nav={nav}
          filter={filter}
          setFilter={setFilter}
          picked={picked}
          setPicked={setPicked}
          period={period}
          setPeriod={setPeriod}
        />

        <div className="ln-bath" aria-hidden />
        <div className="ln-vignette" aria-hidden />
        <div className="ln-grain" aria-hidden />

        <Mast sheet={sheet} />

        {/*
         * The completion signal. A zero-size element, keyed on the flight, that
         * runs the move THIS level change is actually running and reports when
         * it settles — so the flatten above ends with the morph rather than at
         * a number somebody typed. It is the whole of what a 700ms timer used
         * to do, minus the 700.
         */}
        <motion.span
          key={flightId}
          className="ln-flight"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={signal}
          onAnimationComplete={() => setSettled(flightId)}
        />

        <LayoutGroup>
        <div className="ln-stage" ref={stageRef}>
            {/*
             * BOTH LEVELS ARE MOUNTED WHILE ONE IS LEAVING, and the `layoutId`
             * pitfall that used to forbid it is solved rather than avoided: the
             * outgoing layer renders the same markup with its ids dropped (the
             * `live` prop), so exactly one element claims each id in every
             * frame and the handoff is the one an unmount would have given.
             */}
            {showSwarm ? (
              <motion.div
                className="ln-layer"
                data-layer="swarm"
                initial={false}
                animate={swarmLive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.16 }}
                transition={reduced ? instant : move()}
              >
                <Swarm
                  sheet={sheet}
                  focus={focus}
                  live={swarmLive}
                  filter={filter}
                  picked={pickedSet}
                  onOpenLane={nav.openGroup}
                  onOpenMark={(laneId, markId) => nav.openItem(laneId, markId)}
                />
              </motion.div>
            ) : null}

            {showSpread && spreadLane ? (
              <motion.div
                className="ln-layer"
                data-layer="spread"
                initial={false}
                animate={spreadLive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.92 }}
                transition={reduced ? instant : move()}
              >
                <Spread
                  sheet={sheet}
                  lane={spreadLane}
                  live={spreadLive}
                  filter={filter}
                  picked={pickedSet}
                  mode={mode}
                  onOpenItem={(id) => nav.openItem(spreadLane.id, id)}
                />
              </motion.div>
            ) : null}

        </div>

        {/* The legend is also the filter panel, so the footer takes the filter
            and the setter the tools already move. One `setFilter`, whether the
            press came from a person's thumb or from `set_filter`. */}
        <Foot
          sheet={sheet}
          lane={lane}
          mark={mark}
          level={level}
          nav={nav}
          filter={filter}
          setFilter={setFilter}
        />

        {/*
         * The card layer lives HERE, after the footer, and that placement is
         * load-bearing rather than tidy. It used to sit inside `.ln-stage`,
         * which is a positioned `.ln-root` child and therefore its own stacking
         * context — so the card's `z-index: 60` competed only with its
         * siblings inside the stage, and the footer, a later sibling of the
         * stage at the same level, painted its top rule straight through the
         * card's action panel. As a later sibling itself the card is above
         * everything, with no z-index arms race.
         *
         * It stays inside the `LayoutGroup`, which is what carries the
         * `layoutId` morph from the node it grew out of.
         */}
        <AnimatePresence>
          {level === 2 && mark ? (
            <motion.div
              key="card"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? instant : fade()}
            >
              <Card
                mark={mark}
                detail={detail}
                laneLabel={lane?.label ?? mark.category}
                onClose={nav.up}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        </LayoutGroup>
      </div>
    </MotionConfig>
  );
}
