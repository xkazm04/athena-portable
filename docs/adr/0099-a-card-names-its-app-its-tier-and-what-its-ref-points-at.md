# 0099. A card names its app, its tier and what its ref points at

Date: 2026-10-15

Amends [0066](0066-a-gated-host-proposal-carries-a-capture-of-its-tab.md) (what a card shows) in the spirit of
[0091](0091-apps-are-named-by-origin-and-the-tool-level-shows-claims-not-classes.md) (apps are
named by origin; a page's words are claims). Keeps [0014](0014-page-webviews-get-one-command-and-the-relay-holds-the-id-map.md)
whole.

## Context

A card for a generic hand read `host.web_https_sledger_dtest.page_click` over `ref:
ref_0_3fa9c1d2e4b5`. Nothing on it said which app, that the click is Athena's hand rather than a
tool the app offered, or what the ref points at, so the person was asked to approve a token. The
activity row written for every answered card said `tier: 1` whatever the card was.

## Decision

1. **The card names the app** with `appOf`, which now reads a derived catalog id back to the host
   it was minted from (`hostOfDerivedId`, the inverse of `derivedIdOf`): `ledger.test`, not
   `web_https_sledger_dtest`. Every row that names an app through `appOf` reads the same way.
2. **The card names the tier**, which says where the call runs and never whether it is gated. The
   tool row the panel already holds answers first (the catalog's `tier`); otherwise a `connector:`
   origin is 3 and a hand's name on a host origin is 2 unless the page registered that name itself
   (`tierOf`, `lib/hands.ts`). The activity row of an answered card records this tier.
3. **A ref is described by the page, for the panel only.** `hands.js` answers a message carrying
   `describe: [refs]` with `{ ref: { role, label } }` for refs it still holds. It is not in
   `HANDS`, `FLAGS` or the tool list, so no manifest offers it and a model cannot call it; asked as
   a hand by name it is an unknown hand. The panel reaches it through a new command,
   `hands_describe`, over the same `ask_hands` relay a hand uses, granted to the chrome and the
   Athena window only. Page webviews keep their single command (`bridge_reply`).
4. **A label is the page's claim.** The card prints `button - Send reminder (ref_0_3fa9c1d2e4b5)`
   with the full ref, and says the names are the page's own labels. A dead ref, a page that does
   not answer, or no shell leaves the raw ref and the sentence "The target could not be described".
   Nothing about the class, the gate or the stored grant reads a label.

## Consequences

- A hostile page can label its "Delete all" button "Send reminder". The card says the name is the
  page's claim and the capture (ADR 0066) shows the page; the gate is unchanged, so the call is
  still a card. This is no worse than the page's own tool descriptions, which are claims too.
- A ref is described on the focused tab when the card arrives. Refs are scoped to one document, so
  a card filed for another tab, or restored after a restart, shows the raw ref with the sentence.
- `appOf` naming a derived id by its host changes the Record's app column for apps that published
  no `athena:app` from the slug to the host, which is the name the person knows.
