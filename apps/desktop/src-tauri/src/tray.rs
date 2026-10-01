//! The tray: Athena's way back when she is put away (ADR 0026, README section 3.1).
//!
//! Hiding her stops the drawing and not the listening, so the tray is where a waiting decision
//! shows: the icon carries a pink dot while `cards > 0`. The dot is painted into a copy of the
//! window icon at runtime, so there is one asset and no second file to drift from it.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::companion;

const TRAY_ID: &str = "athena";

/// `--role-human` in the dark theme: the one colour that means "waiting on you".
const DOT: [u8; 3] = [0xf4, 0x72, 0xb6];

/// Paint the waiting dot into the top-right of an RGBA icon.
pub fn with_dot(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let r = (width.min(height) as f32 * 0.24).max(3.0);
    let (cx, cy) = (width as f32 - r - 1.0, r + 1.0);
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            if dx * dx + dy * dy <= r * r {
                let i = ((y * width + x) * 4) as usize;
                out[i..i + 3].copy_from_slice(&DOT);
                out[i + 3] = 255;
            }
        }
    }
    out
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Athena", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Put Athena away", true, None::<&str>)?;
    let main = MenuItem::with_id(app, "main", "Show Main window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &main, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Athena")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => companion::show(app),
            "hide" => companion::hide(app),
            "main" => {
                if let Some(w) = app.get_window(crate::MAIN_WINDOW) {
                    companion::raise(&w);
                }
            }
            "quit" => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                companion::show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Show or clear the waiting dot. Non-fatal: a tray that cannot draw must not take a card with it.
pub fn set_pending(app: &AppHandle, cards: u32) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let Some(base) = app.default_window_icon() else { return };
    let icon = if cards > 0 {
        Image::new_owned(with_dot(base.rgba(), base.width(), base.height()), base.width(), base.height())
    } else {
        base.clone()
    };
    let _ = tray.set_icon(Some(icon));
    let _ = tray.set_tooltip(Some(if cards > 0 { format!("Athena: {cards} waiting on you") } else { "Athena".to_string() }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dot_is_painted_in_the_corner_and_nowhere_else() {
        let (w, h) = (32u32, 32u32);
        let base = vec![0u8; (w * h * 4) as usize];
        let out = with_dot(&base, w, h);
        let px = |x: u32, y: u32| &out[((y * w + x) * 4) as usize..((y * w + x) * 4 + 4) as usize];
        assert_eq!(px(25, 7), &[DOT[0], DOT[1], DOT[2], 255], "the corner carries the dot");
        assert_eq!(px(3, 28), &[0, 0, 0, 0], "the far corner is untouched");
        assert_eq!(out.len(), base.len());
    }
}
