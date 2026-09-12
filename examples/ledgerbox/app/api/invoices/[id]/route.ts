import { NextResponse } from "next/server";
import { getInvoiceDetail } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One invoice, end to end, for the Desk's split view (`use()` + Suspense on the client). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getInvoiceDetail(id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
