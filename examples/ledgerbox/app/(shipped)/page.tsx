import { EdgeHome } from "@/components/edge/Home";
import { PERIODS, type Period } from "@/lib/constants";
import { lineSuggestions, listInvoices, summarize, unappliedLines } from "@/lib/db";
import { countByFilter } from "@/lib/filter";
import type { PeriodSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  const rows = listInvoices();
  const summaries = Object.fromEntries(PERIODS.map((p) => [p, summarize(p)])) as Record<Period, PeriodSummary>;
  const credits = unappliedLines().filter((l) => l.direction === "in");

  return (
    <EdgeHome
      rows={rows}
      counts={countByFilter(rows)}
      summaries={summaries}
      credits={credits}
      suggestions={lineSuggestions()}
    />
  );
}
