/**
 * The Chores root: the catalogue — README section 3.5, ADR 0096.
 *
 * Full width, no side rail: the areas are a row of cards, each a large glyph over its name with its
 * count riding the top edge, the jobs are chips under it, the order a three-way switch, and the
 * ledger one line per playbook: name, job, time saved, value. A press opens the topic page.
 *
 * "Your chores": handed the daemon's deps, the catalogue asks for every saved case and each
 * case's open review (kept warm across a move, `reads.ts`), and draws them above the areas, what is due first (`yours.ts`), each one
 * press from its case or its chore's page; `Yours` narrows the ledger to the chores with a case.
 * Without deps (the preview, no daemon) there is no band and the page is as it always was.
 */
import { useEffect, useRef } from "react";

import Button from "@/components/Button";
import Table, { type Column } from "@/components/Table";
import type { Path } from "@/depth/model";
import type { DueReview } from "@/lib/adopt";
import { CATEGORIES, JOBS, categoryLabel, jobLabel, type CategoryId } from "@/lib/playbook-taxonomy";
import {
  categoryCounts,
  filterLedger,
  sortLedger,
  type CategoryFilter,
  type JobFilter,
  type LedgerSort,
  type PlaybookView,
  type PlaybooksModel,
} from "@/modules/playbooks/model";

import type { AdoptDeps } from "./adopt/deps";
import { EDGE_ORDER, casePath, emptyLine } from "./model";
import { totalsLine, valueCell } from "./worth";
import { lead } from "./rich";
import { JOB_TONE, timeCell } from "./facts";
import Glyph from "./glyphs";
import { hasCase, yoursLine, yoursOf, type YoursState } from "./yours";
import { readKey, useRead } from "./reads";
import { failureOf, staleLine, type Failure } from "./runs";

export interface CatalogueState {
  category: CategoryFilter;
  job: JobFilter;
  sort: LedgerSort;
  /** The row last opened, picked again on the way back. */
  last: string | null;
  /** The ledger narrowed to the chores the person has a saved case for. */
  yours: boolean;
}

/**
 * Every saved case (`cases('')`, ADR 0123) and each one's review (ADR 0131). A review that cannot be
 * read is no review: the case is still listed, by its approval. The answer outlives a move
 * (`reads.ts`, ADR 0159): rising from a topic draws the band as it was and asks again behind it.
 */
export function useYours(deps: AdoptDeps | undefined): (YoursState & { stale?: Failure }) | null {
  const client = deps?.client;
  const chores = deps?.chores;
  const state = useRead<Extract<YoursState, { kind: "found" }>>(client ? readKey(client, "all-cases", chores) : null, async () => {
    const reply = await client!.cases("");
    const reviews = new Map<string, DueReview | null>();
    if (chores) {
      const read = await Promise.allSettled(reply.cases.map((c) => chores.review(c.case_id)));
      read.forEach((r, i) => reviews.set(reply.cases[i]!.case_id, r.status === "fulfilled" ? r.value : null));
    }
    return { kind: "found", cases: reply.cases, footer: reply.footer, reviews };
  });
  if (!deps) return null;
  if (state.kind === "looking") return state;
  if (state.kind === "failed") return { kind: "failed", ...failureOf(state.error) };
  return state.refreshFailed === undefined ? state.value : { ...state.value, stale: failureOf(state.refreshFailed) };
}

const SORTS: { id: string; label: string; sort: LedgerSort; why: string }[] = [
  {
    id: "edge",
    label: "Best fit",
    sort: EDGE_ORDER,
    why: "Hardest for anyone else to do and most useful to you, first: the author's two scores multiplied.",
  },
  {
    id: "value",
    label: "Most value",
    sort: { key: "value", dir: "desc" },
    why: "The author's estimate of money back a year, highest first; estimates of money protected, penalties avoided or a value per episode come after, by their own figure.",
  },
  {
    id: "time",
    label: "Most time saved",
    sort: { key: "time", dir: "desc" },
    why: "The hours the chore takes by hand, the author's estimate, longest first.",
  },
];

const sameSort = (a: LedgerSort, b: LedgerSort) => a.key === b.key && a.dir === b.dir;

export default function Catalogue({
  model,
  state,
  set,
  open,
  create,
  deps,
  go,
}: {
  model: PlaybooksModel;
  state: CatalogueState;
  set: (s: Partial<CatalogueState>) => void;
  open: (view: PlaybookView) => void;
  /** The front door: "New chore". */
  create: () => void;
  /** The daemon's clients; absent, there is no "Your chores" band and no `Yours`. */
  deps?: AdoptDeps;
  /** Where "Open your case" goes. */
  go?: (to: Path) => void;
}) {
  const saved = useYours(deps);
  const found = saved?.kind === "found" ? saved : null;
  const yours = found ? yoursOf(model, found.cases, found.reviews) : null;
  const mine = found ? hasCase(model, found.cases) : null;
  // `Yours` narrows only once the cases are known; until then the remembered toggle waits.
  const narrowed = state.yours && mine !== null && mine.size > 0;
  const counts = categoryCounts(model.items, state.job);
  const filtered = filterLedger(model.items, { category: state.category, job: state.job });
  const rows = sortLedger(narrowed ? filtered.filter((v) => mine.has(v.id)) : filtered, state.sort);
  // How the latest pick was made: a press opens the topic, a walk (arrow, Home, End) only picks.
  const how = useRef<"press" | "walk">("press");
  const box = useRef<HTMLDivElement>(null);

  // Back from a topic: the row it was opened from is in view and holds the focus.
  useEffect(() => {
    if (state.last === null) return;
    const row = box.current?.querySelector<HTMLElement>('tr[aria-selected="true"]');
    row?.scrollIntoView?.({ block: "center" });
    row?.focus({ preventScroll: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: CategoryFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: counts.byCategory[c.id] })),
  ];
  // The tab says the area's first word ("Health"); its full name is its accessible name and title.
  const short = (label: string) => label.split(/\s+(?:&|and)\s+|,\s*/)[0]!;

  const columns: Column<PlaybookView>[] = [
    {
      key: "name",
      head: "Playbook",
      render: (v) => (
        <span className="pa-name" title={lead(v.playbook.brief) || v.playbook.promise}>
          {v.playbook.shortTitle}
        </span>
      ),
    },
    {
      key: "job",
      head: "Job",
      render: (v) =>
        v.playbook.job ? (
          <span className="pa-job" style={{ "--pa-tone": JOB_TONE[v.playbook.job] } as React.CSSProperties}>
            {jobLabel(v.playbook.job)}
          </span>
        ) : (
          <span className="pa-muted">–</span>
        ),
    },
    {
      key: "time",
      head: "Time saved",
      align: "right",
      render: (v) => {
        const t = timeCell(v);
        return (
          <span className="pa-time">
            <span className="pa-time__hand">{t.hand}</span>
            <span className="pa-time__arrow" aria-label=" by hand, with Athena ">
              →
            </span>
            <span className="pa-time__athena" title={t.athena ? "Her test run plus your review" : undefined}>
              {t.athena ?? "not run"}
            </span>
          </span>
        );
      },
    },
    {
      key: "value",
      head: "Value",
      align: "right",
      render: (v) => {
        const c = valueCell(v);
        return (
          <span className="pa-value" title="The author's estimate, not measured">
            <span className="pa-value__n">{c.figure}</span>
            <span className="pa-value__per">{`${c.per} ${c.kind}, est.`}</span>
          </span>
        );
      },
    },
  ];

  const where = state.category === "all" ? "all areas" : categoryLabel(state.category as CategoryId);
  const plural = rows.length === 1 ? "playbook" : "playbooks";
  const shown = narrowed
    ? `${rows.length} ${plural} you have a case for${state.category === "all" ? "" : ` in ${where}`}`
    : `${rows.length} ${plural} in ${where}`;
  const said = saved ? yoursLine(saved) : "";

  return (
    <div className="pa-page">
      <div className="pa-wrap">
        <header className="pa-head">
          <h1 className="pa-h1">Chores</h1>
          <p className="pa-totals">{totalsLine(model)}</p>
          <div className="pa-head__new">
            <Button variant="primary" size="sm" onClick={create}>
              New chore
            </Button>
          </div>
        </header>

        {saved ? (
          <section className="pa-yours" aria-labelledby="pa-yours-h">
            <h2 id="pa-yours-h" className="pa-kpi__label">
              Your chores
            </h2>
            {yours && yours.rows.length ? (
              <ul className="pa-cases">
                {yours.rows.map((r) => (
                  <li key={r.caseId} className={`pa-case pa-yours__row${r.due ? " pa-yours__row--due" : ""}`}>
                    <button
                      type="button"
                      className="pa-link pa-yours__chore focus-ring"
                      title={`Open the page of ${r.chore}`}
                      onClick={() => open(r.view)}
                    >
                      {r.chore}
                    </button>
                    <span className="pa-case__title">{r.title}</span>
                    {r.due ? <span className="pa-yours__due">{r.due}</span> : null}
                    <span className="pa-case__when">{`${r.approved} · ${r.confirmed}`}</span>
                    {go ? (
                      <Button
                        variant={r.due ? "primary" : "ghost"}
                        size="sm"
                        onClick={() => go(casePath(r.playbookId, r.caseId))}
                      >
                        Open your case
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {said ? (
              <p className="pa-muted" role="status">
                {said}
              </p>
            ) : null}
            {saved.kind === "found" && saved.stale ? (
              <p className="pa-muted" role="status">
                {staleLine("Your chores", saved)}
              </p>
            ) : null}
            {yours?.elsewhereLine ? <p className="pa-muted">{yours.elsewhereLine}</p> : null}
            {found?.footer ? <p className="pa-muted">{found.footer}</p> : null}
          </section>
        ) : null}

        <nav className="pa-tabs" aria-label="Areas">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className="pa-tab focus-ring"
              aria-current={state.category === t.id ? "page" : undefined}
              disabled={t.count === 0 && state.category !== t.id}
              onClick={() => set({ category: t.id })}
              title={t.label}
              aria-label={`${t.label}, ${t.count}`}
            >
              <span className="pa-tab__count">{t.count}</span>
              <Glyph id={t.id} size={40} />
              <span className="pa-tab__label">{short(t.label)}</span>
            </button>
          ))}
        </nav>

        <div className="pa-bar">
          <div className="pa-jobs" role="group" aria-label="Job">
            {[{ id: "all" as const, label: "All jobs" }, ...JOBS].map((j) => (
              <button
                key={j.id}
                type="button"
                className="pa-jobchip focus-ring"
                aria-pressed={state.job === j.id}
                style={j.id === "all" ? undefined : ({ "--pa-tone": JOB_TONE[j.id] } as React.CSSProperties)}
                onClick={() => set({ job: j.id })}
              >
                {j.id === "all" ? null : <span className="pa-dot" aria-hidden="true" />}
                {j.label}
              </button>
            ))}
          </div>
          {mine && mine.size > 0 ? (
            <button
              type="button"
              className="pa-jobchip pa-yours-toggle focus-ring"
              aria-pressed={state.yours}
              title="Only the chores you have a saved case for"
              onClick={() => set({ yours: !state.yours })}
            >
              Yours
            </button>
          ) : null}
          <div className="pa-sort" role="group" aria-label="Order">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="pa-sort__btn focus-ring"
                aria-pressed={sameSort(state.sort, s.sort)}
                title={s.why}
                onClick={() => set({ sort: s.sort })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p className="pa-shown">{shown}</p>

        {rows.length === 0 ? (
          <div className="pa-empty">
            <p>{emptyLine({ category: state.category, job: state.job })}</p>
            <Button variant="primary" onClick={() => set({ category: "all", job: "all", yours: false })}>
              Show all
            </Button>
          </div>
        ) : (
          <div
            ref={box}
            className="pa-ledger"
            onPointerDownCapture={() => {
              how.current = "press";
            }}
            onKeyDownCapture={(e) => {
              how.current = e.key === "Enter" || e.key === " " ? "press" : "walk";
            }}
          >
            <Table
              columns={columns}
              rows={rows}
              rowKey={(v) => v.id}
              empty="No playbook here."
              caption="Pick a playbook to open its page."
              selectedKey={state.last}
              onSelect={(v) => {
                set({ last: v.id });
                if (how.current === "press") open(v);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
