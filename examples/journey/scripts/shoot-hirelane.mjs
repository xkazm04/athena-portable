// Hirelane only, at every depth and at two viewports, for a design pass.
//
//   node examples/journey/scripts/shoot-hirelane.mjs <out dir> <tag>
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "shots/hirelane";
const tag = process.argv[3] ?? "now";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

const call = (page, name, args = {}) =>
  page.evaluate(
    async ([n, a]) => {
      const r = await document.modelContext.executeTool(n, JSON.stringify(a));
      return typeof r === "string" ? r : JSON.stringify(r);
    },
    [name, args],
  );

for (const [size, width, height] of [
  ["1440", 1440, 900],
  ["1024", 1024, 768],
]) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const shot = async (name) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/hirelane-${size}-${name}-${tag}.png` });
    console.log("shot", size, name);
  };

  await page.goto("http://localhost:3002/", { waitUntil: "networkidle" });
  await page.waitForFunction(
    async () => (await document.modelContext?.getTools?.())?.length > 5,
    null,
    { timeout: 30_000 },
  );

  await shot("L0");
  await call(page, "set_filter", { arguable: true });
  await shot("L0-arguable");
  await call(page, "set_filter", { arguable: false });

  await call(page, "open_group", { id: "screening::role_backend" });
  await page.waitForTimeout(1200);
  await shot("L1");

  const apps = JSON.parse(
    await call(page, "read_applicants", { role_id: "role_backend", borderline: true }),
  );
  await call(page, "open_item", {
    id: apps.applicants[0].id,
    group: "screening::role_backend",
  });
  await page.waitForTimeout(1200);
  await shot("L2");

  await ctx.close();
}

await browser.close();
