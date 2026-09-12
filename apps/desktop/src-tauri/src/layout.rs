//! Where the panel is and where a page goes (README §3.5: a module-first window).
//!
//! One window, two regions. The panel is a fixed column on the right and every page webview fills
//! what is left. The numbers live here rather than in the code that resizes things, because the
//! first build had the column width written in four places and they disagreed by two pixels after
//! every change.
//!
//! The panel is 380 px wide, which is the width README §3.5 names — and the reason the modules are
//! a bar rather than seven stacked surfaces is that seven surfaces do not fit in it.

use tauri::{LogicalPosition, LogicalSize};

/// The panel column, in logical pixels.
pub const PANEL_WIDTH: f64 = 380.0;

/// The smallest window that still shows a page beside the panel.
pub const MIN_WIDTH: f64 = PANEL_WIDTH + 640.0;
pub const MIN_HEIGHT: f64 = 600.0;

/// There is no chrome strip above the page, and that is a design decision rather than an omission.
///
/// README §3.5 makes the browser *one module among them* in the panel: the address line and the
/// tab row are the Pages module, inside the 380 px column. A second strip across the top would be
/// a second place the same two controls live, and the page would lose the height for nothing.
pub const CHROME_HEIGHT: f64 = 0.0;

/// A rectangle in logical pixels, which is what a webview's position and size are set in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn position(&self) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x, self.y)
    }

    pub fn size(&self) -> LogicalSize<f64> {
        LogicalSize::new(self.width, self.height)
    }
}

/// Both regions for a window of this inner size.
///
/// Clamped rather than allowed to go negative: a webview given a negative size is a crash on one
/// platform and a silently invisible webview on another, and the window can be dragged narrower
/// than its own minimum on a display-scale change.
pub fn split(window_width: f64, window_height: f64) -> (Rect, Rect) {
    let width = window_width.max(MIN_WIDTH);
    let height = window_height.max(MIN_HEIGHT);
    let page = Rect {
        x: 0.0,
        y: CHROME_HEIGHT,
        width: (width - PANEL_WIDTH).max(1.0),
        height: (height - CHROME_HEIGHT).max(1.0),
    };
    let panel = Rect {
        x: width - PANEL_WIDTH,
        y: 0.0,
        width: PANEL_WIDTH,
        height,
    };
    (page, panel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_panel_keeps_its_column_and_the_page_takes_the_rest() {
        let (page, panel) = split(1440.0, 900.0);

        assert_eq!(panel.width, PANEL_WIDTH);
        assert_eq!(panel.x, 1440.0 - PANEL_WIDTH);
        assert_eq!(page.width, 1440.0 - PANEL_WIDTH);
        assert_eq!(page.y, CHROME_HEIGHT);
        assert_eq!(page.height, 900.0 - CHROME_HEIGHT);
    }

    #[test]
    fn the_page_and_the_panel_together_cover_the_whole_window() {
        // Any gap is a strip of nothing on screen, which reads as a rendering fault rather than
        // as empty space — the first launch showed exactly that.
        let (page, panel) = split(1440.0, 900.0);

        assert_eq!(page.x, 0.0);
        assert_eq!(page.y, 0.0);
        assert_eq!(page.height, 900.0);
        assert_eq!(page.width + panel.width, 1440.0);
    }

    #[test]
    fn a_window_narrower_than_the_minimum_never_yields_a_negative_page() {
        let (page, panel) = split(100.0, 100.0);

        assert!(page.width >= 1.0);
        assert!(page.height >= 1.0);
        assert_eq!(panel.width, PANEL_WIDTH);
    }

    #[test]
    fn the_two_regions_do_not_overlap() {
        let (page, panel) = split(1600.0, 1000.0);

        assert!(page.x + page.width <= panel.x);
    }
}
