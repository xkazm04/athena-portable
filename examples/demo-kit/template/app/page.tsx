import { listRecords } from "@/lib/db";
import { Levels } from "@/components/Levels";
import { RecordsTable } from "@/components/RecordsTable";

// SQLite is read per request; nothing here should be statically prerendered.
export const dynamic = "force-dynamic";

export default function ListPage() {
  const rows = listRecords();
  return (
    <>
      <h1 className="dk-page-title">Records</h1>
      {/* The three-depth read of the same rows, on the layered-UI formula. Delete it if your app
          is a flat list; keep it and give it a design if it is a place. */}
      <Levels rows={rows} />
      <RecordsTable rows={rows} />
    </>
  );
}
