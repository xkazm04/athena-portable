/**
 * The population at L0: what this repository CLAIMS, as seventeen cells.
 *
 * Six invariants (README §2), four rungs of the onboarding ladder and four acts of the demo
 * (README §1), and three standing decisions the architecture is shaped by (README §3.4, §4,
 * §3.5). Choosing one sets the lens: every component that carries it lights, and every system
 * and layer above those components lights with them.
 *
 * WHAT IS NOT HERE. The stop rule (README §5) is a claim about how the build was scheduled, not
 * about the machine, and no component enforces it — so it would light nothing, and a concept that
 * lights nothing is a row in a table rather than a lens. The test enforces that: every concept
 * reaches at least one component.
 */
import type { Concept } from "./types";

export const CONCEPTS: Concept[] = [
  /* ---- The six invariants. README §2: "not features; what makes the features trustworthy". ---- */
  {
    id: "inv-disk",
    part: "I-1",
    kind: "invariant",
    name: "Disk is truth",
    claim:
      "Markdown on disk is truth; SQLite is a rebuildable index. A brain is portable by copying the directory.",
    source: "README §2, invariant 1",
    file: "README.md",
  },
  {
    id: "inv-provenance",
    part: "I-2",
    kind: "invariant",
    name: "Provenance is mandatory",
    claim:
      "A fact that does not cite live episodes is rejected at write. No bypass, not even for tests.",
    source: "README §2, invariant 2",
    file: "README.md",
  },
  {
    id: "inv-gate",
    part: "I-3",
    kind: "invariant",
    name: "Policy lives in the gate",
    claim:
      "Policy lives in the gate, never in the model. A GATED tool never executes without a resolved decision.",
    source: "README §2, invariant 3",
    file: "README.md",
  },
  {
    id: "inv-bounded",
    part: "I-4",
    kind: "invariant",
    name: "Bounded and honest",
    claim:
      "Every truncated block announces (showing N of M); every registry name appears in the composed prompt.",
    source: "README §2, invariant 4",
    file: "README.md",
  },
  {
    id: "inv-noprovider",
    part: "I-5",
    kind: "invariant",
    name: "No provider is mandatory",
    claim:
      "The core is stdlib-only; engines, transports and clouds are extras imported lazily.",
    source: "README §2, invariant 5",
    file: "README.md",
  },
  {
    id: "inv-cost",
    part: "I-6",
    kind: "invariant",
    name: "Cost is visible",
    claim:
      "One ledger row per model invocation, failures included, with a reason from a closed set.",
    source: "README §2, invariant 6",
    file: "README.md",
  },

  /* ---- The onboarding ladder. README §1: "the product pattern". ---- */
  {
    id: "tier-remember",
    part: "T-0",
    kind: "tier",
    name: "Tier 0 — remembers",
    claim:
      "A brain that carries a fact learned in one app into a decision made in another.",
    source: "README §1, the onboarding ladder",
    file: "README.md",
  },
  {
    id: "tier-act",
    part: "T-1",
    kind: "tier",
    name: "Tier 1 — acts",
    claim:
      "Generic hands on any page, and the page's own tools wherever it registers them.",
    source: "README §1, the onboarding ladder",
    file: "README.md",
  },
  {
    id: "tier-native",
    part: "T-2",
    kind: "tier",
    name: "Tier 2 — native",
    claim: "The app hosts Athena's chat itself, and publishes its capabilities as a manifest.",
    source: "README §1, the onboarding ladder",
    file: "README.md",
  },
  {
    id: "tier-beside",
    part: "T-3",
    kind: "tier",
    name: "Tier 3 — beside the browser",
    claim: "Third-party connectors: mail, calendar, storage, at the same gate as a page.",
    source: "README §1, the onboarding ladder; §4",
    file: "README.md",
  },

  /* ---- The four acts. README §1, "the demo, four acts, under five minutes". ---- */
  {
    id: "act-setup",
    part: "A-1",
    kind: "act",
    name: "Act 1 — Setup",
    claim:
      "First launch: the engine probe finds the user's subscription with no key typed, and every tool is GATED on first sight.",
    source: "README §1, act 1",
    file: "README.md",
  },
  {
    id: "act-command",
    part: "A-2",
    kind: "act",
    name: "Act 2 — Command",
    claim:
      "Push-to-talk across two apps: read one page, fill drafts in the next, each fill a decision card with its screenshot.",
    source: "README §1, act 2",
    file: "README.md",
  },
  {
    id: "act-agent",
    part: "A-3",
    kind: "act",
    name: "Act 3 — Another agent",
    claim:
      "A coding agent calls Athena's MCP server; its question is a card in the same approvals inbox, and its payment request is declined.",
    source: "README §1, act 3",
    file: "README.md",
  },
  {
    id: "act-record",
    part: "A-4",
    kind: "act",
    name: "Act 4 — The record",
    claim:
      "Every call by app, tier and surface with its cost; both declines ledgered user_denied; every fact shown with the episode it cites.",
    source: "README §1, act 4",
    file: "README.md",
  },

  /* ---- Standing decisions: the shapes the architecture is bent into. ---- */
  {
    id: "dec-onegate",
    part: "D-1",
    kind: "decision",
    name: "One gate, one approval table",
    claim:
      "Three tiers of capability and every other agent queue at the same gate and file on the same approval table; a surface may tighten a class but never loosen one.",
    source: "README §3.4; ADR 0004",
    file: "docs/adr/0004-the-gate-is-the-policy.md",
  },
  {
    id: "dec-connector-data",
    part: "D-2",
    kind: "decision",
    name: "A connector is data, not code",
    claim:
      "One JSON spec per service declares its auth, its hosts and its intent-shaped tools; it enters the catalog exactly like a page.",
    source: "README §4; ADR 0021",
    file: "docs/adr/0021-connectors-are-data-behind-one-vault-and-enter-the-catalog-like-a-page.md",
  },
  {
    id: "dec-module-first",
    part: "D-3",
    kind: "decision",
    name: "The window is module-first",
    claim:
      "A thin module bar plus one full-width module; the browser is an ordinary registry entry, not a frame hosting a side panel.",
    source: "README §3.5; ADR 0013",
    file: "docs/adr/0013-module-first-window.md",
  },
];
