"use client";

/**
 * The Board on WebMCP: the ingest layer for this direction.
 *
 * Four of the tools are the shared ones every three-level direction gets from
 * `useZoomTools` — read the view, open a group, open a candidate, come back
 * out. The two below are what only this pipeline can answer: a search across
 * both roles and all five stages at once, and the two filters the board is
 * actually lit by.
 *
 * A group here is a `stage::role` pair, because a stage in this app is two
 * queues that happen to be at the same point and the comparison worth making is
 * inside one of them. An agent never has to build that string: `read_view`
 * hands the ids out and `search_candidates` returns the group each person is
 * in.
 *
 * NOTHING HERE CHANGES A PERSON'S PROCESS, and nothing here registers the
 * acts that do. `components/HostCapabilities.tsx` carries scoring, moving,
 * deciding and writing to a candidate — with their gates on them, because
 * `decide_stage` and `send_rejection` end somebody's application and can never
 * be taken back — and it deliberately mounts on the SHIPPED surface and not on
 * this route, so it does not hand the board a second overlapping set. This
 * layer looks and moves: every tool in it is `readOnlyHint` and none is
 * `consequentialHint`.
 *
 * `BOARD_CAPABILITIES` in `lib/manifest.ts` is what this route puts on
 * `document.modelContext`, and it is what the foot's register prints. The two
 * cannot disagree, which is the point: a surface claiming a capability the
 * dispatcher does not have is the manifest being a drawer nobody opened
 * (DESIGN-LAW §7.4) with the door painted on. The list lives in `lib/` rather
 * than in this file because a `.tsx` cannot be read by `node --test`, and the
 * class of every tool is now something a test asserts.
 */
import { useZoomTools, useWebMCPTool } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import { STAGES } from "@/lib/constants";
import { registration } from "@/lib/manifest";
import { candidateOf, columnOf, groupId, splitGroup, type BdBoard } from "../model";
import { candidateRead, dossierRead, groupRead, roleRead } from "./read";
import { readApplicants, readShortlist } from "./roster";
import { searchBoard, type BoardQuery } from "./search";

const LEVELS = ["The board", "One group", "One candidate"] as const;


function num(v: unknown): number | undefined {
  const n = Number(v);
  return v === undefined || v === null || Number.isNaN(n) ? undefined : n;
}

export function BoardTools({
  board,
  nav,
  roleFilter,
  setRoleFilter,
  onlyBorderline,
  setOnlyBorderline,
}: {
  board: BdBoard;
  nav: ZoomNav;
  roleFilter: string;
  setRoleFilter: (next: string) => void;
  onlyBorderline: boolean;
  setOnlyBorderline: (next: boolean) => void;
}) {
  const groups = () =>
    board.roles.flatMap((role) =>
      role.columns
        .filter((column) => column.candidates.length > 0)
        .map((column) => ({
          id: groupId(column.id, role.id),
          label: `${role.title} · ${column.label}`,
          count: column.candidates.length,
        })),
    );

  useZoomTools({
    nav,
    levels: LEVELS,
    nouns: ["group", "candidate"],
    groups,
    items: (group) => {
      const { stage, roleId } = splitGroup(group);
      return board.roles
        .filter((role) => roleId === null || role.id === roleId)
        .flatMap((role) =>
          role.columns
            .filter((column) => stage === null || column.id === stage)
            .flatMap((column) =>
              column.candidates.map((c) => ({
                id: c.id,
                label: `${c.name} · ${column.label}`,
                group: groupId(column.id, role.id),
              })),
            ),
        );
    },
    detail: () => {
      const { level, group, item } = nav.state.focus;
      const { stage, roleId } = splitGroup(group);
      const role = board.roles.find((r) => r.id === roleId);
      if (level === 2 && role) {
        const candidate = candidateOf(role, item);
        return candidate ? dossierRead(role, candidate) : { error: `No candidate ${item}.` };
      }
      if (level === 1 && role) {
        const column = columnOf(role, stage);
        if (!column) return { error: `No stage ${stage} on ${role.title}.` };
        return {
          ...groupRead(role, column),
          rubric: roleRead(role).rubric,
          candidates: column.candidates.map(candidateRead),
        };
      }
      return {
        roles: board.roles.map(roleRead),
        stages: STAGES.map((stage) => ({ id: stage, label: board.stageLabel[stage] })),
        open_interview_slots: board.openSlots.length,
      };
    },
  });

  useWebMCPTool({
    name: "search_candidates",
    description:
      "Search every applicant across both roles and all five stages at once, without opening a group first. Every candidate has a current employer, one of the studio's own clients, so an employer name or domain finds the people who work at a company the other two apps also know. Every result carries the group it is in, so its id can be passed straight to open_item. A score filter matches only candidates somebody has actually scored: an unscored application has no score, and is never treated as a zero.",
    ...registration("search_candidates"),
    handler: (args) => {
      const q: BoardQuery = {
        ...(args.text === undefined ? {} : { text: String(args.text) }),
        ...(args.role === undefined ? {} : { role: String(args.role) }),
        ...(args.employer === undefined ? {} : { employer: String(args.employer) }),
        ...(args.stage === undefined ? {} : { stage: String(args.stage) }),
        ...(num(args.scored_at_least) === undefined ? {} : { scored_at_least: num(args.scored_at_least) }),
        ...(num(args.scored_at_most) === undefined ? {} : { scored_at_most: num(args.scored_at_most) }),
        ...(args.arguable === undefined ? {} : { arguable: Boolean(args.arguable) }),
        ...(args.unscored === undefined ? {} : { unscored: Boolean(args.unscored) }),
      };
      return searchBoard(board, q);
    },
  });

  useWebMCPTool({
    name: "set_filter",
    description:
      "Narrow the board to one role, to the arguable candidates, or both. Unlike a search this changes what is on screen: candidates the filter drops leave the board. Call with no arguments to read the filter without changing it.",
    ...registration("set_filter"),
    handler: ({ role, arguable }) => {
      const state = () => ({
        role: roleFilter,
        arguable_only: onlyBorderline,
        groups_on_the_board: groups().length,
      });
      if (role === undefined && arguable === undefined) return state();

      const wanted = role === undefined ? roleFilter : String(role);
      if (wanted !== "all" && !board.roles.some((r) => r.id === wanted)) {
        return {
          ok: false,
          error: `No role with id ${wanted}.`,
          roles: board.roles.map((r) => ({ id: r.id, title: r.title })),
        };
      }
      if (role !== undefined) setRoleFilter(wanted);
      if (arguable !== undefined) setOnlyBorderline(Boolean(arguable));
      return {
        ok: true,
        role: wanted,
        arguable_only: arguable === undefined ? onlyBorderline : Boolean(arguable),
      };
    },
  });

  /*
   * The two reads the screening journey turns on, and the reason they are reads.
   *
   * Beat 1 scores the applied pile; beat 2 is ONE decision over six named people; beat 6 is a
   * page somebody pastes into Notion. None of those is a stage move, and none of them may become
   * one by being convenient — so both of these answer questions and change nothing, which is what
   * `readOnlyHint` on them says to a browser agent.
   */
  useWebMCPTool({
    name: "read_applicants",
    description:
      "Every applicant on one role, with the address to reach them, where they work now and its domain, their stage, whether a person flagged them borderline, the criterion their application never mentions, and their weighted score IF somebody has scored them. An unscored application has no score field at all - it is not a zero. Pass a stage to read one queue, or borderline: true for the ones worth arguing over. Bounded: the result says how many it is showing of how many there are.",
    ...registration("read_applicants"),
    handler: ({ role_id, stage, borderline }) =>
      readApplicants(board, {
        role_id: String(role_id),
        ...(stage === undefined ? {} : { stage: String(stage) }),
        ...(borderline === undefined ? {} : { borderline: Boolean(borderline) }),
      }),
  });

  useWebMCPTool({
    name: "read_shortlist",
    description:
      "The applicants advanced to interview or offer on one role, as a page: a title, ready-to-paste markdown, and the same people as data. Every one of them carries the sentences they wrote that earned each score, quoted, so the shortlist can be argued with. Bounded: the result and the markdown both say how many it is showing of how many there are.",
    ...registration("read_shortlist"),
    handler: ({ role_id }) => readShortlist(board, String(role_id)),
  });

  return null;
}
