import { notFound } from "next/navigation";
import { DetailPane } from "@athena/demo-kit/ui";
import { getRecord } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getRecord(id);
  if (!record) notFound();

  return (
    <DetailPane
      title={record.title}
      subtitle={`${record.id} · ${record.owner}`}
      fields={[
        { label: "Status", value: record.status },
        { label: "Owner", value: record.owner },
        { label: "Updated", value: record.updated_at.slice(0, 10) },
      ]}
    >
      <p>{record.note}</p>
    </DetailPane>
  );
}
