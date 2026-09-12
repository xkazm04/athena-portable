/** Money, always tabular, with a tone the design's tokens colour. Server- and client-safe. */
import { formatMoney, formatMoneyShort } from "@/lib/format";

export type MoneyTone = "late" | "owed" | "ok" | "out" | "plain";

export function Money({
  cents,
  tone = "plain",
  short = false,
  className,
}: {
  cents: number;
  tone?: MoneyTone;
  short?: boolean;
  className?: string;
}) {
  return (
    <span className={`num${className ? ` ${className}` : ""}`} data-tone={tone}>
      {short ? formatMoneyShort(cents) : formatMoney(cents)}
    </span>
  );
}

/** The tone an outstanding balance reads in, given its lateness. */
export function balanceTone(row: { balance_cents: number; days_overdue: number; state: string }): MoneyTone {
  if (row.state === "void") return "out";
  if (row.balance_cents <= 0) return "ok";
  return row.days_overdue > 0 ? "late" : "owed";
}
