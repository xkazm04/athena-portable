/**
 * The scenario for her face — README section 3.1, ADR 0089, ADR 0120.
 *
 * The origami (the heavier form: 19 layers, the hinged mouth and eight floating shards) speaks the
 * spike's calm line from its viseme timeline, about five seconds, then lingers idle and settles. The
 * gate judges the frames of the whole speaking-and-settling window against the budgets, one frame
 * callback per frame, and then holds that a settled face asks the browser for no frame at all.
 * `?avatar=b04-owl` measures the owl the same way (`--url ... --drive scripts/perf-avatar.drive.mjs`).
 */
export default async function drive(page) {
  await page.waitForSelector('[data-face="ready"]', { timeout: 15000 });
  // settle the first idle life, so the measured window starts from rest
  await page.waitForSelector('[data-face-loop="still"]', { timeout: 15000 });
  await page.click("[data-avatar-play]");
  await page.waitForSelector('[data-face-loop="running"]', { timeout: 2000 });
  await page.waitForTimeout(5200);
  // the line has ended: she lingers idle, then settles; the gate's quiet second follows
  await page.waitForSelector('[data-face-loop="still"]', { timeout: 15000 });
}

drive.title = "the origami speaks one line, lingers and settles";
drive.query = "&avatar=d08-origami&fixture=calm&size=520";
