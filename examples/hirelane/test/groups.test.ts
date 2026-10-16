/**
 * The groups an agent is told are on the board are the ones the board draws, under every filter.
 *
 * `read_view` lists "every group on the surface right now" (the kit's `ZoomToolsSpec.groups`),
 * `open_group` opens only what that list holds, and `set_filter` answers with
 * `groups_on_the_board`. All three read `BoardTools`' `groups()`, which counted every non-empty
 * column of every role whatever the filter was. So with "arguable only" on, the board drew one
 * row and the agent was told nine were there, and could open eight the reader could not see.
 * `boardGroups` in `components/board/tools/read.ts` applies the board's own filter module.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-groups-test-");

const { buildBoard } = await import("../lib/board");
const { STAGES } = await import("../lib/constants");
const { groupsAt } = await import("../components/board/columns/filter");
const { groupId } = await import("../components/board/model");
const { boardGroups } = await import("../components/board/tools/read");

const FILTERS = ["all", "role_backend", "role_designer"].flatMap((roleFilter) =>
  [false, true].map((onlyBorderline) => ({ roleFilter, onlyBorderline })),
);

test("under every filter, the groups an agent reads are the rows the board draws, with their counts", () => {
  const board = buildBoard();
  for (const filter of FILTERS) {
    const drawn = STAGES.flatMap((stage) =>
      groupsAt(board, stage, filter).map((g) => [groupId(stage, g.role.id), g.candidates.length] as const),
    );
    const told = boardGroups(board, filter).map((g) => [g.id, g.count] as const);
    assert.deepEqual(
      new Map(told),
      new Map(drawn),
      `${filter.roleFilter}, arguable only ${filter.onlyBorderline}: the agent's groups are the drawn rows`,
    );
  }
});

test("unfiltered, the list is every non-empty column of every role, in the order it always was", () => {
  const board = buildBoard();
  const every = board.roles.flatMap((role) =>
    role.columns
      .filter((column) => column.candidates.length > 0)
      .map((column) => ({
        id: groupId(column.id, role.id),
        label: `${role.title} · ${column.label}`,
        count: column.candidates.length,
      })),
  );
  assert.deepEqual(boardGroups(board, { roleFilter: "all", onlyBorderline: false }), every);
});

test("BoardTools lists, opens and counts groups through boardGroups with the board's own filter", () => {
  const source = readFileSync(new URL("../components/board/tools/BoardTools.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(source, /const groups = \(\) => boardGroups\(board, \{ roleFilter, onlyBorderline \}\);/);
});
