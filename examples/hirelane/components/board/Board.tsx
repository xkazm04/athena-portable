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
 * THE ZOOM. L0 and L1 occupy one grid cell, so they overlap rather than replace
 * each other, and both take the same transform origin: the centre of the group
 * that was clicked, measured off its own element the frame before the level
 * changes. The board scales up and fades out THROUGH that point while the
 * carousel scales up into it — the move reads as pushing into the sheet rather
 * than as two views swapping.
 *
 * The group id is `stage:role`, because a stage in this app is two queues that
 * happen to be at the same point and the comparison worth making is inside one
 * of them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useZoomNav } from "@athena/demo-kit/zoom";

import { Carousel } from "./Carousel";
import { Columns } from "./Columns";
import { Dossier } from "./Dossier";
import { splitGroup, type BdBoard } from "./model";
import { BoardTools } from "./tools";
import { BoardFoot } from "./shell/Foot";
import { BoardMast } from "./shell/Mast";
import { BoardToolbar } from "./shell/Toolbar";
import { fade } from "./motion";
import "./style/index.css";

export function Board({ board }: { board: BdBoard }) {
  const nav = useZoomNav();
  const [roleFilter, setRoleFilter] = useState("all");
  const [onlyBorderline, setOnlyBorderline] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

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
   */
  const orphaned = level === 2 && !candidate;
  useEffect(() => {
    if (orphaned) nav.up();
  }, [orphaned, nav]);

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

        <BoardToolbar
          board={board}
          level={level}
          totals={totals}
          roleFilter={roleFilter}
          setRoleFilter={setRoleFilter}
          onlyBorderline={onlyBorderline}
          setOnlyBorderline={setOnlyBorderline}
          nav={nav}
        />

        <div className="bd-stage" ref={stageRef}>
          <LayoutGroup>
            {/*
             * Exactly ONE level is mounted at a time, and that is what makes the
             * change a morph rather than a cross-fade. While a cross-fade plays,
             * both levels are mounted and two elements claim the same
             * `layoutId` — motion then has two claimants for one identity and
             * animates neither, so the faces stop becoming the cards. The
             * movement the cross-fade used to supply is now the morph itself.
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
                  onFocus={(id) => nav.hover(id)}
                  onOpen={(id) => nav.openItem(nav.state.focus.group ?? "", id)}
                />
              </div>
            )}

            <AnimatePresence>
              {level === 2 && role && column && candidate ? (
                <motion.div
                  key="dossier"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={fade}
                >
                  <Dossier
                    role={role}
                    column={column}
                    candidate={candidate}
                    openSlots={board.openSlots}
                    onFocus={(id) => {
                      nav.hover(id);
                      nav.openItem(nav.state.focus.group ?? "", id);
                    }}
                    onClose={nav.up}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
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
