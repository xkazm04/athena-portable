/**
 * The scenario for the surface — README section 3.1, ADR 0089. The person looks along the five
 * lights and back (her tendrils lean, the marquee swaps, the glyphs float), types a few words and
 * lets go. The gate then holds that the settled surface asks for no frames.
 */
export default async function drive(page) {
  await page.waitForSelector(".surface__light");
  await page.waitForTimeout(400);
  const lights = await page.$$(".surface__light");
  for (const light of [...lights, ...lights.slice().reverse()]) {
    await light.hover();
    await page.waitForTimeout(260);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
}

drive.title = "look along five lights and back";
