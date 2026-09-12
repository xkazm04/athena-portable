"use client";

/**
 * The client providers, and there is only one.
 *
 * There is no CopilotKit here. What it used to carry - the app's capabilities, offered to an agent
 * - is registered on `document.modelContext` through `@athena/demo-kit/webmcp` instead, in
 * `components/HostCapabilities.tsx`. A browser agent speaks that standard natively, so the app
 * hosts no chat and needs no provider to hold one. This matches hirelane, ledgerbox and tidycrm.
 *
 * Adding an in-page chat is the appendix at the end of README.md.
 */
import type { ReactNode } from "react";
import { ToastProvider } from "@athena/demo-kit/ui";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
