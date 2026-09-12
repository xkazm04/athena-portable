import "server-only";

/**
 * What the cleanup did, as a page someone can paste (design 4.6.4, act 3's close).
 *
 * `export` used to answer with a filename. That is the right artifact for a mail tool and the
 * wrong one for a person: the campaign is signed off in a document, and the question asked there
 * is "what changed", not "where is the CSV". So the same tool now also returns a title and a block
 * of Markdown, which is exactly what an agent needs to append the result to a Notion page without
 * inventing figures of its own.
 *
 * Every figure is counted from the database, not accumulated in a variable: an undone
 * normalisation stops counting the moment its revisions are marked reverted, and a merge that was
 * refused never appears. The per-company table is here for the same reason — the campaign audience
 * is a list of companies, and the decision about which of them to leave out belongs to whoever
 * reads the page, so the page states the membership and draws no conclusion from it.
 */
import { MAX_COMPANIES, SEGMENT_LABELS, type Segment } from "./constants";
import { countSegment, companyTotals, db } from "./db";
import { COMPANY_RULE } from "./mutations";

export interface ExportSummary {
  segment: Segment;
  label: string;
  /** Rows in the CSV the same call downloads. */
  contacts: number;
  /** Contacts carrying at least one normalisation that has not been undone. */
  normalized: number;
  /** Field rewrites behind that figure. */
  normalized_fields: number;
  /** Contacts folded into another record; the pair count that produced them is `merged_pairs`. */
  merged: number;
  merged_pairs: number;
  /** Pairs closed without a merge: kept both, or skipped. */
  resolved_pairs: number;
  /** Domains settled on one spelling by `resolve_company`, and the contacts they rewrote. */
  resolved_companies: number;
  resolved_contacts: number;
  /** Company membership of the exported rows, bounded and announced. */
  companies: {
    showing: number;
    total: number;
    footer: string;
    items: { company: string; domain: string; contacts: number }[];
  };
  /** Ready to be the heading of an appended page. */
  title: string;
  /** The same figures as a Markdown block. */
  markdown: string;
}

function one<T extends Record<string, number>>(sql: string, params: string[] = []): T | undefined {
  return db().get<T>(sql, params);
}

export function exportSummary(segment: Segment): ExportSummary {
  const contacts = countSegment(segment);

  const normalized = one<{ contacts: number; fields: number }>(
    `SELECT COUNT(DISTINCT contact_id) AS contacts, COUNT(*) AS fields FROM revisions
     WHERE reverted = 0 AND rules <> ?`,
    [COMPANY_RULE],
  );
  const company = one<{ domains: number; contacts: number }>(
    `SELECT COUNT(DISTINCT c.domain) AS domains, COUNT(DISTINCT r.contact_id) AS contacts
       FROM revisions r JOIN contacts c ON c.id = r.contact_id
      WHERE r.reverted = 0 AND r.rules = ?`,
    [COMPANY_RULE],
  );
  const merged = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM contacts WHERE merged_into IS NOT NULL AND deleted_at IS NULL",
  );
  const pairs = one<{ merged: number; resolved: number }>(
    `SELECT SUM(status = 'merged') AS merged,
            SUM(status IN ('kept_both','skipped')) AS resolved FROM merge_pairs`,
  );

  const all = companyTotals(segment);
  const items = all.slice(0, MAX_COMPANIES);
  const footer = `(showing ${items.length} of ${all.length})`;

  const label = SEGMENT_LABELS[segment];
  const title = `TidyCRM cleanup — ${label}`;
  const counts = {
    contacts,
    normalized: normalized?.contacts ?? 0,
    normalized_fields: normalized?.fields ?? 0,
    merged: merged?.n ?? 0,
    merged_pairs: pairs?.merged ?? 0,
    resolved_pairs: pairs?.resolved ?? 0,
    resolved_companies: company?.domains ?? 0,
    resolved_contacts: company?.contacts ?? 0,
  };

  return {
    segment,
    label,
    ...counts,
    companies: { showing: items.length, total: all.length, footer, items },
    title,
    markdown: markdownFor(title, label, counts, items, all.length, footer),
  };
}

/**
 * The Markdown body. Plain CommonMark - a heading, a list and one table - because the destination
 * is somebody else's editor and anything cleverer arrives as literal punctuation.
 */
function markdownFor(
  title: string,
  label: string,
  c: {
    contacts: number;
    normalized: number;
    normalized_fields: number;
    merged: number;
    merged_pairs: number;
    resolved_pairs: number;
    resolved_companies: number;
    resolved_contacts: number;
  },
  items: { company: string; domain: string; contacts: number }[],
  total: number,
  footer: string,
): string {
  const lines = [
    `## ${title}`,
    "",
    `${c.contacts} contacts in **${label}**, after this cleanup:`,
    "",
    `- Normalised ${c.normalized_fields} field${c.normalized_fields === 1 ? "" : "s"} on ${c.normalized} contact${c.normalized === 1 ? "" : "s"}`,
    `- Merged ${c.merged_pairs} duplicate pair${c.merged_pairs === 1 ? "" : "s"}, folding away ${c.merged} record${c.merged === 1 ? "" : "s"}`,
    `- Closed ${c.resolved_pairs} pair${c.resolved_pairs === 1 ? "" : "s"} without merging`,
    `- Settled ${c.resolved_companies} company name${c.resolved_companies === 1 ? "" : "s"} across ${c.resolved_contacts} contact${c.resolved_contacts === 1 ? "" : "s"}`,
    "",
    "| Company | Domain | Contacts |",
    "| --- | --- | --- |",
    ...items.map((i) => `| ${i.company} | ${i.domain} | ${i.contacts} |`),
    "",
    `${total} compan${total === 1 ? "y" : "ies"} in this segment ${footer}.`,
  ];
  return lines.join("\n");
}
