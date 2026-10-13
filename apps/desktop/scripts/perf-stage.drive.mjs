/**
 * The one fixed path the gate drives over the stage preview — README section 3.1, ADR 0089.
 * Surface, dive to a root, dive to an item, rise twice with Escape, then an interrupted dive
 * (dive, change your mind mid-move, dive elsewhere). Returns when the last move has finished.
 */
const MOVE = 460; // a move is 360 ms; the margin is for the browser, not for the page

export default async function drive(page) {
  await page.waitForSelector('[data-go="apps"]');
  await page.waitForTimeout(300);
  await page.click('[data-go="apps"]');
  await page.waitForTimeout(MOVE);
  await page.click('[data-go="host-1"]');
  await page.waitForTimeout(MOVE);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(MOVE);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(MOVE);
  await page.click('[data-go="apps"]');
  await page.waitForTimeout(120);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(90);
  await page.click('[data-go="mind"]');
  await page.waitForTimeout(MOVE + 300);
}
