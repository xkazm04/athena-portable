"use client";

/**
 * The client providers, and there are only two left.
 *
 * CopilotKit is gone from this app. Every surface that offers an agent anything
 * now registers it on `document.modelContext` through
 * `@athena/demo-kit/webmcp` — for the Strip, that is
 * `components/edge/StripTools.tsx`. That is a standard a browser agent speaks
 * natively, so the app no longer ships a chat, a runtime endpoint or a provider
 * to host one; the agent lives beside the page rather than inside it.
 */
import type { ReactNode } from "react";
import { ToastProvider } from "@athena/demo-kit/ui";
import { AppStateProvider } from "@/components/state/AppState";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AppStateProvider>{children}</AppStateProvider>
    </ToastProvider>
  );
}
