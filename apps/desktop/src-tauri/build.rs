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
            // bridge.rs (c19): bridge_list, bridge_call, bridge_reply
            // daemon.rs (c20): daemon_status, daemon_restart
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
