# 0209. A restart reopens the last session's tabs, and a tab id is never reissued

Date: 2026-10-25

## Context

Every restart of the shell (a crash, an update, a reboot) threw away every open page. Tab state
was an in-memory list in `apps/desktop/src-tauri/src/tabs.rs` with ids counting from 1 on every
launch, and the only tab a launch opened was the dev start url. The Apps ledger (ADR 0024)
reopens an app at its origin, one press per app, never at the page the person was on. Her seal
came up at a fixed bottom-right point on every launch, forgetting the place the person dragged
her to.

The restarting ids were also a quiet aliasing bug. A card is bound to its document by `tab_id`
and `tab_nav` (ADR 0103, `stores/run.ts`), and approvals outlive a restart in the brain index
(ADR 0005). A new launch could mint the same tab id a pending card names, and the card would
then resolve onto whatever unrelated page happened to be that tab this time.

## Decision

1. **The shell owns the return, natively.** A new `session.rs` turns the tab list into a bounded
   snapshot and a saved snapshot plus an optional launch url into a restore plan. Both are pure
   and unit-tested; no view hands the list back.
2. **What is restored without asking: the person's own pages, and only those that are still
   allowed.** http and https only (never `file:`, `data:` or `about:`), at most 12 tabs with the
   focused one always kept, no url over 2,048 characters. The saved row is re-filtered on the way
   in, and an origin whose `origins` row is `enabled: false` is not reopened, so a restore never
   brings back an app the person has since switched off. A restored tab is a page like any other:
   its origin's row decides what Athena may do there. A saved card is not restored by this
   (approvals stay where ADR 0005 put them).
3. **Change-driven, in the settings table.** `settings.shell.session` = `{ "tabs": [{ "url",
   "focused" }] }`, written from `tabs::announce` only when the restorable part of the list moved:
   a navigation, a create, a close or a focus change writes once; a title change writes nothing.
   A close is written at the close, so a restart never reopens a tab the person closed. No schema
   or store change: the settings table holds any JSON.
4. **A tab id is never reissued.** `settings.shell.tab_seq` holds the highest id ever issued; a
   launch seeds the counter from it. A card bound to last launch's tab 3 finds no tab 3.
5. **Launch order.** Saved tabs open in strip order behind, the one that was in front is created
   focused, and a launch argument (or `ATHENA_START_URL`) opens too, is not duplicated when it
   equals a saved url, and wins focus.
6. **Smokes are probes.** With `ATHENA_SMOKE` or `ATHENA_SMOKE_HANDS` set, nothing is restored and
   nothing is written. Both smokes ask the id `tabs::create` returned for the start url instead
   of tab 1, since a carried-over sequence means it is not 1.
7. **Her dock returns when its place still exists.** `settings.shell.dock` = `{ "x", "y", "snap"
   }`, saved on a drop and on a requested snap. A launch restores it only when the seal lies wholly
   inside a connected monitor's work area (a `main.*` snap re-follows Main where Main came up);
   otherwise today's bottom-right default stands, silently.

## Consequences

- A restart costs the person nothing of their place: N presses of the Apps ledger plus
  re-navigation become zero.
- The urls stay in the local store beside the browsing profile that already holds the logins;
  nothing is sent anywhere.
- A tab that fails to rebuild at launch is dropped from the next snapshot.
- A restored screen-edge dock is known to Rust at once but reaches her page only on the next
  `athena:snap` (the page is not loaded when the window is built); until then she rests as a seal
  on that edge rather than as a tab.
- A shell that no longer reads these rows ignores them; each part reverts alone.
