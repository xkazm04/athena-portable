/**
 * Keeping the depth with the tabs, and Rust with the depth — README section 3.5, ADR 0088 and 0215.
 *
 * The depth decides the window's shape and tells Rust (`depth/shape`). Rust decides nothing about
 * the shape: `layout_select` is its only way in, and every `layout:changed` it announces is the
 * echo of a select the depth sent. So that announcement never moves the depth; it is handed to the
 * shape channel, which consumes an owed echo and answers any other disagreement by re-sending the
 * depth's shape (ADR 0215). What does move under the depth is the focused tab under a page (a link
 * opens a window, a tab is closed); that decision is pure so it is tested without a window, and
 * `useFollowShell` is the thin hook that feeds it events.
 *
 * Deliberately not followed: a tab appearing while the person is in a scene. A background act may
 * open a page, and yanking someone out of the depth they are reading would be worse than the page
 * waiting under the Apps depth, where it is listed.
 */
import { useEffect, useRef } from "react";

import { shapeOf, type Path } from "@/depth/model";
import { heardLayout } from "@/depth/shape";
import { useDepth } from "@/depth/store";
import { hasShell, onLayoutChanged } from "@/lib/ipc";
import { itemOfTab, pagePath } from "@/scenes/apps/model";
import { useTabs } from "@/stores/tabs";

export interface Focused {
  id: number;
  url: string;
}

/**
 * The focused tab changed while a page is showing: name the page now on screen, or, if the last tab
 * closed and there is no page to show, leave the page shape (an empty band is not a place).
 */
export function followFocus(path: Path, previous: number | null, focused: Focused | null): Path | null {
  if (shapeOf(path) !== "page") return null;
  if (focused === null) return { root: "apps" };
  if (focused.id === previous) return null;
  const item = itemOfTab(focused);
  return item === path.item ? null : pagePath(item);
}

export function useFollowShell(): void {
  const focusedTab = useTabs((s) => s.tabs.find((t) => t.focused) ?? null);
  const loaded = useTabs((s) => s.loaded);
  const focused: Focused | null = focusedTab ? { id: focusedTab.id, url: focusedTab.url } : null;
  const previous = useRef<number | null>(null);

  useEffect(() => {
    // No shell (the preview harness's `?scene=console`, a plain browser): Rust announces nothing, and
    // `listen` would only reject. Every other listener in the app asks the same question first.
    if (!hasShell()) return;
    let alive = true;
    let stop: (() => void) | undefined;
    onLayoutChanged(heardLayout)
      .then((un) => {
        // A listener that lands after the console unmounted (StrictMode's dev remount) is taken
        // down at once, or it would keep reconciling for a console that is gone.
        if (alive) stop = un;
        else un();
      })
      .catch((error: unknown) => console.error(`[console] follow the layout: ${String(error)}`));
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  useEffect(() => {
    // Before the shell has answered, "no focused tab" means "not asked yet", not "none is open".
    if (!loaded) return;
    const { path, go } = useDepth.getState();
    const to = followFocus(path, previous.current, focused);
    previous.current = focused?.id ?? null;
    if (to) go(to);
  });
}
