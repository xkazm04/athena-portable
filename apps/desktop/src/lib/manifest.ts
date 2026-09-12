/**
 * A page's capability manifest, as the panel publishes it — README section 3.3.
 *
 * THE BUG THIS FILE EXISTS FOR. README section 3.3 says "a page's tools enter the catalog through
 * a manifest", and `POST /run` enforces it: the daemon answers
 *
 *     403 foreign_origin: '<origin>' has sent no manifest; register the origin before running a
 *     turn
 *
 * for an origin it has no session for. `DaemonApi.manifest` existed from c22 and **nothing in this
 * shell ever called it**, so every turn the panel could ever have sent was refused before the
 * stream opened. No test caught it because `src/stores/run.test.ts` drives the run loop against a
 * fake daemon, and a fake `/run` has no session to be missing — the tested path and the shipped
 * path were different servers. `apps/desktop/e2e/run.e2e.test.ts` drives the real one.
 *
 * Nothing here classifies anything. `manifestOf` is `gate.js`'s — the surface half of the same
 * derivation `HostTool.default_class` makes — so a tool's flags become a class in one place on
 * every surface, and the daemon re-derives it anyway and refuses the manifest whole if it does
 * not like it.
 */
// @ts-expect-error - gate.js is plain JavaScript with a .d.ts that does not cover this export.
import { manifestOf } from "@athena/bridge/gate";

import type { BridgeTool } from "@/lib/bridge";

/** What the tools store knows about one page, which is what a manifest is built from. */
export interface ManifestSource {
  /** The web origin the browser observed — the session key the daemon files this under. */
  origin: string;
  /** The `athena:app` slug the page published. Without one there is nothing to namespace. */
  appId: string | null;
  appVersion: string | null;
  /** `webmcp-native` or `webmcp-polyfill`, reported as `transport_detected`. */
  transport: string | null;
  tools: readonly BridgeTool[];
}

/**
 * The body of `POST /manifest`, or `null` when this page cannot be registered.
 *
 * Three ways there is nothing to publish, and all three are facts rather than failures: the page
 * published no `athena:app` id (so its tools have no namespace), it registered no tools at all
 * (the generic hands reach it instead — tier 2, which this shell does not yet publish either),
 * or the browser gave us no origin to key a session by.
 */
export function manifestBodyOf(source: ManifestSource): Record<string, unknown> | null {
  if (!source.appId || !source.origin || source.tools.length === 0) return null;
  return manifestOf(
    {
      origin: source.origin,
      app_id: source.appId,
      app_version: source.appVersion,
      transport: source.transport ?? "",
    },
    source.tools,
  ) as Record<string, unknown>;
}
