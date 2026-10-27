// @vitest-environment jsdom
/**
 * The featured band — ADR 0226. The status rule is the bench's `featured_status`, case by case;
 * the loader keeps the authored block as written and the band earns it from the chore's
 * `senses/proofs.json`, found by the playbook's id; the band is mounted on the catalogue, leads
 * with what is proven on Meta, never dresses a rehearsal as proven, opens a chore as a ledger row
 * does, and is not drawn at all when no playbook is featured.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import { loadPlaybooks } from "@/lib/playbooks";
import { selectPlaybooks, type PlaybooksModel } from "@/modules/playbooks/model";

import FeaturedBand, { featuredRows, proofsLine } from "./featured";
import { SHIPPED_PROOFS, earnFeatured, featuredOf, featuredStatus, proofsById } from "./featured-model";
import { FEATURED_FIXTURE, fixtureIds, fixtures } from "./fixtures";
import { forgetChores } from "./memory";
import { chorePath } from "./model";
import ChoresView from "./view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proof = (passed: boolean) => ({ id: "F1", question: "q", measured: 1, bar: 1, op: ">=", passed, n: 3 });

describe("the status rule, as the bench's featured_status", () => {
  it("is unproven with no file, or a file with no proofs", () => {
    expect(featuredStatus(null)).toBe("unproven");
    expect(featuredStatus({ passed: true, backends: { reader: "meta" }, proofs: [] })).toBe("unproven");
    expect(featuredStatus({ passed: true, backends: { reader: "meta" } })).toBe("unproven");
  });
  it("is failing when the file did not pass, whatever ran", () => {
    expect(featuredStatus({ passed: false, backends: { reader: "meta" }, proofs: [proof(false)] })).toBe("failing");
    expect(featuredStatus({ backends: {}, proofs: [proof(true)] })).toBe("failing");
  });
  it("is proven when it passed and any backend ran on meta", () => {
    const file = { passed: true, backends: { segmenter: "fixture", reader: "meta" }, proofs: [proof(true)] };
    expect(featuredStatus(file)).toBe("proven");
    const muse = { passed: true, backends: { segmenter: "fixture", reader: "muse" }, proofs: [proof(true)] };
    expect(featuredStatus(muse)).toBe("proven");
  });
  it("is rehearsed when it passed on fixtures or Claude alone", () => {
    const file = { passed: true, backends: { segmenter: "fixture", transcriber: "claude" }, proofs: [proof(true)] };
    expect(featuredStatus(file)).toBe("rehearsed");
    expect(featuredStatus({ passed: true, proofs: [proof(true)] })).toBe("rehearsed");
  });
});

describe("the reader", () => {
  const dir = "../../../../playbooks/";
  it("keeps the authored block as written, and the band earns it from senses/proofs.json", () => {
    const block = { senses: ["paper", "smell", "call"], spike: "01-paper-flip", since: "2026-10-26" };
    const [p] = loadPlaybooks({ [`${dir}a/playbook.json`]: { id: "a", featured: block } }, {});
    expect(p!.featured).toEqual(block);
    const files = proofsById({
      [`${dir}a/senses/proofs.json`]: { default: { passed: false, backends: {}, proofs: [proof(true), proof(false)] } },
    });
    expect(Object.keys(files)).toEqual(["a"]);
    expect(featuredOf(p!, files)).toEqual({
      senses: ["paper", "call"],
      spike: "01-paper-flip",
      since: "2026-10-26",
      status: "failing",
      proofs: { passed: 1, total: 2 },
    });
  });

  it("has no featured block when playbook.json carries none, and an unproven one without proofs", () => {
    const [plain, flagged] = loadPlaybooks(
      {
        [`${dir}a/playbook.json`]: { id: "a", title: "A" },
        [`${dir}b/playbook.json`]: { id: "b", title: "B", featured: { senses: ["walk"] } },
      },
      {},
    );
    expect(plain!.featured).toBeNull();
    expect(featuredOf(plain!, {})).toBeNull();
    expect(earnFeatured("yes", null)).toBeNull();
    expect(featuredOf(flagged!, {})).toMatchObject({ status: "unproven", proofs: { passed: 0, total: 0 } });
    expect(proofsLine(featuredOf(flagged!, {})!.proofs)).toBe("No proofs yet");
  });

  it("finds the shipped proofs by the playbook's id: every shipped playbook's directory is its id", () => {
    const root = resolve(__dirname, "../../../../../playbooks");
    const ids = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => {
        try {
          const raw = JSON.parse(readFileSync(resolve(root, d.name, "playbook.json"), "utf8")) as { id?: unknown };
          return [[d.name, raw.id] as const];
        } catch {
          return [];
        }
      });
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter(([name, id]) => name !== id)).toEqual([]);
    // Each shipped proofs file sits beside a playbook that carries a featured block.
    const featured = new Set(fixtures[FEATURED_FIXTURE]!.items.filter((v) => v.playbook.featured).map((v) => v.id));
    expect(Object.keys(SHIPPED_PROOFS).length).toBeGreaterThan(0);
    expect(Object.keys(SHIPPED_PROOFS).filter((id) => !featured.has(id))).toEqual([]);
  });
});

/** An invented `senses/proofs.json`: `passed` of `total` proofs passed, the reader on `reader`. */
const proofsFile = (passed: number, total: number, reader: "fixture" | "meta") => ({
  passed: passed === total,
  backends: { segmenter: "fixture", reader },
  proofs: Array.from({ length: total }, (_, i) => ({ ...proof(i < passed), id: `F${i + 1}` })),
});

/** Three invented chores of the ledger fixture featured, in three of the four statuses (`unproven`
 *  is no file): refunds rehearsed on fixtures, chargebacks proven on Meta, flights with a proof failing. */
const FILES = {
  "carrier-refunds": proofsFile(4, 4, "fixture"),
  "chargeback-evidence": proofsFile(5, 5, "meta"),
  "flight-compensation": proofsFile(2, 3, "meta"),
};
const BLOCKS: Record<string, Record<string, unknown>> = {
  "carrier-refunds": { senses: ["paper"], spike: "01-paper-flip", since: "2026-10-26" },
  "chargeback-evidence": { senses: ["paper", "call"], spike: "02-appeal-kin", since: "2026-10-26" },
  "flight-compensation": { senses: ["walk"], spike: "04-renovation-witness", since: "2026-10-26" },
};

/** The ledger fixture with `BLOCKS` laid on, re-selected so every derived figure follows. */
function invented(): PlaybooksModel {
  const ledger = fixtures.ledger!;
  return selectPlaybooks(
    ledger.items.map((v) => ({ ...v.playbook, featured: BLOCKS[v.id] ?? null })),
    ledger.actions,
  );
}

describe("the band", () => {
  const page = (m: PlaybooksModel) =>
    renderToStaticMarkup(<ChoresView model={m} path={{ root: "chores" }} go={() => {}} />);
  const band = () => renderToStaticMarkup(<FeaturedBand model={invented()} files={FILES} open={() => {}} />);

  it("is a preview fixture", () => {
    expect(fixtureIds).toContain(FEATURED_FIXTURE);
  });

  it("orders the featured chores proven first, then rehearsed, then failing", () => {
    expect(featuredRows(invented(), FILES).map((r) => [r.view.id, r.featured.status])).toEqual([
      ["chargeback-evidence", "proven"],
      ["carrier-refunds", "rehearsed"],
      ["flight-compensation", "failing"],
    ]);
  });

  it("is drawn on the catalogue above the areas, each row with its senses, status and count", () => {
    const h = page(fixtures[FEATURED_FIXTURE]!);
    expect(h).toContain("Featured chores");
    expect(h.indexOf('class="pa-featured"')).toBeLessThan(h.indexOf('class="pa-tabs"'));
    const b = band();
    const order = ["Proven on Meta", "Rehearsed on fixtures", "Proof failing"].map((w) => b.indexOf(w));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(b).toContain("5 of 5 proofs passed");
    expect(b).toContain("2 of 3 proofs passed");
    for (const sense of ["Paper", "Call", "Walk"]) expect(b).toContain(`>${sense}</span>`);
  });

  it("never gives a rehearsal the success dot: only the proven row wears it", () => {
    const h = band();
    expect(h.split("status-dot--success").length - 1).toBe(1);
    const rehearsed = h.slice(h.indexOf("pa-featured__row--rehearsed"), h.indexOf("pa-featured__row--failing"));
    expect(rehearsed).toContain("status-dot--info");
    expect(rehearsed).not.toContain("status-dot--success");
  });

  it("renders nothing, not even its heading, when no playbook is featured", () => {
    const h = page(fixtures.ledger!);
    expect(featuredRows(fixtures.ledger!)).toEqual([]);
    expect(h).not.toContain("pa-featured");
    expect(h).not.toContain("Featured chores");
  });
});

describe("a press on the band", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    forgetChores();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens the chore's topic page, as its ledger row does", () => {
    const go = vi.fn<(to: Path) => void>();
    const model = fixtures[FEATURED_FIXTURE]!;
    act(() => root.render(<ChoresView model={model} path={{ root: "chores" }} go={go} />));
    const first = host.querySelector<HTMLButtonElement>(".pa-featured__chore");
    act(() => first!.click());
    expect(go).toHaveBeenLastCalledWith(chorePath(featuredRows(model)[0]!.view.id));
  });
});
