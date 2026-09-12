"use client";

/**
 * L0 — the board: five stage columns, and inside each one a row per role.
 *
 * WHY A ROW PER ROLE. The column is the stage, because position is the fact a
 * pipeline carries and a column says position without needing a label. What
 * goes inside it has to survive a real pipeline, which is not two roles — it is
 * fifteen — so a role is a ROW: one compact band, a title line and a line of
 * faces. Rows stack, so a column holds as many roles as the org has open, and
 * the column scrolls rather than the board reflowing.
 *
 * A row is also the shape the level below it already is. The carousel is a
 * horizontal run of cards with three held under the loupe; a row is that run
 * before it has been opened — the candidates are already in a line, already in
 * the order the cards will hold — so opening a row grows each face into its
 * card where it already stands. A grid of monograms cannot do that, which is
 * why the inside of the column changed and the column itself did not.
 *
 * HOW A ROW STACKS ITSELF. What a face can carry depends on how many are beside
 * it, so the row picks one of three arrangements from its own count:
 *
 *   1-2   the room to say who these people are: face and full name
 *   3-4   face and first name
 *   5+    a cluster: six faces, each tucked an eighth under the one before it,
 *         and a `+N` that counts the rest exactly
 *
 * The cluster is capped rather than tightened, which is the readability fix.
 * Solving the tuck to fit eleven faces in the column's 200px did keep the row
 * on one line, and it did it by showing a 17px sliver of each 32px disc - a
 * heap of half-initials that answered neither "who" nor "how many". Six whole
 * faces and a `+5` answer both.
 */
import type { CSSProperties } from "react";
import { motion } from "motion/react";

import { STAGES } from "@/lib/constants";
import { Face } from "./marks/Face";
import {
  groupId,
  type BdBoard,
  type BdCandidate,
  type BdRole,
} from "./model";
import { settle, throwOut } from "./motion";
import { GroupRead, stageFact } from "./columns/facts";
import {
  FACE,
  PILE_CAP,
  labelFor,
  overlapFor,
  stackingFor,
} from "./columns/stacking";

export function Columns({
  board,
  roleFilter,
  onlyBorderline,
  onOpen,
}: {
  board: BdBoard;
  roleFilter: string;
  onlyBorderline: boolean;
  onOpen: (group: string) => void;
}) {
  return (
    <div className="bd-board">
      {STAGES.map((stage) => {
        const label = board.stageLabel[stage];
        const groups = board.roles
          .map((role): { role: BdRole; candidates: BdCandidate[] } => ({
            role,
            candidates: (role.columns.find((c) => c.id === stage)?.candidates ?? []).filter(
              (c) => !onlyBorderline || c.borderline,
            ),
          }))
          .filter((g) => roleFilter === "all" || g.role.id === roleFilter)
          .filter((g) => g.candidates.length > 0);

        const here = groups.reduce((n, g) => n + g.candidates.length, 0);
        const scored = groups.reduce((n, g) => n + g.candidates.filter((c) => c.scored).length, 0);
        const stageRole = board.roles[0]?.columns.find((c) => c.id === stage)?.role;
        const fact = stageRole ? stageFact(stageRole, groups.flatMap((g) => g.candidates)) : null;

        return (
          <motion.section
            key={stage}
            layout
            transition={settle}
            className="bd-column"
            data-role={stageRole}
          >
            <div className="bd-column-head">
              <h2 className="bd-column-name">{label}</h2>
              <span className="bd-column-figures">
                <span>{here}</span>
                <span aria-hidden>·</span>
                <span>{scored} scored</span>
              </span>
            </div>

            <div className="bd-column-body">
              {groups.length === 0 ? (
                <p className="bd-empty">{onlyBorderline ? "Nobody arguable." : "Nobody here."}</p>
              ) : (
                groups.map(({ role, candidates }) => {
                  const stacking = stackingFor(candidates.length);
                  const shown = candidates.slice(0, PILE_CAP);
                  const hidden = candidates.length - shown.length;
                  const overlap = overlapFor(candidates.length);

                  return (
                    <motion.button
                      key={role.id}
                      type="button"
                      layout
                      transition={settle}
                      className="bd-group-row"
                      onClick={() => onOpen(groupId(stage, role.id))}
                      aria-label={`Open ${role.title} at ${label}, ${candidates.length} candidates`}
                    >
                      <span className="bd-group-label">
                        <b>{role.title}</b>
                        <span>{candidates.length}</span>
                      </span>

                      <span
                        className="bd-pile"
                        data-stacking={stacking}
                        /* Both numbers are solved in stacking.ts and pushed in here: the
                           tuck is derived FROM the face's side, so the stylesheet must draw
                           the face at the side the solve assumed. */
                        style={
                          {
                            "--overlap": `${overlap}px`,
                            "--face": `${FACE}px`,
                          } as CSSProperties
                        }
                      >
                        {shown.map((candidate, index) => {
                          const name = labelFor(candidate, stacking);
                          return (
                            <motion.span
                              key={candidate.id}
                              /* The same identity the carousel card and the
                                 dossier carry. One id, three levels. */
                              layoutId={`candidate-${candidate.id}`}
                              layout
                              className="bd-pile-item"
                              data-borderline={candidate.borderline}
                              title={candidate.name}
                              /*
                               * Earlier faces paint OVER later ones. The array
                               * arrives `byScoreDesc`, so the face that stays
                               * whole is the strongest candidate in the group
                               * and the ones tucking under it are the ones
                               * behind them — which is the same claim the
                               * ranking makes, said with paint order. It used
                               * to be the reverse, so the person a reader most
                               * wanted to see was the one buried.
                               */
                              style={{ zIndex: shown.length - index }}
                              initial={{ opacity: 0, scale: 0.7 }}
                              animate={{ opacity: 1, scale: 1, rotate: 0, x: 0, y: 0 }}
                              exit={throwOut(candidate.id)}
                              transition={settle}
                            >
                              <Face
                                id={candidate.id}
                                initials={candidate.initials}
                                className="bd-mono"
                              />
                              {name ? <span className="bd-pile-name">{name}</span> : null}
                            </motion.span>
                          );
                        })}
                        {hidden > 0 ? <span className="bd-pile-more">+{hidden}</span> : null}
                      </span>

                      <GroupRead candidates={candidates} />
                    </motion.button>
                  );
                })
              )}
            </div>

            {/* The stage's own fact, on the line every column's foot shares. */}
            {fact ? <p className="bd-column-foot">{fact}</p> : null}
          </motion.section>
        );
      })}
    </div>
  );
}
