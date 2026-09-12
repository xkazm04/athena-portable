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

export interface AppSpec {
  /** The slug the catalog namespaces tools under (`host.<app_id>.<name>`). */
  readonly id: string;
  readonly dir: string;
  readonly port: number;
  /** The tools this act asserts are GATED. Every other tool the page lists must be AUTO. */
  readonly gated: readonly string[];
}

export const LEDGERBOX: AppSpec = {
  id: "ledgerbox",
  dir: resolve(EXAMPLES, "ledgerbox"),
  port: 3001 + PORT_OFFSET,
  gated: ["mark_paid", "send_reminder", "void_invoice"],
};

export const HIRELANE: AppSpec = {
  id: "hirelane",
  dir: resolve(EXAMPLES, "hirelane"),
  port: 3002 + PORT_OFFSET,
  gated: ["decide_stage", "send_scheduling_email", "send_rejection"],
};

export const TIDYCRM: AppSpec = {
  id: "tidycrm",
  dir: resolve(EXAMPLES, "tidycrm"),
  port: 3004 + PORT_OFFSET,
  gated: ["merge_contacts", "delete_contacts", "undo"],
};

export const APPS: readonly AppSpec[] = [LEDGERBOX, HIRELANE, TIDYCRM];

export function urlOf(app: AppSpec, path = "/"): string {
  return `http://localhost:${app.port}${path}`;
}

/** The origin the gate budgets and the ledger groups by (README section 3.4, tier 1). */
export function originOf(app: AppSpec): string {
  return `host:${app.id}`;
}
