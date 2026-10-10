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
import { withHands } from "@/lib/hands";

/** Every derived catalog id starts with this; a page that publishes it is treated as naming none. */
const RESERVED_PREFIX = "web_";

/** Characters that pass through a derived id unchanged. Everything else is escaped, so it is injective. */
const PLAIN = /[a-z0-9-]/;

function escapeHost(host: string): string {
  let out = "";
  for (const ch of host) {
    if (PLAIN.test(ch)) out += ch;
    else if (ch === ".") out += "_d";
    else if (ch === "_") out += "_u";
    else if (ch === ":") out += "_c";
    else out += `_x${ch.codePointAt(0)?.toString(16)}_`;
  }
  return out;
}

/**
 * The catalog id a web origin gets when its page names no app (ADR 0065): the scheme, the host and
 * the port, spelled as a slug that `validate()` accepts. `https://ledger.test` is
 * `web_https_sledger_dtest`; `http://localhost:3000` is `web_http_slocalhost_c3000`.
 *
 * Injective: `_` only ever begins an escape, so two origins never share an id. `null` for an
 * address that is not a web origin.
 */
export function derivedIdOf(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${RESERVED_PREFIX}${url.protocol.slice(0, -1)}_s${escapeHost(url.host)}`;
}

/** Is this slug in the form only the shell mints? A page cannot claim it. */
export function isReservedId(app: string): boolean {
  return app.startsWith(RESERVED_PREFIX);
}

/**
 * The one catalog id for a tab: the `athena:app` the page published, or the id derived from its
 * web origin. A published slug in the reserved form counts as none. `null` when the tab has
 * neither (an address that is not a web origin).
 */
export function catalogIdOf(origin: string, published: string | null): string | null {
  if (published && !isReservedId(published)) return published;
  return derivedIdOf(origin);
}

/** What the tools store knows about one page, which is what a manifest is built from. */
export interface ManifestSource {
  /** The web origin the browser observed — the session key the daemon files this under. */
  origin: string;
  /** The `athena:app` slug the page published, if any; `catalogIdOf` decides what is used. */
  appId: string | null;
  appVersion: string | null;
  /** `webmcp-native` or `webmcp-polyfill`, reported as `transport_detected`. */
  transport: string | null;
  tools: readonly BridgeTool[];
}

/** The daemon refuses any other `page_origin` (`HostManifest.validate`), so none is offered. */
function registrable(origin: string): boolean {
  return origin.startsWith("https://") || origin.startsWith("http://localhost");
}

/**
 * The body of `POST /manifest`, or `null` when this page cannot be registered.
 *
 * The page's tools followed by the generic hands (tier 2, `lib/hands.ts`), so a page that
 * registered nothing, published no `athena:app`, or could not be read still has something to act
 * with. It is catalogued under its web origin when it named no app (`catalogIdOf`). There is
 * nothing to publish only when the browser gave us no origin the daemon would take, or when there
 * are no tools and no hands (outside the shell the hands list is empty).
 */
export function manifestBodyOf(source: ManifestSource): Record<string, unknown> | null {
  const app = catalogIdOf(source.origin, source.appId);
  const tools = withHands(source.tools);
  if (!app || !registrable(source.origin) || tools.length === 0) return null;
  return manifestOf(
    {
      origin: source.origin,
      app_id: app,
      app_version: source.appVersion,
      transport: source.transport ?? "",
    },
    tools,
  ) as Record<string, unknown>;
}
