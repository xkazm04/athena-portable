//! The Athena window: her named sizes, where she sits, and how she docks (ADR 0026, README
//! section 3.1).
//!
//! Athena is her own window, not a panel of the main rectangle. It is a transparent, frameless,
//! off-the-taskbar window whose rectangle **hugs its drawing**, so nothing relies on click-through
//! over transparent pixels (they still take clicks on Windows). The page asks for a *name*
//! (`seal`, `slip`, `ledger` ...) and this file owns what the name means in pixels, so a size is
//! never a value a page can choose.
//!
//! **The seal is the anchor of every resize.** Her screen rectangle stays where it is and the
//! window grows out of it. `Orient` says which edges of the window the seal sits on; Rust picks
//! it (the page only proposes), flips it when the rectangle would leave the monitor's work area
//! and slides the smallest distance when neither flip fits. The arithmetic is pure and tested
//! below, in the style of `layout.rs`.
//!
//! **Snapping is Rust's.** The page starts a native drag; Rust watches `Moved`, treats a short
//! quiet as a drop, and decides `Snap`: beside Main, in Main's corner, on a screen edge (then she
//! is a `tab`) or free. A `main.*` snap follows Main when it moves or resizes.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, WebviewUrl,
    Window, WebviewWindowBuilder, WindowEvent,
};

use crate::layout::Rect;

/// The Athena window's label. The capability `capabilities/athena.json` is granted to it, and it
/// holds exactly one webview, which is why it may name a window where `ui.json` may not.
pub const ATHENA_WINDOW: &str = "athena";

/// The shadow margin on every side of her drawing, except the `tab`, which sits flush.
pub const MARGIN: f64 = 8.0;

/// The seal is a square of this side. The window grows out of it.
pub const SEAL: f64 = 76.0;

/// How close (logical px) a dropped seal has to be to an edge to snap to it.
pub const SNAP_PX: f64 = 32.0;

/// How long the window has to stop moving before a drag is a drop.
pub const DROP_QUIET: Duration = Duration::from_millis(180);

/// A `Moved` event inside this window of one of our own placements is ours, not the user's.
const OWN_MOVE: Duration = Duration::from_millis(300);

/// The named sizes of ADR 0026, in logical pixels. The page mirrors this table in
/// `src/lib/companion.ts` and a test there pins the two together.
pub const STATES: [(&str, f64, f64); 8] = [
    ("seal", 92.0, 92.0),
    ("tape", 440.0, 92.0),
    ("hear", 440.0, 92.0),
    ("face", 240.0, 300.0),
    ("slip", 488.0, 316.0),
    ("welcome", 488.0, 432.0),
    ("ledger", 488.0, 656.0),
    ("tab", 28.0, 96.0),
];

/// The size of a named state, or `None` for a name nothing answers to.
pub fn size_of(name: &str) -> Option<(f64, f64)> {
    STATES.iter().find(|(n, _, _)| *n == name).map(|&(_, w, h)| (w, h))
}

/// Which window edge the seal sits on, horizontally.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

/// Which window edge the seal sits on, vertically: `Down` is "the paper runs down from the seal".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VAlign {
    Down,
    Up,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Orient {
    pub side: Side,
    pub valign: VAlign,
}

impl Orient {
    fn flip_side(self) -> Self {
        Self {
            side: match self.side {
                Side::Left => Side::Right,
                Side::Right => Side::Left,
            },
            ..self
        }
    }
    fn flip_valign(self) -> Self {
        Self {
            valign: match self.valign {
                VAlign::Down => VAlign::Up,
                VAlign::Up => VAlign::Down,
            },
            ..self
        }
    }
}

/// A screen point, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Where the seal's top-left is, given the window's rectangle and its orientation.
pub fn seal_origin(win: &Rect, o: Orient) -> Point {
    Point {
        x: match o.side {
            Side::Left => win.x + MARGIN,
            Side::Right => win.x + win.width - MARGIN - SEAL,
        },
        y: match o.valign {
            VAlign::Down => win.y + MARGIN,
            VAlign::Up => win.y + win.height - MARGIN - SEAL,
        },
    }
}

/// The window's rectangle for a seal, a size and an orientation: the inverse of [`seal_origin`].
pub fn window_rect(seal: Point, (w, h): (f64, f64), o: Orient) -> Rect {
    Rect {
        x: match o.side {
            Side::Left => seal.x - MARGIN,
            Side::Right => seal.x + SEAL + MARGIN - w,
        },
        y: match o.valign {
            VAlign::Down => seal.y - MARGIN,
            VAlign::Up => seal.y + SEAL + MARGIN - h,
        },
        width: w,
        height: h,
    }
}

fn inside(r: &Rect, work: &Rect) -> bool {
    r.x >= work.x
        && r.y >= work.y
        && r.x + r.width <= work.x + work.width
        && r.y + r.height <= work.y + work.height
}

/// Place a window of `size` around `seal`. The preferred orientation wins if it fits; then a flip
/// of the side, of the vertical, of both; and when nothing fits the preferred rectangle is slid
/// the smallest distance that brings it inside (the seal moves with it, which is the honest cost of
/// a window larger than the room she was given).
pub fn place(seal: Point, size: (f64, f64), prefer: Orient, work: &Rect) -> (Rect, Orient) {
    let candidates = [
        prefer,
        prefer.flip_side(),
        prefer.flip_valign(),
        prefer.flip_side().flip_valign(),
    ];
    for o in candidates {
        let r = window_rect(seal, size, o);
        if inside(&r, work) {
            return (r, o);
        }
    }
    let mut r = window_rect(seal, size, prefer);
    r.x = r.x.min(work.x + work.width - r.width).max(work.x);
    r.y = r.y.min(work.y + work.height - r.height).max(work.y);
    (r, prefer)
}

/// Which screen edge she is docked to, when she is a `tab`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dock {
    Left,
    Right,
}

/// The `tab`'s rectangle: flush to the dock edge, vertically clamped into the work area.
pub fn tab_rect(dock: Dock, y: f64, (w, h): (f64, f64), work: &Rect) -> Rect {
    Rect {
        x: match dock {
            Dock::Left => work.x,
            Dock::Right => work.x + work.width - w,
        },
        y: y.min(work.y + work.height - h).max(work.y),
        width: w,
        height: h,
    }
}

/// Where the seal would be if she grew out of a docked `tab` whose rectangle is `win`: against the
/// same edge, centred on the tab vertically.
pub fn tab_seal(dock: Dock, win: &Rect) -> Point {
    Point {
        x: match dock {
            Dock::Left => win.x + MARGIN,
            Dock::Right => win.x + win.width - MARGIN - SEAL,
        },
        y: win.y + (win.height - SEAL) / 2.0,
    }
}

/// What the window is attached to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Snap {
    Free,
    MainRight,
    MainLeft,
    MainCorner,
    ScreenLeft,
    ScreenRight,
}

impl Snap {
    /// The wire spelling `athena:snap` carries.
    pub fn as_str(self) -> &'static str {
        match self {
            Snap::Free => "free",
            Snap::MainRight => "main.right",
            Snap::MainLeft => "main.left",
            Snap::MainCorner => "main.corner",
            Snap::ScreenLeft => "screen.left",
            Snap::ScreenRight => "screen.right",
        }
    }

    pub fn dock(self) -> Option<Dock> {
        match self {
            Snap::ScreenLeft => Some(Dock::Left),
            Snap::ScreenRight => Some(Dock::Right),
            _ => None,
        }
    }

    fn follows_main(self) -> bool {
        matches!(self, Snap::MainRight | Snap::MainLeft | Snap::MainCorner)
    }
}

/// The inner corner region of Main, in logical px, where a seal counts as "in the corner".
const CORNER_PX: f64 = SNAP_PX * 3.0;

/// Classify a dropped seal against Main and the screen. Main's own edges win over the screen's
/// unless Main is flush to that screen edge (a maximised Main would otherwise make docking
/// impossible).
pub fn classify(seal: Point, main: Option<&Rect>, work: &Rect) -> Snap {
    let right = seal.x + SEAL;
    let bottom = seal.y + SEAL;
    if let Some(m) = main {
        let mr = m.x + m.width;
        let mb = m.y + m.height;
        let in_corner = right <= mr + SNAP_PX
            && right >= mr - CORNER_PX
            && bottom <= mb + SNAP_PX
            && bottom >= mb - CORNER_PX;
        if in_corner {
            return Snap::MainCorner;
        }
        let v_overlap = seal.y < mb && bottom > m.y;
        let main_flush_right = (mr - (work.x + work.width)).abs() < 2.0;
        let main_flush_left = (m.x - work.x).abs() < 2.0;
        if v_overlap && !main_flush_right && seal.x >= mr - SNAP_PX && seal.x - mr <= SNAP_PX + MARGIN {
            return Snap::MainRight;
        }
        if v_overlap && !main_flush_left && m.x - right >= -SNAP_PX && m.x - right <= SNAP_PX + MARGIN {
            return Snap::MainLeft;
        }
    }
    if seal.x - work.x <= SNAP_PX {
        return Snap::ScreenLeft;
    }
    if (work.x + work.width) - right <= SNAP_PX {
        return Snap::ScreenRight;
    }
    Snap::Free
}

/// Where the seal goes when Main moves or resizes under a `main.*` snap; `None` for any other.
pub fn follow(snap: Snap, seal: Point, main: &Rect) -> Option<Point> {
    let mr = main.x + main.width;
    let mb = main.y + main.height;
    let clamp_y = |y: f64| y.min(mb - SEAL).max(main.y);
    match snap {
        Snap::MainRight => Some(Point { x: mr + MARGIN, y: clamp_y(seal.y) }),
        Snap::MainLeft => Some(Point { x: main.x - MARGIN - SEAL, y: clamp_y(seal.y) }),
        Snap::MainCorner => Some(Point { x: mr - 16.0 - SEAL, y: mb - 16.0 - SEAL }),
        _ => None,
    }
}

// ==============================================================================================
// The window. Everything above is arithmetic; everything below touches a real window.
// ==============================================================================================

#[derive(Debug)]
struct Inner {
    name: String,
    orient: Orient,
    /// The seal's top-left on the desktop, as last placed or last dropped.
    seal: Point,
    snap: Snap,
    cards: u32,
    line: String,
    visible: bool,
    /// Bumped on every user move; a drop is the last generation standing after `DROP_QUIET`.
    drop_gen: u64,
    ignore_until: Option<Instant>,
}

/// The companion's managed state.
#[derive(Debug)]
pub struct Companion {
    inner: Mutex<Inner>,
}

impl Default for Companion {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                name: "seal".to_string(),
                orient: Orient { side: Side::Right, valign: VAlign::Up },
                seal: Point { x: 0.0, y: 0.0 },
                snap: Snap::Free,
                cards: 0,
                line: String::new(),
                visible: false,
                drop_gen: 0,
                ignore_until: None,
            }),
        }
    }
}

impl Companion {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("companion poisoned")
    }

}

fn window_of(app: &AppHandle) -> Option<Window> {
    app.get_window(ATHENA_WINDOW)
}

/// A window's outer rectangle in logical pixels.
fn logical_rect(w: &Window) -> Option<Rect> {
    let scale = w.scale_factor().ok()?;
    let p = w.outer_position().ok()?;
    let s = w.outer_size().ok()?;
    Some(Rect {
        x: p.x as f64 / scale,
        y: p.y as f64 / scale,
        width: s.width as f64 / scale,
        height: s.height as f64 / scale,
    })
}

/// The work area (monitor minus the taskbar) of the monitor the window is on, in logical pixels.
fn work_area(w: &Window) -> Rect {
    let scale = w.scale_factor().unwrap_or(1.0);
    let monitor = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten());
    match monitor {
        Some(m) => {
            let a = m.work_area();
            Rect {
                x: a.position.x as f64 / scale,
                y: a.position.y as f64 / scale,
                width: a.size.width as f64 / scale,
                height: a.size.height as f64 / scale,
            }
        }
        None => Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0 },
    }
}

fn main_rect(app: &AppHandle) -> Option<Rect> {
    let w = app.get_window(crate::MAIN_WINDOW)?;
    if !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
        return None;
    }
    logical_rect(&w)
}

/// Emit to the Athena window alone. `ui_emit` reaches every privileged label; these events are
/// hers and Main has no use for them.
fn emit_athena<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit_to(
        EventTarget::AnyLabel { label: ATHENA_WINDOW.to_string() },
        event,
        payload,
    );
}

/// Move and size the window in one place, and mark the move as ours so the drop detector ignores
/// it.
fn put(inner: &mut Inner, w: &Window, r: Rect) {
    inner.ignore_until = Some(Instant::now() + OWN_MOVE);
    let _ = w.set_size(LogicalSize::new(r.width, r.height));
    let _ = w.set_position(LogicalPosition::new(r.x, r.y));
}

/// Build the window. She floats above Main and other applications from the start (the page's pin
/// defaults to on); the pin button turns it off. Hidden until asked: on first launch it is the only window the user sees, so
/// the caller shows it at `welcome`; on every other launch it comes up at her home form.
pub fn build(app: &AppHandle, first_launch: bool) -> tauri::Result<()> {
    let (w, h) = size_of("seal").expect("the seal is in the table");
    WebviewWindowBuilder::new(app, ATHENA_WINDOW, WebviewUrl::App("athena.html".into()))
        .title("Athena")
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .build()?;
    let window = window_of(app).ok_or(tauri::Error::WindowNotFound)?;

    let work = work_area(&window);
    // Where the person last put her (ADR 0209), when that place is still on a connected monitor.
    let restored = if first_launch { None } else { saved_dock(app) };
    let main = main_rect(app);
    let companion = app.state::<Companion>();
    {
        let mut inner = companion.lock();
        // First launch: near the top middle, where the welcome paper has room to unroll. Every
        // other launch: bottom right, where a resting seal is easiest to look past.
        inner.seal = if first_launch {
            Point { x: work.x + work.width / 2.0 - SEAL / 2.0, y: work.y + work.height * 0.22 }
        } else {
            Point { x: work.x + work.width - 24.0 - SEAL, y: work.y + work.height - 24.0 - SEAL }
        };
        inner.orient = if first_launch {
            Orient { side: Side::Left, valign: VAlign::Down }
        } else {
            Orient { side: Side::Right, valign: VAlign::Up }
        };
        let r = match restored {
            Some((seal, snap, room)) => {
                // A `main.*` snap comes back beside Main wherever Main came up this time.
                let followed = main.as_ref().and_then(|m| follow(snap, seal, m));
                inner.seal = followed.unwrap_or(seal);
                inner.snap = snap;
                let (r, o) = place(inner.seal, (w, h), inner.orient, &room);
                inner.orient = o;
                r
            }
            None => window_rect(inner.seal, (w, h), inner.orient),
        };
        put(&mut inner, &window, r);
    }

    let handle = app.clone();
    window.on_window_event(move |event| on_athena_event(&handle, event));
    Ok(())
}

/// The page asks for a named size around the seal.
pub fn set_size(app: &AppHandle, name: &str, side: Side, valign: VAlign) -> Result<(), String> {
    let size = size_of(name).ok_or_else(|| format!("unknown state \"{name}\""))?;
    let window = window_of(app).ok_or("the Athena window does not exist")?;
    let work = work_area(&window);
    let companion = app.state::<Companion>();
    let mut inner = companion.lock();

    let previous = inner.orient;
    let dock = inner.snap.dock();
    let rect;
    if name == "tab" {
        let dock = dock.ok_or("a tab needs a screen edge to sit on")?;
        rect = tab_rect(dock, inner.seal.y - (size.1 - SEAL) / 2.0, size, &work);
        inner.seal = tab_seal(dock, &rect);
    } else {
        // Growing out of a docked tab: she keeps to the edge she was docked to.
        let prefer = match dock {
            Some(Dock::Left) => Orient { side: Side::Left, valign },
            Some(Dock::Right) => Orient { side: Side::Right, valign },
            None => Orient { side, valign },
        };
        let (r, o) = place(inner.seal, size, prefer, &work);
        rect = r;
        inner.orient = o;
        inner.seal = seal_origin(&r, o);
    }
    inner.name = name.to_string();
    put(&mut inner, &window, rect);
    let orient = inner.orient;
    drop(inner);

    if orient != previous {
        emit_athena(app, "athena:orient", orient);
    }
    Ok(())
}

/// A user move: note it, and decide the drop once the window has been still for [`DROP_QUIET`].
pub fn on_athena_event(app: &AppHandle, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // Closing her puts her away; quitting is the tray's and Main's.
            api.prevent_close();
            hide(app);
        }
        WindowEvent::Moved(_) => {
            let companion = app.state::<Companion>();
            let generation = {
                let mut inner = companion.lock();
                if inner.ignore_until.is_some_and(|t| Instant::now() < t) {
                    return;
                }
                if let Some(w) = window_of(app) {
                    if let Some(r) = logical_rect(&w) {
                        inner.seal = if inner.name == "tab" {
                            match inner.snap.dock() {
                                Some(d) => tab_seal(d, &r),
                                None => seal_origin(&r, inner.orient),
                            }
                        } else {
                            seal_origin(&r, inner.orient)
                        };
                    }
                }
                inner.drop_gen += 1;
                inner.drop_gen
            };
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(DROP_QUIET);
                settle_drop(&handle, generation);
            });
        }
        _ => {}
    }
}

/// The window has been still: classify where the seal landed and tell the page.
fn settle_drop(app: &AppHandle, generation: u64) {
    let Some(window) = window_of(app) else { return };
    let work = work_area(&window);
    let main = main_rect(app);
    let companion = app.state::<Companion>();
    let mut inner = companion.lock();
    if inner.drop_gen != generation {
        return;
    }
    let was_docked = inner.snap.dock().is_some();
    let snap = classify(inner.seal, main.as_ref(), &work);
    // A tab dragged away from its edge is free; one dragged along it stays docked.
    let snap = if was_docked && inner.name == "tab" && snap.dock().is_none() { Snap::Free } else { snap };
    inner.snap = snap;
    if let (Some(m), true) = (main.as_ref(), snap.follows_main()) {
        if let Some(p) = follow(snap, inner.seal, m) {
            inner.seal = p;
            let size = size_of(&inner.name).unwrap_or((92.0, 92.0));
            let (r, o) = place(p, size, inner.orient, &work);
            inner.orient = o;
            put(&mut inner, &window, r);
        }
    }
    let payload = serde_json::json!({ "to": snap.as_str(), "docked": snap.dock() });
    let seal = inner.seal;
    drop(inner);
    save_dock(app, seal, snap);
    emit_athena(app, "athena:snap", payload);
}

/// Main moved or resized: a `main.*` snap follows it.
pub fn on_main_event(app: &AppHandle, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
        return;
    }
    let (Some(window), Some(main)) = (window_of(app), main_rect(app)) else { return };
    let work = work_area(&window);
    let companion = app.state::<Companion>();
    let mut inner = companion.lock();
    if !inner.snap.follows_main() {
        return;
    }
    if let Some(p) = follow(inner.snap, inner.seal, &main) {
        inner.seal = p;
        let size = size_of(&inner.name).unwrap_or((92.0, 92.0));
        let (r, o) = place(p, size, inner.orient, &work);
        inner.orient = o;
        put(&mut inner, &window, r);
    }
}

/// Why she is being shown. A card arriving is not a reason to take the keyboard from whatever the
/// user is typing into: the decision is Rust's and it is this one function (ADR 0026, "she never
/// opens the slip over the user's work").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cause {
    /// The user asked: the tray, the pill, `Ctrl+Shift+Space`.
    User,
    /// A card arrived while she was put away or unfocused.
    Arrival,
}

/// Should a show take focus? A user's own request does; an arrival never does, because whether the
/// user is typing elsewhere is not knowable from here.
pub fn takes_focus(cause: Cause) -> bool {
    matches!(cause, Cause::User)
}

/// What the command's optional `focus` argument means: absent is a user's show.
pub fn cause_of(focus: Option<bool>) -> Cause {
    if focus.unwrap_or(true) {
        Cause::User
    } else {
        Cause::Arrival
    }
}

/// Put her on the screen, focused: a user-initiated show.
pub fn show(app: &AppHandle) {
    show_with(app, true);
}

/// Put her on the screen. With a card waiting the page opens at `slip`; with none, at home. With
/// `focus` false the window is shown without being activated, so a card arriving never takes the
/// keyboard from the user's work.
pub fn show_with(app: &AppHandle, focus: bool) {
    let Some(window) = window_of(app) else { return };
    let cards = {
        let companion = app.state::<Companion>();
        let mut inner = companion.lock();
        inner.visible = true;
        inner.cards
    };
    if focus {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        show_no_activate(&window);
    }
    emit_athena(app, "athena:summon", serde_json::json!({ "cards": cards, "focus": focus }));
    announce(app);
}

/// Show a window without activating it. `Window::show` is `SW_SHOW` underneath, which activates;
/// `SW_SHOWNOACTIVATE` does not. Hers on a card's arrival, and every halo's (ADR 0027).
#[cfg(windows)]
pub fn show_no_activate(window: &Window) {
    debug_assert_eq!(show_plan(std::env::consts::OS), ShowPlan::NativeNoActivate);
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    match window.hwnd() {
        Ok(hwnd) => unsafe {
            ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
        },
        Err(_) => {
            let _ = window.show();
        }
    }
}

/// How a window is shown without taking the keyboard, per host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShowPlan {
    /// `SW_SHOWNOACTIVATE`.
    NativeNoActivate,
    /// Mark the window unfocusable for the show (macOS: it cannot become key; Linux: GTK
    /// `accept_focus` off), then make it focusable again so a click can still reach her.
    UnfocusableShow,
    /// A plain `show`, which activates. Never the answer for an arrival; it exists so the test can
    /// name what no host may be given.
    #[allow(dead_code)]
    Plain,
}

/// The no-activate path for a host named as `std::env::consts::OS` spells it.
pub fn show_plan(os: &str) -> ShowPlan {
    match os {
        "windows" => ShowPlan::NativeNoActivate,
        _ => ShowPlan::UnfocusableShow,
    }
}

#[cfg(not(windows))]
pub fn show_no_activate(window: &Window) {
    // Focus is deliberately not taken: a card arriving must not pull the user out of whatever
    // they are typing in (non-stealing-overlay). A plain `show` activates on macOS and Linux.
    debug_assert_eq!(show_plan(std::env::consts::OS), ShowPlan::UnfocusableShow);
    let _ = window.set_focusable(false);
    let _ = window.show();
    let _ = window.set_focusable(true);
}

/// What a toggle does, given whether she is on the screen now: put away what is shown, show what
/// is put away. Kept apart from the window so the rule is testable without one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Toggle {
    Show,
    Hide,
}

pub fn toggle_plan(visible: bool) -> Toggle {
    if visible {
        Toggle::Hide
    } else {
        Toggle::Show
    }
}

/// Main's illustration of her was pressed (fleet-surfaces D2): show her if she is put away, put
/// her away if she is shown. `Inner.visible` is the authority, the same fact `athena:status`
/// mirrors to the chrome, so the label the person read is the act they get. A show is the user's
/// own (focused), as the tray's and the pill's are. With `at` (the illustration's centre, in the
/// chrome webview's px) a show brings her seal onto the illustration first, so she comes up where
/// the person pressed instead of wherever she was last put. Returns whether she is visible
/// afterwards.
pub fn toggle(app: &AppHandle, at: Option<Anchor>) -> bool {
    let visible = app.state::<Companion>().lock().visible;
    match toggle_plan(visible) {
        Toggle::Show => {
            if let Some(centre) = at.and_then(|a| chrome_point_on_screen(app, Point { x: a.x, y: a.y })) {
                come_to(app, centre);
            }
            show_with(app, true)
        }
        Toggle::Hide => hide(app),
    }
    app.state::<Companion>().lock().visible
}

/// A point on Main's illustration of her, in the chrome webview's CSS px (logical).
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Anchor {
    pub x: f64,
    pub y: f64,
}

/// Where her seal goes to come up on her illustration in Main: centred on `centre` (a screen point),
/// kept a margin inside the work area. Pure.
pub fn seal_at(centre: Point, work: &Rect) -> Point {
    let clamp = |v: f64, lo: f64, hi: f64| v.min(hi).max(lo);
    Point {
        x: clamp(centre.x - SEAL / 2.0, work.x + MARGIN, work.x + work.width - MARGIN - SEAL),
        y: clamp(centre.y - SEAL / 2.0, work.y + MARGIN, work.y + work.height - MARGIN - SEAL),
    }
}

/// A point in the chrome webview's logical px, on the screen: Main's client origin plus the
/// webview's place in it.
fn chrome_point_on_screen(app: &AppHandle, p: Point) -> Option<Point> {
    let main = app.get_window(crate::MAIN_WINDOW)?;
    let scale = main.scale_factor().ok()?;
    let inner = main.inner_position().ok()?;
    let web = app.get_webview(crate::CHROME_WEBVIEW)?.position().ok()?;
    Some(Point {
        x: (inner.x + web.x) as f64 / scale + p.x,
        y: (inner.y + web.y) as f64 / scale + p.y,
    })
}

/// Move her seal onto `centre` (a screen point) at her current form, free of any dock or of Main's
/// edge, and tell the page what changed.
fn come_to(app: &AppHandle, centre: Point) {
    let (Some(window), Some(main)) = (window_of(app), app.get_window(crate::MAIN_WINDOW)) else {
        return;
    };
    let work = work_area(&main);
    let companion = app.state::<Companion>();
    let mut inner = companion.lock();
    let previous = inner.orient;
    inner.snap = Snap::Free;
    // A docked tab undocks to its seal; the page follows on `athena:snap`.
    let name = if inner.name == "tab" { "seal" } else { inner.name.as_str() };
    let size = size_of(name).unwrap_or((92.0, 92.0));
    let (r, o) = place(seal_at(centre, &work), size, inner.orient, &work);
    inner.orient = o;
    inner.seal = seal_origin(&r, o);
    put(&mut inner, &window, r);
    let orient = inner.orient;
    drop(inner);
    if orient != previous {
        emit_athena(app, "athena:orient", orient);
    }
    emit_athena(app, "athena:snap", serde_json::json!({ "to": Snap::Free.as_str(), "docked": null }));
}

/// Put her away. Hiding stops drawing, not listening: the webview lives on and the daemon's
/// events still arrive, and the tray carries the dot.
pub fn hide(app: &AppHandle) {
    if let Some(window) = window_of(app) {
        let _ = window.hide();
    }
    app.state::<Companion>().lock().visible = false;
    announce(app);
}

pub fn pin(app: &AppHandle, on: bool) {
    if let Some(window) = window_of(app) {
        let _ = window.set_always_on_top(on);
    }
}

/// What she is doing, as the page reports it. Feeds Main's status pill, the tray dot and the
/// global chords.
pub fn report(app: &AppHandle, state: &str, cards: u32, line: &str) {
    let changed_cards;
    {
        let companion = app.state::<Companion>();
        let mut inner = companion.lock();
        changed_cards = inner.cards != cards;
        inner.cards = cards;
        inner.line = line.to_string();
        // The page's state is authoritative for the name; `set_size` is what moves the window.
        if size_of(state).is_some() {
            inner.name = state.to_string();
        }
    }
    if changed_cards {
        crate::tray::set_pending(app, cards);
        crate::hotkeys::set_card_chords(app, cards > 0);
    }
    announce(app);
}

/// Tell the chrome what she is doing.
fn announce(app: &AppHandle) {
    let companion = app.state::<Companion>();
    let inner = companion.lock();
    crate::ui_emit_to(
        app,
        crate::CHROME_WEBVIEW,
        "athena:status",
        serde_json::json!({
            "state": inner.name,
            "cards": inner.cards,
            "line": inner.line,
            "visible": inner.visible,
        }),
    );
}

/// A chord was pressed. Only the page knows which card is first and whether it can be answered.
pub fn chord(app: &AppHandle, kind: &str) {
    emit_athena(app, "athena:chord", serde_json::json!({ "kind": kind }));
}

/// The held summon chord went down or came up (ADR 0027): push-to-talk from anywhere. Her page
/// owns the voice, so the event is hers alone.
pub fn ptt(app: &AppHandle, down: bool) {
    crate::ui_emit_to(app, ATHENA_WINDOW, "athena:ptt", serde_json::json!({ "down": down }));
}

/// Bring a window to the front. Windows refuses `set_focus` from a process that is not already the
/// foreground one, which leaves a freshly shown Main behind whatever the user was doing; a brief
/// topmost toggle is the documented way past it.
pub fn raise(window: &Window) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_always_on_top(false);
    let _ = window.set_focus();
}

/// The one thing the store's `onboarded` row means to the window: Main appears, and she settles
/// on its right edge as a seal.
pub fn after_onboarded(app: &AppHandle) {
    let Some(main) = app.get_window(crate::MAIN_WINDOW) else { return };
    raise(&main);
    crate::layout::apply(app);
    let Some(window) = window_of(app) else { return };
    let work = work_area(&window);
    let Some(m) = main_rect(app) else { return };
    let companion = app.state::<Companion>();
    let mut inner = companion.lock();
    inner.snap = Snap::MainRight;
    if let Some(p) = follow(Snap::MainRight, inner.seal, &m) {
        inner.seal = p;
        let size = size_of(&inner.name).unwrap_or((92.0, 92.0));
        let (r, o) = place(p, size, inner.orient, &work);
        inner.orient = o;
        put(&mut inner, &window, r);
    }
    let payload = serde_json::json!({ "to": Snap::MainRight.as_str(), "docked": serde_json::Value::Null });
    drop(inner);
    emit_athena(app, "athena:snap", payload);
}

/// Parse the wire spelling of a snap target.
pub fn snap_from_str(s: &str) -> Option<Snap> {
    Some(match s {
        "main.right" => Snap::MainRight,
        "main.left" => Snap::MainLeft,
        "main.corner" => Snap::MainCorner,
        "screen.left" => Snap::ScreenLeft,
        "screen.right" => Snap::ScreenRight,
        "free" => Snap::Free,
        _ => return None,
    })
}

/// Where the seal goes for a requested snap. `Err` names why it cannot: a `main.*` target needs a
/// visible Main. A screen target lands the seal one margin from the edge (which `classify` calls
/// that edge); `free` from a dock steps the seal in off the edge so it does not read as docked.
pub fn snap_seal(
    snap: Snap,
    seal: Point,
    was_docked: bool,
    main: Option<&Rect>,
    work: &Rect,
) -> Result<Point, &'static str> {
    let clamp_y = |y: f64| y.min(work.y + work.height - SEAL).max(work.y);
    match snap {
        Snap::MainRight | Snap::MainLeft | Snap::MainCorner => {
            let m = main.ok_or("Main is not open")?;
            follow(snap, seal, m).ok_or("Main is not open")
        }
        Snap::ScreenLeft => Ok(Point { x: work.x + MARGIN, y: clamp_y(seal.y) }),
        Snap::ScreenRight => Ok(Point { x: work.x + work.width - MARGIN - SEAL, y: clamp_y(seal.y) }),
        Snap::Free => Ok(if was_docked {
            let inward = SNAP_PX * 2.0;
            let x = if seal.x < work.x + work.width / 2.0 { seal.x + inward } else { seal.x - inward };
            Point { x, y: seal.y }
        } else {
            seal
        }),
    }
}

/// The `settings` row holding where she was last put: `{ "x", "y", "snap" }` (ADR 0209).
pub const DOCK_KEY: &str = "shell.dock";

/// The row a seal and its snap are saved as.
pub fn dock_record(seal: Point, snap: Snap) -> serde_json::Value {
    serde_json::json!({ "x": seal.x, "y": seal.y, "snap": snap.as_str() })
}

/// Where a launch puts her seal from a saved row: the saved point and snap when the seal still lies
/// wholly inside one connected work area, else `None` and today's default stands
/// (layered-place-restoration: restore what is still valid, fall back silently).
pub fn restore_seal(saved: &serde_json::Value, works: &[Rect]) -> Option<(Point, Snap)> {
    let x = saved.get("x")?.as_f64()?;
    let y = saved.get("y")?.as_f64()?;
    let snap = snap_from_str(saved.get("snap")?.as_str()?)?;
    let seal = Rect { x, y, width: SEAL, height: SEAL };
    works.iter().any(|w| inside(&seal, w)).then_some((Point { x, y }, snap))
}

/// Every connected monitor's work area, in logical pixels, each at its own scale.
fn work_areas(app: &AppHandle) -> Vec<Rect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let a = m.work_area();
            Rect {
                x: a.position.x as f64 / scale,
                y: a.position.y as f64 / scale,
                width: a.size.width as f64 / scale,
                height: a.size.height as f64 / scale,
            }
        })
        .collect()
}

/// The saved seal, its snap and the work area it lies in, or `None` for no row, a broken one, or a
/// place on a monitor that is gone.
fn saved_dock(app: &AppHandle) -> Option<(Point, Snap, Rect)> {
    let row = crate::store::opened(app).ok()?.get("settings", DOCK_KEY).ok()?;
    let works = work_areas(app);
    let (seal, snap) = restore_seal(&row, &works)?;
    let square = Rect { x: seal.x, y: seal.y, width: SEAL, height: SEAL };
    let room = works.into_iter().find(|w| inside(&square, w))?;
    Some((seal, snap, room))
}

/// Remember where she was put: on a drop and on a requested snap, never on her own moves.
fn save_dock(app: &AppHandle, seal: Point, snap: Snap) {
    if let Ok(store) = crate::store::opened(app) {
        if let Err(e) = store.set("settings", DOCK_KEY, &dock_record(seal, snap)) {
            eprintln!("[companion] cannot save her dock: {e}");
        }
    }
}

/// Snap her by name, as the drop detector would have, and tell the page.
pub fn snap_to(app: &AppHandle, to: &str) -> Result<(), String> {
    let snap = snap_from_str(to).ok_or_else(|| format!("unknown snap target \"{to}\""))?;
    let window = window_of(app).ok_or("the Athena window does not exist")?;
    let work = work_area(&window);
    let main = main_rect(app);
    let companion = app.state::<Companion>();
    let mut inner = companion.lock();
    let was_docked = inner.snap.dock().is_some();
    let seal = snap_seal(snap, inner.seal, was_docked, main.as_ref(), &work).map_err(str::to_string)?;
    let previous = inner.orient;
    inner.snap = snap;
    let size = size_of(&inner.name).unwrap_or((92.0, 92.0));
    let rect = match (inner.name.as_str(), snap.dock()) {
        ("tab", Some(dock)) => {
            let r = tab_rect(dock, seal.y - (size.1 - SEAL) / 2.0, size, &work);
            inner.seal = tab_seal(dock, &r);
            r
        }
        _ => {
            let (r, o) = place(seal, size, inner.orient, &work);
            inner.orient = o;
            inner.seal = seal_origin(&r, o);
            r
        }
    };
    put(&mut inner, &window, rect);
    let orient = inner.orient;
    let seal = inner.seal;
    drop(inner);
    save_dock(app, seal, snap);
    if orient != previous {
        emit_athena(app, "athena:orient", orient);
    }
    emit_athena(app, "athena:snap", serde_json::json!({ "to": snap.as_str(), "docked": snap.dock() }));
    Ok(())
}

/// Main's preferred size and its minimum, logical px.
pub const MAIN_WIDE: (f64, f64) = (1440.0, 900.0);
pub const MAIN_MIN: (f64, f64) = (900.0, 600.0);

/// Main's size and place at creation: 1440x900 unless that is more than 90% of the work area, never
/// below the 900x600 minimum, centred in the work area (logical px) so its buttons are on screen.
pub fn main_start_rect(work: &Rect) -> Rect {
    let width = MAIN_WIDE.0.min((work.width * 0.9).floor()).max(MAIN_MIN.0);
    let height = MAIN_WIDE.1.min((work.height * 0.9).floor()).max(MAIN_MIN.1);
    Rect {
        x: (work.x + (work.width - width) / 2.0).max(work.x).floor(),
        y: (work.y + (work.height - height) / 2.0).max(work.y).floor(),
        width,
        height,
    }
}

// ==============================================================================================
// Commands. Each needs three edits: here, `build.rs`, and `capabilities/athena.json`.
// ==============================================================================================

#[tauri::command(rename_all = "snake_case")]
pub async fn athena_set_size(
    app: AppHandle,
    name: String,
    side: Side,
    valign: VAlign,
) -> Result<(), String> {
    set_size(&app, &name, side, valign)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn athena_show(app: AppHandle, focus: Option<bool>) -> Result<(), String> {
    show_with(&app, takes_focus(cause_of(focus)));
    Ok(())
}

/// Bring Main forward, for the page's "Later" recovery and the pill.
#[tauri::command(rename_all = "snake_case")]
pub async fn athena_open_main(app: AppHandle) -> Result<(), String> {
    let main = app.get_window(crate::MAIN_WINDOW).ok_or("Main does not exist")?;
    raise(&main);
    crate::layout::apply(&app);
    Ok(())
}

/// Dock her where a drop would have: the same classification arithmetic, asked for by name.
#[tauri::command(rename_all = "snake_case")]
pub async fn athena_snap_to(app: AppHandle, to: String) -> Result<(), String> {
    snap_to(&app, &to)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn athena_hide(app: AppHandle) -> Result<(), String> {
    hide(&app);
    Ok(())
}

/// Show her or put her away, whichever she is not; answers whether she is visible afterwards.
/// The chrome's: Main's illustration of her is the switch (fleet-surfaces D2).
#[tauri::command(rename_all = "snake_case")]
pub async fn athena_toggle(app: AppHandle, at: Option<Anchor>) -> Result<bool, String> {
    Ok(toggle(&app, at))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn athena_pin(app: AppHandle, on: bool) -> Result<(), String> {
    pin(&app, on);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn athena_report(
    app: AppHandle,
    state: String,
    cards: u32,
    line: String,
) -> Result<(), String> {
    report(&app, &state, cards, &line);
    Ok(())
}

#[cfg(test)]
mod tests {
    /// An arrival must never use a plain, activating show on any host.
    #[test]
    fn no_host_shows_an_arrival_with_a_plain_activating_show() {
        for os in ["windows", "macos", "linux"] {
            assert_ne!(show_plan(os), ShowPlan::Plain, "{os} would steal focus on an arrival");
        }
        assert_eq!(show_plan("windows"), ShowPlan::NativeNoActivate);
    }

    use super::*;

    const WORK: Rect = Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0 };
    const LEFT_DOWN: Orient = Orient { side: Side::Left, valign: VAlign::Down };
    const RIGHT_UP: Orient = Orient { side: Side::Right, valign: VAlign::Up };

    #[test]
    fn every_state_is_named_once_and_the_seal_fits_inside_every_window_but_the_tab() {
        for (i, (name, w, h)) in STATES.iter().enumerate() {
            assert!(STATES.iter().skip(i + 1).all(|(n, _, _)| n != name), "{name} is repeated");
            if *name != "tab" {
                assert!(*w >= SEAL + 2.0 * MARGIN && *h >= SEAL + 2.0 * MARGIN, "{name} cannot hold the seal");
            }
        }
        assert_eq!(size_of("slip"), Some((488.0, 316.0)));
        assert_eq!(size_of("face"), Some((240.0, 300.0)));
        assert_eq!(size_of("nonsense"), None);
    }

    /// The anchor claim of ADR 0026: growing the window never moves the seal.
    #[test]
    fn the_seal_does_not_move_when_the_window_grows_in_any_orientation() {
        let seal = Point { x: 800.0, y: 400.0 };
        for o in [LEFT_DOWN, RIGHT_UP, Orient { side: Side::Left, valign: VAlign::Up }, Orient { side: Side::Right, valign: VAlign::Down }] {
            for (name, w, h) in STATES.iter().filter(|s| s.0 != "tab") {
                let r = window_rect(seal, (*w, *h), o);
                assert_eq!(seal_origin(&r, o), seal, "{name} moved the seal under {o:?}");
            }
        }
    }

    #[test]
    fn a_seal_at_the_window_corner_puts_it_at_the_margin() {
        let r = window_rect(Point { x: 100.0, y: 100.0 }, (488.0, 316.0), LEFT_DOWN);
        assert_eq!((r.x, r.y), (100.0 - MARGIN, 100.0 - MARGIN));
        let r = window_rect(Point { x: 1000.0, y: 500.0 }, (488.0, 316.0), RIGHT_UP);
        assert_eq!(r.x + r.width, 1000.0 + SEAL + MARGIN);
        assert_eq!(r.y + r.height, 500.0 + SEAL + MARGIN);
    }

    #[test]
    fn a_seal_brought_to_her_illustration_is_centred_on_it_and_stays_on_the_screen() {
        let s = seal_at(Point { x: 400.0, y: 300.0 }, &WORK);
        assert_eq!(s, Point { x: 400.0 - SEAL / 2.0, y: 300.0 - SEAL / 2.0 });
        let corner = seal_at(Point { x: 2.0, y: 1039.0 }, &WORK);
        assert_eq!(corner, Point { x: MARGIN, y: WORK.height - MARGIN - SEAL });
    }

    #[test]
    fn placement_keeps_the_preferred_orientation_when_it_fits() {
        let (r, o) = place(Point { x: 600.0, y: 300.0 }, (488.0, 316.0), LEFT_DOWN, &WORK);
        assert_eq!(o, LEFT_DOWN);
        assert!(inside(&r, &WORK));
    }

    #[test]
    fn placement_flips_the_side_near_the_right_edge_and_the_vertical_near_the_bottom() {
        let near_right = Point { x: 1920.0 - 24.0 - SEAL, y: 300.0 };
        let (r, o) = place(near_right, (488.0, 316.0), LEFT_DOWN, &WORK);
        assert_eq!(o.side, Side::Right, "the paper has to go to the other side of the seal");
        assert!(inside(&r, &WORK));
        assert_eq!(seal_origin(&r, o), near_right, "flipping keeps the seal where it was");

        let near_bottom = Point { x: 600.0, y: 1040.0 - 24.0 - SEAL };
        let (r, o) = place(near_bottom, (488.0, 656.0), LEFT_DOWN, &WORK);
        assert_eq!(o.valign, VAlign::Up);
        assert!(inside(&r, &WORK));
    }

    #[test]
    fn placement_slides_the_least_distance_when_no_orientation_fits() {
        let small = Rect { x: 0.0, y: 0.0, width: 600.0, height: 500.0 };
        let (r, _) = place(Point { x: 300.0, y: 200.0 }, (488.0, 656.0), LEFT_DOWN, &small);
        assert!(r.y >= small.y && r.x >= small.x);
        assert!(r.x + r.width <= small.x + small.width);
    }

    #[test]
    fn a_tab_sits_flush_to_its_edge_and_stays_on_screen() {
        let left = tab_rect(Dock::Left, 400.0, (28.0, 96.0), &WORK);
        assert_eq!(left.x, 0.0);
        let right = tab_rect(Dock::Right, 400.0, (28.0, 96.0), &WORK);
        assert_eq!(right.x + right.width, 1920.0);
        let low = tab_rect(Dock::Left, 5000.0, (28.0, 96.0), &WORK);
        assert_eq!(low.y + low.height, 1040.0, "a tab dropped below the screen is pulled back");
        let seal = tab_seal(Dock::Left, &left);
        assert_eq!(seal.x, MARGIN, "she grows out of the tab against the same edge");
    }

    fn main_window() -> Rect {
        Rect { x: 200.0, y: 100.0, width: 1200.0, height: 800.0 }
    }

    #[test]
    fn a_seal_dropped_beside_main_snaps_to_its_edge() {
        let main = main_window();
        let right = Point { x: main.x + main.width + 10.0, y: 300.0 };
        assert_eq!(classify(right, Some(&main), &WORK), Snap::MainRight);
        let left = Point { x: main.x - SEAL - 10.0, y: 300.0 };
        assert_eq!(classify(left, Some(&main), &WORK), Snap::MainLeft);
    }

    #[test]
    fn a_seal_dropped_in_mains_bottom_right_corner_is_the_corner_snap() {
        let main = main_window();
        let p = Point { x: main.x + main.width - 16.0 - SEAL, y: main.y + main.height - 16.0 - SEAL };
        assert_eq!(classify(p, Some(&main), &WORK), Snap::MainCorner);
    }

    #[test]
    fn a_seal_at_a_screen_edge_docks_and_one_in_open_space_is_free() {
        assert_eq!(classify(Point { x: 10.0, y: 500.0 }, None, &WORK), Snap::ScreenLeft);
        assert_eq!(classify(Point { x: 1920.0 - SEAL - 10.0, y: 500.0 }, None, &WORK), Snap::ScreenRight);
        assert_eq!(classify(Point { x: 900.0, y: 500.0 }, None, &WORK), Snap::Free);
    }

    /// A maximised Main is flush to the screen edge. Its right edge must not swallow the screen's
    /// right edge, or a user with a maximised window could never dock her.
    #[test]
    fn a_maximised_main_does_not_make_docking_impossible() {
        let main = Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0 };
        let p = Point { x: 1920.0 - SEAL - 4.0, y: 300.0 };
        assert_eq!(classify(p, Some(&main), &WORK), Snap::ScreenRight);
    }

    #[test]
    fn a_card_arrival_never_takes_focus_and_a_user_show_does() {
        assert!(!takes_focus(Cause::Arrival));
        assert!(takes_focus(Cause::User));
        assert_eq!(cause_of(None), Cause::User, "absent means a user's show");
        assert_eq!(cause_of(Some(true)), Cause::User);
        assert_eq!(cause_of(Some(false)), Cause::Arrival);
    }

    #[test]
    fn a_toggle_puts_away_what_is_shown_and_shows_what_is_put_away() {
        assert_eq!(toggle_plan(true), Toggle::Hide);
        assert_eq!(toggle_plan(false), Toggle::Show);
        // Two presses come back to where they started.
        for start in [true, false] {
            let after_one = toggle_plan(start) == Toggle::Show;
            let after_two = toggle_plan(after_one) == Toggle::Show;
            assert_eq!(after_two, start);
        }
    }

    #[test]
    fn every_snap_spelling_round_trips_and_nonsense_is_refused() {
        for s in ["main.right", "main.left", "main.corner", "screen.left", "screen.right", "free"] {
            assert_eq!(snap_from_str(s).map(Snap::as_str), Some(s));
        }
        assert_eq!(snap_from_str("main"), None);
    }

    /// A requested snap must classify back to itself, or the next real drop would disagree.
    #[test]
    fn a_requested_snap_lands_where_the_drop_detector_would_call_it_the_same() {
        let main = main_window();
        let start = Point { x: 900.0, y: 400.0 };
        for snap in [Snap::MainRight, Snap::MainLeft, Snap::MainCorner, Snap::ScreenLeft, Snap::ScreenRight] {
            let p = snap_seal(snap, start, false, Some(&main), &WORK).expect("placeable");
            assert_eq!(classify(p, Some(&main), &WORK), snap, "{snap:?} landed at {p:?}");
        }
    }

    #[test]
    fn a_main_snap_without_main_is_refused_and_free_from_a_dock_steps_off_the_edge() {
        let seal = Point { x: 8.0, y: 300.0 };
        assert!(snap_seal(Snap::MainRight, seal, false, None, &WORK).is_err());
        assert!(snap_seal(Snap::ScreenLeft, seal, false, None, &WORK).is_ok());
        let p = snap_seal(Snap::Free, seal, true, None, &WORK).unwrap();
        assert_eq!(classify(p, None, &WORK), Snap::Free);
        assert_eq!(snap_seal(Snap::Free, Point { x: 900.0, y: 500.0 }, false, None, &WORK).unwrap(), Point { x: 900.0, y: 500.0 });
    }

    #[test]
    fn main_starts_at_1440_by_900_where_it_fits_and_shrinks_to_90_percent_where_it_does_not() {
        let big = main_start_rect(&WORK);
        assert_eq!((big.width, big.height), (1440.0, 900.0), "1920x1040 at 100%");
        assert_eq!((big.x, big.y), (240.0, 70.0), "centred");

        let hd150 = Rect { x: 0.0, y: 0.0, width: 1280.0, height: 672.0 };
        let r = main_start_rect(&hd150);
        assert_eq!((r.width, r.height), (1152.0, 604.0), "1080p at 150%");
        assert!(r.y + r.height <= hd150.height && r.x >= 0.0 && r.y >= 0.0);

        let uhd = Rect { x: 0.0, y: 0.0, width: 3840.0, height: 2080.0 };
        let r = main_start_rect(&uhd);
        assert_eq!((r.width, r.height), (1440.0, 900.0), "4K at 100%");
    }

    #[test]
    fn main_is_never_smaller_than_its_minimum_even_on_a_tiny_work_area() {
        let tiny = Rect { x: 0.0, y: 0.0, width: 800.0, height: 500.0 };
        let r = main_start_rect(&tiny);
        assert_eq!((r.width, r.height), MAIN_MIN);
        assert!(r.x >= 0.0 && r.y >= 0.0, "the title buttons stay reachable");
    }

    #[test]
    fn a_main_snap_follows_main_and_the_others_do_not() {
        let main = main_window();
        let seal = Point { x: 0.0, y: 50.0 };
        let p = follow(Snap::MainRight, seal, &main).expect("a main snap follows");
        assert_eq!(p.x, main.x + main.width + MARGIN);
        assert!(p.y >= main.y && p.y + SEAL <= main.y + main.height, "she stays alongside Main");
        assert!(follow(Snap::ScreenLeft, seal, &main).is_none());
        assert!(follow(Snap::Free, seal, &main).is_none());
    }

    #[test]
    fn a_saved_dock_comes_back_only_on_a_monitor_that_is_still_connected() {
        let one = [Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0 }];
        let saved = dock_record(Point { x: 1700.0, y: 900.0 }, Snap::MainRight);
        assert_eq!(
            restore_seal(&saved, &one),
            Some((Point { x: 1700.0, y: 900.0 }, Snap::MainRight)),
            "her seal and its snap return"
        );

        let on_a_gone_monitor = dock_record(Point { x: 2500.0, y: 300.0 }, Snap::ScreenRight);
        assert_eq!(restore_seal(&on_a_gone_monitor, &one), None, "the default stands");
        let two = [one[0], Rect { x: 1920.0, y: 0.0, width: 1920.0, height: 1040.0 }];
        assert!(restore_seal(&on_a_gone_monitor, &two).is_some(), "and returns when it is back");

        for broken in [
            serde_json::Value::Null,
            serde_json::json!({ "x": 10.0, "y": 10.0, "snap": "sideways" }),
            serde_json::json!({ "x": "10", "y": 10.0, "snap": "free" }),
        ] {
            assert_eq!(restore_seal(&broken, &one), None, "{broken} is not a place");
        }
    }
}
