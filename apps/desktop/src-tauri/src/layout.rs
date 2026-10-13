//! The window's rectangles — README section 3.1 (surfaces) and 3.5, ADR 0087 and 0088.
//!
//! The window holds two kinds of child webview and no HTML container, so nothing about the
//! geometry is negotiated in CSS: this file owns every rectangle, and re-lays on resize, on every
//! tab change and on every shape change.
//!
//! **There are two shapes, and which one the window is in is what the depth stage last said.**
//!
//! ```text
//! page, with a tab focused                  scene (and a page shape with no tab)
//! ┌────────────────────────────────┐        ┌────────────────────────────────┐
//! │ chrome: the bar         (36)   │        │ chrome: the bar         (36)   │
//! │ chrome: the tab strip   (40)   │        │                                │
//! ├────────────────────────────────┤        │ chrome: the scene, full width, │
//! │                                │        │ full height                    │
//! │ page-<id>, the focused tab      │       │                                │
//! │ full width, full height        │        │                                │
//! └────────────────────────────────┘        └────────────────────────────────┘
//! ```
//!
//! One privileged webview, not two. The bar and the scene are one React tree, which is what lets
//! the app root start the app-wide stores (README section 3.5: a store a *view* starts stops being
//! true the moment the user leaves that view). The cost is that the bar has to be a band across the
//! top rather than a rail down the side — an L-shape is not a rectangle — and in the page shape the
//! chrome's first `STRIP_HEIGHT` pixels under the bar are the tab strip, because everything below
//! them is clipped away and a page webview is put there instead. `styles/app.css` spells both
//! numbers as `--bar-height` and `--strip-height`, and the stage's band is drawn to them; the two
//! files are edited together or not at all.
//!
//! **Why the two shapes and not one.** A page webview exists only while there is a focused tab.
//! With no tab to show there is nothing to put under the strip, so the chrome keeps the whole
//! window and the Apps depth, which owns that case, draws its own empty state.
//!
//! Every unfocused page is hidden rather than resized, so a background tab costs no layout.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager};

use crate::tabs::Tabs;

/// The bar. Nothing else is in this band: it exists so there is somewhere left to grab a
/// window whose decorations are off, and 36 is the shortest band a 12px label with its padding
/// and a focus ring fits in.
pub const BAR_HEIGHT: f64 = 36.0;

/// The tab strip under the bar — the only part of the chrome shown in the page shape.
pub const STRIP_HEIGHT: f64 = 40.0;

/// The chrome's height in the page shape: both bands. 76, on the 4px rhythm.
pub const CHROME_HEIGHT: f64 = BAR_HEIGHT + STRIP_HEIGHT;

/// The two shapes the window can be in (ADR 0088), spelled as the depth stage tells them. `page`
/// is `apps/<app>/page`: the chrome keeps its band and a page webview owns the rest. `scene` is
/// everything else, and the window comes up in it. `src/depth/shape.ts` spells the same two ids,
/// and a test reads this file to keep them equal.
pub const PAGE_SHAPE: &str = "page";
pub const SCENE_SHAPE: &str = "scene";

/// Which shape the window is in. Managed state, so the layout and the chrome cannot disagree.
#[derive(Debug)]
pub struct Selection {
    shape: Mutex<String>,
}

impl Default for Selection {
    fn default() -> Self {
        Self {
            shape: Mutex::new(SCENE_SHAPE.to_string()),
        }
    }
}

impl Selection {
    pub fn get(&self) -> String {
        self.shape.lock().expect("selection poisoned").clone()
    }

    pub fn set(&self, shape: &str) {
        *self.shape.lock().expect("selection poisoned") = shape.to_string();
    }

    /// Is the selection the page shape? Whether a page is then *shown* also needs a focused tab;
    /// see `apply`. Any id but `page` is the scene.
    pub fn is_page(&self) -> bool {
        self.get() == PAGE_SHAPE
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
    /// The chrome webview: the bar, plus whatever of the scene it is still showing.
    pub chrome: Rect,
    /// Everything under the bar. It belongs to the chrome webview unless a page takes it.
    pub scene_area: Rect,
    /// The focused tab's page webview, when there is one to show.
    pub page: Option<Rect>,
}

/// The arithmetic, with no window in it — which is what makes it testable (see the tests below).
///
/// `page_shown` is "the page shape is selected **and** a tab is focused". Both halves matter:
/// selecting it with nothing open must not blank the window.
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
        scene_area: Rect {
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
/// of what it decides, and it is called on resize, on every tab change and on every shape change.
pub fn apply(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };

    let tabs = app.state::<Tabs>();
    let page_shown = app.state::<Selection>().is_page() && tabs.focused().is_some();
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
            // Hidden, not resized: a background tab costs no layout, and in the scene shape
            // the focused page is hidden by the same mechanism rather than a new one.
            _ => {
                let _ = webview.hide();
            }
        }
    }
}

/// Select a shape: remember it, re-lay, and announce it. The chrome sets it, and the chrome also
/// hears it back — the round trip is what keeps one fact in one place.
pub fn select(app: &AppHandle, shape: &str) {
    app.state::<Selection>().set(shape);
    apply(app);
    // Announced as the shape it is: an id that is not `page` is the scene, so a window that mirrors
    // the selection never has to know which ids mean which.
    let shape = if app.state::<Selection>().is_page() {
        PAGE_SHAPE
    } else {
        SCENE_SHAPE
    };
    crate::ui_emit(app, "layout:changed", serde_json::json!({ "shape": shape }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_takes_everything_under_the_chrome_and_leaves_no_gap() {
        let r = rects(1440.0, 900.0, true);
        assert_eq!(r.chrome.height, CHROME_HEIGHT);
        let page = r.page.expect("the page shape with a tab has a page rect");
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
            r.scene_area.y, BAR_HEIGHT,
            "the scene still starts under the bar"
        );
        assert_eq!(r.scene_area.y + r.scene_area.height, 900.0);
    }

    /// A window dragged shorter than the chrome itself. Every rectangle stays positive, because a
    /// zero or negative size is what makes a webview vanish and never come back.
    #[test]
    fn a_window_shorter_than_its_own_chrome_still_produces_real_rectangles() {
        for height in [1.0, 20.0, 50.0, 76.0] {
            let r = rects(300.0, height, true);
            assert!(r.chrome.height >= 1.0 && r.chrome.height <= height);
            let page = r.page.expect("the page shape still has a page rect");
            assert!(page.height >= 1.0, "height {height} produced {page:?}");
            assert!(r.scene_area.height >= 1.0);
        }
    }

    #[test]
    fn the_selection_starts_as_the_scene_and_is_whatever_the_chrome_last_said() {
        let selection = Selection::default();
        assert_eq!(selection.get(), SCENE_SHAPE);
        assert!(!selection.is_page(), "the window comes up with the scene owning it");

        selection.set(PAGE_SHAPE);
        assert_eq!(selection.get(), PAGE_SHAPE);
        assert!(selection.is_page());
    }

    /// ADR 0088: the depth stage names the shape, and `page` is the one that lets a page show. Any
    /// other id, including the old module ids, is the scene.
    #[test]
    fn the_page_shape_shows_a_page_and_every_other_id_is_the_scene() {
        let selection = Selection::default();
        selection.set(PAGE_SHAPE);
        assert!(selection.is_page());
        selection.set(SCENE_SHAPE);
        assert!(!selection.is_page(), "the scene owns the window");
        for other in ["browser", "settings", "anything"] {
            selection.set(other);
            assert!(!selection.is_page(), "{other} is not the page shape");
        }
    }

    #[test]
    fn the_two_shape_ids_are_distinct() {
        assert_ne!(PAGE_SHAPE, SCENE_SHAPE);
    }
}
