# Screenshots

The window, walked by hand on 2026-09-12, 1280 px wide, both themes. Each is the real shell
against `apps/desktop/scratch/webmcp-page.html` with the daemon replaying
`apps/desktop/scratch/gated-round.jsonl` (`ATHENA_ENGINE_SCRIPT`), so what they show is
reproducible with the three commands in the root README.

| Shot | What it is evidence of |
|---|---|
| `panel-tools-dark.png`, `panel-tools-light.png` | act 1: the window comes up on Panel, the page's three tools are listed with the class the gate derived — two `AUTO`, one `GATED` — and the daemon says `ready` |
| `panel-card-light.png` | act 2, mid-turn: the transcript streamed, `invoice_list` ran on the page, `invoice_send` came back `pending_approval`, and the card is pinned under the transcript with its action, its `id` parameter, its rationale and its two options |
| `panel-approved-dark.png`, `panel-approved-light.png` | act 2, answered: the card collapsed to one line naming the choice, `invoice_send` ran on the page in 4 ms, and the turn continued to its last sentence |
| `origins-dark.png` | the Origins module listing the origin, with the sightings the store stamped and the count of rulings |
| `settings-dark.png` | the engine probe the daemon ran, rendered: both CLIs found, with their versions. The store path is redacted — a screenshot is a committed file and rule 11 applies to it |
| `setup-dark.png` | the Setup wizard's stations derived from the same probe: "All 2 answered their version flags" |
