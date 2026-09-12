"use client";

/**
 * Is an agent actually beside this page, or is the app only claiming to be ready for one?
 *
 * The masthead used to say "Athena is not connected yet" in ink, which is a sentence that cannot
 * become false. It is the one line on the surface that a recorded walkthrough turns on, so it has
 * to be a reading rather than a caption.
 *
 * TWO SIGNALS, and they answer different questions:
 *
 *   · `window.__athenaBridge` is set by `packages/athena-bridge/inject.js`, in the page's own
 *     world, at document start. It is present only when the surface has put its half of the
 *     bridge in — so it means A BRIDGE IS HERE, which is the thing the line is about.
 *   · `detectModelContext()` says whether `document.modelContext` exists at all and whether it is
 *     the kit's polyfill. A page with tools and no bridge is the shipped state: registered and
 *     waiting.
 *
 * The bridge installs before the app's scripts, so one read after mount is enough for the common
 * case; the `toolchange` listener covers the other direction (a bridge that attaches to a page
 * already open) without a poll. Nothing here is rendered on the server: the first paint is the
 * honest "not connected", and the effect corrects it if it is wrong.
 */
import { useEffect, useState } from "react";
import { detectModelContext } from "@athena/demo-kit/webmcp";

declare global {
  interface Window {
    /** `athena-webmcp/1`, set by the surface's injected half. Absent means no bridge. */
    __athenaBridge?: string;
  }
}

export interface Presence {
  /** The surface's bridge is in this page. */
  bridged: boolean;
  /** `document.modelContext` exists, so the registrations landed somewhere. */
  registered: boolean;
  /** It is the kit's polyfill rather than a browser's own implementation. */
  polyfilled: boolean;
}

const NONE: Presence = { bridged: false, registered: false, polyfilled: false };

export function useAthenaPresence(): Presence {
  const [presence, setPresence] = useState<Presence>(NONE);

  useEffect(() => {
    const read = () => {
      const detection = detectModelContext();
      setPresence({
        bridged: typeof window.__athenaBridge === "string",
        registered: detection.available,
        polyfilled: detection.polyfilled,
      });
    };
    read();
    const mc = document.modelContext;
    mc?.addEventListener("toolchange", read);
    return () => mc?.removeEventListener("toolchange", read);
  }, []);

  return presence;
}
