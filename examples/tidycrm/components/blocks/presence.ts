"use client";

/**
 * Is an agent actually beside this sheet, or is the app only claiming to be ready for one?
 *
 * The check print said nothing at all about Athena, which is the one thing a reader watching a
 * recorded walkthrough needs to know before anything moves. Ledgerbox answers it in its masthead
 * (`examples/ledgerbox/components/lanes/presence.ts`) and this is the same reading, in the same
 * wording, so the studio's three tabs agree about their own state.
 *
 * TWO SIGNALS, answering different questions:
 *
 *   · `window.__athenaBridge` is set by `packages/athena-bridge/inject.js`, in the page's own
 *     world, at document start. It is present only when the surface has put its half of the bridge
 *     in — so it means A BRIDGE IS HERE, which is what the line is about.
 *   · `detectModelContext()` says whether `document.modelContext` exists at all. A page with tools
 *     and no bridge is the shipped state: registered and waiting.
 *
 * THE COUNTS ARE READ, NOT DECLARED. Ledgerbox counts a static manifest; tidycrm has none, and
 * writing one by hand here would be a second list to keep true. The registrations are already on
 * `document.modelContext` carrying the design 5.1 annotations the kit writes
 * (`annotationsFor`, demo-kit webmcp/hooks.ts), so `consequentialHint` IS the gated set —
 * `merge_contacts`, `delete_contacts` and `undo` — counted from the page rather than claimed
 * about it. A tool that is registered and a tool that is counted here cannot drift apart.
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
  /** Every capability this page offers. */
  total: number;
  /** Those a host must answer for before they run — design 5.1's `consequentialHint`. */
  gated: number;
}

const NONE: Presence = { bridged: false, registered: false, total: 0, gated: 0 };

export function useAthenaPresence(): Presence {
  const [presence, setPresence] = useState<Presence>(NONE);

  useEffect(() => {
    let live = true;
    const read = async () => {
      const detection = detectModelContext();
      const tools = (await document.modelContext?.getTools?.()) ?? [];
      if (!live) return;
      setPresence({
        bridged: typeof window.__athenaBridge === "string",
        registered: detection.available,
        total: tools.length,
        gated: tools.filter((tool) => tool.annotations?.consequentialHint === true).length,
      });
    };
    void read();
    const mc = document.modelContext;
    mc?.addEventListener("toolchange", read);
    return () => {
      live = false;
      mc?.removeEventListener("toolchange", read);
    };
  }, []);

  return presence;
}

/** The one sentence, so the head does not have to assemble it. */
export function presenceLine(presence: Presence): string {
  const { bridged, total, gated } = presence;
  // One frame at mount, before any registration has landed. "All 0 capabilities" is a false
  // sentence, so it is not printed.
  if (total === 0) {
    return bridged
      ? "Athena is connected. This sheet's capabilities are still registering."
      : "Athena is not connected. This sheet's capabilities are still registering.";
  }
  if (bridged) {
    return `Athena is connected. ${total - gated} capabilities run on their own; ${gated} ask first.`;
  }
  return `Athena is not connected. All ${total} capabilities are registered and waiting — ${gated} of them gated.`;
}
