/**
 * The scenario for the Wavefront skin — README section 3.1, ADR 0142 and 0089. The stage's own fixed
 * path (dive, dive, rise, rise, an interrupted dive) in the skin, so every move sends a wave across
 * the field. The waves then cross and the field lets the clock go, and the gate holds that the
 * settled water asks for no frames, as the product's own teal does.
 */
import stage from "./perf-stage.drive.mjs";

/** The arrival's last wave leaves at 2.85 s; a wave crosses a 1440x900 stage in about 3 s; with margin. */
const SETTLE = 6500;

export default async function drive(page) {
  await page.waitForSelector(".backdrop__wavefront");
  await stage(page);
  await page.waitForTimeout(SETTLE);
}

drive.title = "the stage's path in the skin, then the waves cross and the field rests";
drive.scene = "stage";
drive.query = "&skin=wavefront";
