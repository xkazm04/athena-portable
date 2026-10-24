/**
 * The scenario for the Loop Tide skin — README section 3.1, ADR 0142 and 0089. The stage's own
 * fixed path (dive, dive, rise, rise, an interrupted dive) in the skin, so the loop current is
 * pushed by every move and flows. It then coasts, slows and settles into its exposure, and the gate
 * holds that the settled water asks for no frames, as the product's own teal does.
 */
import stage from "./perf-stage.drive.mjs";

/** The current's coast (1.6 s), its slow-down and its 0.5 s cross-fade into the exposure, with margin. */
const SETTLE = 4200;

export default async function drive(page) {
  await page.waitForSelector(".backdrop__current");
  await stage(page);
  await page.waitForTimeout(SETTLE);
}

drive.title = "the stage's path in the skin, then the current settles";
drive.scene = "stage";
drive.query = "&skin=loop-tide";
