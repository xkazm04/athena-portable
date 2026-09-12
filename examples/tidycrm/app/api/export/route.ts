import { logActivity } from "@athena/demo-kit/activity";
import { SEGMENTS, SEGMENT_LABELS, type Segment } from "@/lib/constants";
import { exportFilename, toCsv } from "@/lib/csv";
import { db, segmentRows } from "@/lib/db";

// node:sqlite lives here, so this route cannot run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `export(segment)` lands here. Reading is not a mutation, but it is still provenance. */
export function GET(request: Request): Response {
  const requested = new URL(request.url).searchParams.get("segment") ?? "all";
  if (!(SEGMENTS as readonly string[]).includes(requested)) {
    return new Response(`Unknown segment "${requested}".`, { status: 400 });
  }
  const segment = requested as Segment;
  const rows = segmentRows(segment);

  logActivity(db(), {
    actor: "user",
    action: "export",
    target: `segment:${segment}`,
    summary: `Exported ${rows.length} contacts from ${SEGMENT_LABELS[segment]} as CSV.`,
    reversible: false,
  });

  return new Response(toCsv(rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(segment)}"`,
      "cache-control": "no-store",
    },
  });
}
