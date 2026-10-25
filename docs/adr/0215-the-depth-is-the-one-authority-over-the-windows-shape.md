# 0215. The depth is the one authority over the window's shape; Rust is reconciled, not followed

Date: 2026-10-25

Extends ADR 0088 (depth has two shapes, because the page webview is native), which said the depth
tells Rust the shape and left implicit who follows whom when the two disagree.

## Context

The window's shape had two writers and an echo between them. `depth/shape.ts` pushed the depth's
shape to Rust with `layout_select`; `layout.rs` `select` announces every selection back as
`layout:changed`; and `console/follow.ts` `followLayout` moved the depth to match each
announcement, as if Rust had decided something. Rust decides nothing about the shape:
`layout_select` is its only way in and `shape.ts` was its only caller, so the follower only ever
heard its own echoes, and it judged each one against the depth as it is now, not as it was when the
select was sent. Three defects shared that cause:

- **Echo ping-pong.** Two shape changes inside one IPC round trip (open a page and press Escape)
  let the stale `page` echo dive the depth back onto the page, which re-sent, whose echo flipped it
  again. Under a fake shell the loop issued 62 selects in 30 tasks.
- **Unordered selects.** `layout_select` is an async Tauri command, so two invokes in flight land
  in either order; Rust could end in `page` while the depth drew a scene.
- **A refused select was never retried.** `last` was set before delivery, so after a refusal the
  same shape was deduplicated forever and Rust stayed in the other shape.

## Decision

1. **The depth leads; no layout event moves it.** `followLayout` is gone. `useFollowShell` hands
   `layout:changed` to `heardLayout` in `depth/shape.ts`. `followFocus` stays: the focused tab
   genuinely moves under a page.
2. **The seam is a channel.** At most one select is in flight. A shape wanted meanwhile waits in
   one slot and only the latest is kept; when the select settles, the slot is sent if it differs
   from what Rust accepted.
3. **Each accepted select owes one echo, and an owed echo is consumed unread.** A refused select
   owes none and leaves Rust's shape unknown, so the next want is sent even if equal. Every depth
   move is offered to the channel (an equal shape costs nothing), so a refused page is re-sent on
   the next page move.
4. **An announcement nobody is owed that disagrees with the depth re-sends the depth's shape**
   (forced), reconciling Rust to the depth.

## Consequences

- The page webview can no longer be shown over a scene, nor a scene yank the person back onto a
  page, from timing alone. `shell-sync.test.tsx` pins the end-to-end behaviour against a fake shell;
  `shape.test.ts` pins the single flight, the coalescing and the retry.
- A future Rust-side reason to change the shape (none exists today) is not a layout event the
  depth follows: it must be a separate, named event the depth decides on, or the channel re-sends
  over it.
- The first frame grows by roughly 0.25 kB gzipped (the channel replaces the follower's rule); the
  first-paint gate holds.
- `shapeSyncState()` reports whether Rust holds the depth's shape, for tests and a diagnostic.
