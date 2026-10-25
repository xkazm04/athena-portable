"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, EmptyState } from "@athena/demo-kit/ui";
import { useWebMCPTool } from "@athena/demo-kit/webmcp";
import { setStatusAction } from "@/app/actions";
import { SET_STATUS_TOOL, actLabel, planStatusChange } from "@/lib/acts";
import { STATUSES, type Record_ } from "@/lib/types";
import { useStatusAct } from "./StatusAction";

/** Cap on the ids one call returns. Truncation is announced, never silent. */
const MAX_SELECTION = 50;

export function RecordsTable({ rows }: { rows: Record_[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const { pending, act, report } = useStatusAct();

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

  // The same act the bulk bar takes, offered to an agent: same server action, same activity row,
  // same undoId in the answer, and the same toast with Undo, so the person sees what was done and
  // can take it back. A refusal (nothing to change) is the answer, not a fault.
  useWebMCPTool({
    ...SET_STATUS_TOOL,
    handler: async ({ ids, status }) => {
      const result = await setStatusAction(ids as string[], String(status), "athena");
      report(result);
      return result;
    },
  });

  // One button per status the selection can actually move to, counted from the plan the server
  // will run, so the bar never offers a no-op ("Archive 3" when every one is archived already).
  const offers = selected.length === 0
    ? []
    : STATUSES.flatMap((to) => {
        const plan = planStatusChange(rows, selected, to);
        return plan.ok ? [{ to, n: plan.changes.length }] : [];
      });

  return (
    <>
      {selected.length > 0 ? (
        <div className="dk-act-bar" role="toolbar" aria-label="Act on the selected records">
          <span className="dk-act-count">{selected.length} selected</span>
          {offers.map(({ to, n }) => (
            <button
              key={to}
              type="button"
              className="dk-btn"
              disabled={pending}
              onClick={() => act(selected, to, () => setSelected([]))}
            >
              {actLabel(to, n)}
            </button>
          ))}
        </div>
      ) : null}
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
    </>
  );
}
