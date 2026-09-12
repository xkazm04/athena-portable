"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, EmptyState } from "@athena/demo-kit/ui";
import { useWebMCPTool } from "@athena/demo-kit/webmcp";
import type { Record_ } from "@/lib/types";

/** Cap on the ids one call returns. Truncation is announced, never silent. */
const MAX_SELECTION = 50;

export function RecordsTable({ rows }: { rows: Record_[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);

  // What the user has ticked, so "these three" means something. WebMCP has no readable channel, so
  // the selection is a read-only tool the agent calls rather than ambient context in every prompt.
  useWebMCPTool({
    name: "read_selection",
    description: `Ids of the records the user has ticked in the list. At most ${MAX_SELECTION} are returned; the count says how many there are.`,
    reversible: true,
    sideEffects: "none",
    handler: () => ({
      total: selected.length,
      shown: Math.min(MAX_SELECTION, selected.length),
      ids: selected.slice(0, MAX_SELECTION),
    }),
    deps: [selected],
  });

  return (
    <DataTable
      rows={rows}
      rowId={(r) => r.id}
      selected={selected}
      onSelectionChange={setSelected}
      onRowClick={(r) => router.push(`/${r.id}`)}
      empty={<EmptyState title="No records" description="The seed did not run." />}
      caption={`${rows.length} records · ${selected.length} selected`}
      columns={[
        { key: "title", header: "Title", render: (r) => r.title, sortValue: (r) => r.title },
        { key: "owner", header: "Owner", render: (r) => r.owner, sortValue: (r) => r.owner },
        {
          key: "status",
          header: "Status",
          // The column's one ranked distinction, drawn as one: the live value carries the accent,
          // the settled one stays quiet. Not `dk-badge-auto` - that ramp means a tool's
          // consequence class, not a row's status.
          render: (r) => (
            <span className={r.status === "open" ? "dk-badge dk-badge-accent" : "dk-badge"}>
              {r.status}
            </span>
          ),
          sortValue: (r) => r.status,
        },
        {
          key: "updated_at",
          header: "Updated",
          align: "end",
          render: (r) => r.updated_at.slice(0, 10),
          sortValue: (r) => r.updated_at,
        },
      ]}
    />
  );
}
