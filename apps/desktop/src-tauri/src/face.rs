//! Athena's face, mirrored to Main (the ADR on Athena's face; ADR 0026, ADR 0027's face cap, 40 Hz since its 2026-10-25 amendment).
//!
//! **One producer.** The `athena` window owns her voice, so it reduces the voice, its mouth
//! timeline and its motion track to one `FaceSignal` a frame (`src/avatar/types.ts`) and calls
//! `athena_face` at most `FACE_MIRROR_HZ` times a second (`src/lib/face.ts`). This file validates
//! the signal exactly as `halo.rs` validates the halo's - an unknown phase or mouth shape is
//! refused, every number is clamped into its range and a non-number is 0, a motion channel the
//! track leaves out stays `null` (no say, never 0) - and re-emits it as
//! `athena:face` to the chrome webview only, with `ui_emit_to`. Main's surfaces read it through
//! `mainFaceSource()`; no page webview ever hears it.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::halo::Phase;

/// The event Main receives. The page spells it `FACE_EVENT`.
pub const FACE_EVENT: &str = "athena:face";

/// The furthest a head turns, in degrees, on any axis. A 2D layer rig cannot show more without
/// tearing; the producer's own motion stays well inside it, so this only stops a bad frame.
pub const HEAD_MAX_DEG: f64 = 45.0;

/// The Oculus 15 mouth shapes, the page's `VISEMES`, in the same order.
pub const VISEMES: [&str; 15] = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"];

/// Head and eye pose as it arrives. Every channel is optional: a channel the motion track does
/// not drive is absent or `null` ("no say": the face keeps its own motion there), never 0, which
/// is a say (gaze 0 centres her eyes on purpose). A frame with every channel parses as before.
#[derive(Clone, Debug, Deserialize)]
pub struct RawMotion {
    #[serde(default)]
    pub yaw: Option<f64>,
    #[serde(default)]
    pub pitch: Option<f64>,
    #[serde(default)]
    pub roll: Option<f64>,
    /// `null` when the motion model does not drive the eyelids (the avatar blinks on its own).
    #[serde(default)]
    pub blink: Option<f64>,
    #[serde(default, rename = "gazeX")]
    pub gaze_x: Option<f64>,
    #[serde(default, rename = "gazeY")]
    pub gaze_y: Option<f64>,
}

/// The signal as it arrives: phase and viseme are strings until [`FaceSignal::parse`] has looked.
#[derive(Clone, Debug, Deserialize)]
pub struct RawFaceSignal {
    pub phase: String,
    pub level: f64,
    pub viseme: Option<String>,
    pub open: f64,
    pub motion: Option<RawMotion>,
    pub generation: u64,
}

/// Head and eye pose, clamped: head in degrees within [`HEAD_MAX_DEG`], blink 0..1, gaze -1..1;
/// a channel nobody drives is `null` (serialised as `null`, never absent).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Motion {
    pub yaw: Option<f64>,
    pub pitch: Option<f64>,
    pub roll: Option<f64>,
    pub blink: Option<f64>,
    #[serde(rename = "gazeX")]
    pub gaze_x: Option<f64>,
    #[serde(rename = "gazeY")]
    pub gaze_y: Option<f64>,
}

/// One frame of her face: the Rust mirror of `FaceSignal`. `viseme` and `motion` serialise as
/// `null`, never absent, as the page's contract spells them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FaceSignal {
    pub phase: Phase,
    pub level: f64,
    pub viseme: Option<String>,
    pub open: f64,
    pub motion: Option<Motion>,
    pub generation: u64,
}

/// Clamp a number into `lo..=hi`; a non-number is 0 (which lies in every range used here).
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v.is_finite() { v.clamp(lo, hi) } else { 0.0 }
}

impl FaceSignal {
    /// Validate a raw signal: an unknown phase or mouth shape is an error naming what it was
    /// given; level and open are clamped into 0..1, the pose into its ranges.
    pub fn parse(raw: RawFaceSignal) -> Result<Self, String> {
        let phase = Phase::parse(&raw.phase).map_err(|_| format!("unknown face phase \"{}\"", raw.phase))?;
        let viseme = match raw.viseme {
            Some(v) if VISEMES.contains(&v.as_str()) => Some(v),
            Some(v) => return Err(format!("unknown viseme \"{v}\"")),
            None => None,
        };
        let head = |v: Option<f64>| v.map(|v| clamp(v, -HEAD_MAX_DEG, HEAD_MAX_DEG));
        let motion = raw.motion.map(|m| Motion {
            yaw: head(m.yaw),
            pitch: head(m.pitch),
            roll: head(m.roll),
            blink: m.blink.map(|b| clamp(b, 0.0, 1.0)),
            gaze_x: m.gaze_x.map(|g| clamp(g, -1.0, 1.0)),
            gaze_y: m.gaze_y.map(|g| clamp(g, -1.0, 1.0)),
        });
        Ok(Self {
            phase,
            level: clamp(raw.level, 0.0, 1.0),
            viseme,
            open: clamp(raw.open, 0.0, 1.0),
            motion,
            generation: raw.generation,
        })
    }
}

// ==============================================================================================
// Commands. Each needs three edits: here, `build.rs`, and `capabilities/athena.json`.
// ==============================================================================================

/// The `athena` window's one way to show her face in Main. A bad signal is refused, not drawn.
#[tauri::command(rename_all = "snake_case")]
pub async fn athena_face(app: AppHandle, signal: RawFaceSignal) -> Result<(), String> {
    let parsed = FaceSignal::parse(signal)?;
    crate::ui_emit_to(&app, crate::CHROME_WEBVIEW, FACE_EVENT, parsed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(phase: &str, level: f64, open: f64) -> RawFaceSignal {
        RawFaceSignal { phase: phase.to_string(), level, viseme: None, open, motion: None, generation: 3 }
    }

    #[test]
    fn every_phase_parses_and_an_unknown_phase_or_viseme_is_an_error_string() {
        for p in ["idle", "listening", "thinking", "speaking", "gate"] {
            let s = FaceSignal::parse(raw(p, 0.0, 0.0)).expect("a known phase");
            assert_eq!(serde_json::to_value(s.phase).unwrap(), serde_json::json!(p));
        }
        let err = FaceSignal::parse(raw("dancing", 0.0, 0.0)).unwrap_err();
        assert!(err.contains("dancing"), "the error names what it was given: {err}");

        for v in VISEMES {
            let mut r = raw("speaking", 0.5, 0.5);
            r.viseme = Some(v.to_string());
            assert_eq!(FaceSignal::parse(r).unwrap().viseme.as_deref(), Some(v));
        }
        let mut r = raw("speaking", 0.5, 0.5);
        r.viseme = Some("zz".to_string());
        assert!(FaceSignal::parse(r).unwrap_err().contains("zz"));
    }

    #[test]
    fn level_and_open_are_clamped_into_zero_to_one_and_a_non_number_is_zero() {
        let s = FaceSignal::parse(raw("speaking", 1.7, -0.3)).unwrap();
        assert_eq!((s.level, s.open), (1.0, 0.0));
        let s = FaceSignal::parse(raw("speaking", f64::NAN, f64::INFINITY)).unwrap();
        assert_eq!((s.level, s.open), (0.0, 0.0));
        let s = FaceSignal::parse(raw("speaking", 0.4, 0.6)).unwrap();
        assert_eq!((s.level, s.open), (0.4, 0.6));
    }

    #[test]
    fn the_pose_is_clamped_into_its_ranges() {
        let mut r = raw("speaking", 0.0, 0.0);
        r.motion = Some(RawMotion {
            yaw: Some(90.0),
            pitch: Some(-400.0),
            roll: Some(12.5),
            blink: Some(2.0),
            gaze_x: Some(-3.0),
            gaze_y: Some(f64::NAN),
        });
        let m = FaceSignal::parse(r).unwrap().motion.unwrap();
        assert_eq!(
            m,
            Motion {
                yaw: Some(HEAD_MAX_DEG),
                pitch: Some(-HEAD_MAX_DEG),
                roll: Some(12.5),
                blink: Some(1.0),
                gaze_x: Some(-1.0),
                gaze_y: Some(0.0),
            }
        );

        let mut r = raw("speaking", 0.0, 0.0);
        r.motion = Some(RawMotion { yaw: Some(0.0), pitch: Some(0.0), roll: Some(0.0), blink: None, gaze_x: Some(0.0), gaze_y: Some(0.0) });
        assert_eq!(FaceSignal::parse(r).unwrap().motion.unwrap().blink, None, "a blink nobody drives stays null");
    }

    #[test]
    fn a_channel_the_track_omits_crosses_as_null_and_a_zero_stays_a_zero() {
        // Absent or null: no say, and it goes on as null (her own motion keeps that channel).
        let head_only = serde_json::json!({
            "phase": "speaking", "level": 0.5, "viseme": null, "open": 0.25,
            "motion": { "yaw": 4.0, "pitch": -2.0, "roll": 1.0 },
            "generation": 7,
        });
        let s = FaceSignal::parse(serde_json::from_value(head_only).unwrap()).unwrap();
        let out = serde_json::to_value(&s).unwrap();
        assert_eq!(
            out["motion"],
            serde_json::json!({ "yaw": 4.0, "pitch": -2.0, "roll": 1.0, "blink": null, "gazeX": null, "gazeY": null }),
            "an omitted channel is null on the way out, never absent and never 0"
        );

        let explicit = serde_json::json!({
            "phase": "speaking", "level": 0.5, "viseme": null, "open": 0.25,
            "motion": { "yaw": null, "pitch": null, "roll": null, "blink": null, "gazeX": 0.0, "gazeY": 0.0 },
            "generation": 7,
        });
        let s = FaceSignal::parse(serde_json::from_value(explicit.clone()).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&s).unwrap(), explicit, "gaze 0 is centred on purpose and stays 0");
    }

    #[test]
    fn the_wire_shape_round_trips_with_null_viseme_and_motion_and_with_both() {
        let quiet = serde_json::json!({
            "phase": "idle", "level": 0.0, "viseme": null, "open": 0.0, "motion": null, "generation": 0,
        });
        let s = FaceSignal::parse(serde_json::from_value(quiet.clone()).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&s).unwrap(), quiet);

        let speaking = serde_json::json!({
            "phase": "speaking", "level": 0.5, "viseme": "aa", "open": 0.75,
            "motion": { "yaw": 4.0, "pitch": -2.0, "roll": 1.0, "blink": 0.0, "gazeX": 0.25, "gazeY": -0.5 },
            "generation": 7,
        });
        let s = FaceSignal::parse(serde_json::from_value(speaking.clone()).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&s).unwrap(), speaking);

        let undriven_blink = serde_json::json!({
            "phase": "speaking", "level": 0.5, "viseme": null, "open": 0.25,
            "motion": { "yaw": 4.0, "pitch": -2.0, "roll": 1.0, "blink": null, "gazeX": 0.25, "gazeY": -0.5 },
            "generation": 7,
        });
        let s = FaceSignal::parse(serde_json::from_value(undriven_blink.clone()).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&s).unwrap(), undriven_blink);
    }
}
