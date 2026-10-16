/** Client-safe app identity. `lib/db.ts` is server-only, so the ids live here too. */
export const APP_ID = "demo-app";
export const APP_VERSION = "0.1.0";

/**
 * The name of this app's design. One name, one `[data-variant]` block in `app/globals.css`, set
 * statically on `<html>` in `app/layout.tsx`. The kit's `ThemeVariantSwitcher` still exists for a
 * prototyping round with several live directions; reach for it when you have one, not by default.
 */
export const VARIANT = "plain";

/**
 * Views `navigate` can open. Enums are mandatory for anything addressing UI (design 5.1) - and
 * every member of one has to be reachable: `detail` is `app/[id]/page.tsx`, so `navigate` takes an
 * `id` alongside it and refuses the call when it is missing rather than landing on the list and
 * reporting success. Add a view here only once the handler can actually open it.
 */
export const VIEWS = ["list", "detail", "activity"] as const;
export type View = (typeof VIEWS)[number];

/**
 * The view a pathname shows: what `read_current_view` answers. The routes are `/`, `/activity`
 * and `app/[id]`, so `/activity-log` is a record page; a prefix test would call it the log.
 */
export function viewFor(pathname: string): View {
  if (pathname === "/") return "list";
  if (pathname === "/activity" || pathname === "/activity/") return "activity";
  return "detail";
}

/** What `navigate` answers: a push target, or a refusal that explains itself. */
export type NavDecision =
  | { ok: true; view: View; href: string; id?: string }
  | { ok: false; error: string; available?: string[]; hint?: string };

/**
 * The enum/handler agreement, as a pure function so it can be tested without a router: given what
 * the agent asked for, either a route to push or a refusal. `components/HostCapabilities.tsx` does
 * the pushing and nothing else, so there is no path on which the return value and the navigation
 * can disagree - which is the whole point. Every href it answers with is read back through
 * `viewFor()` above, the function `read_current_view` uses, so it maps back to the view it claims.
 */
export function routeFor(view: unknown, id?: unknown): NavDecision {
  const asked = String(view);
  if (!(VIEWS as readonly string[]).includes(asked)) {
    return { ok: false, error: `No view named ${asked}.`, available: [...VIEWS] };
  }
  const target = asked as View;

  if (target === "detail") {
    const recordId = typeof id === "string" ? id.trim() : "";
    if (!recordId) {
      return {
        ok: false,
        error: 'The "detail" view needs a record id. Pass `id`.',
        hint: "read_selection returns the ids the user has ticked in the list.",
      };
    }
    const href = `/${encodeURIComponent(recordId)}`;
    // Escaping is not enough: the browser collapses `/.` and `/..` to the list, and a static
    // route (`/activity`) wins over `app/[id]`. Read the href back the way the router will, and
    // refuse an id whose page is some other view rather than answer "detail" from the wrong one.
    const lands = viewFor(new URL(href, "http://app.invalid").pathname);
    if (lands !== "detail") {
      return {
        ok: false,
        error: `"${recordId}" cannot be a record id here: its page is the ${lands} view.`,
      };
    }
    return { ok: true, view: target, href, id: recordId };
  }

  return { ok: true, view: target, href: target === "activity" ? "/activity" : "/" };
}
