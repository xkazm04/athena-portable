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
import { manifestOf } from "@athena/bridge/gate";

import type { BridgeTool } from "@/lib/bridge";
import { HAND_RUNNER, isMarkedHand, withHands } from "@/lib/hands";

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

/**
 * The host a derived id was minted from: `web_https_sledger_dtest` is `ledger.test`, and
 * `web_http_slocalhost_c3000` is `localhost:3000`. The inverse of {@link derivedIdOf}, for naming
 * an app to a person (ADR 0091); `null` for an id that is not in the derived form.
 */
export function hostOfDerivedId(app: string): string | null {
  const m = /^web_https?_s(.+)$/.exec(app);
  if (!m) return null;
  let out = "";
  const s = m[1];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== "_") {
      if (!PLAIN.test(ch)) return null;
      out += ch;
      continue;
    }
    const code = s[i + 1];
    if (code === "d") out += ".";
    else if (code === "u") out += "_";
    else if (code === "c") out += ":";
    else if (code === "x") {
      const end = s.indexOf("_", i + 2);
      const hex = end === -1 ? "" : s.slice(i + 2, end);
      // Hex digits and nothing else (`parseInt` would read "1g" as 1), naming a real code point
      // (`String.fromCodePoint` throws past U+10FFFF): anything else is not an id this file minted.
      if (!/^[0-9a-f]{1,6}$/.test(hex)) return null;
      const point = parseInt(hex, 16);
      if (point > 0x10ffff) return null;
      out += String.fromCodePoint(point);
      i = end;
      continue;
    } else return null;
    i += 1;
  }
  return out || null;
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

/**
 * The hosts a page may register from over plain `http`: this machine, by exact name (ADR 0119).
 * `LOOPBACK_PAGE_HOSTS` in `src/athena/contracts/manifest.py` is the same list, held by a parity test.
 */
export const LOOPBACK_PAGE_HOSTS = Object.freeze(["localhost"]);

/**
 * Whether the daemon would take a manifest from `origin` (`page_origin_admitted`, which
 * `HostManifest.validate` applies): `https` with a host, or `http` on this machine. Read off the
 * parsed host, never a prefix of the string, which would admit `http://localhost.evil.example`.
 * Nothing else is offered.
 */
export function registrable(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return url.hostname !== "";
  return url.protocol === "http:" && LOOPBACK_PAGE_HOSTS.includes(url.hostname);
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
  const body = manifestOf(
    {
      origin: source.origin,
      app_id: app,
      app_version: source.appVersion,
      transport: source.transport ?? "",
    },
    tools,
  ) as unknown as { tools: Record<string, unknown>[] } & Record<string, unknown>;
  // `manifestOf` rebuilds each tool from fixed keys, so the marker is carried across here, by
  // position, from the tools `withHands` marked (ADR 0066). A page's tool never carries it.
  body.tools = body.tools.map((entry, index) =>
    isMarkedHand(tools[index]) ? { ...entry, runner: HAND_RUNNER } : entry,
  );
  return body;
}
