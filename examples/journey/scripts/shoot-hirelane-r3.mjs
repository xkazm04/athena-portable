// Round 3, hirelane: the three spatial directions, each on the rubric path,
// plus a wheel-zoom strip and a drag strip per direction.
//
//   node examples/journey/scripts/shoot-hirelane-r3.mjs [out dir]
//
// The rubric path is the one every round drives: L0 -> open group -> L1 ->
// open item -> L2 -> Escape -> L1 -> Escape -> L0. It is driven through the
// app's own TOOLS rather than through clicks, because the round's claim is that
// a tool call and a click produce the same flight; if they did not, this script
// would be measuring a second code path.
//
// The camera strips are driven with real input — `mouse.wheel` and a pointer
// drag — because that is the half a tool cannot reach.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "shots/round3-hirelane";
mkdirSync(out, { recursive: true });

const VARIANTS = ["board", "rooms", "constellation"];
const GROUP = "screening::role_backend";

const browser = await chromium.launch();

const call = (page, name, args = {}) =>
  page.evaluate(
    async ([n, a]) => {
      const r = await document.modelContext.executeTool(n, JSON.stringify(a));
      return typeof r === "string" ? r : JSON.stringify(r);
    },
    [name, args],
  );

for (const variant of VARIANTS) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const shot = async (name, settle = 900) => {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${variant}-${name}.png` });
    console.log("shot", variant, name);
  };

  await page.goto(`http://localhost:3002/?dir=${variant}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    async () => (await document.modelContext?.getTools?.())?.length > 5,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(600);

  /* ---------------------------------------------------- the rubric path */
  await shot("00-L0");

  await call(page, "open_group", { id: GROUP });
  /* Mid-flight, so the level change is judged as a MOVE and not only as two
     resting states: 160ms is inside every budget this round set. */
  await page.waitForTimeout(160);
  await page.screenshot({ path: `${out}/${variant}-01-L0-to-L1-160ms.png` });
  await shot("02-L1");

  const apps = JSON.parse(
    await call(page, "read_applicants", { role_id: "role_backend", borderline: true }),
  );
  const who = apps.applicants[0].id;
  await call(page, "open_item", { id: who, group: GROUP });
  await page.waitForTimeout(160);
  await page.screenshot({ path: `${out}/${variant}-03-L1-to-L2-160ms.png` });
  await shot("04-L2");

  await page.keyboard.press("Escape");
  await shot("05-back-to-L1");
  await page.keyboard.press("Escape");
  await shot("06-back-to-L0");

  /* ------------------------------------------------------ the wheel strip */
  const box = await page.locator("[data-camera='rig']").first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(140);
    await page.screenshot({ path: `${out}/${variant}-wheel-${i}.png` });
  }
  console.log("strip", variant, "wheel");

  /* Back out however far the wheel took us, so the drag strip starts at rest. */
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(220);
  }
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 260);
  await page.waitForTimeout(700);

  /* ------------------------------------------------------- the drag strip */
  await page.mouse.move(cx + 260, cy + 60);
  await page.mouse.down();
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.move(cx + 260 - (i + 1) * 90, cy + 60 - (i + 1) * 18, { steps: 6 });
    await page.waitForTimeout(110);
    await page.screenshot({ path: `${out}/${variant}-drag-${i}.png` });
  }
  await page.mouse.up();
  console.log("strip", variant, "drag");

  await ctx.close();
}

await browser.close();
