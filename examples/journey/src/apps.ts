/**
 * README section 1 â€” the three host applications the four acts move between.
 *
 * One row per app: the port it serves on, the workspace directory `next dev` is spawned in, and
 * the tool names the journey asserts the gate's class for. The names are the stable half of the
 * contract with the app agents; everything about the *shape* of what those tools answer lives in
 * `contracts.ts`, so a field that moves is one edit there and none here.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** `examples/` â€” the parent of this package and of the three apps. */
export const EXAMPLES = resolve(here, "..", "..");

/**
 * Every app's port, shiftable in one place.
 *
 * The demo's ports are 3001/3002/3004 and the default is exactly those. `JOURNEY_PORT_OFFSET`
 * moves all three together, which is what a second journey on one machine needs — and what a
 * developer needs when the port is already held by a dev server somebody else started, since
 * adopting that one means asserting against whatever code it happens to be running.
 */
export const PORT_OFFSET = Number(process.env.JOURNEY_PORT_OFFSET ?? 0);

/**
 * How a spec is served.
 *
 * `next` is one of the studio's three applications. `static` is the fourth thing the journey
 * boots and the only one that is not ours: a directory of hand-written HTML with no script in it
 * at all (`outside/`). The distinction is not cosmetic — a `static` spec registers no tools, so
 * everything Athena does on it is a generic hand (README section 3.4, tier 2).
 */
export type AppKind = "next" | "static";

export interface AppSpec {
  /** The slug the catalog namespaces tools under (`host.<app_id>.<name>`). */
  readonly id: string;
  readonly dir: string;
  readonly port: number;
  /** The tools this act asserts are GATED. Every other tool the page lists must be AUTO. */
  readonly gated: readonly string[];
  readonly kind: AppKind;
}

export const LEDGERBOX: AppSpec = {
  id: "ledgerbox",
  dir: resolve(EXAMPLES, "ledgerbox"),
  port: 3001 + PORT_OFFSET,
  gated: ["mark_paid", "send_reminder", "void_invoice"],
  kind: "next",
};

export const HIRELANE: AppSpec = {
  id: "hirelane",
  dir: resolve(EXAMPLES, "hirelane"),
  port: 3002 + PORT_OFFSET,
  gated: ["decide_stage", "send_scheduling_email", "send_rejection"],
  kind: "next",
};

export const TIDYCRM: AppSpec = {
  id: "tidycrm",
  dir: resolve(EXAMPLES, "tidycrm"),
  port: 3004 + PORT_OFFSET,
  gated: ["merge_contacts", "delete_contacts", "undo"],
  kind: "next",
};

/**
 * The page that has never heard of Athena — README section 3.4, tier 2.
 *
 * Kestrel Labs' own supplier portal: four files of static HTML with no `document.modelContext`, no
 * `athena:app` meta tag and no script element. It is in the journey because the three applications
 * above all publish WebMCP tools, and a demo made only of pages that agreed to cooperate proves
 * the smaller half of the claim. Here Athena has eight generic hands and nothing else, and act 1's
 * one undecided credit is what she uses them to settle.
 *
 * `gated` is empty because the page lists no tools at all; the hands' classes come from the same
 * derivation as any page's, through `gate.js`.
 */
export const OUTSIDE: AppSpec = {
  id: "kestrel-portal",
  // `here` is `src/`; the site is a sibling of it, at `examples/journey/outside`.
  dir: resolve(here, "..", "outside"),
  port: 3005 + PORT_OFFSET,
  gated: [],
  kind: "static",
};

/** The three the studio owns. */
export const APPS: readonly AppSpec[] = [LEDGERBOX, HIRELANE, TIDYCRM];

/** Everything the journey boots, ours and not. */
export const ALL: readonly AppSpec[] = [...APPS, OUTSIDE];

export function urlOf(app: AppSpec, path = "/"): string {
  return `http://localhost:${app.port}${path}`;
}

/** The origin the gate budgets and the ledger groups by (README section 3.4, tier 1). */
export function originOf(app: AppSpec): string {
  return `host:${app.id}`;
}
