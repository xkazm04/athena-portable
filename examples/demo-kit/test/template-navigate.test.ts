// The scaffold's `navigate` must reach every member of its own enum, and must refuse out loud.
//
// `examples/demo-kit/template` is what someone copies to start a host app, so a tool that lies in
// it is inherited by every copy. It used to route `list` and `activity` and send `detail` to the
// list while answering `Opened detail.` - a success string for a navigation that did not happen,
// contradicted a moment later by `read_current_view`. The routing decision lives in the template's
// `lib/constants.ts` as a pure function precisely so this file can pin it; the component does the
// pushing and nothing else, so the answer and the navigation cannot come apart.
//
// The template is deliberately outside the pnpm workspace, so this reaches it by relative path.
// `lib/constants.ts` imports nothing, which is what makes that safe.

import assert from "node:assert/strict";
import { test } from "node:test";

import { VIEWS, routeFor } from "../template/lib/constants.ts";

/** `viewFor()` in components/HostCapabilities.tsx, kept in step. */
function viewFor(pathname: string): string {
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname === "/") return "list";
  return "detail";
}

test("every enum member the manifest advertises is reachable", () => {
  const ids: Record<string, string | undefined> = { detail: "rec-0001" };
  for (const view of VIEWS) {
    const decision = routeFor(view, ids[view]);
    assert.equal(decision.ok, true, `navigate({ view: "${view}" }) was refused`);
  }
});

test("the view a call reports is the view the pushed route resolves to", () => {
  const ids: Record<string, string | undefined> = { detail: "rec-0001" };
  for (const view of VIEWS) {
    const decision = routeFor(view, ids[view]);
    assert.ok(decision.ok);
    assert.equal(
      viewFor(decision.href),
      decision.view,
      `navigate({ view: "${view}" }) pushed ${decision.href}, which reads back as ${viewFor(decision.href)}`,
    );
  }
});

test("detail without an id is refused, and refusing does not navigate", () => {
  for (const missing of [undefined, "", "   ", 7, null]) {
    const decision = routeFor("detail", missing);
    assert.equal(decision.ok, false, `detail with id=${JSON.stringify(missing)} was allowed`);
    assert.ok(!("href" in decision), "a refusal must carry no route to push");
    assert.match((decision as { error: string }).error, /record id/);
  }
});

test("a view outside the enum is refused and the enum is handed back", () => {
  const decision = routeFor("settings");
  assert.equal(decision.ok, false);
  assert.deepEqual((decision as { available?: string[] }).available, [...VIEWS]);
});

test("a record id is escaped into the path rather than pasted into it", () => {
  const decision = routeFor("detail", "rec 1/../secrets");
  assert.ok(decision.ok);
  assert.equal(decision.href, "/rec%201%2F..%2Fsecrets");
  assert.equal(viewFor(decision.href), "detail");
});
