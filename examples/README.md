# Examples - the studio the demo runs on

Three small Next.js apps that ship WITHOUT Athena, plus the journey that drives them (ADR 0014).
They are one studio's tabs: Halden Studio's books, its hiring pipeline and its contact list. Every
seed reads the same world from `@athena/demo-kit/seed` — the studio, its fifteen clients with one
billing contact each, and the named people and aliases the four acts of README §1 pull on — so a
fact Athena learns in one tab is checkable in the next.

None of them hosts a chat. What a page offers an agent is registered on `document.modelContext`
through `@athena/demo-kit/webmcp`, tagged with the page's own `reversible` / `side_effects` claims;
the surface's half of the bridge (`packages/athena-bridge/gate.js`) derives the class. Athena sits
beside the page, never inside it.

| Directory | Port | Domain | Act | Stresses |
|---|---|---|---|---|
| `ledgerbox/` | 3001 | invoice and expense inbox | 1 | money gates, tone as a parameter, matching as a long job |
| `hirelane/` | 3002 | recruiting pipeline | 2 | judgment with evidence, per-row decisions, gates on anything that reaches a candidate |
| `tidycrm/` | 3004 | CRM cleanup | 3 | provenance at scale, merge-vs-delete gate, a fact from act 1 applied |
| `journey/` | – | the four acts, automated | 1–4 | the real bridge in a real Chromium; approvals and connectors as fakes at the seam |

```bash
pnpm dev:ledgerbox                      # one app
pnpm --filter @athena/journey test      # boots all three, runs the journey, prints the ledger
```

## The threads between the acts

- **Kestrel Labs.** Chased in act 1. In act 2, `KESTREL_APPLICANT` is one of the six borderline
  applicants for the backend role, and Tidycrm holds them under the same email. Context only;
  nothing in Hirelane can score or move a stage on it.
- **Pinegrove Collective.** Pays as `PINEGROVE COOP` on the bank statement (act 1); some CRM records
  spell it `Pinegrove Coop` (act 3). One alias, learned once, cited twice.
- **Solstice Partners.** Paid 80% and went quiet. Ledgerbox exposes the signal in act 1, Tidycrm
  exposes the company on every contact in act 3, and leaving them out of the chase and of the
  campaign audience is the same decision made by Athena twice.

## Shared kit

`demo-kit/` is the workspace package `@athena/demo-kit`: a `node:sqlite` database with a once-only
seed, the shared `activity` table and log view, the WebMCP layer that carries the design flags as
standard annotations, UI primitives themed through `--dk-*` custom properties, the zoom reducer
and the deterministic fake-data helpers. It ships TypeScript source; every app compiles it via
`transpilePackages`. `demo-kit/template/` is a working app skeleton. Read `demo-kit/README.md` for
import paths and gotchas.

## Rules the apps keep

1. **Deterministic seeds**, via `rngFor(APP_ID, stream)`, with the defects the act needs planted in
   the same rows on every machine. Shared names come from the registry, never from a word list.
2. **Honest flags.** `reversible && side_effects !== "external"` is AUTO, everything else GATED.
   Anything that reaches a person, a payment or a public URL is `external`. A page never argues a
   tool out of GATED and never quietly lowers one into AUTO.
3. **Bounded reads** announce their bound: `(showing N of M)`.
4. **Every mutation is in the activity log**, with an undo payload where it is reversible.
5. **No provider, no network, no telemetry** at runtime. Delete `data/*.sqlite` to reseed.
