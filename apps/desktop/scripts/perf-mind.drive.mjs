/**
 * The scenario for the Mind depth — README section 3.5, ADR 0089. Look along the five instruments,
 * open the look, step through its three choices, rise, open the engine and rise. The gate holds
 * frame time and long tasks over the moves and that the settled depth asks for no frames.
 */
export default async function drive(page) {
  await page.waitForSelector(".mind__instrument");
  await page.waitForTimeout(400);
  const tiles = await page.$$(".mind__instrument");
  for (const tile of tiles) {
    await tile.hover();
    await page.waitForTimeout(150);
  }
  await tiles[2].click();
  await page.waitForTimeout(480);
  for (const word of ["light", "compact", "dark"]) {
    await page.click(`[role="radio"]:has-text("${word}")`);
    await page.waitForTimeout(160);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(480);
  const again = await page.$$(".mind__instrument");
  await again[0].click();
  await page.waitForTimeout(480);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(480);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

/** A query string for the preview: the fixture this scenario is about. */
drive.query = "&fixture=typical";
drive.title = "look along the instruments, open the look, change it, open the engine, rise";
