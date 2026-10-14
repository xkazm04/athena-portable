/**
 * The scenario for the Chores depth — README section 3.5, ADR 0089 and 0096. The person walks the
 * catalogue's rows with the arrows, narrows it by an area and a job, orders it by value and by time,
 * opens a playbook's topic page from its row, enlarges a still and steps the lightbox, opens the fit
 * and closes it, dives into the replay, steps through it by arrow, and rises back to the catalogue.
 * The gate then holds that the settled scene asks for no frames and that no step, pick or dive ran a
 * long task.
 */
export default async function drive(page) {
  await page.waitForSelector("tbody tr[aria-selected]");
  await page.waitForTimeout(400);

  // Walk the catalogue: every step moves the pick, and opens nothing.
  await page.locator("tbody tr[aria-selected]").first().focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(120);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(120);
  }

  // Narrow it and order it.
  const tabs = await page.$$(".pa-tab:not([disabled])");
  for (const t of tabs.slice(1, 4)) {
    await t.click();
    await page.waitForTimeout(200);
  }
  await tabs[0].click();
  await page.waitForTimeout(200);
  for (const name of ["Recover money", "All jobs", "Most value", "Most time saved", "Best edge"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(200);
  }

  // Open the first playbook's topic page from its row.
  await page.locator("tbody tr[aria-selected]").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".pa-topic");
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);

  // Enlarge a still, step the lightbox, close it.
  const frame = page.locator(".pa-frame").first();
  if (await frame.count()) {
    await frame.click();
    await page.waitForSelector(".lbx");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // The fit opens at the page's foot and closes.
  await page.getByRole("button", { name: "Fit it to me" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);

  // Dive into the replay. Not every chore has a run to watch; the fixture's first does.
  await page.getByRole("button", { name: "Watch the run turn by turn" }).click();
  await page.waitForSelector(".ch-dot", { timeout: 4000 });
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(450);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(450);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(450);

  // Rise: the replay, the topic, the catalogue.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

drive.title = "walk the catalogue, filter and order it, open a topic, enlarge a still, replay its run, rise";
// The shipped set: a hundred rows is the case the budget is for, and its first chore has a run.
drive.query = "&fixture=shipped";
