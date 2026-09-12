//! The tabs, as state (README §5 phase P4: "tabs on real sites").
//!
//! A tab is a page webview plus what the shell knows about it: where it is, what it calls itself,
//! and which daemon session it registered as. The webview itself is created in `lib.rs`; this
//! module is the part worth testing, which is the bookkeeping.
//!
//! Two rules are enforced here rather than remembered.
//!
//! **A webview label is derived once and never reused.** Labels address webviews, the relay routes
//! replies by them, and Tauri refuses a duplicate — so a counter that reset on close would make the
//! third tab receive the first tab's answers.
//!
//! **Closing the active tab moves the selection to a neighbour, not to nothing.** A window with
//! tabs open and none active is a window showing an empty rectangle, which reads as a crash.

use serde::{Deserialize, Serialize};

/// The prefix every page webview's label carries. `capabilities/page-bridge.json` matches on it,
/// so the relay's two permissions are granted to pages and to nothing else.
pub const PAGE_PREFIX: &str = "page-";

/// The panel's own webview label.
pub const PANEL_LABEL: &str = "panel";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tab {
    /// The webview label. Unique for the life of the process.
    pub label: String,
    pub url: String,
    pub title: String,
    /// What the page called itself, once it registered. `None` until it does.
    pub app_id: Option<String>,
    /// The daemon session this page opened, if its manifest was accepted.
    pub session_id: Option<String>,
    /// How many tools the page registered, as the panel shows on first sight.
    pub tool_count: usize,
}

impl Tab {
    fn new(label: String, url: String) -> Self {
        Self {
            label,
            url,
            title: String::new(),
            app_id: None,
            session_id: None,
            tool_count: 0,
        }
    }

    /// `true` when this page has told the shell what it is and what it offers.
    pub fn registered(&self) -> bool {
        self.app_id.is_some() && self.session_id.is_some()
    }
}

#[derive(Debug, Default)]
pub struct Tabs {
    tabs: Vec<Tab>,
    active: Option<String>,
    minted: u64,
}

impl Tabs {
    pub fn new() -> Self {
        Self::default()
    }

    // -- opening and closing -----------------------------------------------------------------

    /// Open a tab on `url` and make it active. Returns the new tab.
    pub fn open(&mut self, url: impl Into<String>) -> Tab {
        self.minted += 1;
        let tab = Tab::new(format!("{PAGE_PREFIX}{}", self.minted), url.into());
        self.active = Some(tab.label.clone());
        self.tabs.push(tab.clone());
        tab
    }

    /// Close a tab. Returns it, and leaves the selection on a neighbour when it was active.
    pub fn close(&mut self, label: &str) -> Option<Tab> {
        let index = self.tabs.iter().position(|tab| tab.label == label)?;
        let removed = self.tabs.remove(index);
        if self.active.as_deref() == Some(label) {
            let neighbour = index.min(self.tabs.len().saturating_sub(1));
            self.active = self.tabs.get(neighbour).map(|tab| tab.label.clone());
        }
        Some(removed)
    }

    // -- reading ----------------------------------------------------------------------------

    pub fn all(&self) -> &[Tab] {
        &self.tabs
    }

    pub fn get(&self, label: &str) -> Option<&Tab> {
        self.tabs.iter().find(|tab| tab.label == label)
    }

    pub fn active(&self) -> Option<&Tab> {
        self.active.as_ref().and_then(|label| self.get(label))
    }

    pub fn active_label(&self) -> Option<&str> {
        self.active.as_deref()
    }

    /// The tab an application's tools belong to, if that application is open.
    pub fn for_app(&self, app_id: &str) -> Option<&Tab> {
        self.tabs
            .iter()
            .find(|tab| tab.app_id.as_deref() == Some(app_id))
    }

    pub fn is_empty(&self) -> bool {
        self.tabs.is_empty()
    }

    pub fn len(&self) -> usize {
        self.tabs.len()
    }

    // -- moving ------------------------------------------------------------------------------

    pub fn activate(&mut self, label: &str) -> bool {
        if self.get(label).is_some() {
            self.active = Some(label.to_string());
            return true;
        }
        false
    }

    fn with(&mut self, label: &str, edit: impl FnOnce(&mut Tab)) -> bool {
        match self.tabs.iter_mut().find(|tab| tab.label == label) {
            Some(tab) => {
                edit(tab);
                true
            }
            None => false,
        }
    }

    /// The page navigated. Its registration does not survive: a new document is a new page, and
    /// tools registered by the old one must stop being addressable (README §3.3).
    pub fn navigated(&mut self, label: &str, url: impl Into<String>) -> Option<String> {
        let mut dropped = None;
        self.with(label, |tab| {
            tab.url = url.into();
            tab.title = String::new();
            tab.app_id = None;
            tab.tool_count = 0;
            dropped = tab.session_id.take();
        });
        dropped
    }

    pub fn titled(&mut self, label: &str, title: impl Into<String>) -> bool {
        self.with(label, |tab| tab.title = title.into())
    }

    /// The page registered its tools and the daemon accepted the manifest.
    pub fn registered(
        &mut self,
        label: &str,
        app_id: impl Into<String>,
        session_id: impl Into<String>,
        tool_count: usize,
    ) -> bool {
        self.with(label, |tab| {
            tab.app_id = Some(app_id.into());
            tab.session_id = Some(session_id.into());
            tab.tool_count = tool_count;
        })
    }

    /// What the lane is told about the world this turn (README §3.2 step 1).
    pub fn host_state(&self) -> serde_json::Value {
        let active = self.active();
        serde_json::json!({
            "tabs": self.tabs.iter().map(|tab| serde_json::json!({
                "app_id": tab.app_id,
                "title": tab.title,
                "url": tab.url,
                "tools": tab.tool_count,
            })).collect::<Vec<_>>(),
            "active_tab": active.map(|tab| tab.label.clone()),
            "active_app": active.and_then(|tab| tab.app_id.clone()),
            "page_title": active.map(|tab| tab.title.clone()),
            "page_url": active.map(|tab| tab.url.clone()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_tab_is_active_and_carries_a_page_label() {
        let mut tabs = Tabs::new();
        let tab = tabs.open("https://invoices.example");

        assert!(tab.label.starts_with(PAGE_PREFIX));
        assert_eq!(tabs.active_label(), Some(tab.label.as_str()));
    }

    #[test]
    fn a_label_is_never_reused_after_a_close() {
        let mut tabs = Tabs::new();
        let first = tabs.open("https://a.example");
        tabs.close(&first.label);
        let second = tabs.open("https://b.example");

        assert_ne!(first.label, second.label);
    }

    #[test]
    fn closing_the_active_tab_selects_a_neighbour() {
        let mut tabs = Tabs::new();
        let first = tabs.open("https://a.example");
        let second = tabs.open("https://b.example");
        tabs.activate(&first.label);

        tabs.close(&first.label);

        assert_eq!(tabs.active_label(), Some(second.label.as_str()));
    }

    #[test]
    fn closing_the_last_tab_leaves_nothing_active() {
        let mut tabs = Tabs::new();
        let only = tabs.open("https://a.example");
        tabs.close(&only.label);

        assert!(tabs.active().is_none());
        assert!(tabs.is_empty());
    }

    #[test]
    fn a_registered_tab_knows_its_app_and_its_session() {
        let mut tabs = Tabs::new();
        let tab = tabs.open("https://invoices.example");
        tabs.registered(&tab.label, "invoices", "sess_000000000001", 2);

        let found = tabs.for_app("invoices").expect("the application is open");
        assert!(found.registered());
        assert_eq!(found.tool_count, 2);
    }

    #[test]
    fn navigating_away_drops_the_registration_and_names_the_session_to_close() {
        let mut tabs = Tabs::new();
        let tab = tabs.open("https://invoices.example");
        tabs.registered(&tab.label, "invoices", "sess_000000000001", 2);

        let dropped = tabs.navigated(&tab.label, "https://elsewhere.example");

        assert_eq!(dropped.as_deref(), Some("sess_000000000001"));
        assert!(tabs.for_app("invoices").is_none());
        assert_eq!(tabs.get(&tab.label).unwrap().tool_count, 0);
    }

    #[test]
    fn host_state_names_the_active_application() {
        let mut tabs = Tabs::new();
        let first = tabs.open("https://invoices.example");
        tabs.registered(&first.label, "invoices", "sess_000000000001", 2);
        tabs.titled(&first.label, "Invoices");
        tabs.open("https://inbox.example");
        tabs.activate(&first.label);

        let state = tabs.host_state();

        assert_eq!(state["active_app"], "invoices");
        assert_eq!(state["page_title"], "Invoices");
        assert_eq!(state["tabs"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn activating_a_tab_that_is_not_open_changes_nothing() {
        let mut tabs = Tabs::new();
        let tab = tabs.open("https://a.example");

        assert!(!tabs.activate("page-99"));
        assert_eq!(tabs.active_label(), Some(tab.label.as_str()));
    }
}
