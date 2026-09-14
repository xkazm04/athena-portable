/**
 * The one thing the three spatial directions share.
 *
 * WHY THERE ARE THREE. Round 2 was reviewed as "too careful": every adjustment
 * was a correction to the shape already on the page, so the rounds could not
 * learn a *conceptual* lesson — only a craft one. Round 3 is a concept test.
 * The same database, the same tools, the same three depths, drawn three ways:
 *
 *   board          the shipped columns/carousel/dossier, unchanged in look,
 *                  with the kit's Echo carrying rule 1 and a free camera over
 *                  the board. The CONTROL: it tests the camera rig and nothing
 *                  else, so whatever the other two win is theirs.
 *   rooms          place-based navigation. Five rooms seen from above in CSS
 *                  3D, one per stage, each floor holding its role groups as
 *                  tables and its candidates as seated tokens. Opening a group
 *                  is the camera going down into that room; the rooms you are
 *                  not in stay on screen, receded. Asks: does a place you
 *                  RETURN to beat a layer that re-mounts?
 *   constellation  semantic zoom. One field of points, every candidate placed
 *                  by weighted score and by how much of the rubric their
 *                  application actually speaks to, banded by group. Zoom in and
 *                  a point becomes a chip, then a card, then the dossier. Asks
 *                  the same question ledgerbox's map asked, in a second domain:
 *                  can camera distance BE the level?
 *
 * THE RULE OF THE FOLDERS. Each direction lives in `dir/<name>/` and imports
 * nothing from any other. This file is the only thing all three share, and it
 * holds exactly two kinds of thing: the props the board hands down, and the
 * pure arithmetic more than one drawing of the same pipeline would otherwise
 * copy. The masthead, the foot, the switcher, the scrim and the DOSSIER are the
 * host's (`Board.tsx`): L2 is the same pane in all three, because the round is
 * a test of how you get to an item, not of what an item says.
 *
 * WHAT IS NOT HERE. No component, no stylesheet, no motion. A direction that
 * needed to reach into another direction's geometry would have been the tell
 * that the concepts are not actually separable, and none of them did.
 */

import type { Focus, LevelFlight, Presence, ZoomNav } from "@athena/demo-kit/zoom";

import type { BdBoard, BdCandidate, BdColumn, BdRole } from "../model";
import { groupId } from "../model";
import { STAGES, type Stage } from "@/lib/constants";

/* ---------------------------------------------------------- the directions */

export const DIRECTIONS = ["board", "rooms", "constellation"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABEL: Record<Direction, string> = {
  board: "board",
  rooms: "rooms",
  constellation: "constellation",
};

/** What each direction is, in the one line the switcher can carry as a title. */
export const DIRECTION_NOTE: Record<Direction, string> = {
  board: "Five stage columns, a carousel, a dossier. The camera is free over it.",
  rooms: "Five rooms seen from above. Opening a group flies down into one.",
  constellation: "One field of points. Zoom in and a point becomes a card.",
};

/** The concept each one is a test of, for the brief and for the switcher's note. */
export const DIRECTION_CONCEPT: Record<Direction, string> = {
  board: "control: the camera rig alone, over the shape that already reads",
  rooms: "a place you return to, against a layer that re-mounts",
  constellation: "camera distance as the level",
};

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

/* ----------------------------------------------------------------- the data */

/**
 * One (stage, role) pair with the people standing in it: the unit the board
 * opens, after the filters have had their say.
 *
 * Every direction needs exactly this list and each of them was about to derive
 * it from `board.roles` in its own double loop — the same filter predicate
 * written three times, which is how three drawings of one pipeline start
 * disagreeing about how many people are in it.
 */
export interface DirGroup {
  /** `stage::role`, the kit's opaque group id. */
  id: string;
  stage: Stage;
  stageLabel: string;
  role: BdRole;
  column: BdColumn;
  candidates: BdCandidate[];
}

export interface DirFilters {
  roleFilter: string;
  onlyBorderline: boolean;
}

/**
 * The groups, in board order: stage-major, then the roles in the order the
 * board declares them. Empty groups are dropped — a room with nobody in it and
 * a band with no points are both furniture — but the STAGES are not, because a
 * stage with nobody in it is a fact about the pipeline.
 */
export function groupsOf(board: BdBoard, filters: DirFilters): DirGroup[] {
  const out: DirGroup[] = [];
  for (const stage of STAGES) {
    for (const role of board.roles) {
      if (filters.roleFilter !== "all" && role.id !== filters.roleFilter) continue;
      const column = role.columns.find((c) => c.id === stage);
      if (!column) continue;
      const candidates = column.candidates.filter(
        (c) => !filters.onlyBorderline || c.borderline,
      );
      if (candidates.length === 0) continue;
      out.push({
        id: groupId(stage, role.id),
        stage,
        stageLabel: board.stageLabel[stage],
        role,
        column,
        candidates,
      });
    }
  }
  return out;
}

/** The groups that belong to one stage, in role order. */
export function groupsInStage(groups: DirGroup[], stage: Stage): DirGroup[] {
  return groups.filter((g) => g.stage === stage);
}

/**
 * How much of the rubric a candidate's application actually speaks to, as a
 * count of quoted sentences.
 *
 * Not `meta.evidenced`, which is a count of CRITERIA and is only interesting in
 * screening. The constellation's vertical axis is "how much did they say", and
 * that is sentences: two criteria with four quotes between them is a thicker
 * application than four criteria with one each, and the board already prints
 * both figures one level down.
 */
export function evidenceCount(candidate: BdCandidate): number {
  return candidate.scores.reduce((n, s) => n + s.evidence.length, 0);
}

/**
 * A stable number in [0, 1) from an id.
 *
 * Every direction needs one — a seat that does not reshuffle between renders, a
 * point that does not sit exactly on top of another point — and a random one
 * would make the same board look different on two machines, which is the thing
 * `Portrait.tsx` already refuses to do for the same reason.
 */
export function spread(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 100003;
  return hash / 100003;
}

/* ---------------------------------------------------------------- the props */

/**
 * What the board hands every direction.
 *
 * The nav and the flight go down whole rather than as callbacks, because a
 * direction that drives a camera has to READ them — which level is open, which
 * group, whether a move is in the air — and a direction that only clicks can
 * ignore everything but `onOpenGroup`. `presence` is the kit's `presenceOf()`
 * already bound to the current focus, so no direction re-derives what recedes
 * (formula §1 rule 7).
 */
export interface DirProps {
  board: BdBoard;
  /** The filtered groups, board order. */
  groups: DirGroup[];
  nav: ZoomNav;
  flight: LevelFlight;
  focus: Focus;
  filters: DirFilters;
  /** The role, column and candidate the focus names, resolved once by the host. */
  role: BdRole | undefined;
  column: BdColumn | undefined;
  candidate: BdCandidate | undefined;
  /** The kit's `highlight` set: where the reader just came back from. */
  lit: ReadonlySet<string>;
  onOpenGroup: (group: string) => void;
  onOpenItem: (group: string, item: string) => void;
  /** `presenceOf(focus, group)` / `presenceOf(focus, group, item)`, bound. */
  presence: (group: string, item?: string) => Presence;
  /** True under `prefers-reduced-motion`. Every direction lands on final state. */
  reduced: boolean;
}
