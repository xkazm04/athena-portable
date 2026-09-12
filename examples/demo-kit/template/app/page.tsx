import { listRecords } from "@/lib/db";
import { RecordsTable } from "@/components/RecordsTable";

// SQLite is read per request; nothing here should be statically prerendered.
export const dynamic = "force-dynamic";

export default function ListPage() {
  const rows = listRecords();
  return (
    <>
      <h1 className="dk-page-title">Records</h1>
      <RecordsTable rows={rows} />
    </>
  );
}
