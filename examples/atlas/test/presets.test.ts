/**
 * Round 7: three finishes of one drawing, and the switcher that puts them on the table.
 *
 * The geometry is not under test here — `lanes.model.test.ts` / `lanes.poses.test.ts` /
 * `lanes.routing.test.ts` already pin it. This file pins the THESIS of the round: the mast has
 * a real choice, the three slugs are distinct finishes of the same engine, and the copy each
 * finish puts on the page is the claim it is making.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COPY, VIEWS } from "../components/atlas/variants/archify-lanes/copy";
import { VARIANTS, type VariantSlug } from "../components/atlas/variants/contract";
import { variantRow } from "../components/atlas/tools/read";
import { BEAT_VIEWS } from "../components/atlas/variants/archify-lanes/story";
import { LANES } from "../components/atlas/variants/archify-lanes/workflow";

test("the default variant is the round-6 winner, and two finishes sit beside it", () => {
  assert.equal(VARIANTS.length, 3);
  assert.equal(VARIANTS[0]!.slug, "archify-lanes");
  const slugs = VARIANTS.map((v) => v.slug);
  assert.deepEqual(slugs, ["archify-lanes", "archify-signal", "archify-editorial"]);
  assert.equal(new Set(slugs).size, 3, "a slug appears twice");
  assert.equal(new Set(VARIANTS.map((v) => v.label)).size, 3, "a label is reused");
  for (const v of VARIANTS) {
    assert.ok(v.blurb.length > 20, `${v.slug} has no claim`);
    assert.ok(v.label.length > 0 && v.label.length < 16, `${v.slug} label is not a tab`);
  }
});

test("every finish projects through variantRow, so read_view and set_variant agree", () => {
  for (const v of VARIANTS) {
    const row = variantRow(v.slug);
    assert.equal(row.id, v.slug);
    assert.equal(row.label, v.label);
    assert.equal(row.is, v.blurb);
  }
});

test("the three finishes share one engine: two views, twelve stops, four lanes", () => {
  assert.deepEqual([...VIEWS], ["lanes", "turn"]);
  assert.equal(BEAT_VIEWS.length, 12);
  assert.equal(LANES.length, 4);
  const presets = Object.keys(COPY) as (keyof typeof COPY)[];
  assert.deepEqual(presets, ["classic", "signal", "editorial"]);
  for (const preset of presets) {
    assert.ok(COPY[preset].title.length > 0, `${preset} has no title`);
    assert.ok(COPY[preset].subtitle.length > 40, `${preset} has no argument`);
  }
  assert.notEqual(COPY.classic.title, COPY.signal.title);
  assert.notEqual(COPY.classic.title, COPY.editorial.title);
});

test("VariantSlug is exactly the VARIANTS list, so the tool enum cannot drift", () => {
  const asSlug = (s: string): s is VariantSlug => VARIANTS.some((v) => v.slug === s);
  for (const v of VARIANTS) assert.equal(asSlug(v.slug), true);
  assert.equal(asSlug("archify"), false);
  assert.equal(asSlug("archify-density"), false);
});
