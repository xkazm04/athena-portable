// Ledgerbox only, at both review widths, for the UI polish pass.
//
//   node examples/journey/scripts/shoot-ledgerbox.mjs <out dir>
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "shots/polish/before";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

const call = (page, name, args = {}) =>
  page.evaluate(async ([n, a]) => {
    const r = await document.modelContext.executeTool(n, JSON.stringify(a));
    return typeof r === "string" ? r : JSON.stringify(r);
  }, [name, args]);

for (const [tag, viewport] of [
  ["1440", { width: 1440, height: 900 }],
  ["1024", { width: 1024, height: 768 }],
]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const shot = async (name) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/ledgerbox-${name}-${tag}.png` });
    console.log("shot", name, tag);
  };

  await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });
  await page.waitForFunction(async () => (await document.modelContext?.getTools?.())?.length > 5, null, {
    timeout: 30_000,
  });

  await shot("L0");
  const view = JSON.parse(await call(page, "read_view"));
  const area = view.areas.items[0].id;
  await call(page, "open_group", { id: area });
  await shot("L1");
  const l1 = JSON.parse(await call(page, "read_view"));
  const inv =
    l1.detail?.invoices?.[0]?.id ??
    JSON.parse(await call(page, "read_inbox", { filter: "overdue" })).items[0].id;
  await call(page, "open_item", { id: inv });
  await shot("L2");
  await call(page, "zoom_out");
  await call(page, "zoom_out");
  await call(page, "navigate", { view: "overdue" });
  await shot("L0-overdue");
  await ctx.close();
}

await browser.close();
