// Screenshots of the three apps at every depth, for a design review. Drives the pages through
// the kit's document.modelContext directly (not through the bridge): this is a camera, not a test.
//
//   node examples/journey/scripts/shoot.mjs <out dir>
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "shots/review";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const call = (name, args = {}) => page.evaluate(async ([n, a]) => {
  const r = await document.modelContext.executeTool(n, JSON.stringify(a));
  return typeof r === "string" ? r : JSON.stringify(r);
}, [name, args]);
const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };
const ready = async (url) => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(async () => (await document.modelContext?.getTools?.())?.length > 5, null, { timeout: 30_000 });
};

// Ledgerbox — The Lanes
await ready("http://localhost:3001/");
await shot("ledgerbox-L0");
const view = JSON.parse(await call("read_view"));
const area = view.areas.items[0].id;
await call("open_group", { id: area });
await shot("ledgerbox-L1");
const l1 = JSON.parse(await call("read_view"));
const inv = l1.detail?.invoices?.[0]?.id ?? JSON.parse(await call("read_inbox", { filter: "overdue" })).items[0].id;
await call("open_item", { id: inv });
await shot("ledgerbox-L2");
await call("zoom_out"); await call("zoom_out");
await call("navigate", { view: "overdue" });
await shot("ledgerbox-L0-overdue");

// Hirelane — The Board
await ready("http://localhost:3002/");
await shot("hirelane-L0");
await call("set_filter", { arguable: true });
await shot("hirelane-L0-arguable");
await call("set_filter", { arguable: false });
await call("open_group", { id: "screening::role_backend" });
await page.waitForTimeout(1200);
await shot("hirelane-L1");
const apps = JSON.parse(await call("read_applicants", { role_id: "role_backend", borderline: true }));
await call("open_item", { id: apps.applicants[0].id, group: "screening::role_backend" });
await page.waitForTimeout(1200);
await shot("hirelane-L2");

// Tidycrm — The Blocks
await ready("http://localhost:3004/");
await page.waitForTimeout(2500);
await shot("tidycrm-L0");
await call("show_breakdown", { open: true });
await shot("tidycrm-L0-breakdown");
await call("open_group", { id: "A" });
await page.waitForTimeout(3500);
await shot("tidycrm-L1");
const blocks = JSON.parse(await call("search_blocks", { zone: "A" }));
const ident = blocks.items[0].id ?? blocks.items[0].ident;
await call("open_item", { id: ident, group: "A" });
await page.waitForTimeout(1500);
await shot("tidycrm-L2");

await browser.close();
