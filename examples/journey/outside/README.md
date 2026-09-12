# `outside/` — a page that has never heard of Athena

One static site, served on its own port by the journey's runner, standing in for the web the user
already has open. It is the tier-2 half of README section 3.4: the three example applications
publish WebMCP tools and Athena uses them; this one publishes nothing at all and Athena uses the
generic hands on it.

**Nothing here imports the kit, the seed or the bridge.** There is no `document.modelContext`, no
`athena:app` meta tag, no manifest and no script of any kind — the whole site is four files of
hand-written HTML. That is the point: a page Athena can operate *because it is a page*, not
because its author agreed to anything.

## Why it is frozen rather than live

The journey runs inside `pnpm test`, so a live third-party site would make the gate
network-dependent and flaky, and a green run would mean "the site was up" as much as "the hands
work". The claim being checked is *the hands operate uninstrumented HTML*, and uninstrumented HTML
is exactly what this is.

The live demo points the same beats at the real thing. `apps/desktop` has been driven against
Wikipedia and Hacker News with these hands and no changes; that is the evidence for the claim this
fixture makes deterministic.

## What is on it, and why those things

Kestrel Labs is one of the studio's fifteen clients (`@athena/demo-kit/seed`), and it is the client
the demo's hardest moment is about. Act 1 finds a credit for £4,800 that settles *either* of two
parallel retainers equally well, and leaves it alone, because guessing which invoice a payment
belongs to is not something an agent should do quietly.

A finance person would not guess either. They would go and look at the customer's own remittance
advice, which is published — and this is that page. It names the invoice the payment was against,
so act 1's one undecided credit becomes a decided one, with a card citing where the answer came
from.

| Page | What act it serves |
|---|---|
| `index.html` | the company, and the way in to the other two |
| `remittances.html` | the remittance table that resolves act 1's ambiguous credit |
| `team.html` | corroborates act 2's cross-app thread: the applicant really does work there |

The values on these pages are the seed's. `journey.spec.ts` asserts that they still agree with
`@athena/demo-kit/seed` and with Ledgerbox's own invoice numbers, so a drift on either side is a
red test rather than a demo that quietly stops making sense.
