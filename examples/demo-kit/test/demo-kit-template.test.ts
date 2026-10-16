// The template's own promises, held to the tree: what someone copies to start a host app.
//
// A defect in `examples/demo-kit/template` is inherited by every copy, so each test here pins one
// thing the template says or does against the ground truth it describes. The template is outside
// the pnpm workspace; this file reaches it by relative path, and reads only modules that import
// nothing (`lib/constants.ts`) or the source text itself.

import assert from "node:assert/strict";
import { test } from "node:test";

import { VIEWS, routeFor, viewFor } from "../template/lib/constants.ts";

/** Where the browser actually lands for a pushed href: the URL parser collapses `.` and `..`. */
function landsOn(href: string): string {
  return viewFor(new URL(href, "http://app.invalid").pathname);
}

test("navigate never answers detail for an id whose route lands on another view", () => {
  // `/..` and `/.` collapse to `/`, the list; `/activity` is the static route, which wins over
  // `app/[id]`; `/activity-log` IS `app/[id]`, a record page, whatever its prefix.
  for (const id of ["rec-0001", "..", ".", "activity", "activity-log", "rec 1/../x", "%2e%2e"]) {
    const decision = routeFor("detail", id);
    if (decision.ok) {
      assert.equal(
        landsOn(decision.href),
        "detail",
        `navigate({ view: "detail", id: ${JSON.stringify(id)} }) answered ok and pushed ${decision.href}, which lands on ${landsOn(decision.href)}`,
      );
    } else {
      assert.ok(!("href" in decision), "a refusal must carry no route to push");
      assert.match(decision.error, /record/);
    }
  }
});

test("an ordinary record id, and every view, still route to where they say", () => {
  const ids: Record<string, string | undefined> = { detail: "rec-0001" };
  for (const view of VIEWS) {
    const decision = routeFor(view, ids[view]);
    assert.ok(decision.ok, `navigate({ view: "${view}" }) was refused`);
    assert.equal(landsOn(decision.href), view);
  }
  assert.ok(routeFor("detail", "activity-log").ok, "a record whose id starts with activity is still a record");
});

test("read_current_view names a record page whose id starts with activity as detail", () => {
  assert.equal(viewFor("/activity"), "activity");
  assert.equal(viewFor("/activity-log"), "detail");
  assert.equal(viewFor("/"), "list");
});
