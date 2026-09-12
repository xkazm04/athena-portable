//! Tabs — README section 3.1, the browsing surface.
//!
//! One page webview per tab, labelled `page-<id>`, **all sharing one browsing profile**: the same
//! `data_directory` goes to every one of them, so a login in one tab is a login in all of them.
//! That is a deliberate choice and not an accident of the API — per-project browsing profiles are
//! a declared non-goal, and a demo that logs into an app once and then opens a second tab on it
//! is the reason.
//!
//! Tab state lives here and the Zustand store mirrors it off `tabs:changed`. Nothing in the UI is
//! authoritative: every mutation is a command, and the whole list comes back on the event. One
//! event carrying the whole list rather than a diff — the list is short, and a diff is a bug
//! surface a tab strip does not need.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, Url, WebviewUrl};

use crate::layout;

/// A tab, as the chrome webview sees it. `lib/ipc.ts` declares the same shape in TypeScript.
#[derive(Clone, Debug, Serialize)]
pub struct Tab {
    pub id: u32,
    /// The webview label, `page-<id>`. The UI needs it for nothing; a bug report that names the
    /// webview is worth the eight bytes.
    pub label: String,
    pub url: String,
    pub title: String,
    pub focused: bool,
}

#[derive(Debug)]
struct TabRecord {
    id: u32,
    url: String,
    title: String,
}

#[derive(Default)]
pub struct Tabs {
    inner: Mutex<TabsState>,
}

#[derive(Default)]
struct TabsState {
    next_id: u32,
    focused: Option<u32>,
    list: Vec<TabRecord>,
}

pub fn label_for(id: u32) -> String {
    format!("page-{id}")
}

impl Tabs {
    pub fn list(&self) -> Vec<Tab> {
        let state = self.inner.lock().expect("tabs poisoned");
        state
            .list
            .iter()
            .map(|t| Tab {
                id: t.id,
                label: label_for(t.id),
                url: t.url.clone(),
                title: t.title.clone(),
                focused: state.focused == Some(t.id),
            })
            .collect()
    }

    /// The focused tab's id, if any. `layout::apply` asks this to decide whether there is a page
    /// to show at all.
    pub fn focused(&self) -> Option<u32> {
        let state = self.inner.lock().expect("tabs poisoned");
        state.focused
    }

    /// Where one tab currently is. `None` when there is no such tab.
    ///
    /// The list already carries it, but a caller that wants one url should not have to clone the
    /// whole list and search it — and a capture (c24) wants exactly one, to record which origin
    /// the picture is of.
    pub fn url_for(&self, id: u32) -> Option<String> {
        let state = self.inner.lock().expect("tabs poisoned");
        state
            .list
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.url.clone())
    }

    pub fn labels_with_focus(&self) -> Vec<(String, bool)> {
        let state = self.inner.lock().expect("tabs poisoned");
        state
            .list
            .iter()
            .map(|t| (label_for(t.id), state.focused == Some(t.id)))
            .collect()
    }

    fn add(&self, url: &str) -> u32 {
        let mut state = self.inner.lock().expect("tabs poisoned");
        state.next_id += 1;
        let id = state.next_id;
        state.list.push(TabRecord {
            id,
            url: url.to_string(),
            title: String::new(),
        });
        state.focused = Some(id);
        id
    }

    fn remove(&self, id: u32) {
        let mut state = self.inner.lock().expect("tabs poisoned");
        state.list.retain(|t| t.id != id);
        if state.focused == Some(id) {
            state.focused = state.list.last().map(|t| t.id);
        }
    }

    fn focus(&self, id: u32) -> bool {
        let mut state = self.inner.lock().expect("tabs poisoned");
        if state.list.iter().any(|t| t.id == id) {
            state.focused = Some(id);
            true
        } else {
            false
        }
    }

    /// Keep the record current as the page navigates itself. It is what makes the address field
    /// show where a tab really is, and later what makes "is this still the document we asked?"
    /// answerable (c19).
    pub fn set_url(&self, id: u32, url: &str) {
        let mut state = self.inner.lock().expect("tabs poisoned");
        if let Some(tab) = state.list.iter_mut().find(|t| t.id == id) {
            tab.url = url.to_string();
        }
    }

    pub fn set_title(&self, id: u32, title: &str) {
        let mut state = self.inner.lock().expect("tabs poisoned");
        if let Some(tab) = state.list.iter_mut().find(|t| t.id == id) {
            tab.title = title.to_string();
        }
    }
}

/// `scheme://host[:port]` for a tab's url, or an empty string when it has none yet.
///
/// The one identity the whole build keys trust on: the `origins` table, the bridge's nonce, and
/// README section 3.3's rule that an application is one origin and a second origin claiming its
/// name is refused. A capture records it so a picture can be said to be *of* somewhere.
///
/// An unparseable or opaque url answers with an empty string rather than with the url. A row that
/// held `about:blank` in the origin column would read as an origin, and the empty string cannot
/// be mistaken for one.
pub fn origin_of(url: &str) -> String {
    match Url::parse(url) {
        Ok(parsed) if parsed.has_host() => parsed.origin().ascii_serialization(),
        _ => String::new(),
    }
}

/// Announce the whole tab list to the privileged webview.
pub fn announce(app: &AppHandle) {
    let list = app.state::<Tabs>().list();
    crate::ui_emit(app, "tabs:changed", list);
}

/// Create a page webview for `url`, focus it, and re-lay the window.
pub fn create(app: &AppHandle, url: &str) -> Result<u32, String> {
    let parsed = Url::parse(url).map_err(|e| format!("bad url {url}: {e}"))?;
    let window = app
        .get_window(crate::MAIN_WINDOW)
        .ok_or_else(|| "the main window is gone".to_string())?;

    // `add` focuses the new tab before its webview exists, so a failure below would leave a
    // focused record with nothing to render — and `layout::apply` hides every page webview that
    // is not the focused one, which blanks the whole browsing area. Remember who had focus, so
    // the error path can put the window back exactly as it was.
    let previous = app.state::<Tabs>().focused();
    let id = app.state::<Tabs>().add(parsed.as_str());
    let label = label_for(id);

    let app_for_nav = app.clone();
    let app_for_title = app.clone();
    // The relay's two scripts (c19, ADR 0014), in the order they have to run: `inject.js` first,
    // at document start, so it reaches `document.modelContext` before the application's own
    // scripts do, then the forwarder that carries its answers back to Rust. A navigation re-runs
    // both, which is what makes a page that replaced itself a page with a working bridge.
    let (inject, relay) = crate::bridge::scripts(app, id);

    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .initialization_script(inject)
        .initialization_script(relay)
        // The hands, after the relay that carries their answers out. Order matters only in that
        // all three run before the page's own scripts, which is what `initialization_script`
        // promises (README section 3.4 tier 2).
        .initialization_script(crate::hands_script())
        // One profile for every tab: passing the same directory to each webview is what makes a
        // login in one tab a login in the next.
        .data_directory(profile_dir(app))
        // **`window.open` is allowed, and this line is README section 9's first risk row.**
        //
        // Measured in this shell on 2026-09-12 before the line existed: a page calling
        // `window.open` was answered with `null` — both from a timer and from a real mouse click
        // on a button, i.e. *with* user activation. Tauri v2's default for a new-window request
        // is to deny it, so every OAuth "Sign in with…" popup in the world would have failed
        // silently in this browser, and the first place that would have shown up is a demo.
        //
        // `Allow` hands the request to WebView2's own default: it opens the popup as a plain
        // WebView2 window in the *same environment*, which is what makes the login it performs a
        // login in the shared browsing profile above. That window is not a Tauri webview at all
        // — no IPC, no capability, no command — so allowing it widens what a page can display
        // and not what it can reach.
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Allow)
        .on_navigation(move |url| {
            app_for_nav.state::<Tabs>().set_url(id, url.as_str());
            announce(&app_for_nav);
            true
        })
        .on_document_title_changed(move |_, title| {
            app_for_title.state::<Tabs>().set_title(id, &title);
            announce(&app_for_title);
        });

    // Built at the rectangle it is about to be given anyway; `layout::apply` below is what makes
    // the first frame right.
    if let Err(e) = window.add_child(
        builder,
        tauri::LogicalPosition::new(0.0, layout::CHROME_HEIGHT),
        tauri::LogicalSize::new(800.0, 600.0),
    ) {
        // Undo the registration, or the strip lists a tab that cannot render and nothing on
        // screen says why.
        app.state::<Tabs>().remove(id);
        if let Some(previous) = previous {
            app.state::<Tabs>().focus(previous);
        }
        layout::apply(app);
        announce(app);
        return Err(format!("cannot open a page webview: {e}"));
    }

    layout::apply(app);
    announce(app);
    Ok(id)
}

pub fn close(app: &AppHandle, id: u32) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label_for(id)) {
        let _ = webview.close();
    }
    app.state::<Tabs>().remove(id);
    layout::apply(app);
    announce(app);
    Ok(())
}

pub fn focus(app: &AppHandle, id: u32) -> Result<(), String> {
    if !app.state::<Tabs>().focus(id) {
        return Err(format!("no tab {id}"));
    }
    layout::apply(app);
    announce(app);
    Ok(())
}

pub fn navigate(app: &AppHandle, id: u32, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|e| format!("bad url {url}: {e}"))?;
    let webview = app
        .get_webview(&label_for(id))
        .ok_or_else(|| format!("no tab {id}"))?;
    webview.navigate(parsed.clone()).map_err(|e| e.to_string())?;
    app.state::<Tabs>().set_url(id, parsed.as_str());
    announce(app);
    Ok(())
}

/// The shared browsing profile. Under app data, so it survives an update and can be removed by
/// hand when a login has to go.
fn profile_dir(app: &AppHandle) -> std::path::PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let dir = base.join("browsing-profile");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_focuses_the_new_tab_and_closing_falls_back_to_another() {
        let tabs = Tabs::default();
        let first = tabs.add("https://a.test/");
        let second = tabs.add("https://b.test/");
        assert_eq!(tabs.focused(), Some(second));

        tabs.remove(second);
        assert_eq!(tabs.focused(), Some(first), "focus falls back to what is left");

        tabs.remove(first);
        assert_eq!(tabs.focused(), None, "and to nothing when nothing is left");
        assert!(tabs.list().is_empty());
    }

    /// The rollback `create` performs when `add_child` fails. `remove` alone is not enough: it
    /// re-points focus at the last tab in the list, which is not the tab that had it.
    #[test]
    fn a_rolled_back_create_restores_the_previous_focus() {
        let tabs = Tabs::default();
        let first = tabs.add("https://a.test/");
        let _second = tabs.add("https://b.test/");
        tabs.focus(first);

        let previous = tabs.focused();
        let phantom = tabs.add("https://c.test/");
        assert_eq!(tabs.focused(), Some(phantom));

        // What the error path does.
        tabs.remove(phantom);
        if let Some(previous) = previous {
            tabs.focus(previous);
        }

        let list = tabs.list();
        assert_eq!(list.len(), 2, "the phantom record is gone");
        assert!(list.iter().all(|t| t.id != phantom));
        assert_eq!(
            list.iter().find(|t| t.focused).map(|t| t.id),
            Some(first),
            "focus is back where it was, not on the last tab in the list"
        );
    }

    #[test]
    fn one_tabs_url_can_be_asked_for_without_reading_the_whole_list() {
        let tabs = Tabs::default();
        let id = tabs.add("https://a.test/one");
        tabs.add("https://b.test/two");

        assert_eq!(tabs.url_for(id).as_deref(), Some("https://a.test/one"));
        assert_eq!(tabs.url_for(9_999), None, "no such tab is not an empty url");

        tabs.set_url(id, "https://a.test/elsewhere");
        assert_eq!(
            tabs.url_for(id).as_deref(),
            Some("https://a.test/elsewhere"),
            "it follows the page rather than the address it was opened at"
        );
    }

    #[test]
    fn an_origin_is_scheme_host_and_port_and_nothing_else() {
        // The identity every trust decision is keyed on: the `origins` table, the bridge's nonce,
        // and a capture's own row.
        assert_eq!(origin_of("https://a.test/path?q=1#frag"), "https://a.test");
        assert_eq!(origin_of("http://a.test:3001/x"), "http://a.test:3001");
        assert_eq!(
            origin_of("https://a.test:443/x"),
            "https://a.test",
            "the default port is not part of the name"
        );
        assert_ne!(
            origin_of("https://a.test/"),
            origin_of("https://b.test/"),
            "two hosts are two applications"
        );
    }

    #[test]
    fn a_url_with_no_host_has_no_origin_rather_than_a_made_up_one() {
        // An opaque url in the origin column would read as an origin. The empty string cannot be
        // mistaken for one, which is the point.
        let none = |url: &str| assert_eq!(origin_of(url), "", "{url} is not an origin");
        none("about:blank");
        none("data:text/html,<p>hi");
        none("not a url at all");
        none("");
    }

    #[test]
    fn a_tab_carries_its_own_label_and_whatever_the_page_last_called_itself() {
        let tabs = Tabs::default();
        let id = tabs.add("https://a.test/");
        tabs.set_title(id, "A page");
        tabs.set_url(id, "https://a.test/elsewhere");

        let tab = tabs.list().remove(0);
        assert_eq!(tab.label, format!("page-{id}"));
        assert_eq!(tab.title, "A page");
        assert_eq!(tab.url, "https://a.test/elsewhere");
        assert!(tab.focused);
    }
}
