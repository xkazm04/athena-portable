/**
 * The scenario for the Accounts depth — README sections 3.1 and 4, ADR 0089. The person is already
 * in the depth (`preview.html?scene=accounts`): they look along the accounts and back (the
 * marquee swaps, the cards lift), open one, step into its allow-list, type a draft and drop it with
 * Escape, then rise twice. The gate then holds that the settled scene asks for no frames.
 */
const MOVE = 460; // a move is 360 ms; the margin is for the browser, not for the page

export default async function drive(page) {
  await page.waitForSelector(".card");
  await page.waitForTimeout(400);
  const cards = await page.$$(".card");
  for (const card of [...cards, ...cards.slice().reverse()]) {
    await card.hover();
    await page.waitForTimeout(220);
  }
  await page.click('[data-go="notion"]');
  await page.waitForTimeout(MOVE);
  await page.click("text=Edit the page ids");
  await page.waitForTimeout(MOVE);
  await page.fill("input.input", "0123");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(MOVE);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(MOVE);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

drive.title = "look along the accounts, open one, edit its allow-list, rise twice";
