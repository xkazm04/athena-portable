"use client";

/** The Strip's frame: a thin rail over a dark, lit ground; the numbers scroll as a ticker line. */
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import { STUDIO } from "@athena/demo-kit/seed";
import { Money } from "./Money";
import { PERIOD_LABEL } from "@/lib/constants";
import type { ShellCounts } from "./types";

const NAV = [
  { href: "/", label: "Strip" },
];

export function EdgeShell({ counts, children }: { counts: ShellCounts; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <MotionConfig reducedMotion="user">
      <div className="ed-shell">
        <header className="ed-rail">
          {/* Ledgerbox is the product; the books belong to one studio, and its name is the
              same one TidyCRM and Hirelane show, so the three read as one owner's tabs. */}
          <Link href="/" className="ed-mark">
            Ledgerbox<span className="ed-mark-studio"> · {STUDIO.name}</span>
          </Link>
          <nav className="ed-nav" aria-label="Main">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" || pathname.startsWith("/invoices") : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <div className="ed-ticker">
          <span><b className="num">{counts.overdue}</b> overdue worth <Money cents={counts.overdueCents} tone="late" short /> in {PERIOD_LABEL[counts.period]}</span>
          <span><b className="num">{counts.unmatched}</b> with a credit waiting</span>
          <span><b className="num">{counts.disputed}</b> disputed</span>
          <span>Books frozen 1 September 2026</span>
        </div>
        <main className="ed-main">{children}</main>
      </div>
    </MotionConfig>
  );
}
