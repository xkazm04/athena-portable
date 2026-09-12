import { notFound } from "next/navigation";
import { EdgeDetail } from "@/components/edge/Detail";
import { getInvoiceDetail } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getInvoiceDetail(id);
  if (!detail) notFound();
  return <EdgeDetail detail={detail} />;
}
