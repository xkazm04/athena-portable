/// Declaring the app's own commands here turns on the **app ACL manifest**, and that is a
/// security decision rather than a formality.
///
/// Without it, every command in `invoke_handler` is callable from every webview in the window —
/// including the page webviews, which hold whatever site the user navigated to. With it, a
/// command is reachable only from a webview some capability grants it to, and
/// `capabilities/ui.json` grants the list below to the `chrome` webview alone. A page webview is
/// named by no capability, so it can call nothing at all; c19 gives it exactly one command
/// (`bridge_reply`) through a capability of its own.
///
/// The cost is that a new command has to be added in three places — here, the `invoke_handler`
/// in `lib.rs`, and `capabilities/ui.json`. Forgetting this one produces `Permission ... not
/// found` at runtime, so it is the first list to edit, not the last.
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
            // layout.rs (c18) — which module the window is showing
            "layout_module",
            "layout_select",
            // ---- later milestones add their commands here, one block per module ----
            // bridge.rs (c19) — the first two are the chrome's, the third is the page's only one
            "bridge_list",
            "bridge_call",
            "bridge_reply",
            // bridge.rs (c23) — the smoke's two: which mode the shell was armed with, and one
            // line of a run on this process's stdout. The chrome webview's, never a page's.
            "smoke_mode",
            "smoke_say",
            // daemon.rs (c20): daemon_status, daemon_restart
            // bridge.rs (c19): bridge_list, bridge_call, bridge_reply
            // daemon.rs (c20) — the sidecar's URL, token and health, and a restart on an
            // engine change. The names are the function names in `daemon.rs`, wherever the
            // function is declared.
            "daemon_status",
            "daemon_restart",
            // store.rs  (c21): store_get, store_set, origins_*
            // store.rs (c21) — one key/value surface over every table, not one command per table
            "store_get",
            "store_set",
            "store_list",
            "store_delete",
            "store_path",
            "captures_sweep",
            // hands.rs  (c24): hands_call, screenshot_read
        ])),
    )
    .expect("failed to run tauri-build");
}
