# 0018. Ledgerbox ships The Lanes, and one page carries both tool layers

Date: 2026-09-12

## Context

ADR 0017 brought the three example apps in with "the shipped design at the root route". For
Ledgerbox that was read off the sibling repository's README, which still named The Strip as the
shipped design. The Strip is the older of Ledgerbox's two directions; The Lanes came four days
later, in the same round that produced Hirelane's Board and Tidycrm's Blocks, and it is the one
built on the kit's three-level zoom model those two share. The migration kept the Strip and
deleted the Lanes, so the one app in the demo that did not move through its layers on camera was
the one whose layered design had been thrown away.

The Strip also owned the write tools. The Lanes registered only a read and zoom layer over the
same books, and the two were never mounted together, so making the Lanes the page meant either
losing every write or carrying two registration files on one route.

## Decision

The Lanes is the Ledgerbox at `/`. The Strip, its stage route and its state are removed rather
than kept beside it; a second design on a second route is what the direction index was for, and
the index is gone.

One page carries both layers, the way Hirelane's Board does: `lib/manifest.ts` holds every tool's
parameters, `lib/tool-classes.ts` stays the single source of `reversible` / `side_effects`, and a
registration helper merges the two so no call site can restate a class. The view layer keeps the
kit's verbs (`read_view`, `open_group`, `open_item`, `zoom_out`, `search_invoices`, `set_filter`)
and the books layer keeps the Strip's names, re-pointed at the Lanes' state, so `open_invoice` and
`open_item` are the same move and `navigate` and `set_filter` press the same chips. Twenty-three
names, no duplicates, and exactly `mark_paid`, `send_reminder` and `void_invoice` gated.

The page reads the bridge's own presence marker (`window.__athenaBridge`, ADR 0008) and says
whether Athena is connected and how many capabilities are offered. That is the first of the
in-page signals the recorded walkthrough needs, and it costs the app nothing it does not already
have.

## Consequences

- The Ledgerbox tool contract changes shape: navigation calls answer with the level and the thing
  opened rather than a sentence, and the journey's adapters follow.
- Every write in act 1 is now visible on the open card: a match flips the lead figure to settled,
  a draft appears as a block, a send clears it and counts in the aside.
- The other two apps owe the same presence line and the same "one manifest, two layers" shape
  where they do not have it yet; that is the next change, not this one.
