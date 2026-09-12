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
 * THE ZOOM. L0 and L1 occupy the same grid cell, so they overlap rather than
 * replace each other, and both are given the same transform origin: the centre
 * of the lane you actually clicked, measured off its own element the moment
 * before the level changes. The books then scale up and fade out THROUGH that
 * point while the lane scales up into it from below — which is what makes the
 * change read as pushing into the sheet rather than as two views swapping.
 * Going back runs the same move in reverse.
 *
 * L2 is a different gesture on purpose: it is not a zoom but a lift, and it is
 * handled by matched `layoutId`s between the L1 node and the card.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useZoomNav } from "@athena/demo-kit/zoom";

import { Card } from "./Card";
import type { Period } from "@/lib/constants";
import {
  NO_FILTER,
  laneById,
  markById,
  matches,
  type LnBooks,
  type LnFilter,
  type LnSheet,
} from "./model";
import { fade } from "./motion";
import { Spread, type SpreadMode } from "./Spread";
import { Swarm } from "./Swarm";
import { Bar } from "./shell/Bar";
import { Foot } from "./shell/Foot";
import { Mast } from "./shell/Mast";
import { BooksTools, LanesTools } from "./tools";
import "./style/index.css";

export function Lanes({ sheet, books }: { sheet: LnSheet; books: LnBooks }) {
  const nav = useZoomNav();
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
  const [flat, setFlat] = useState(false);
  const [mode, setMode] = useState<SpreadMode>("flat");
  /**
   * True from the moment a lane is opened until its cards have arrived.
   *
   * Layout projection measures boxes in viewport space and re-applies them as
   * transforms, so an ancestor holding a `rotateX` hands motion the projection
   * of a tilted plane and the card arrives skewed. The stack lies flat for the
   * length of the move and tilts back afterwards.
   */
  const [settled, setSettled] = useState(-1);

  const level = nav.state.focus.level;
  const lane = laneById(sheet, nav.state.focus.group);
  const mark = markById(sheet, nav.state.focus.item);
  const detail = mark ? sheet.details[mark.id] : undefined;

  /**
   * Flatten for the length of EVERY level change, whoever asked for it.
   *
   * Three buttons used to flatten the stack themselves, which meant the fourth
   * way of changing level — the Escape key, which the kit's nav owns and this
   * component never sees — projected the morph through a tilted plane and the
   * marks arrived skewed. `flight` counts level changes from all four paths, so
   * hanging the flatten off it is the only version that cannot be forgotten by
   * a new call site. It also runs once on mount, which lands the stack flat and
   * lets the tilt settle in.
   *
   * What is stored is the flight that has FINISHED, so `moving` is derived
   * during render and the stack is flat on the very frame the level changes.
   * Storing `moving` itself would need a `setState` in the effect body, which is
   * both a lint error here and a frame late — the morph would have started.
   */
  const flight = nav.state.flight;
  const moving = settled !== flight;
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(flight), 700);
    return () => window.clearTimeout(timer);
  }, [flight]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const shown = useMemo(
    () => sheet.lanes.reduce((sum, l) => sum + l.marks.filter((m) => matches(m, filter)).length, 0),
    [sheet.lanes, filter],
  );

  const shownInLane = useMemo(
    () => (lane ? lane.marks.filter((m) => matches(m, filter)).length : 0),
    [lane, filter],
  );

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

        <Bar
          sheet={sheet}
          level={level}
          filter={filter}
          setFilter={setFilter}
          flat={flat}
          setFlat={setFlat}
          mode={mode}
          setMode={setMode}
          shown={shown}
          lane={lane}
          shownInLane={shownInLane}
          picked={picked.length}
          period={period}
          setPeriod={setPeriod}
          nav={nav}
        />

        <LayoutGroup>
        <div className="ln-stage">
            {/*
             * Exactly ONE level is mounted at a time, and that is deliberate.
             * A cross-fade keeps both mounted while it plays, which means two
             * elements claim the same `layoutId` and motion animates neither —
             * the marks stop being the cards. Rendering one level is what lets
             * the morph carry the movement instead.
             */}
            {level === 0 || !lane ? (
              <div className="ln-layer">
                <Swarm
                  sheet={sheet}
                  filter={filter}
                  picked={pickedSet}
                  onOpenLane={nav.openGroup}
                  onOpenMark={(laneId, markId) => nav.openItem(laneId, markId)}
                />
              </div>
            ) : (
              <div className="ln-layer">
                <Spread
                  sheet={sheet}
                  lane={lane}
                  filter={filter}
                  picked={pickedSet}
                  mode={mode}
                  onOpenItem={(id) => nav.openItem(lane.id, id)}
                  onOpenLane={nav.openGroup}
                />
              </div>
            )}

        </div>

        <Foot sheet={sheet} lane={lane} mark={mark} level={level} nav={nav} />

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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
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
