/**
 * The Chores scene's fixtures — README section 3.5, ADR 0040 and 0090.
 *
 * The module's own view-models, reused as they are (`modules/playbooks/fixtures.ts`): built through
 * the same reader the shipped set goes through, so a fixture cannot drift into a shape no real
 * playbook could produce. What the old view expressed as an open layer (`initialOpenFor`,
 * `initialFacetFor`, `initialTurnFor`) is a place here: `pathFor` names it, and the preview opens
 * it with `&at=%23/chores/<id>`. `typical` is first, because the perf gate renders the first.
 */
import type { Path } from "@/depth/model";
import type { FacetId, PlaybooksModel } from "@/modules/playbooks/model";
import {
  fixtures as moduleFixtures,
  initialFacetFor,
  initialOpenFor,
  initialTurnFor,
} from "@/modules/playbooks/fixtures";
import type { FixtureId } from "@/modules/types";

import { chorePath, runPath } from "./model";

/** The module's fixtures minus the one per shipped playbook, which the evidence capture films. */
const IDS: readonly FixtureId[] = [
  "typical",
  "empty",
  "heavy",
  "degraded",
  "open",
  "open-run",
  "open-turn-2",
  "open-traps",
  "open-short",
  "open-short-traps",
  "open-short-proof",
  "open-unbenched",
  "open-evidence",
  "open-short-evidence",
  "shipped",
  "shipped-open",
  "shipped-proof",
];

export const fixtures: Readonly<Record<string, PlaybooksModel>> = Object.fromEntries(
  IDS.map((id) => [id, moduleFixtures[id]!]),
);

export const fixtureIds: readonly FixtureId[] = IDS;

/** Where a fixture is meant to be looked at: the field, a chore, or a turn of its replay. */
export function pathFor(fixture: FixtureId): Path {
  const id = initialOpenFor(fixture);
  if (id === null) return { root: "chores" };
  return initialFacetFor(fixture) === "run" ? runPath(id, initialTurnFor(fixture)) : chorePath(id);
}

/** The facet a fixture's chore opens on; the replay is a place of its own, not a facet. */
export function facetFor(fixture: FixtureId): FacetId | null {
  const facet = initialFacetFor(fixture);
  return facet === "run" ? null : facet;
}
