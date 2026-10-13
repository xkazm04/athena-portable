/**
 * The scenario for the Voice depth — README section 3.1, ADR 0089. The person looks at the two
 * places, dives into the studio and presses its keys (Enter, B, S, 1, Space held and released),
 * rises with Escape, dives into settings, moves through its controls and rises again. The gate then
 * holds that the settled scene asks for no frames: with nothing recording and nothing playing, the
 * waveform and the meters must not run.
 */
export default async function drive(page) {
  await page.waitForSelector(".vsc-place");
  await page.waitForTimeout(400);
  for (const place of await page.$$(".vsc-place")) {
    await place.hover();
    await page.waitForTimeout(260);
  }

  // Dive into the studio and work its keys. The preview's actions are inert, so the keys exercise
  // the handlers and the rail without changing the fixture.
  await (await page.$$(".vsc-place"))[0].click();
  await page.waitForSelector(".vsc--studio");
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
  for (const key of ["Enter", "b", "s", "1", "2"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
  }
  await page.keyboard.down(" ");
  await page.waitForTimeout(120);
  await page.keyboard.up(" ");
  await page.waitForTimeout(200);

  // Rise one level with Escape, then dive into settings.
  await page.keyboard.press("Escape");
  await page.waitForSelector(".vsc-place");
  await page.waitForTimeout(500);
  await (await page.$$(".vsc-place"))[1].click();
  await page.waitForSelector(".vsc--settings");
  await page.waitForTimeout(500);
  for (const label of ["Replace", "Keep the stored key"]) {
    await page.getByRole("button", { name: label }).click();
    await page.waitForTimeout(120);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

drive.title = "look at two places, work the studio's keys, rise, work settings, rise";
