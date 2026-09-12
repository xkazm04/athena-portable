"use client";

/**
 * The three slices of UI state the host manifest exposes as readables: which filter the inbox is
 * showing, which invoices are ticked, and which accounting period the reports are on.
 *
 * They live in one context above the router so a `navigate` call from an agent and a click on a
 * filter tab end up in exactly the same place. Filtering 120 invoices in the browser is instant,
 * so there is no reason to round-trip the server for it.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Filter, Period } from "@/lib/constants";

interface AppStateValue {
  filter: Filter;
  setFilter: (f: Filter) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  selection: string[];
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [period, setPeriod] = useState<Period>("2026-08");
  const [selection, setSelection] = useState<string[]>([]);

  const value = useMemo<AppStateValue>(
    () => ({
      filter,
      setFilter,
      period,
      setPeriod,
      selection,
      setSelection,
      clearSelection: () => setSelection([]),
    }),
    [filter, period, selection],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
}
