/**
 * The scenario for the Apps depth — README section 3.4, ADR 0089. Look along the apps, open one,
 * open one of its tools, and rise back out with Escape; then look along the apps once more. The
 * gate holds frame time and long tasks over the moves and that the settled field asks for no frames.
 */
export default async function drive(page) {
  await page.waitForSelector(".apps__orb");
  await page.waitForTimeout(400);
  const orbs = await page.$$(".apps__orb");
  for (const orb of orbs) {
    await orb.hover();
    await page.waitForTimeout(160);
  }
  await orbs[0].click();
  await page.waitForTimeout(480);
  // Required, not "if there is one": a step skipped in silence is a shorter path judged green.
  await page.click(".apps__tool");
  await page.waitForTimeout(480);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(480);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(480);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

/** A query string for the preview: the fixture this scenario is about. */
drive.query = "&fixture=typical";
drive.title = "look along the apps, open one, open a tool, rise twice";
