/// Declaring the app's own commands here turns on the **app ACL manifest**, and that is a
/// security decision rather than a formality.
///
/// Without it, every command in `invoke_handler` is callable from every webview in the window —
/// including the page webviews, which hold whatever site the user navigated to. With it, a
/// command is reachable only from a webview some capability grants it to, and each surface has
/// its own file in `capabilities/`: `ui.json` for the `chrome` webview, `athena.json` for her
/// window (which holds `hands_call`, `bridge_call` and the store too), `halo.json` for the
/// overlays (nothing), and `page.json` for the page webviews, which get exactly one command
/// (`bridge_reply`, c19) and nothing else.
///
/// The cost is that a new command has to be added in three places — here, the `invoke_handler`
/// in `lib.rs`, and the capability file of every surface that calls it. Forgetting this one
/// produces `Permission ... not found` at runtime, so it is the first list to edit, not the last.
/// `src/lib/commands.test.ts` holds the four lists to one another.
fn main() {
    // `src/bridge.rs` embeds the bridge package's `inject.js` with `include_str!`, so a change to
    // that file has to rebuild this crate even though it is nowhere in `src/`. Cargo tracks
    // `include_str!` through the dep-info file, and this says it a second time out loud: the page
    // half of the protocol is one file with two consumers and a stale binary is the one failure
    // that would look like a page with no tools (c19).
    println!("cargo:rerun-if-changed=../../../packages/athena-bridge/inject.js");

    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            // tabs.rs (c18)
            "tabs_create",
            "tabs_close",
            "tabs_focus",
            "tabs_navigate",
            "tabs_list",
            // layout.rs — which shape the window is in (ADR 0088)
            "layout_select",
            // ---- later milestones add their commands here, one block per module ----
            // bridge.rs (c19) — the first two are the chrome's and hers, the third is the page's
            // only one
            "bridge_list",
            "bridge_call",
            "bridge_reply",
            // daemon.rs (c20) — the sidecar's URL, token and health, and a restart on an
            // engine change. The names are the function names in `daemon.rs`, wherever the
            // function is declared.
            "daemon_status",
            "daemon_restart",
            // store.rs (c21) — one key/value surface over every table, not one command per table
            "store_get",
            "store_set",
            "store_list",
            "store_delete",
            "store_path",
            "captures_sweep",
            // hands.rs (c24) — the generic hands of README section 3.4 tier 2. `hands_call`
            // runs one on a tab; `hands_list` is the catalogue the panel appends to a page's
            // manifest. Both are the chrome's and hers; no capability a page webview holds grants
            // them, which is what stops a site operating itself through them.
            "hands_call",
            "hands_list",
            // `hands_describe` names what a card's refs still point at (ADR 0099). The chrome's
            // and hers: it is no hand, and no capability a page webview holds grants it.
            "hands_describe",
            // companion.rs (ADR 0026) - her window: named sizes, show and hide, pin, and what she
            // reports. All seven are hers; `athena_show`, `athena_hide`, `athena_snap_to` and
            // `athena_open_main` are also the chrome's (the status pill summons her).
            // `athena_toggle` is the chrome's alone: Main's illustration of her is the switch.
            "athena_set_size",
            "athena_show",
            "athena_hide",
            "athena_toggle",
            "athena_pin",
            "athena_report",
            "athena_snap_to",
            "athena_open_main",
            // halo.rs (ADR 0027) - her window hands the halo its one signal; the `halo-*`
            // overlays themselves are granted no command at all.
            "athena_halo",
            // face.rs (the ADR on Athena's face) - her window mirrors her face to Main, which
            // hears it as `athena:face`; only her window is granted the command.
            "athena_face",
        ])),
    )
    .expect("failed to run tauri-build");
}
