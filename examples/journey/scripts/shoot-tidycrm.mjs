// Tidycrm — The Blocks, at every depth, for the design review. Drives the page through the kit's
// document.modelContext directly (not through the bridge): this is a camera, not a test.
//
//   node examples/journey/scripts/shoot-tidycrm.mjs <out dir> [tag]
//
// Shoots 1440x900 and 1024x768 at each of the three depths, so the "no overlapping text at either
// size" rule of the review is checked by looking rather than by hoping.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "shots/tidycrm";
const tag = process.argv[3] ?? "";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
];

const browser = await chromium.launch();

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  const call = (name, args = {}) =>
    page.evaluate(
      async ([n, a]) => {
        const r = await document.modelContext.executeTool(n, JSON.stringify(a));
        return typeof r === "string" ? r : JSON.stringify(r);
      },
      [name, args],
    );
  const shot = async (name) => {
    await page.waitForTimeout(700);
    const file = `${out}/tidycrm-${name}${tag ? `-${tag}` : ""}-${size.name}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log("shot", file);
  };

  await page.goto("http://localhost:3004/", { waitUntil: "networkidle" });
  await page.waitForFunction(
    async () => (await document.modelContext?.getTools?.())?.length > 5,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2500);

  await shot("L0");
  await call("show_breakdown", { open: true });
  await shot("L0-breakdown");
  await call("open_group", { id: "A" });
  await page.waitForTimeout(3500);
  await shot("L1");
  const blocks = JSON.parse(await call("search_blocks", { zone: "A" }));
  const ident = blocks.items[0].id ?? blocks.items[0].ident;
  await call("open_item", { id: ident, group: "A" });
  await page.waitForTimeout(1500);
  await shot("L2");

  await ctx.close();
}

await browser.close();
