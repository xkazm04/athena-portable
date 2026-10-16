/**
 * The scenario for the Chores depth — README section 3.5, ADR 0089 and 0096. The person walks the
 * catalogue's rows with the arrows, narrows it by an area and a job, orders it by value and by time,
 * opens a playbook's topic page from its row, enlarges a still and steps the lightbox, presses the
 * page's first "Make it yours" control (the Adopt studio, ADR 0097, where the inline fit form was
 * until it was replaced) and closes it, dives into the replay, steps through it by arrow, and rises
 * back to the catalogue.
 * The gate then holds that the settled scene asks for no frames and that no step, pick or dive ran a
 * long task.
 */

/**
 * Every control the drive presses by its name, by the level it is pressed on. `perf-chores.drive.test.ts`
 * renders each level of the scene from the drive's own fixture and holds that every name is there,
 * so a renamed or removed control fails `pnpm test` instead of a perf run half an hour later.
 */
export const CONTROLS = {
  catalogue: ["Recover money", "All jobs", "Most value", "Most time saved", "Best edge"],
  topic: ["Talk it through with her", "Watch the run turn by turn"],
  adopt: ["Close"],
};

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
  for (const name of CONTROLS.catalogue) {
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

  // Enlarge a still, step the lightbox, close it. The fixture's first chore has stills
  // (perf-chores.drive.test.ts), so a missing one is a failure, never a step skipped in silence.
  await page.locator(".pa-frame").first().click();
  await page.waitForSelector(".lbx");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Make it yours: the studio opens from the page's foot and closes back to the page. The preview
  // hands the shipped fixture no daemon, so the studio draws its own "needs the daemon" note.
  await page.getByRole("button", { name: CONTROLS.topic[0], exact: true }).click();
  await page.waitForSelector(".ad-page");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: CONTROLS.adopt[0], exact: true }).click();
  await page.waitForSelector(".pa-topic");
  await page.waitForTimeout(300);

  // Dive into the replay. Not every chore has a run to watch; the fixture's first does.
  await page.getByRole("button", { name: CONTROLS.topic[1], exact: true }).click();
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

drive.title = "walk the catalogue, filter and order it, open a topic, enlarge a still, open and close the studio, replay its run, rise";
// The shipped set: a hundred rows is the case the budget is for, and its first chore has a run.
drive.query = "&fixture=shipped";
