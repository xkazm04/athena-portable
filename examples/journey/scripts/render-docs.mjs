#!/usr/bin/env node
/**
 * WP-V (nvidia-revisit): render the document corpus to PNG at three degradations, and the letters to PDF.
 *
 * Usage: node examples/journey/scripts/render-docs.mjs --manifest <manifest.json>
 *
 * The manifest is `[{ html, prefix, pdf }]`. For each job it writes
 *   <prefix>.clean.png   the page as it is
 *   <prefix>.skew.png    rotated 1.5 degrees, over a fixed-seed noise overlay
 *   <prefix>.scan.png    rendered at 0.5x, upscaled, greyscale, blurred (a low-resolution scan)
 *   <prefix>.pdf         when `pdf` is true
 * Pages are 794x1123 CSS px at 1.25x device scale (992x1404 px), so the long edge stays under the
 * 1600 px the vision model is sent. Nothing random is used; the same HTML gives the same pictures
 * wherever Chromium allows.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const W = 794;
const H = 1123;
const SCALE = 1.25;

const NOISE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' seed='7'/>" +
  "<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#n)'/></svg>";
const NOISE = `data:image/svg+xml;utf8,${encodeURIComponent(NOISE_SVG)}`;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const manifestPath = arg('--manifest');
if (!manifestPath) {
  console.error('usage: render-docs.mjs --manifest <manifest.json>');
  process.exit(2);
}
const jobs = JSON.parse(readFileSync(manifestPath, 'utf8'));
const clip = { x: 0, y: 0, width: W, height: H };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  for (const job of jobs) {
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(job.html).href);
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(`${job.prefix}.clean.png`, await page.screenshot({ clip }));
    if (job.pdf) {
      writeFileSync(`${job.prefix}.pdf`, await page.pdf({ width: `${W}px`, height: `${H}px`, printBackground: true }));
    }

    // skew + noise: the page turned on a desk, with a grain over it.
    await page.evaluate((noise) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#d9d6cf';
      const sheet = document.createElement('div');
      sheet.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;transform:rotate(1.5deg) scale(0.96);' +
        'transform-origin:50% 50%;background:#fff;box-shadow:0 0 18px rgba(0,0,0,.35);overflow:hidden';
      while (document.body.firstChild) sheet.appendChild(document.body.firstChild);
      wrap.appendChild(sheet);
      const grain = document.createElement('div');
      grain.style.cssText = `position:absolute;inset:0;background:url("${noise}");opacity:.22;mix-blend-mode:multiply;pointer-events:none`;
      wrap.appendChild(grain);
      document.body.appendChild(wrap);
    }, NOISE);
    writeFileSync(`${job.prefix}.skew.png`, await page.screenshot({ clip }));
    await page.close();

    // low-res scan: the clean page at 0.5x, then stretched back up, grey and soft.
    const lowCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 0.5 });
    const low = await lowCtx.newPage();
    await low.goto(pathToFileURL(job.html).href);
    const small = await low.screenshot({ clip });
    await lowCtx.close();
    const up = await ctx.newPage();
    await up.setContent(
      `<body style="margin:0;background:#fff"><img style="display:block;width:${W}px;height:${H}px;` +
        `filter:grayscale(1) blur(0.7px) contrast(0.92)" src="data:image/png;base64,${small.toString('base64')}"></body>`,
    );
    await up.waitForFunction(() => document.images[0].complete);
    writeFileSync(`${job.prefix}.scan.png`, await up.screenshot({ clip }));
    await up.close();
  }
} finally {
  await browser.close();
}
