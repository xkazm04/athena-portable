/**
 * The scenario for the Chores depth — README section 3.5, ADR 0089. The person looks across the
 * map (the marquee swaps), opens a chore, reads two of its parts, dives into its replay, steps
 * through it by button and by arrow, and rises back to the field. The gate then holds that the
 * settled scene asks for no frames and that no step, hover or dive ran a long task.
 */
export default async function drive(page) {
  await page.waitForSelector(".ch-mark");
  await page.waitForTimeout(400);

  const marks = await page.$$(".ch-mark");
  for (const mark of [...marks, ...marks.slice().reverse()]) {
    await mark.hover();
    await page.waitForTimeout(120);
  }

  // Open the first chore, read its proof and its run, dive into the replay.
  await marks[0].click();
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
  const watch = await page.$$("button");
  for (const b of watch) {
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

  // Rise: the replay, the chore, the field.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

drive.title = "look across the map, open a chore, replay its run, rise";
