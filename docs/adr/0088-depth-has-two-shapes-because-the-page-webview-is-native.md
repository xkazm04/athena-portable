# 0088 — Depth has two shapes, because the page webview is native

## Context

`layout.rs` owns the window's rectangles. With a Browser tab focused, `chrome` is the top 76 px
and a native `page-<id>` webview fills the rest; nothing the scene draws can show under it. Rust
knows exactly one module id, `browser`, because the rectangles depend on it.

## Decision

A depth path has a **shape**: `scene` (the chrome webview owns the window below the 36 px bar) or
`page` (a tab is focused: the chrome keeps a 76 px band and the page webview owns the rest).
`shape(path)` is a pure function in `src/depth/` and is the only thing Rust is told, through the
existing `layout_select`, with the `browser` id kept as an alias for `page` so the Rust side
changes by one match arm and its tests.

The band is the scene's own: Rise, the breadcrumb, the tab strip, the address field and the tools
indicator. Entering a tab is a transition that ends on that band; the page itself appears by the
webview being shown, never by an animation the scene pretends to run under it. `--bar-height` and
`--strip-height` and `layout.rs` keep being edited together, and the `capture.rs` crop is checked
whenever they change.

## Consequences

- The scene cannot paint behind a page, and does not try to. The illusion of one continuous scene
  holds up to the band and no further, which is the cost of native webviews.
- Adding a depth is a TypeScript change; only a new shape would touch Rust.
- `layout.rs` gains tests for both shapes, and a test pins that the TypeScript and Rust shape
  names agree.
