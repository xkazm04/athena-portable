// @vitest-environment jsdom
/**
 * The featured band — ADR 0226. The status rule is the bench's `featured_status`, case by case;
 * the reader finds `senses/proofs.json` beside its `playbook.json`; the band is mounted on the
 * catalogue, leads with what is proven on Meta, never dresses a rehearsal as proven, opens a chore
 * as a ledger row does, and is not drawn at all when no playbook is featured.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import { featuredStatus, loadPlaybooks } from "@/lib/playbooks";

import { featuredRows, proofsLine } from "./featured";
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
  it("reads senses/proofs.json beside its playbook.json into the featured block", () => {
    const [p] = loadPlaybooks(
      {
        [`${dir}a/playbook.json`]: {
          id: "a",
          featured: { senses: ["paper", "smell", "call"], spike: "01-paper-flip", since: "2026-10-26" },
        },
      },
      {},
      {},
      false,
      {},
      null,
      { [`${dir}a/senses/proofs.json`]: { default: { passed: false, backends: {}, proofs: [proof(true), proof(false)] } } },
    );
    expect(p!.featured).toEqual({
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
    expect(flagged!.featured).toMatchObject({ status: "unproven", proofs: { passed: 0, total: 0 } });
    expect(proofsLine(flagged!.featured!.proofs)).toBe("No proofs yet");
  });
});

describe("the band", () => {
  const model = () => fixtures[FEATURED_FIXTURE]!;
  const html = (m = model()) => renderToStaticMarkup(<ChoresView model={m} path={{ root: "chores" }} go={() => {}} />);

  it("is a preview fixture", () => {
    expect(fixtureIds).toContain(FEATURED_FIXTURE);
  });

  it("orders the featured chores proven first, then rehearsed, then failing", () => {
    expect(featuredRows(model()).map((v) => [v.id, v.playbook.featured!.status])).toEqual([
      ["chargeback-evidence", "proven"],
      ["carrier-refunds", "rehearsed"],
      ["flight-compensation", "failing"],
    ]);
  });

  it("is drawn on the catalogue above the areas, each row with its senses, status and count", () => {
    const h = html();
    expect(h).toContain("Featured chores");
    expect(h.indexOf('class="pa-featured"')).toBeLessThan(h.indexOf('class="pa-tabs"'));
    const order = ["Proven on Meta", "Rehearsed on fixtures", "Proof failing"].map((w) => h.indexOf(w));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).toContain("5 of 5 proofs passed");
    expect(h).toContain("2 of 3 proofs passed");
    for (const sense of ["Paper", "Call", "Walk"]) expect(h).toContain(`>${sense}</span>`);
  });

  it("never gives a rehearsal the success dot: only the proven row wears it", () => {
    const h = html();
    expect(h.split("status-dot--success").length - 1).toBe(1);
    const rehearsed = h.slice(h.indexOf("pa-featured__row--rehearsed"), h.indexOf("pa-featured__row--failing"));
    expect(rehearsed).toContain("status-dot--info");
    expect(rehearsed).not.toContain("status-dot--success");
  });

  it("renders nothing, not even its heading, when no playbook is featured", () => {
    const h = html(fixtures.ledger!);
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
    act(() => root.render(<ChoresView model={fixtures[FEATURED_FIXTURE]!} path={{ root: "chores" }} go={go} />));
    const first = host.querySelector<HTMLButtonElement>(".pa-featured__chore");
    act(() => first!.click());
    expect(go).toHaveBeenLastCalledWith(chorePath("chargeback-evidence"));
  });
});
