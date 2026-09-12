import { NextResponse } from "next/server";
import { listInvoices } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The slim list the Desk's command palette jumps through. */
export function GET() {
  const rows = listInvoices().map((r) => ({
    id: r.id,
    number: r.number,
    client_name: r.client_name,
    balance_cents: r.balance_cents,
    days_overdue: r.days_overdue,
    state: r.state,
  }));
  return NextResponse.json(rows);
}
