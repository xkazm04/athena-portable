/**
 * The scenario for the bell preview — README section 3.1, ADR 0089. Four bells run their own
 * CSS animations; the person looks left, right and back, for about three seconds. The gate then
 * holds that nothing asked the browser for a frame afterwards, because nothing is meant to.
 */
export default async function drive(page) {
  await page.waitForSelector('[data-pose-card="asking"]');
  await page.waitForTimeout(400);
  for (const lean of [-1, 1, 0, 1, -1, 0]) {
    await page.click(`[data-lean="${lean}"]`);
    await page.waitForTimeout(500);
  }
}

drive.title = "four poses, nine tendrils, six looks";
