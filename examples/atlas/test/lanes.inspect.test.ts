/**
 * A RUN YOU CAN OPEN — the readout's rules, pinned where `node --test` reaches them.
 *
 * Every run of the lane sheet is authored with a sentence (`note`) and a source (`cite`). These
 * cases hold what opening one answers: its role, its two ends, the note, the citation, and the
 * turn stops that travel it, all derived from `EDGES`, the nodes and the story's `HOPS`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cycleRun,
  runKey,
  runReadout,
  runsTouching,
  selectRun,
} from "../components/atlas/variants/archify-lanes/inspect";
import { EDGES, nodeById } from "../components/atlas/variants/archify-lanes/workflow";

test("case 1: opening e-class answers its role, ends, note, cite and the stop it carries", () => {
  const r = runReadout("e-class");
  assert.ok(r, "e-class has no readout");
  assert.deepEqual(
    {
      role: r.role,
      roleLabel: r.roleLabel,
      from: r.from,
      to: r.to,
      note: r.note,
      cite: r.cite,
      stops: r.stops,
    },
    {
      role: "main",
      roleLabel: "the turn",
      from: "The hooks",
      to: "The catalog",
      note: "Reversible? External? The ToolClass is decided in one module.",
      cite: "README §3.3",
      stops: [7],
    },
  );
  assert.equal(r.walked, true);
});

test("case 2: e-approval is a main run no stop travels; e-up and e-home carry the last two", () => {
  const approval = runReadout("e-approval");
  assert.ok(approval);
  assert.deepEqual(approval.stops, []);
  assert.equal(approval.walked, false);
  assert.deepEqual(runReadout("e-up")?.stops, [11]);
  assert.deepEqual(runReadout("e-home")?.stops, [12]);
  assert.equal(runReadout("e-nowhere"), null);
});

test("case 3: every one of the 14 runs reads a note, a cite and its ends' own labels", () => {
  assert.equal(EDGES.length, 14);
  for (const e of EDGES) {
    const r = runReadout(e.id);
    assert.ok(r, `${e.id} has no readout`);
    assert.ok(r.note.length > 0, `${e.id}: empty note`);
    assert.ok(r.cite.length > 0, `${e.id}: empty cite`);
    assert.equal(r.from, nodeById(e.from)?.label);
    assert.equal(r.to, nodeById(e.to)?.label);
  }
});

test("case 4: the runs touching a node, in declaration order, and '[' / ']' cycle them", () => {
  assert.deepEqual(runsTouching("hooks"), ["e-call", "e-class", "e-manifest", "e-ledger"]);
  assert.equal(cycleRun("hooks", "e-ledger", +1), "e-call");
  assert.equal(cycleRun("hooks", null, -1), "e-ledger");
  assert.equal(cycleRun("hooks", null, +1), "e-call");
  assert.equal(cycleRun("hooks", "e-class", -1), "e-call");
  /* A run that does not touch the node starts the cycle over, rather than getting stuck. */
  assert.equal(cycleRun("hooks", "e-home", +1), "e-call");
  assert.equal(runKey("]", "hooks", "e-ledger"), "e-call");
  assert.equal(runKey("[", "hooks", null), "e-ledger");
});

test("case 5: selecting a run with the story on jumps to its first stop; Escape clears", () => {
  assert.deepEqual(selectRun({ story: true, stop: 2 }, "e-class"), { run: "e-class", stop: 6 });
  assert.deepEqual(selectRun({ story: false, stop: 2 }, "e-class"), { run: "e-class", stop: 2 });
  assert.deepEqual(selectRun({ story: true, stop: 2 }, "e-approval"), {
    run: "e-approval",
    stop: 2,
  });
  assert.equal(runKey("Escape", "hooks", "e-class"), null, "Escape keeps the run open");
  assert.equal(runKey("Escape", null, null), undefined, "Escape with nothing open is not ours");
  assert.equal(runKey("a", "hooks", "e-class"), undefined);
});
