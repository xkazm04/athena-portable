/**
 * The scenario for the Chores depth — README section 3.5, ADR 0089 and 0096. The person walks the
 * ledger's rows with the arrows (the preview follows each), narrows it by an area and a job, orders
 * it by value, looks across the map and picks a mark, opens the fit and closes it, then opens a
 * chore, reads two of its parts, dives into its replay, steps through it by button and by arrow,
 * and rises back to the ledger. The gate then holds that the settled scene asks for no frames and
 * that no step, pick or dive ran a long task.
 */
export default async function drive(page) {
  await page.waitForSelector("tbody tr[aria-selected]");
  await page.waitForTimeout(400);

  // Walk the ledger: every step moves the pick and redraws the preview.
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
  const areas = await page.$$(".ch-area");
  for (const a of areas.slice(1, 4)) {
    await a.click();
    await page.waitForTimeout(200);
  }
  await areas[0].click();
  await page.waitForTimeout(200);
  for (const name of ["Recover money", "Every job"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(200);
  }
  for (let i = 0; i < 3; i++) {
    await page.locator(".table__sort", { hasText: "Value" }).click();
    await page.waitForTimeout(200);
  }

  // The map: look across it and pick a few marks; then back.
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForSelector(".ch-mark");
  await page.waitForTimeout(300);
  const marks = await page.$$(".ch-mark");
  for (const mark of marks.slice(0, 24)) {
    await mark.hover();
    await page.waitForTimeout(60);
  }
  for (const mark of marks.slice(0, 4)) {
    await mark.click();
    await page.waitForTimeout(150);
  }
  await page.getByRole("button", { name: "Ledger", exact: true }).click();
  await page.waitForTimeout(300);

  // The fit opens in the pane and closes.
  await page.getByRole("button", { name: "Fit it to me" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);

  // Open the picked chore, read its proof and its run, dive into the replay.
  await page.getByRole("button", { name: "Open the full playbook" }).click();
  await page.waitForSelector(".ch-facet");
  await page.waitForTimeout(500);
  const facets = await page.$$(".ch-facet");
  for (const facet of facets.slice(2, 5)) {
    await facet.click();
    await page.waitForTimeout(150);
  }
  for (const facet of await page.$$(".ch-facet")) {
    if ((await facet.textContent())?.includes("Watch the run")) {
      await facet.click();
      await page.waitForTimeout(150);
      break;
    }
  }
  for (const b of await page.$$("button")) {
    if ((await b.textContent())?.trim() === "Watch the run") {
      await b.click();
      break;
    }
  }
  // Not every chore has a run to watch; the fixture's first does.
  await page.waitForSelector(".ch-dot", { timeout: 4000 });
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(450);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(450);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(450);

  // Rise: the replay, the chore, the ledger.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

drive.title = "walk the ledger, filter and order it, pick on the map, open a chore, replay its run, rise";
// The shipped set: a hundred rows is the case the budget is for, and its first chore has a run.
drive.query = "&fixture=shipped";
