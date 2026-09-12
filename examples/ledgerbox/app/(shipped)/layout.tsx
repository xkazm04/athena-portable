import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "@/components/edge/edge.css";
import { EdgeShell } from "@/components/edge/Shell";
import { StripTools } from "@/components/edge/StripTools";
import { countByFilter } from "@/lib/filter";
import { lineSuggestions, listClients, listInvoices, summarize, unappliedCredits } from "@/lib/db";
import { PERIODS, type Period } from "@/lib/constants";
import type { PeriodSummary } from "@/lib/types";

// One family, used across its optical-size axis: display cuts for the month and the running total,
// text cuts for the cards. Figures are tabular everywhere.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-edge",
  display: "swap",
});

export const dynamic = "force-dynamic";

// App identity for a WebMCP consumer: origin comes from the page, app_id and version from here.
export const metadata: Metadata = {
  other: { "athena:app": "ledgerbox", "athena:app-version": "0.1.0" },
};

/** The shipped design (The Strip). URLs are unchanged; the route group is invisible. */
export default function ShippedLayout({ children }: { children: React.ReactNode }) {
  const rows = listInvoices();
  const counts = countByFilter(rows);
  const summaries = Object.fromEntries(PERIODS.map((p) => [p, summarize(p)])) as Record<Period, PeriodSummary>;
  // The ticker's overdue pair comes from `summarize`, which is where every other
  // overdue figure in the app comes from. Computing it here from the unfiltered
  // rows was a second, period-blind implementation of the same rule: it agrees
  // with the reports today only because every seeded invoice falls inside the
  // quarter. The ticker now names the span it covers.
  const q = summaries.quarter;
  // The tools read the credit VIEW - the line plus the judgements `lib/db.ts` makes about it -
  // so the ambiguity rule is applied in one place rather than re-derived inside the tool.
  const credits = unappliedCredits();

  return (
    // `edge` names the shipped design; its tokens are scoped to it in edge.css.
    <div data-variant="edge" className={bricolage.variable}>
      {/* The Strip's capabilities, registered on document.modelContext. No chat on this design. */}
      <StripTools rows={rows} credits={credits} suggestions={lineSuggestions()} summaries={summaries} clients={listClients()} />
      <EdgeShell
        counts={{
          ...counts,
          period: q.period,
          overdue: q.overdue_count,
          overdueCents: q.overdue_cents,
        }}
      >
        {children}
      </EdgeShell>
    </div>
  );
}
