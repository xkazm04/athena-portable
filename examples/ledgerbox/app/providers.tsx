"use client";

/**
 * The client provider, and there is one left.
 *
 * The app-wide `AppStateProvider` is gone with the Strip. Filter, period and selection are the
 * Lanes' own state now, held in `components/lanes/Lanes.tsx` beside the zoom focus, because every
 * one of them is a fact about the one page rather than about the app.
 *
 * There is no chat provider either. Everything this app offers an agent is registered on
 * `document.modelContext` through `@athena/demo-kit/webmcp`, in `components/lanes/tools/` — a
 * standard a browser agent speaks natively — so the app ships no chat, no runtime endpoint and no
 * provider to host one. The agent lives beside the page rather than inside it.
 */
import type { ReactNode } from "react";
import { ToastProvider } from "@athena/demo-kit/ui";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
