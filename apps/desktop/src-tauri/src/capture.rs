//! The screenshot behind a gated proposal — README section 3.4 tier 2, plan c24.
//!
//! README section 5 puts "the screenshot on a gated proposal" on the never-cut list, and the
//! reason is the card: a person asked to approve `page_click` on a ref cannot judge it from the
//! ref. What they can judge is the page. So before a gated hand is proposed the shell captures the
//! focused page, the capture goes in the store, and the approval carries its id.
//!
//! **Why the window and not the webview.** Neither Tauri nor `wry` exposes a webview capture, and
//! WebView2's own `CapturePreview` is not reachable through either. What is reachable is the OS,
//! so the window is captured and cropped to the rectangle `layout` already owns. That rectangle is
//! the page and nothing else, which is what the card wants anyway — the panel beside it would only
//! be Athena showing the user her own words back.
//!
//! **`PrintWindow`, not a screen grab.** A screen grab captures whatever is in front, so a card
//! filed while the user had a mail client over the window would carry a picture of the mail client.
//! `PrintWindow` with `PW_RENDERFULLCONTENT` asks the window to draw itself, occluded or not, and
//! that flag is what makes it work for a window whose content is a hardware-composited webview.
//!
//! Windows only, and that is stated rather than hidden: `capture` returns a refusal naming the
//! platform elsewhere, so a card on a Mac is a card with no picture rather than a call that panics.

use crate::layout;

/// What one capture is, before it reaches the store.
pub struct Shot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Encode top-down RGBA into a PNG. The one image format the captures table holds.
pub fn encode(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        // Default compression: a capture is written once and read by a person, so the cheapest
        // thing to optimise is the wall-clock cost of filing a card.
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// BGRA as Windows hands it back, to the RGBA the encoder wants. Alpha is forced opaque.
///
/// `PrintWindow` leaves the alpha channel undefined for most controls, so a faithful copy of it
/// produces a card that is mostly transparent — which renders as a chequerboard or as nothing at
/// all depending on who opens it. A screenshot has no transparency to preserve.
pub fn bgra_to_rgba(bgra: &[u8]) -> Vec<u8> {
    let mut rgba = Vec::with_capacity(bgra.len());
    for pixel in bgra.chunks_exact(4) {
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 0xFF]);
    }
    rgba
}

/// Crop a top-down RGBA image. Returns `None` when the rectangle is not wholly inside.
pub fn crop(
    rgba: &[u8],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Option<Vec<u8>> {
    if w == 0 || h == 0 || x + w > width || y + h > height {
        return None;
    }
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in y..y + h {
        let start = ((row * width + x) * 4) as usize;
        out.extend_from_slice(&rgba[start..start + (w * 4) as usize]);
    }
    Some(out)
}

/// The page's rectangle in *physical* pixels, measured from the top-left of the **window**.
///
/// Two conversions, and the second one is the one that is easy to miss.
///
/// `layout` works in logical pixels because that is what a webview's position is set in, and a
/// bitmap has no idea what a logical pixel is — so every figure is multiplied by the scale factor
/// here rather than in two callers.
///
/// And `layout`'s rectangles are measured inside the *client* area, while `PrintWindow` draws the
/// whole window, frame included. On Windows 11 that frame is a couple of logical pixels, which is
/// exactly small enough to look like a slightly wrong picture rather than an obviously wrong one:
/// the first run of the smoke came back with a black band down the left edge. `inset` closes it —
/// the client area's offset within the window, which the caller reads off the window itself.
pub fn page_rect_physical(
    width: f64,
    height: f64,
    scale: f64,
    page_shown: bool,
    inset: (i32, i32),
) -> Option<(u32, u32, u32, u32)> {
    // `None` when no page is showing: in any module but Browser the main area is the panel, and a
    // picture of Athena's own words is not evidence about anything.
    let rect = layout::rects(width, height, page_shown).page?;
    let (inset_x, inset_y) = (f64::from(inset.0.max(0)), f64::from(inset.1.max(0)));
    Some((
        (rect.x * scale + inset_x).round().max(0.0) as u32,
        (rect.y * scale + inset_y).round().max(0.0) as u32,
        (rect.width * scale).round().max(1.0) as u32,
        (rect.height * scale).round().max(1.0) as u32,
    ))
}

#[cfg(windows)]
pub use windows_capture::capture;

#[cfg(not(windows))]
pub fn capture(_app: &tauri::AppHandle) -> Result<Shot, String> {
    Err("a capture is implemented on Windows only".to_string())
}

#[cfg(windows)]
mod windows_capture {
    use super::{bgra_to_rgba, crop, encode, page_rect_physical, Shot};

    use crate::layout::Selection;
    use crate::tabs::Tabs;
    use tauri::{Manager, Window};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    };
    use windows_sys::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};

    /// Draw the whole window, composited children included.
    ///
    /// Spelled here because `windows-sys` exports `PW_CLIENTONLY` and not this one. It is the flag
    /// that makes the call work at all for a window whose content is a hardware-composited
    /// webview: without it the page comes back blank and the card carries a picture of nothing.
    const PW_RENDERFULLCONTENT: PRINT_WINDOW_FLAGS = 2;

    /// Capture the focused page of the main window.
    pub fn capture(app: &tauri::AppHandle) -> Result<Shot, String> {
        // `get_window`, not `get_webview_window`: the shell's window is built with
        // `WindowBuilder` and its content is child webviews (ADR 0013's module-first window), so
        // it is not a webview window and the other accessor answers `None` for it.
        let window: Window = app
            .get_window(crate::MAIN_WINDOW)
            .ok_or("the window is gone")?;
        // `hwnd()` answers with the `windows` crate's newtype; this crate speaks `windows-sys`,
        // where the same handle is a bare pointer.
        let hwnd: HWND = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
        let scale = window.scale_factor().unwrap_or(1.0);

        // The bitmap is the size of the whole window, because that is what `PrintWindow` draws
        // into it. The rectangles come from the client area, so the difference between the two
        // origins is the offset every one of them needs.
        let outer = window.outer_size().map_err(|e| e.to_string())?;
        let client = window.inner_size().map_err(|e| e.to_string())?;
        let inset = match (window.inner_position(), window.outer_position()) {
            (Ok(inner), Ok(whole)) => (inner.x - whole.x, inner.y - whole.y),
            // A window that will not say where it is gets no offset rather than no picture: the
            // crop is then a frame's width out, which is a slightly wrong picture and is still
            // better evidence than none.
            _ => (0, 0),
        };

        // Asked before the bitmap is drawn, so a call with nothing to photograph costs nothing.
        // `layout` shows a page only in the Browser module and only with a tab focused; in any
        // other module the main area is the panel, and a picture of Athena's own words is not
        // evidence about the thing being approved.
        let page_shown =
            app.state::<Selection>().is_browser() && app.state::<Tabs>().focused().is_some();
        let (x, y, w, h) = page_rect_physical(
            client.width as f64 / scale,
            client.height as f64 / scale,
            scale,
            page_shown,
            inset,
        )
        .ok_or("no page is on screen to capture")?;

        let shot = window_bitmap(hwnd, outer.width, outer.height)?;
        // A page larger than the window it is in cannot happen, but a rounding error at a
        // fractional scale factor can put the rectangle one pixel outside — in which case the
        // whole window is a worse picture than none, so it is the whole window.
        let (pixels, width, height) = match crop(&shot, outer.width, outer.height, x, y, w, h) {
            Some(cropped) => (cropped, w, h),
            None => (shot, outer.width, outer.height),
        };
        Ok(Shot {
            png: encode(&pixels, width, height)?,
            width,
            height,
        })
    }

    /// `PrintWindow` into a top-down 32-bit DIB, returned as RGBA.
    fn window_bitmap(hwnd: HWND, width: u32, height: u32) -> Result<Vec<u8>, String> {
        if width == 0 || height == 0 {
            return Err("the window has no size".to_string());
        }
        // SAFETY: every handle created below is released on every path out, including the error
        // paths, and none of them escapes this function. The DIB's pixel buffer is owned by the
        // bitmap and is read only while the bitmap is alive.
        unsafe {
            let screen: HDC = GetDC(std::ptr::null_mut());
            if screen.is_null() {
                return Err("no screen device context".to_string());
            }
            let memory: HDC = CreateCompatibleDC(screen);
            if memory.is_null() {
                ReleaseDC(std::ptr::null_mut(), screen);
                return Err("no memory device context".to_string());
            }

            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                // Negative: a top-down bitmap, so row 0 is the top and no flip is needed.
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            };

            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bitmap: HBITMAP = CreateDIBSection(
                memory,
                &info,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            let finish = |bitmap: HBITMAP, memory: HDC, screen: HDC| {
                if !bitmap.is_null() {
                    DeleteObject(bitmap as _);
                }
                DeleteDC(memory);
                ReleaseDC(std::ptr::null_mut(), screen);
            };
            if bitmap.is_null() || bits.is_null() {
                finish(bitmap, memory, screen);
                return Err("could not allocate the capture bitmap".to_string());
            }

            let previous = SelectObject(memory, bitmap as _);
            let drawn = PrintWindow(hwnd, memory, PW_RENDERFULLCONTENT);
            SelectObject(memory, previous);
            if drawn == 0 {
                finish(bitmap, memory, screen);
                return Err("the window refused to draw itself".to_string());
            }

            let count = (width as usize) * (height as usize) * 4;
            let bgra = std::slice::from_raw_parts(bits as *const u8, count).to_vec();
            finish(bitmap, memory, screen);
            Ok(bgra_to_rgba(&bgra))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        rgba.iter()
            .copied()
            .cycle()
            .take((width * height * 4) as usize)
            .collect()
    }

    #[test]
    fn a_png_is_encoded_with_its_signature() {
        let png = encode(&solid(4, 3, [1, 2, 3, 255]), 4, 3).expect("an encodable image");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn bgra_becomes_rgba_and_alpha_is_forced_opaque() {
        // PrintWindow leaves alpha undefined for most controls, so a faithful copy is a card that
        // renders as a chequerboard. A screenshot has no transparency to preserve.
        let bgra = vec![0x30, 0x20, 0x10, 0x00];
        assert_eq!(bgra_to_rgba(&bgra), vec![0x10, 0x20, 0x30, 0xFF]);
    }

    #[test]
    fn a_crop_takes_the_rectangle_asked_for() {
        // Two rows of two pixels; the second row's second pixel is the one wanted.
        let mut image = Vec::new();
        for value in [1u8, 2, 3, 4] {
            image.extend_from_slice(&[value, value, value, 255]);
        }
        let cropped = crop(&image, 2, 2, 1, 1, 1, 1).expect("inside the image");
        assert_eq!(cropped, vec![4, 4, 4, 255]);
    }

    #[test]
    fn a_crop_outside_the_image_is_refused_rather_than_clamped() {
        // Clamping would hand back a picture of somewhere other than the page, and a card whose
        // picture is of the wrong thing is worse than a card with none.
        assert!(crop(&solid(4, 4, [0, 0, 0, 255]), 4, 4, 3, 3, 2, 2).is_none());
        assert!(crop(&solid(4, 4, [0, 0, 0, 255]), 4, 4, 0, 0, 0, 1).is_none());
    }

    #[test]
    fn the_page_rectangle_is_scaled_into_physical_pixels() {
        // A logical rectangle and a bitmap are measured in different units, and the bitmap's are
        // the ones a crop is in.
        let (x, y, w, h) =
            page_rect_physical(1000.0, 800.0, 2.0, true, (0, 0)).expect("a page is showing");
        let logical = layout::rects(1000.0, 800.0, true)
            .page
            .expect("a page rect");

        assert_eq!(x, (logical.x * 2.0) as u32);
        assert_eq!(y, (logical.y * 2.0) as u32);
        assert_eq!(w, (logical.width * 2.0) as u32);
        assert_eq!(h, (logical.height * 2.0) as u32);
    }

    #[test]
    fn a_captured_page_is_never_zero_sized() {
        // A window dragged smaller than its own minimum still has to yield a picture.
        let (_, _, w, h) =
            page_rect_physical(1.0, 1.0, 1.0, true, (0, 0)).expect("a page is showing");
        assert!(w >= 1 && h >= 1);
    }

    #[test]
    fn no_page_showing_means_no_capture() {
        // In any module but Browser the main area is the panel, and a picture of Athena's own
        // words is not evidence about the thing being approved.
        assert!(page_rect_physical(1440.0, 900.0, 1.0, false, (0, 0)).is_none());
    }

    #[test]
    fn the_frames_inset_moves_the_rectangle_and_not_its_size() {
        // `PrintWindow` draws the whole window and `layout` measures the client area inside it.
        // Without this the crop is a frame's width out, which is what the first smoke run showed
        // as a black band down the left edge of the picture.
        let flush = page_rect_physical(1440.0, 900.0, 1.0, true, (0, 0)).expect("a page");
        let inset = page_rect_physical(1440.0, 900.0, 1.0, true, (8, 31)).expect("a page");

        assert_eq!(inset.0, flush.0 + 8);
        assert_eq!(inset.1, flush.1 + 31);
        assert_eq!(
            (inset.2, inset.3),
            (flush.2, flush.3),
            "the page is no bigger for sitting further in"
        );
    }

    #[test]
    fn a_negative_inset_is_no_inset() {
        // A window that reports its client area outside its own frame is reporting nonsense, and
        // the honest answer to nonsense is to do nothing with it.
        assert_eq!(
            page_rect_physical(1440.0, 900.0, 1.0, true, (-40, -40)),
            page_rect_physical(1440.0, 900.0, 1.0, true, (0, 0))
        );
    }
}
