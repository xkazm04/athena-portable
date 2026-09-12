"use client";

/**
 * Is an agent actually beside this page, or is the board only claiming to be ready for one?
 *
 * The masthead used to say "Athena is not connected yet. Every capability below is registered and
 * waiting." in ink — a sentence that cannot become false, on the one surface a recorded
 * walkthrough turns on. DESIGN-LAW §8 (data honesty) asks every figure on the page to be a
 * reading; this is the line with the most riding on it and it was a caption.
 *
 * TWO SIGNALS, answering different questions:
 *
 *   · `window.__athenaBridge` is set by `packages/athena-bridge/inject.js`, in the page's own
 *     world, at document start. Present only when the surface has put its half of the bridge in,
 *     so it means A BRIDGE IS HERE, which is what the line is about.
 *   · `detectModelContext()` says whether `document.modelContext` exists at all. A page with tools
 *     and no bridge is the shipped state: registered and waiting.
 *
 * The bridge installs before the app's scripts, so one read after mount covers the common case;
 * the `toolchange` listener covers a bridge that attaches to a page already open, without a poll.
 * Nothing here runs on the server: the first paint is the honest "not connected", and the effect
 * corrects it if that is wrong.
 *
 * This is the same file, to the signal, as `examples/ledgerbox/components/lanes/presence.ts`. The
 * two apps are two tabs of one studio and the reading has to mean the same thing in both.
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
