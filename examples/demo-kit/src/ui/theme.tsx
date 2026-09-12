"use client";

/**
 * Theme variants, for a prototyping round. An app defines several design directions, styles them
 * with `[data-variant="..."]` selectors or Tailwind's `data-[variant=...]:` variants, and the
 * operator switches between them until one wins; the shared components never change, only the
 * custom properties they read do.
 *
 * The first round (2026-09-06) is consolidated: every host app now ships one design and sets
 * `data-variant` statically, so nothing here is mounted today. This stays in the kit because the
 * next round will use it again. A round is over when the switcher is gone from every app, the
 * losing trees are deleted, and the winner is the sole render.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { clsx } from "clsx";

export interface ThemeVariant {
  id: string;
  label: string;
  subtitle?: string;
}

const DEFAULT_KEY = "dk.variant";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function applyVariant(id: string): void {
  document.documentElement.dataset["variant"] = id;
}

/**
 * Current variant + setter, persisted in localStorage and applied as `data-variant` on `<html>`.
 * The first variant in `variants` is the default.
 */
export function useThemeVariant(variants: ThemeVariant[], storageKey: string = DEFAULT_KEY) {
  const first = variants[0]?.id ?? "default";
  const [variant, setVariantState] = useState(first);

  useEffect(() => {
    const stored = readStored(storageKey);
    const next = stored && variants.some((v) => v.id === stored) ? stored : first;
    setVariantState(next);
    applyVariant(next);
  }, [storageKey, first, variants]);

  const setVariant = useCallback(
    (id: string) => {
      setVariantState(id);
      applyVariant(id);
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        /* private mode: the variant still applies for this page load */
      }
    },
    [storageKey],
  );

  return { variant, setVariant };
}

/**
 * Read-only view of the active variant for any component that is not the switcher: observes
 * the `data-variant` attribute the switcher writes, so variant-conditional copy or layout can
 * live in React rather than in CSS `content`.
 */
export function useVariantValue(fallback: string = "default"): string {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setValue(root.dataset["variant"] ?? fallback);
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-variant"] });
    return () => observer.disconnect();
  }, [fallback]);
  return value;
}

export interface ThemeVariantSwitcherProps {
  variants: ThemeVariant[];
  storageKey?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A segmented control over whatever design directions an app declares.
 *
 * Real consumer set: `examples/demo-kit/template/components/Shell.tsx` only - no shipped app mounts
 * it (clonedeck's Deck draws its own picker over `useThemeVariant`). See the module docstring above
 * for why the mechanism stays in the kit between rounds.
 */
export function ThemeVariantSwitcher({
  variants,
  storageKey = DEFAULT_KEY,
  className,
  children,
}: ThemeVariantSwitcherProps) {
  const { variant, setVariant } = useThemeVariant(variants, storageKey);
  return (
    <div className={clsx("dk-variants", className)} role="group" aria-label="Design variant">
      {variants.map((v) => (
        <button
          key={v.id}
          type="button"
          className={clsx("dk-variant", variant === v.id && "dk-variant-active")}
          aria-pressed={variant === v.id}
          title={v.subtitle ?? v.label}
          onClick={() => setVariant(v.id)}
        >
          {v.label}
        </button>
      ))}
      {children}
    </div>
  );
}
