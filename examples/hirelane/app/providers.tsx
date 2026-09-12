"use client";

/**
 * The client providers, and there is only one left.
 *
 * CopilotKit is gone from this app. What it used to carry — the app's
 * capabilities, offered to an agent — is registered on
 * `document.modelContext` through `@athena/demo-kit/webmcp` instead:
 * `components/HostCapabilities.tsx` for the shipped surface and
 * `components/board/tools/` for the Board. A browser agent speaks that standard
 * natively, so the app hosts no chat and needs no provider to hold one.
 */
import type { ReactNode } from "react";
import { ToastProvider } from "@athena/demo-kit/ui";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
