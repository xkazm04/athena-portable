import { notFound } from "next/navigation";
import { DetailPane } from "@athena/demo-kit/ui";
import { getRecord } from "@/lib/db";
import { StatusAction } from "@/components/StatusAction";

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
      {/* Status is something the reader can change here, not only a field: the same act as the
          list's bulk bar, with the same toast Undo. */}
      <StatusAction id={record.id} status={record.status} />
      <p>{record.note}</p>
    </DetailPane>
  );
}
