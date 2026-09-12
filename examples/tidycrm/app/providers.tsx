"use client";

/**
 * The client providers, and there is only one left.
 *
 * CopilotKit is gone from this app. Every surface that offers an agent
 * something now registers it on `document.modelContext` through
 * `@athena/demo-kit/webmcp`: the shipped views in
 * `components/shell/HostCapabilities.tsx`, the Blocks in
 * `components/blocks/tools/`.
 */
import type { ReactNode } from "react";
import { ToastProvider } from "@athena/demo-kit/ui";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
