/**
 * The desktop recorder's beat vocabulary, offline: `scripts/lib/desktop-steps.mjs` parses every
 * step `record-desktop.mjs` performs, so a script it could not play is refused by `--dry` before
 * the operator starts a capture. `pnpm test:unit` runs this file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkDesktopActs, devBuildSigns, hashOf, parseStep } from '../lib/desktop-steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..', '..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(JOURNEY, rel), 'utf8'));

test('a step names its page, and only the first colon splits the argument', () => {
  assert.deepEqual(parseStep('approve'), { verb: 'approve', arg: undefined, page: 'athena' });
  assert.deepEqual(parseStep('open-record'), { verb: 'open-record', arg: undefined, page: 'athena' });
  assert.deepEqual(parseStep('finder:Studio books'), { verb: 'finder', arg: 'Studio books', page: 'main' });
  assert.deepEqual(parseStep('page:http://localhost:3001'), { verb: 'page', arg: 'http://localhost:3001', page: 'main' });
  assert.deepEqual(parseStep('pause:1200'), { verb: 'pause', arg: '1200', page: null });
});

test('a step the recorder cannot perform is refused with a reason', () => {
  assert.throws(() => parseStep('click:#x'), /unknown desktop step/);
  assert.throws(() => parseStep('finder'), /needs an argument/);
  assert.throws(() => parseStep('finder:  '), /needs an argument/);
  assert.throws(() => parseStep('send:now'), /takes no argument/);
  assert.throws(() => parseStep('pause:0'), /1 to 30000/);
  assert.throws(() => parseStep('pause:soon'), /1 to 30000/);
  assert.throws(() => parseStep('page:localhost:3001'), /an origin/);
  assert.throws(() => parseStep('page:http://localhost:3001/invoices'), /an origin/);
  assert.throws(() => parseStep(''), /non-empty/);
});

test('surface and page set the hash the depth grammar reads (depth/model.ts formatHash)', () => {
  assert.equal(hashOf(parseStep('surface')), '#/');
  assert.equal(hashOf(parseStep('page:http://localhost:3001')), '#/apps/http%3A%2F%2Flocalhost%3A3001/page');
  assert.throws(() => hashOf(parseStep('send')), /sets no hash/);
});

test('checkDesktopActs lists every bad step and cue by beat, and passes a playable act', () => {
  const acts = [
    {
      id: 'a',
      beats: [
        { id: 'X1', do: ['surface', 'finder:Studio books'] },
        { id: 'X2', cue: 'card' },
        { id: 'X3', cue: 'end', do: ['wave'] },
      ],
    },
  ];
  assert.deepEqual(checkDesktopActs(acts), ['X3: unknown desktop cue end', 'X3: unknown desktop step: wave']);
  assert.deepEqual(checkDesktopActs([acts[0].beats.slice(0, 2)].map((beats) => ({ id: 'a', beats }))), []);
});

test('every desktop act of the shipped scripts is playable', () => {
  for (const rel of ['script/film.en.json', 'script/proving.en.json']) {
    const acts = readJson(rel).acts.filter((a) => a.segment === 'desktop');
    assert.ok(acts.length > 0, `${rel} has desktop acts`);
    assert.deepEqual(checkDesktopActs(acts), [], rel);
  }
});

test('devBuildSigns names a blob shared worker or a page served by the Vite dev server, and nothing else', () => {
  const built = [
    { type: 'page', url: 'http://tauri.localhost/chrome.html' },
    { type: 'page', url: 'http://tauri.localhost/athena.html' },
    { type: 'service_worker', url: 'https://example.test/sw.js' },
  ];
  assert.deepEqual(devBuildSigns(built), []);
  const dev = [
    { type: 'page', url: 'http://localhost:1431/chrome.html' },
    { type: 'shared_worker', url: 'blob:http://localhost:1431/0f1e' },
    { type: 'page', url: 'http://localhost:3001/' },
  ];
  assert.deepEqual(devBuildSigns(dev).map((t) => t.type), ['page', 'shared_worker']);
  assert.deepEqual(devBuildSigns(undefined), []);
});
