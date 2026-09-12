"use client";

/**
 * `AppShell` - the scaffold's layout: a header with the app name, nav, the variant switcher slot,
 * and a main column. Everything visual is a `--dk-*` custom property, so an app can look nothing
 * like its neighbour while using the same markup.
 *
 * Real consumer set: `examples/demo-kit/template/` only. Each of the four shipped apps outgrew
 * this and builds its own chrome (ledgerbox lanes/edge, tidycrm blocks, hirelane board, clonedeck
 * deck); what they share from this package is ToastProvider/useToast. Changing this file changes
 * the scaffold a new app is copied from, not any shipped surface.
 */
import type { ReactNode } from "react";
import { clsx } from "clsx";

export interface NavItem {
  href: string;
  label: string;
  /** Set by the app from its own router; the shell does not guess. */
  active?: boolean;
  badge?: string | number;
}

export interface AppShellProps {
  appName: string;
  /** Right-hand slot; usually `<ThemeVariantSwitcher />`. */
  themeSwitcher?: ReactNode;
  nav?: NavItem[];
  /** Rendered under the header, above `children` (filters, a search box). */
  toolbar?: ReactNode;
  tagline?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppShell({
  appName,
  themeSwitcher,
  nav = [],
  toolbar,
  tagline,
  children,
  className,
}: AppShellProps) {
  return (
    <div className={clsx("dk-shell", className)}>
      <header className="dk-header">
        <div className="dk-brand">
          <span className="dk-brand-name">{appName}</span>
          {tagline ? <span className="dk-brand-tagline">{tagline}</span> : null}
        </div>
        <nav className="dk-nav" aria-label="Main">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={clsx("dk-nav-link", item.active && "dk-nav-link-active")}
              aria-current={item.active ? "page" : undefined}
            >
              {item.label}
              {item.badge !== undefined ? <span className="dk-nav-badge">{item.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="dk-header-end">{themeSwitcher}</div>
      </header>
      {toolbar ? <div className="dk-toolbar">{toolbar}</div> : null}
      <main className="dk-main">{children}</main>
    </div>
  );
}
