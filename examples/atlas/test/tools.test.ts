/**
 * What Atlas answers an agent: the bounds, the refusals, and the lens arithmetic.
 *
 * Three things are being pinned, and each has a named failure mode from AGENTS.md and from the
 * template's own "rules the app agents must not break":
 *
 *   · a bounded read that does not announce its bound — the agent cannot tell what it did not see;
 *   · a handler that answers a request it will not serve with a success string — the agent's next
 *     step acts on the wrong thing and `read_view` then contradicts the answer it was just given;
 *   · a lens read that disagrees with the lens the surface draws — the mark on a band and the
 *     mark on a row would then mean different things.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { CONCEPTS, COMPONENTS, LAYERS, SYSTEMS, lensFor, litInLayer } from "../data";
import { READ_CAP } from "../lib/constants";
import {
  CONCEPT_KINDS,
  announce,
  announced,
  componentRead,
  conceptsRead,
  lensRead,
  systemRead,
  viewDetail,
} from "../components/atlas/tools/read";

test("announce() is the one sentence AGENTS.md asks for", () => {
  assert.equal(announce(5, 22), "(showing 5 of 22)");
});

test("announced() cuts at the cap, states the total, and says so in words", () => {
  const rows = Array.from({ length: 90 }, (_, i) => ({ id: `r${i}` }));
  const cut = announced(rows, (r) => r.id);
  assert.equal(cut.showing, READ_CAP);
  assert.equal(cut.of, 90);
  assert.equal(cut.items.length, READ_CAP);
  assert.equal(cut.footer, `(showing ${READ_CAP} of 90)`);
});

test("announced() of a short list is not truncated and still announces", () => {
  const cut = announced([1, 2, 3], (n) => n);
  assert.equal(cut.showing, 3);
  assert.equal(cut.of, 3);
  assert.equal(cut.footer, "(showing 3 of 3)");
});

test("read_concepts answers every kind in its own enum", () => {
  for (const kind of CONCEPT_KINDS) {
    const out = conceptsRead(kind);
    assert.ok(out.ok, `${kind} was refused`);
    assert.ok(out.of > 0, `${kind} matched nothing`);
    for (const row of out.items) assert.equal(row.kind, kind);
  }
});

test("read_concepts refuses a kind it does not have, and says which it does", () => {
  const out = conceptsRead("vibes");
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.match(out.error, /vibes/);
  assert.deepEqual(out.available, [...CONCEPT_KINDS]);
});

test("read_concepts with no kind returns all of them, with their component counts", () => {
  const out = conceptsRead();
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.of, CONCEPTS.length);
  for (const row of out.items) assert.ok(row.components > 0, `${row.part} lights nothing`);
});

test("read_system answers every system id it advertises", () => {
  for (const s of SYSTEMS) {
    const out = systemRead(s.id);
    assert.ok(out.ok, `${s.id} was refused`);
    if (!out.ok) continue;
    assert.equal(out.id, s.id);
    assert.ok(out.components.of > 0);
    assert.ok(out.layer, `${s.id} has no layer`);
  }
});

test("read_system refuses an unknown id with the ids it has", () => {
  const out = systemRead("sys-nope");
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.available.length, SYSTEMS.length);
});

test("read_component answers every component, with both directions of its edges", () => {
  for (const c of COMPONENTS) {
    const out = componentRead(c.id);
    assert.ok(out.ok, `${c.id} was refused`);
    if (!out.ok) continue;
    assert.equal(out.file, c.file);
    assert.ok(out.system && out.layer, `${c.id} lost its place`);
    /* Every edge the read reports has to name a component that exists, or the agent is handed an
       id it cannot pass to open_item. */
    for (const e of [...out.called_by.items, ...out.reaches.items]) {
      assert.ok(COMPONENTS.some((x) => x.id === e.id), `${c.id} cites unknown ${e.id}`);
    }
  }
});

test("read_component refuses an unknown id with a hint and a bounded list", () => {
  const out = componentRead("cmp-nope");
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.match(out.error, /cmp-nope/);
  assert.ok(out.available.footer.startsWith("(showing "));
  assert.ok(out.available.showing <= READ_CAP);
  assert.equal(out.available.of, COMPONENTS.length);
});

test("set_lens's read agrees with the lens the surface draws", () => {
  for (const concept of CONCEPTS) {
    const out = lensRead(concept.id);
    const lens = lensFor(concept.id);
    assert.equal(out.lens?.id, concept.id);
    assert.equal(out.components?.of, lens.components.size);
    assert.equal(out.systems?.length, lens.systems.size);
    assert.equal(out.layers?.length, lens.layers.size);
    /* And the per-layer figures are the ones the bands print. */
    for (const row of out.layers ?? []) {
      assert.equal(row.lit, litInLayer(lens, row.id));
    }
  }
});

test("set_lens with nothing set reads as no lens, and offers the concepts", () => {
  const out = lensRead(null);
  assert.equal(out.lens, null);
  assert.equal(out.concepts?.of, CONCEPTS.length);
});

test("read_view's detail is honest at all three levels", () => {
  const l0 = viewDetail({ level: 0, group: null, item: null }, null);
  assert.equal(l0.counts?.components, COMPONENTS.length);
  assert.equal(l0.stack?.length, LAYERS.length);

  const layer = LAYERS[0]!;
  const l1 = viewDetail({ level: 1, group: layer.id, item: null }, null);
  assert.equal(l1.layer?.id, layer.id);
  assert.ok((l1.systems?.length ?? 0) > 0);
  assert.ok(l1.components?.footer.startsWith("(showing "));

  const component = COMPONENTS[0]!;
  const l2 = viewDetail({ level: 2, group: component.system, item: component.id }, null);
  assert.equal(l2.component?.ok, true);
});

test("read_view carries the lens at every level, so an agent never loses the mark", () => {
  const concept = CONCEPTS[0]!;
  for (const focus of [
    { level: 0 as const, group: null, item: null },
    { level: 1 as const, group: LAYERS[0]!.id, item: null },
    { level: 2 as const, group: COMPONENTS[0]!.system, item: COMPONENTS[0]!.id },
  ]) {
    const out = viewDetail(focus, concept.id);
    assert.equal(out.lens?.id, concept.id);
  }
});
