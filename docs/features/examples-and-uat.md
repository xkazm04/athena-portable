# Example apps and user acceptance

## Example apps

`examples/` (ADR 0017): one invented studio whose work spreads across three apps the demo runs on,
each registering WebMCP tools through the bridge.

| App | Role in the journey |
|---|---|
| `ledgerbox` | the books (act 1): invoices, payments, chase drafts; The Lanes page carries a view layer and a books layer, 23 tools, three gated (ADR 0018) |
| `hirelane` | the pipeline (act 2): applicants, shortlist, scheduling and rejection mail |
| `tidycrm` | the contact list (act 3): conflicts, company previews and resolutions |
| `demo-kit` | the shared seed, database, activity log and WebMCP helpers |
| `atlas` | a design blueprint (one canvas, four views) |
| `journey` | boots the three apps in scratch directories and drives the four acts end to end through `inject.js` and `gate.js`, approving and declining as a surface would; records the demo take on request |

## User acceptance (`uat/`)

Five Characters (`ana`, `jonas`, `mira`, `priya`, and `juror`, the evaluator), five journeys (first
launch, living with her, deciding a card, trusting the record, a workday in Main), a seven-dimension
rubric, a driver, and the runs with their insights (`docs/uat-insights/`). The Proving Ground's
Characters prototype plays these users with Nemotron.
