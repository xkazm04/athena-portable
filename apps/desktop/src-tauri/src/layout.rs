//! The window's rectangles — README section 3.1 (surfaces) and 3.5 (module-first window).
//!
//! The window holds two kinds of child webview and no HTML container, so nothing about the
//! geometry is negotiated in CSS: this file owns every rectangle, and re-lays on resize, on every
//! tab change and on every module change.
//!
//! **There are two shapes, and which one the window is in is the selected module.**
//!
//! ```text
//! Browser, with a tab open                  every other module (and Browser with no tab)
//! ┌────────────────────────────────┐        ┌────────────────────────────────┐
//! │ chrome: module bar      (36)   │        │ chrome: module bar      (36)   │
//! │ chrome: the tab strip   (40)   │        │                                │
//! ├────────────────────────────────┤        │ chrome: the selected module,   │
//! │                                │        │ full width, full height        │
//! │ page-<id>, the focused tab      │       │                                │
//! │ full width, full height        │        │                                │
//! └────────────────────────────────┘        └────────────────────────────────┘
//! ```
//!
//! One privileged webview, not two. The module bar and the module are one React tree, which is
//! what lets the app root start the app-wide stores (README section 3.5: a store a *view* starts
//! stops being true the moment the user leaves that view). The cost is that the bar has to be a
//! band across the top rather than a rail down the side — an L-shape is not a rectangle — and the
//! Browser module's first `STRIP_HEIGHT` pixels have to be its tab strip, because in browser mode
//! everything below them is clipped away and a page webview is put there instead. `styles/app.css`
//! spells both numbers as `--bar-height` and `--strip-height` and carries this sentence too; the
//! two files are edited together or not at all.
//!
//! **Why the two shapes and not one.** A page webview exists only while there is a focused tab.
//! With no tab open there is nothing to put under the strip, so the chrome keeps the whole window
//! and the Browser module renders its own empty state — which is the only way that empty state is
//! ever seen.
//!
//! Every unfocused page is hidden rather than resized, so a background tab costs no layout.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager};

use crate::tabs::Tabs;

/// The module bar. Nothing else is in this band: it exists so there is somewhere left to grab a
/// window whose decorations are off, and 36 is the shortest band a 12px label with its padding
/// and a focus ring fits in.
pub const BAR_HEIGHT: f64 = 36.0;

/// The Browser module's tab strip — the only part of a module the chrome shows in browser mode.
pub const STRIP_HEIGHT: f64 = 40.0;

/// The chrome's height in browser mode: both bands. 76, on the 4px rhythm.
pub const CHROME_HEIGHT: f64 = BAR_HEIGHT + STRIP_HEIGHT;

/// The module the window comes up on. `registry.ts` spells the same id as `DEFAULT_MODULE_ID`.
pub const DEFAULT_MODULE: &str = "browser";

/// The one module id Rust knows, because the rectangles depend on it. Every other id is a string
/// this file passes through untouched — adding a module is a TypeScript change, not a Rust one.
pub const BROWSER_MODULE: &str = "browser";

/// Which module is showing. Managed state, so the layout and the chrome cannot disagree.
#[derive(Debug)]
pub struct Selection {
    module: Mutex<String>,
}

impl Default for Selection {
    fn default() -> Self {
        Self {
            module: Mutex::new(DEFAULT_MODULE.to_string()),
        }
    }
}

impl Selection {
    pub fn get(&self) -> String {
        self.module.lock().expect("selection poisoned").clone()
    }

    pub fn set(&self, module: &str) {
        *self.module.lock().expect("selection poisoned") = module.to_string();
    }

    pub fn is_browser(&self) -> bool {
        self.get() == BROWSER_MODULE
    }
}

/// One rectangle, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The three rectangles the window is made of.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Rects {
    /// The chrome webview: the bar, plus whatever of the module it is still showing.
    pub chrome: Rect,
    /// Everything under the bar. It belongs to the chrome webview unless a page takes it.
    pub module_area: Rect,
    /// The focused tab's page webview, when there is one to show.
    pub page: Option<Rect>,
}

/// The arithmetic, with no window in it — which is what makes it testable (see the tests below).
///
/// `page_shown` is "the Browser module is selected **and** a tab is focused". Both halves matter:
/// selecting Browser with nothing open must not blank the window.
pub fn rects(width: f64, height: f64, page_shown: bool) -> Rects {
    let width = width.max(1.0);
    let height = height.max(1.0);
    let chrome_height = if page_shown {
        CHROME_HEIGHT.min(height)
    } else {
        height
    };
    Rects {
        chrome: Rect {
            x: 0.0,
            y: 0.0,
            width,
            height: chrome_height,
        },
        module_area: Rect {
            x: 0.0,
            y: BAR_HEIGHT.min(height),
            width,
            height: (height - BAR_HEIGHT).max(1.0),
        },
        page: page_shown.then(|| Rect {
            x: 0.0,
            y: CHROME_HEIGHT.min(height),
            width,
            height: (height - CHROME_HEIGHT).max(1.0),
        }),
    }
}

/// Re-lay the window. Cheap and idempotent: "which webview is visible, and how big" is the whole
/// of what it decides, and it is called on resize, on every tab change and on every module change.
pub fn apply(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };

    let tabs = app.state::<Tabs>();
    let page_shown = app.state::<Selection>().is_browser() && tabs.focused().is_some();
    let r = rects(
        size.width as f64 / scale,
        size.height as f64 / scale,
        page_shown,
    );

    if let Some(chrome) = app.get_webview(crate::CHROME_WEBVIEW) {
        let _ = chrome.set_position(LogicalPosition::new(r.chrome.x, r.chrome.y));
        let _ = chrome.set_size(LogicalSize::new(r.chrome.width, r.chrome.height));
    }

    for (label, focused) in tabs.labels_with_focus() {
        let Some(webview) = app.get_webview(&label) else {
            continue;
        };
        match (focused, r.page) {
            (true, Some(page)) => {
                let _ = webview.set_position(LogicalPosition::new(page.x, page.y));
                let _ = webview.set_size(LogicalSize::new(page.width, page.height));
                let _ = webview.show();
            }
            // Hidden, not resized: a background tab costs no layout, and in every other module
            // the focused page is hidden by the same mechanism rather than a new one.
            _ => {
                let _ = webview.hide();
            }
        }
    }
}

/// Select a module: remember it, re-lay, and announce it. The chrome sets it, and the chrome also
/// hears it back — the round trip is what keeps one fact in one place.
pub fn select(app: &AppHandle, module: &str) {
    app.state::<Selection>().set(module);
    apply(app);
    crate::ui_emit(app, "layout:changed", serde_json::json!({ "module": module }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_takes_everything_under_the_chrome_and_leaves_no_gap() {
        let r = rects(1440.0, 900.0, true);
        assert_eq!(r.chrome.height, CHROME_HEIGHT);
        let page = r.page.expect("browser mode with a tab has a page rect");
        assert_eq!(page.y, r.chrome.height, "the page starts where the chrome ends");
        assert_eq!(
            page.y + page.height,
            900.0,
            "and it reaches the bottom of the window"
        );
        assert_eq!(page.width, 1440.0);
    }

    #[test]
    fn without_a_page_the_chrome_is_the_whole_window() {
        let r = rects(1440.0, 900.0, false);
        assert_eq!(r.chrome.height, 900.0);
        assert!(r.page.is_none(), "no page webview is positioned");
        assert_eq!(
            r.module_area.y, BAR_HEIGHT,
            "the module still starts under the bar"
        );
        assert_eq!(r.module_area.y + r.module_area.height, 900.0);
    }

    /// A window dragged shorter than the chrome itself. Every rectangle stays positive, because a
    /// zero or negative size is what makes a webview vanish and never come back.
    #[test]
    fn a_window_shorter_than_its_own_chrome_still_produces_real_rectangles() {
        for height in [1.0, 20.0, 50.0, 76.0] {
            let r = rects(300.0, height, true);
            assert!(r.chrome.height >= 1.0 && r.chrome.height <= height);
            let page = r.page.expect("browser mode still has a page rect");
            assert!(page.height >= 1.0, "height {height} produced {page:?}");
            assert!(r.module_area.height >= 1.0);
        }
    }

    #[test]
    fn the_selection_starts_on_the_browser_and_is_whatever_the_chrome_last_said() {
        let selection = Selection::default();
        assert_eq!(selection.get(), DEFAULT_MODULE);
        assert!(selection.is_browser());

        selection.set("settings");
        assert_eq!(selection.get(), "settings");
        assert!(
            !selection.is_browser(),
            "an id Rust has never heard of is still not the browser"
        );
    }
}
