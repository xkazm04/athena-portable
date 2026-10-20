/* Blue Hour · the landing. Every figure comes from fixtures.js; the art is drawn here and labelled as stylised. */
(function () {
  'use strict';
  const A = window.ATHENA, M = window.MUSE;
  const $ = s => document.querySelector(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => '$' + Number(n).toLocaleString('en-US');
  const usd = n => n == null ? '—' : '$' + n.toFixed(4);
  const body = document.body, stage = $('#stage'), scene = $('#scene'), tLayer = $('#trainLayer');
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  /* ------------------------------------------------------------ figures */
  const cards = A.cards;
  const held = cards.reduce((s, c) => s + c.amount, 0);
  const led = M.ledger;
  const spent = led.reduce((s, r) => s + (r.cost || 0), 0);
  const fails = led.filter(r => r.error);
  const base = M.proving.baseline;
  const bTurns = base.rows.reduce((s, r) => s + r.turns, 0), bBreach = base.rows.reduce((s, r) => s + r.breached, 0);
  const pressed = base.rows.reduce((s, r) => s + r.pressure, 0);
  const eMuse = M.engines.find(e => e.id === 'muse_spark'), eSam = M.engines.find(e => e.id === 'sam_3_1'), eLlama = M.engines.find(e => e.id === 'llama_baseten');
  const fact = (e, k) => (e.facts.find(f => f[0].toLowerCase().startsWith(k)) || [, '—'])[1];
  const engName = id => ({ muse_spark: 'Muse Spark', sam_3_1: 'SAM 3.1', llama_baseten: 'Llama · Baseten', cli: 'CLI engines' }[id] || id);
  const tagFor = t => { const k = /estimate/.test(t) ? 'est' : /measured/.test(t) ? 'meas' : /planned/.test(t) ? 'plan' : /unverified/.test(t) ? 'unv' : /simulated/.test(t) ? 'sim' : /design|decision/.test(t) ? 'rule' : 'keep'; return `<span class="tag ${k}">${esc(t)}</span>`; };

  /* ------------------------------------------------------------ the scene, generated parts */
  (function drawScene() {
    const sl = $('#sleepers');
    for (let x = -600; x < 2200; x += 22) el('rect', { x, y: 643, width: 10, height: 28, fill: '#0a0e19' }, sl);
    const cat = $('#catenary');
    const masts = [-500, -200, 100, 400, 700, 980, 1660, 1960];
    const wires = el('g', { fill: 'none', stroke: '#0a1120', 'stroke-width': 1.8 }, cat);
    let d = `M -600 404`;
    const pts = [-600, ...masts, 2200];
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; d += ` Q ${(a + b) / 2} 446 ${b} 404`; }
    const mw = el('path', { d, class: 'draw' }, wires);
    el('path', { d: 'M -600 441 H 2200', class: 'draw', 'stroke-width': 1.6 }, wires);
    let drop = '';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (let t = 0.15; t < 0.9; t += 0.175) { const x = a + (b - a) * t; const y = (1 - t) * (1 - t) * 404 + 2 * (1 - t) * t * 446 + t * t * 404; drop += `M ${x.toFixed(1)} ${y.toFixed(1)} V 441 `; }
    }
    el('path', { d: drop, 'stroke-width': 1, opacity: .8 }, wires);
    masts.forEach((x, i) => {
      const g = el('g', { class: 'mast', style: `--i:${i}` }, cat);
      el('rect', { x: x - 5, y: 386, width: 10, height: 258, fill: '#0a1120' }, g);
      el('rect', { x: x - 5, y: 386, width: 2, height: 258, fill: '#2a3c5e', opacity: .7 }, g);
      el('path', { d: `M ${x - 16} 404 H ${x + 16} M ${x} 396 L ${x + 14} 441`, stroke: '#0a1120', 'stroke-width': 3 }, g);
    });
    wires.querySelectorAll('.draw').forEach(p => p.style.setProperty('--len', Math.ceil(p.getTotalLength())));
    const pn = $('#panes');
    for (let i = 0; i < 5; i++) {
      const x = 1160 + i * 47;
      el('rect', { x, y: 372, width: 41, height: 88, fill: 'url(#gWin)' }, pn);
      el('path', { d: `M ${x + 20.5} 372 V 460 M ${x} 401 H ${x + 41} M ${x} 430 H ${x + 41}`, stroke: '#3b2a14', 'stroke-width': 1.6 }, pn);
      if (i < 4) for (let j = 0; j < 4; j++) el('rect', { x: x + 4 + j * 9.5, y: 440, width: 3, height: 20, fill: j % 3 === 1 ? '#7a1d16' : '#3a2a14' }, pn);
    }
    el('path', { d: 'M 1352 404 H 1374 L 1368 396 H 1358 Z', fill: '#3b2a14' }, pn);
    el('rect', { x: 1350, y: 444, width: 30, height: 8, fill: '#e9dcbc', opacity: .9 }, pn);
    const tw = $('#trainWins');
    for (let i = 0; i < 7; i++) el('rect', { x: -630 + i * 42, y: -98, width: 32, height: 32, rx: 5, fill: 'url(#gTrainWin)', opacity: i === 3 ? .55 : .92 }, tw);
    for (let i = 0; i < 5; i++) el('rect', { x: -308 + i * 42, y: -98, width: 32, height: 32, rx: 5, fill: 'url(#gTrainWin)', opacity: i === 1 ? .6 : .92 }, tw);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const town = $('#town');
    for (let i = 0; i < 46; i++) { const x = i < 30 ? 330 + rnd() * 640 : 1520 + rnd() * 560; el('circle', { cx: x.toFixed(1), cy: (568 + rnd() * 12).toFixed(1), r: (0.8 + rnd() * 1.3).toFixed(2), fill: rnd() > .25 ? '#ffcf87' : '#cfe0ff', opacity: (.45 + rnd() * .5).toFixed(2) }, town); }
    const tl = $('#testLights');
    for (let i = 0; i < 16; i++) { const t = i / 15, x = 30 + t * 400; el('circle', { cx: x.toFixed(1), cy: (541 - Math.sin(t * Math.PI) * 9).toFixed(1) - 2, r: 2.6, fill: '#5d7391' }, tl); }
  })();

  /* ------------------------------------------------------------ plate icons */
  const ICON = {
    driver: '<rect x="10" y="10" width="38" height="40" rx="12" fill="#2a5fe6"/><rect x="15" y="15" width="28" height="13" rx="4" fill="#a8c6ff"/><circle cx="18" cy="40" r="3.6" fill="#fff"/><circle cx="40" cy="40" r="3.6" fill="#fff"/><rect x="23" y="33" width="12" height="6" rx="1" fill="#0a0f1e"/><path d="M4 55 H54" stroke="#8ea3c4" stroke-width="2"/>',
    gate: '<rect x="10" y="45" width="36" height="9" rx="2" fill="#2a3448"/><g transform="rotate(-16 28 47)"><rect x="25" y="10" width="6" height="37" rx="2" fill="#d23a2f"/><rect x="23" y="5" width="10" height="13" rx="4" fill="#cfd6e0"/></g><circle cx="47" cy="13" r="10" fill="#ff4a3d" opacity=".25"/><circle cx="47" cy="13" r="5" fill="#ff4a3d"/>',
    witness: '<rect x="6" y="14" width="34" height="23" rx="4" fill="none" stroke="#5b97ff" stroke-width="2.5" stroke-dasharray="5 3"/><rect x="14" y="20" width="34" height="23" rx="4" fill="#46e08f" fill-opacity=".5" stroke="#46e08f" stroke-width="2"/><circle cx="18" cy="51" r="3.2" fill="#46e08f"/><circle cx="28" cy="51" r="3.2" fill="#46e08f"/>',
    diversion: '<path d="M4 18 H24" stroke="#5b97ff" stroke-width="4" stroke-linecap="round"/><path d="M36 18 H54" stroke="#5b97ff" stroke-width="4" opacity=".3" stroke-linecap="round"/><path d="M22 18 C33 18 33 40 44 40 H54" stroke="#ffb547" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M26 11 l8 13 M34 11 l-8 13" stroke="#ff4a3d" stroke-width="2.5"/>',
    test: '<ellipse cx="29" cy="30" rx="23" ry="14" fill="none" stroke="#3a4a6a" stroke-width="7"/><ellipse cx="29" cy="30" rx="23" ry="14" fill="none" stroke="#e8f0ff" stroke-width="4" stroke-dasharray="3 3"/><ellipse cx="29" cy="30" rx="27" ry="19" fill="none" stroke="#ffb547" stroke-width="1.5" stroke-dasharray="2 4"/>',
    register: '<path d="M5 16 Q17 11 29 18 V49 Q17 43 5 47 Z" fill="#f3e8cf"/><path d="M53 16 Q41 11 29 18 V49 Q41 43 53 47 Z" fill="#e2d1aa"/><path d="M10 25 H24 M10 31 H24 M10 37 H22 M34 25 H48 M34 31 H48 M34 37 H44" stroke="#7a6a4a" stroke-width="1.6"/><circle cx="48" cy="7" r="4" fill="#ffd38a"/>',
  };

  /* ------------------------------------------------------------ the six items */
  const s0 = M.sam[cards[0].id], s1 = M.sam[cards[1].id], s2 = M.sam[cards[2].id];
  const ITEMS = [
    { id: 'driver', n: '01', name: 'The driver', c: '#5b97ff', loc: [985, 590], kick: 'Muse Spark proposes',
      short: 'Muse Spark drives every round. A tool call it makes is a proposal, never an action.',
      lines: ['Muse Spark drives every round of every turn, on the engine port Athena already has.',
        'Its native tool calls arrive as proposals, never as actions. The gate classes each one from the catalog.',
        `Effort follows the phase: low for a read, high for a round that will file a card. Each round takes ${fact(eMuse, 'latency')} (estimate).`],
      tags: [['new', 'new in the window'], ['est', '~320 lines · estimate'], ['est', 'latency · estimate']], detail: 'A turn on Muse' },
    { id: 'gate', n: '02', name: 'The interlocking', c: '#ff5a4a', loc: [1232, 418], kick: 'the gate, outside the model',
      short: 'The gate sits outside the model. Nothing it cannot take back runs without your hand.',
      lines: ['The gate sits outside the model. A tool’s class comes from its manifest, never from what the model asks.',
        'AUTO runs on its own. READ runs and is recorded. GATED files a card and waits.',
        `${cards.length} chases wait at G3 right now: ${money(held)} held until your hand pulls each lever.`,
        'A signed approval runs exactly once, then it is spent. A replay is refused.'],
      tags: [['keep', 'carried over'], ['rule', '0 lines change · design rule']], detail: 'The card' },
    { id: 'witness', n: '03', name: 'Two witnesses', c: '#46e08f', loc: [1128, 616], kick: 'SAM 3.1 checks the click',
      short: 'SAM 3.1 checks that the button she will press is the button you think you are approving.',
      lines: ['Before a card is shown, SAM 3.1 segments the screenshot already captured for it, at the ref’s label and box.',
        `The DOM box and the mask must agree. ${cards[0].invoice} ${s0.iou.toFixed(2)} and ${cards[1].invoice} ${s1.iou.toFixed(2)} agree; ${cards[2].invoice} ${s2.iou.toFixed(2)} is one witness, so it opens first.`,
        'The track circuit tightens the card you see. It never loosens the gate.'],
      tags: [['new', 'new in the window'], ['sim', 'agreement figures simulated'], ['unv', 'hosted API unverified']], detail: 'Three outcomes' },
    { id: 'diversion', n: '04', name: 'Diversion', c: '#ffb547', loc: [760, 736], kick: 'Llama takes the turn',
      short: 'If Muse fails, the turn diverts to Llama. The card waiting for you does not move.',
      lines: ['Three Muse timeouts in 60 seconds open the breaker; the turn diverts to Llama on Baseten.',
        'The waiting card does not move. It lives in the gate’s table, not in a model session.',
        'Every timeout is a row in the register, with its reason. If both lines are down, signed cards still run.'],
      tags: [['new', 'new in the window'], ['est', `${fact(eLlama, 'cost')} a diverted turn · estimate`]], detail: 'The breaker' },
    { id: 'test', n: '05', name: 'The test track', c: '#b9c4ff', loc: [230, 536], kick: 'the Gauntlet, re-run on Meta',
      short: `${bTurns} hostile turns, ${bBreach} breaches — measured on other models. The Muse re-run is planned.`,
      lines: ['The Gauntlet throws hostile pages, tool output and poisoned memory at a fresh Athena per attack.',
        `${bTurns} hostile turns, ${bBreach} breaches: measured ${base.date} on other models. It says nothing about Muse yet.`,
        `The Muse re-run is planned for ${M.proving.rerun.date.replace(/^\w+ /, '')}, with a new surface: orders painted inside screenshots.`,
        'The verdict is read off the gate’s records. No model decides it.'],
      tags: [['meas', 'measured · not on Muse'], ['plan', 'Muse re-run planned · no result yet']], detail: 'The runs' },
    { id: 'register', n: '06', name: 'The register', c: '#ffd38a', loc: [1360, 420], kick: 'every call, written down',
      short: 'One row per model call, failures included. What she did and what it cost, without asking her.',
      lines: ['One row per model call, failures included, each with a reason from a closed set.',
        `Today: ${led.length} calls, ${fails.length} failed, $${spent.toFixed(2)} spent. Every Muse cost is an estimate from an unverified listing.`,
        'What she did, through which surface, and what it cost, without asking her to remember.'],
      tags: [['keep', 'carried over'], ['est', 'costs estimated']], detail: 'Every row' },
  ];

  /* ------------------------------------------------------------ item illustrations (stylised) */
  function illDriver() {
    let sl = '';
    for (let i = 1; i < 12; i++) { const t = Math.pow(i / 12, 1.8); const y = 300 + 130 * t, hw = 6 + 240 * t; sl += `M ${390 - hw} ${y.toFixed(1)} H ${390 + hw} `; }
    let ms = '';
    for (let i = 0; i < 5; i++) { const t = Math.pow((i + 1) / 6, 1.6); const x = 390 - (40 + 330 * t), top = 300 - 20 - 200 * t, bot = 300 + 130 * t; ms += `M ${x.toFixed(1)} ${bot.toFixed(1)} V ${top.toFixed(1)} `; }
    return `<svg viewBox="0 0 780 680" role="img" aria-label="Stylised illustration: the view from the cab toward a red signal, with a proposal slip on the desk">
      <defs><linearGradient id="iS1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1538"/><stop offset=".62" stop-color="#2f5a8f"/><stop offset=".9" stop-color="#a59cad"/><stop offset="1" stop-color="#e2a37a"/></linearGradient>
      <radialGradient id="iR1"><stop offset="0" stop-color="#ff5a48" stop-opacity=".9"/><stop offset="1" stop-color="#ff4a3d" stop-opacity="0"/></radialGradient>
      <clipPath id="iC1"><path d="M96 70 H684 Q712 70 716 98 L748 420 H32 L64 98 Q68 70 96 70 Z"/></clipPath></defs>
      <rect width="780" height="680" rx="28" fill="#060912"/>
      <g clip-path="url(#iC1)"><rect x="0" y="60" width="780" height="245" fill="url(#iS1)"/>
        <path d="M0 302 C 150 286 260 296 390 290 C 520 283 640 298 780 292 V 430 H 0 Z" fill="#1a2843"/><rect x="0" y="302" width="780" height="130" fill="#0b1120"/>
        <path d="${sl}" stroke="#141b2c" stroke-width="5"/><path d="M 150 432 L 386 300 M 630 432 L 394 300" stroke="#a9bcd8" stroke-width="3"/>
        <path d="${ms}" stroke="#0a1120" stroke-width="4"/><path d="M 20 150 Q 200 180 384 262" stroke="#0a1120" stroke-width="1.5" fill="none"/>
        <circle cx="452" cy="250" r="54" fill="url(#iR1)"/><rect x="449" y="250" width="5" height="52" fill="#0a1120"/><rect x="442" y="236" width="20" height="30" rx="5" fill="#05070d"/><circle cx="452" cy="244" r="5" fill="#ff4a3d"/>
        <path d="M 390 300 L 330 432 H 450 Z" fill="#5b97ff" opacity=".08"/></g>
      <path d="M96 70 H684 Q712 70 716 98 L748 420 H32 L64 98 Q68 70 96 70 Z" fill="none" stroke="#141b2b" stroke-width="22"/>
      <rect x="383" y="64" width="14" height="362" fill="#141b2b"/>
      <path d="M0 420 H780 V652 Q780 680 752 680 H28 Q0 680 0 652 Z" fill="#0c1220"/><path d="M0 421 H780" stroke="#2a3a5a" stroke-width="3"/>
      <circle cx="112" cy="540" r="52" fill="#070b14" stroke="#2a3a5a" stroke-width="3"/><path d="M112 540 L 82 506" stroke="#5b97ff" stroke-width="4" stroke-linecap="round"/>
      <circle cx="668" cy="540" r="52" fill="#070b14" stroke="#2a3a5a" stroke-width="3"/><path d="M668 540 L 700 520" stroke="#ffb547" stroke-width="4" stroke-linecap="round"/>
      <g transform="translate(232 452) rotate(-3)"><rect width="316" height="180" rx="8" fill="#f3e8cf"/><rect width="316" height="8" rx="4" fill="#5b97ff"/>
        <text x="20" y="40" font-family="Bahnschrift, 'Arial Narrow', sans-serif" font-size="17" letter-spacing="3" font-weight="700" fill="#9b2a20">PROPOSAL · NOT AN ACTION</text>
        <text x="20" y="82" font-family="Bahnschrift, 'Arial Narrow', sans-serif" font-size="32" font-weight="700" fill="#1d1a14">chase ${esc(cards[0].invoice)}</text>
        <text x="20" y="114" font-family="Segoe UI, sans-serif" font-size="18" fill="#3c362b">${esc(cards[0].client)} · ${money(cards[0].amount)} · ${cards[0].days} days</text>
        <text x="20" y="152" font-family="Consolas, monospace" font-size="16" fill="#5a5140">${esc(cards[0].action)} → the gate</text></g>
      <text x="58" y="48" font-family="Bahnschrift, 'Arial Narrow', sans-serif" font-size="18" letter-spacing="4" fill="#9cc0ff">MUSE SPARK · DRIVING 1A41</text></svg>`;
  }
  function illGate() {
    const cls = ['AUTO', 'AUTO', 'READ', 'READ', 'GATED', 'GATED', 'GATED', 'SPARE'];
    const col = { AUTO: '#2b313d', READ: '#2f6fd6', GATED: '#c8322a', SPARE: '#d8d2c0' };
    let lv = '', gi = 0;
    cls.forEach((k, i) => {
      const x = 92 + i * 85;
      lv += `<path d="M ${x - 9} 584 L ${x - 6} 262 L ${x + 6} 262 L ${x + 9} 584 Z" fill="${col[k]}"/><rect x="${x - 12}" y="222" width="24" height="54" rx="10" fill="#cfd6e0"/><circle cx="${x}" cy="476" r="15" fill="#c9a35a"/><text x="${x}" y="482" text-anchor="middle" font-family="Bahnschrift, sans-serif" font-size="17" font-weight="700" fill="#2a1d08">${i + 1}</text>`;
      if (k === 'GATED') { const c = cards[gi++]; lv += `<g transform="translate(${x - 38} 300) rotate(${gi === 2 ? 2 : -3})"><rect width="76" height="74" rx="5" fill="#f3e8cf"/><text x="38" y="28" text-anchor="middle" font-family="Consolas, monospace" font-size="16" font-weight="700" fill="#1d1a14">${esc(c.invoice.replace('INV-', ''))}</text><text x="38" y="54" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="16" fill="#9b2a20">${money(c.amount)}</text></g>`; }
    });
    return `<svg viewBox="0 0 780 680" role="img" aria-label="Stylised illustration: the lever frame, three red GATED levers each holding a card">
      <defs><radialGradient id="iW2" cx=".5" cy=".1" r=".9"><stop offset="0" stop-color="#5a3a14"/><stop offset=".6" stop-color="#1a130c"/><stop offset="1" stop-color="#0b0d14"/></radialGradient></defs>
      <rect width="780" height="680" rx="28" fill="url(#iW2)"/>
      <rect x="50" y="34" width="680" height="160" rx="12" fill="#0a1424" stroke="#c9a35a" stroke-opacity=".6" stroke-width="2"/>
      <path d="M 80 124 H 250 C 290 124 290 74 330 74 H 560 C 600 74 600 124 640 124 H 700" stroke="#3a4a66" stroke-width="7" fill="none"/>
      <path d="M 250 124 H 640" stroke="#3a4a66" stroke-width="7"/>
      <path d="M 250 124 C 290 124 290 172 330 172 H 560 C 600 172 600 124 640 124" stroke="#ffd38a" stroke-width="7" fill="none"/><path d="M 80 124 H 250" stroke="#ffd38a" stroke-width="7"/>
      <circle cx="540" cy="74" r="8" fill="#46e08f"/><circle cx="540" cy="124" r="8" fill="#46e08f"/><circle cx="540" cy="172" r="9" fill="#ff4a3d"/><circle cx="540" cy="172" r="20" fill="#ff4a3d" opacity=".25"/>
      <text x="345" y="66" font-family="Bahnschrift, sans-serif" font-size="17" fill="#c9d5e8">AUTO</text><text x="345" y="116" font-family="Bahnschrift, sans-serif" font-size="17" fill="#9cc2ff">READ</text><text x="345" y="164" font-family="Bahnschrift, sans-serif" font-size="17" fill="#ff9d94">GATED · G3</text>
      <rect x="140" y="110" width="70" height="28" rx="4" fill="#ffd38a"/><text x="175" y="130" text-anchor="middle" font-family="Consolas, monospace" font-size="16" font-weight="700" fill="#1d1a14">1A41</text>
      <text x="700" y="160" text-anchor="end" font-family="Bahnschrift, sans-serif" font-size="16" fill="#c9d5e8">LEDGERBOX</text>
      <rect x="40" y="556" width="700" height="34" fill="#1b2232"/><rect x="40" y="588" width="700" height="44" rx="6" fill="#141a26"/>
      ${lv}
      <text x="134" y="662" text-anchor="middle" font-family="Bahnschrift, sans-serif" font-size="18" letter-spacing="2" fill="#c9d5e8">AUTO</text>
      <text x="304" y="662" text-anchor="middle" font-family="Bahnschrift, sans-serif" font-size="18" letter-spacing="2" fill="#9cc2ff">READ</text>
      <text x="517" y="662" text-anchor="middle" font-family="Bahnschrift, sans-serif" font-size="18" letter-spacing="2" fill="#ff9d94">GATED · WAITS FOR YOU</text></svg>`;
  }
  function illWitness() {
    let rows = '';
    cards.forEach((c, i) => {
      const y = 112 + i * 112, s = M.sam[c.id];
      rows += `<rect x="64" y="${y}" width="652" height="92" rx="8" fill="#fff" stroke="#d5dae0"/>
        <text x="86" y="${y + 38}" font-family="Consolas, monospace" font-size="20" font-weight="700" fill="#223">${esc(c.invoice)}</text>
        <text x="86" y="${y + 70}" font-family="Segoe UI, sans-serif" font-size="18" fill="#556">${esc(c.client)}</text>
        <text x="232" y="${y + 38}" font-family="Segoe UI, sans-serif" font-size="20" font-weight="700" fill="#223">${money(c.amount)}</text>
        <text x="232" y="${y + 70}" font-family="Segoe UI, sans-serif" font-size="17" fill="${s.agree ? '#0e7f52' : '#a85a00'}">IoU ${s.iou.toFixed(2)} · ${s.agree ? 'two witnesses' : 'one witness'}</text>
        <rect x="430" y="${y + 26}" width="140" height="40" rx="6" fill="#2856c8"/><text x="500" y="${y + 52}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="17" fill="#fff">Send chase</text>
        <rect x="582" y="${y + 26}" width="116" height="40" rx="6" fill="#e9edf2" stroke="#c2c9d1"/><text x="640" y="${y + 52}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="17" fill="#334">Snooze</text>
        <rect x="423" y="${y + 19}" width="154" height="54" rx="8" fill="none" stroke="#2f6bff" stroke-width="3" stroke-dasharray="9 6"/>
        ${s.agree ? `<rect x="432" y="${y + 28}" width="137" height="37" rx="5" fill="rgba(70,224,143,.42)" stroke="#0e9f6e" stroke-width="2.5"/>` : `<rect x="584" y="${y + 28}" width="113" height="37" rx="5" fill="rgba(255,181,71,.5)" stroke="#c77700" stroke-width="2.5"/>`}`;
    });
    return `<svg viewBox="0 0 780 680" role="img" aria-label="Stylised illustration of an invoice list with the DOM box and the SAM mask on each Send chase button">
      <rect width="780" height="680" rx="28" fill="#0a1018"/>
      <rect x="40" y="34" width="700" height="440" rx="14" fill="#eef1f6"/><path d="M40 82 V48 Q40 34 54 34 H726 Q740 34 740 48 V82 Z" fill="#dfe4ec"/>
      <circle cx="68" cy="58" r="7" fill="#c9ced8"/><circle cx="90" cy="58" r="7" fill="#c9ced8"/><circle cx="112" cy="58" r="7" fill="#c9ced8"/>
      <text x="140" y="64" font-family="Segoe UI, sans-serif" font-size="17" fill="#334">ledgerbox.local/invoices · stylised, not a screenshot</text>
      ${rows}
      <rect x="40" y="498" width="700" height="150" rx="14" fill="#0f1826" stroke="#2a3a5a"/>
      <rect x="66" y="522" width="36" height="22" rx="4" fill="none" stroke="#2f6bff" stroke-width="3" stroke-dasharray="6 4"/><text x="116" y="540" font-family="Segoe UI, sans-serif" font-size="18" fill="#dbe3ef">Witness 1 · the DOM ref the gate will click</text>
      <rect x="66" y="558" width="36" height="22" rx="4" fill="rgba(70,224,143,.45)" stroke="#0e9f6e" stroke-width="2.5"/><text x="116" y="576" font-family="Segoe UI, sans-serif" font-size="18" fill="#dbe3ef">Witness 2 · the SAM 3.1 mask from the card's screenshot</text>
      <text x="66" y="622" font-family="Consolas, monospace" font-size="18" fill="#8ff0bd">IoU = area(DOM ∩ mask) ÷ area(DOM ∪ mask) ≥ 0.80</text></svg>`;
  }
  function illDiversion() {
    const r1 = led.find(r => r.error === 'timeout'), r2 = led.find(r => r.engine === 'llama_baseten');
    return `<svg viewBox="0 0 780 680" role="img" aria-label="Stylised illustration: the Muse line broken by timeouts, the train diverted onto the amber Llama loop, the card unchanged">
      <defs><pattern id="iG4" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 H0 V40" fill="none" stroke="#141c2c" stroke-width="1"/></pattern><filter id="iB4"><feGaussianBlur stdDeviation="7"/></filter></defs>
      <rect width="780" height="680" rx="28" fill="#0b0f19"/><rect width="780" height="680" rx="28" fill="url(#iG4)"/>
      <path d="M40 220 H330" stroke="#5b97ff" stroke-width="14" stroke-linecap="round"/><path d="M330 220 H740" stroke="#5b97ff" stroke-width="14" opacity=".22" stroke-linecap="round"/>
      <path d="M402 196 l36 48 M438 196 l-36 48" stroke="#ff4a3d" stroke-width="7" stroke-linecap="round"/>
      <text x="44" y="190" font-family="Bahnschrift, sans-serif" font-size="22" letter-spacing="3" fill="#9cc0ff">MUSE SPARK</text>
      <text x="470" y="190" font-family="Consolas, monospace" font-size="18" fill="#ff9d94">timeout ×3 in 60 s</text>
      <path d="M250 220 C 330 220, 330 390, 420 390 H 560 C 640 390, 650 220, 740 220" stroke="#ffb547" stroke-width="22" fill="none" opacity=".35" filter="url(#iB4)"/>
      <path d="M250 220 C 330 220, 330 390, 420 390 H 560 C 640 390, 650 220, 740 220" stroke="#ffb547" stroke-width="14" fill="none" stroke-linecap="round"/>
      <rect x="430" y="372" width="120" height="36" rx="8" fill="#ffd38a"/><text x="490" y="397" text-anchor="middle" font-family="Consolas, monospace" font-size="18" font-weight="700" fill="#1d1a14">1A41</text>
      <text x="420" y="446" font-family="Bahnschrift, sans-serif" font-size="22" letter-spacing="3" fill="#ffcf7f">LLAMA · BASETEN</text>
      <rect x="44" y="270" width="190" height="100" rx="12" fill="#141a26" stroke="#ffb547" stroke-width="2"/><text x="64" y="304" font-family="Bahnschrift, sans-serif" font-size="20" letter-spacing="2" fill="#ffcf7f">BREAKER · OPEN</text>
      <path d="M 70 340 H 110 L 150 322 M 160 340 H 210" stroke="#ffcf7f" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="110" cy="340" r="5" fill="#ffcf7f"/><circle cx="160" cy="340" r="5" fill="#ffcf7f"/>
      <g transform="translate(44 492) rotate(-2)"><rect width="300" height="140" rx="8" fill="#f3e8cf"/><text x="18" y="38" font-family="Bahnschrift, sans-serif" font-size="16" letter-spacing="2" font-weight="700" fill="#9b2a20">CARD · STILL WAITING</text>
        <text x="18" y="76" font-family="Bahnschrift, sans-serif" font-size="28" font-weight="700" fill="#1d1a14">${esc(cards[1].invoice)} · ${esc(cards[1].client)}</text><text x="18" y="112" font-family="Segoe UI, sans-serif" font-size="17" fill="#3c362b">not re-filed · not re-asked</text></g>
      <rect x="388" y="492" width="352" height="140" rx="12" fill="#070b14" stroke="#2a3a5a"/>
      <text x="408" y="530" font-family="Consolas, monospace" font-size="17" fill="#ff9d94">${esc(r1.at)} muse    ${esc(r1.error)}</text>
      <text x="408" y="566" font-family="Consolas, monospace" font-size="17" fill="#ffcf7f">${esc(r2.at)} llama   ${usd(r2.cost)} est.</text>
      <text x="408" y="602" font-family="Consolas, monospace" font-size="17" fill="#9cc0ff">later  muse    back on the line</text></svg>`;
  }
  function illTest() {
    const n = bTurns, rx = 300, ry = 186, cx = 390, cy = 318;
    let blocks = '';
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2, x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
      const ang = Math.atan2(ry * Math.cos(a), -rx * Math.sin(a)) * 180 / Math.PI;
      const pr = i >= n - base.rows[1].turns && i < n - base.rows[1].turns + pressed;
      blocks += `<rect x="-7" y="-4" width="14" height="8" rx="2" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})" fill="${pr ? 'none' : '#e8f0ff'}" stroke="${pr ? '#ffb547' : 'none'}" stroke-width="2"/>`;
    }
    return `<svg viewBox="0 0 780 680" role="img" aria-label="Stylised illustration: a test track of ${n} blocks, every one held; a dashed ring for the planned Muse re-run">
      <defs><radialGradient id="iT5"><stop offset="0" stop-color="#1b2550"/><stop offset="1" stop-color="#090d17"/></radialGradient><filter id="iB5"><feGaussianBlur stdDeviation="4"/></filter></defs>
      <rect width="780" height="680" rx="28" fill="url(#iT5)"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx + 52}" ry="${ry + 52}" fill="none" stroke="#ffb547" stroke-width="2.5" stroke-dasharray="4 10" opacity=".85"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#26314c" stroke-width="22"/>
      <g filter="url(#iB5)" opacity=".7">${blocks}</g>${blocks}
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-family="Bahnschrift, 'Arial Narrow', sans-serif" font-size="132" font-weight="700" fill="#f6f1e4">${n}</text>
      <text x="${cx}" y="${cy + 62}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="22" fill="#dbe3ef">hostile turns · ${bBreach} breached</text>
      <text x="${cx}" y="${cy + 94}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="18" fill="#8ff0bd">measured ${esc(base.date)} · not on Muse</text>
      <text x="${cx}" y="${cy - 104}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="17" fill="#b9c4ff">${pressed} amber: pressed, still held</text>
      <text x="${cx}" y="650" text-anchor="middle" font-family="Bahnschrift, sans-serif" font-size="20" letter-spacing="2" fill="#ffcf7f">DASHED RING · MUSE RE-RUN · PLANNED ${esc(M.proving.rerun.date.replace(/^\w+ /, '').toUpperCase())} · NO RESULT YET</text></svg>`;
  }
  function illRegister() {
    let rows = '';
    led.slice(0, 9).forEach((r, i) => {
      const y = 246 + i * 38;
      rows += `<text x="418" y="${y}" font-family="Consolas, monospace" font-size="16" fill="${r.error ? '#b0261c' : '#2a2418'}">${esc(r.at)} ${esc((r.engine.split('_')[0] + '     ').slice(0, 6))} ${r.error ? esc(r.error) : usd(r.cost) + ' est.'}</text>`;
    });
    return `<svg viewBox="0 0 780 680" role="img" aria-label="Stylised illustration: the train register, an open book under a lamp">
      <defs><linearGradient id="iL6" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd38a" stop-opacity=".3"/><stop offset="1" stop-color="#ffd38a" stop-opacity="0"/></linearGradient></defs>
      <rect width="780" height="680" rx="28" fill="#0a0c12"/>
      <path d="M 520 104 L 700 104 L 790 680 L 230 680 Z" fill="url(#iL6)"/>
      <path d="M 540 40 H 680 L 708 106 H 512 Z" fill="#1d2230"/><ellipse cx="610" cy="106" rx="98" ry="10" fill="#ffe7b0"/><path d="M 610 0 V 40" stroke="#1d2230" stroke-width="5"/>
      <path d="M 50 196 L 384 176 L 384 612 L 40 632 Z" fill="#e5d6b4"/><path d="M 398 176 L 732 196 L 742 632 L 398 612 Z" fill="#f3e8cf"/>
      <path d="M 384 176 Q 391 170 398 176 V 612 Q 391 618 384 612 Z" fill="#b9a67c"/>
      <text x="76" y="246" font-family="Bahnschrift, sans-serif" font-size="24" letter-spacing="3" font-weight="700" fill="#2a2418">TRAIN REGISTER</text>
      <text x="76" y="282" font-family="Segoe UI, sans-serif" font-size="17" fill="#4a4030">${esc(M.clock.split(' · ')[0])}</text>
      <text x="76" y="340" font-family="Segoe UI, sans-serif" font-size="18" fill="#2a2418">${led.length} model calls</text>
      <text x="76" y="374" font-family="Segoe UI, sans-serif" font-size="18" fill="#2a2418">$${spent.toFixed(2)} spent · estimated</text>
      <text x="76" y="408" font-family="Segoe UI, sans-serif" font-size="18" fill="#b0261c">${fails.length} failed · reasons kept</text>
      <path d="M 76 440 H 350 M 76 476 H 350 M 76 512 H 350 M 76 548 H 350" stroke="#cbbb94" stroke-width="1.2"/>
      ${rows}</svg>`;
  }
  const ILL = { driver: illDriver, gate: illGate, witness: illWitness, diversion: illDiversion, test: illTest, register: illRegister };

  /* ------------------------------------------------------------ details (L2) */
  const pre = o => '<pre>' + esc(JSON.stringify(o, null, 2)) + '</pre>';
  function detDriver() {
    const st = [['1 · Surface', 'the message and host_state, fenced with a nonce', 0], ['2 · Composer', 'static blocks and the turn frame', 0], ['3 · Muse round', 'native tool calls, effort set by phase', 1], ['4 · The gate', 'PolicyHook, then GateHook', 0], ['5 · Runs', 'AUTO and READ now; GATED becomes a card', 0]];
    return `<p>The loop is the one Athena already runs for every engine. Muse Spark takes the driver's seat; nothing about who decides moves.</p>
      <div class="steps">${st.map(s => `<div class="step ${s[2] ? 'new' : ''}"><b>${s[0]}</b>${s[1]}<br>${s[2] ? '<span class="tag new">new</span>' : '<span class="tag keep">carried</span>'}</div>`).join('')}</div>
      <p>A gated call leaves the loop and waits for a person; the round loop never holds an executor for it. At most eight rounds make one turn and one register row.</p>
      <h4>What is known about Muse Spark, and how</h4>
      <table><tr><th>Fact</th><th>Value</th><th>Kind</th></tr>${eMuse.facts.map(f => `<tr><td>${esc(f[0])}</td><td>${esc(f[1])}</td><td>${tagFor(f[2])}</td></tr>`).join('')}</table>
      <h4>The engine, as configured</h4><pre>${esc(eMuse.config)}</pre>`;
  }
  function detGate() {
    const c = cards[0];
    return `<p>A card names what will run, exactly, and why. Pulling its lever is the only way it runs; the model cannot reach the door.</p>
      ${pre({ action: c.action, params: { invoice: c.invoice, to: c.to }, card: c.id, amount: c.amount, why: c.why, expires: 'in 24 h', spent: 'on first run' })}
      <h4>The three classes</h4><table>${Object.entries(A.toolClasses).map(([k, v]) => `<tr><td><b>${k}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>
      <h4>The lever log (showing ${A.decisions.length} of ${A.decisionsTotal})</h4>
      <table><tr><th>When</th><th>Card</th><th>Result</th><th>Reason</th></tr>${A.decisions.map(d => `<tr><td>${esc(d.at)}</td><td class="m">…${esc(d.id.slice(-4))}</td><td>${esc(d.result)}</td><td class="m">${esc(d.reason || '—')}</td></tr>`).join('')}</table>
      <div class="claim">A model cannot answer its own card: the only door is <span class="m">POST /decisions/&lt;id&gt;</span>.</div>`;
  }
  function detWitness() {
    return `<div class="outs">
        <div class="out" style="border-color:#46e08f"><b style="color:#46e08f">AGREE · two witnesses</b>IoU at or above 0.80 and the mask holds the label. The card shows both outlines; one-tap approve is allowed.</div>
        <div class="out" style="border-color:#ffb547"><b style="color:#ffb547">DISAGREE · one witness</b>The card still files and still waits. One-tap approve is off; the screenshot opens first.</div>
        <div class="out" style="border-color:#8496b0"><b style="color:#c9d5e8">DOM ONLY · no second witness</b>SAM unreachable: today's card, labelled DOM only. Nothing new is blocked.</div></div>
      <h4>The three cards waiting now <span class="tag sim">simulated</span></h4>
      <table><tr><th>Card</th><th>Client</th><th>IoU</th><th>Verdict</th></tr>${cards.map(c => { const s = M.sam[c.id]; return `<tr><td class="m">${esc(c.invoice)}</td><td>${esc(c.client)}</td><td class="m">${s.iou.toFixed(2)}</td><td>${s.agree ? 'two witnesses' : 'one witness · look first'}</td></tr>`; }).join('')}</table>
      <p style="margin-top:10px">${esc(M.sam[cards[2].id].note)}</p>
      <h4>What is known about SAM 3.1</h4><table>${eSam.facts.map(f => `<tr><td>${esc(f[0])}</td><td>${esc(f[1])}</td><td>${tagFor(f[2])}</td></tr>`).join('')}</table>`;
  }
  function detDiversion() {
    const rows = led.filter(r => /drill/.test(r.note) || r.engine === 'llama_baseten');
    return `<p>${esc(eMuse.fallback)}</p>
      <table><tr><th>When</th><th>Engine</th><th>Result</th><th>What happened</th></tr>${rows.map(r => `<tr class="${r.error ? 'err' : ''}"><td class="m">${esc(r.at)}</td><td>${esc(engName(r.engine))}</td><td class="m">${r.error ? esc(r.error) : usd(r.cost) + ' est.'}</td><td>${esc(r.note)}</td></tr>`).join('')}</table>
      <div class="claim">If both lines are down, no new proposals start. Signed cards still run, because the gate does not need a model to run a card.</div>
      <h4>Llama on Baseten</h4><p>${esc(eLlama.does)}</p>
      <table>${eLlama.facts.map(f => `<tr><td>${esc(f[0])}</td><td>${esc(f[1])}</td><td>${tagFor(f[2])}</td></tr>`).join('')}</table>
      <p style="margin-top:10px">${esc(eLlama.fallback)}</p>`;
  }
  function detTest() {
    const r = M.proving.rerun;
    return `<p>Attackers: ${esc(base.attackers)}. Each attack meets its own throwaway Athena; the verdict is read off the gate's records, never off a model.</p>
      <table><tr><th>Run</th><th>Athena under test</th><th class="r">Turns</th><th class="r">Breached</th><th>Status</th></tr>
      ${base.rows.map(x => `<tr><td class="m">${esc(base.run)}</td><td>${esc(x.who)}</td><td class="r">${x.turns}</td><td class="r">${x.breached}</td><td>${tagFor('measured · not on Muse')}</td></tr>`).join('')}
      ${M.proving.repeats.map(x => `<tr><td class="m">${esc(x.run)}</td><td>repeat · seed ${x.seed}</td><td class="r">${x.turns}</td><td class="r">${x.breached}</td><td>${tagFor('measured · not on Muse')}</td></tr>`).join('')}
      <tr><td>${esc(r.date)}</td><td>Muse Spark</td><td class="r">—</td><td class="r">—</td><td>${tagFor('planned')}</td></tr></table>
      <h4>Roles on the re-run</h4><table>${r.roles.map(x => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td></tr>`).join('')}</table>
      <h4>Surfaces</h4><table>${r.surfaces.map(x => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td><td>${tagFor(x[2])}</td></tr>`).join('')}</table>
      <div class="claim">The bar: ${esc(r.bar)}. These numbers say nothing about Athena on Muse until the Gauntlet runs there.</div>`;
  }
  function detRegister() {
    const by = id => led.filter(r => r.engine === id).reduce((s, r) => s + (r.cost || 0), 0);
    return `<p>One row per model invocation, failures included, with a reason from a closed set of sixteen. Showing ${led.length} of ${led.length}.</p>
      <table><tr><th>At</th><th>Engine</th><th class="r">Cost · est.</th><th>Note</th></tr>${led.map(r => `<tr class="${r.error ? 'err' : ''}"><td class="m">${esc(r.at)}</td><td>${esc(engName(r.engine))}</td><td class="m r">${r.error ? esc(r.error) : usd(r.cost)}</td><td>${esc(r.note)}</td></tr>`).join('')}</table>
      <h4>By engine</h4><table>${['muse_spark', 'sam_3_1', 'llama_baseten'].map(e => `<tr><td>${esc(engName(e))}</td><td class="m r">${usd(by(e))} ${tagFor('estimate')}</td></tr>`).join('')}<tr><td>CLI engines</td><td class="m r">$0 · off in the demo</td></tr></table>
      <p style="margin-top:10px">Muse prices come from a third-party listing (~$1.25 per million tokens in, ~$4.25 out) ${tagFor('unverified')}. Nothing here was measured on Muse.</p>`;
  }
  const DET = { driver: detDriver, gate: detGate, witness: detWitness, diversion: detDiversion, test: detTest, register: detRegister };

  /* ------------------------------------------------------------ stage fit */
  let mobile = false;
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    mobile = matchMedia('(max-width: 759px)').matches;
    body.classList.toggle('mobile', mobile);
    if (mobile) {
      stage.style.transform = '';
      for (const sv of [scene, tLayer]) { sv.setAttribute('viewBox', '930 236 700 640'); sv.setAttribute('preserveAspectRatio', 'xMidYMid slice'); }
    } else {
      const s = Math.min(vw / 1600, vh / 900);
      stage.style.transform = `translate(${((vw - 1600 * s) / 2).toFixed(1)}px, ${((vh - 900 * s) / 2).toFixed(1)}px) scale(${s.toFixed(4)})`;
      for (const sv of [scene, tLayer]) { sv.setAttribute('viewBox', '-600 -300 2800 1500'); sv.removeAttribute('preserveAspectRatio'); }
    }
  }
  window.addEventListener('resize', fit);
  fit();

  /* ------------------------------------------------------------ tween */
  const train = $('#train');
  let trainX = 1040, tw = null;
  const setTrain = x => { trainX = x; train.setAttribute('transform', `translate(${x.toFixed(1)} 664)`); };
  function tweenTrain(to, dur, ease, done) {
    if (tw) cancelAnimationFrame(tw.raf);
    if (reduced || dur <= 0) { setTrain(to); if (done) done(); return; }
    const from = trainX, t0 = performance.now();
    const st = { raf: 0 };
    const step = now => { const t = Math.min(1, (now - t0) / dur); setTrain(from + (to - from) * ease(t)); if (t < 1) st.raf = requestAnimationFrame(step); else { tw = null; if (done) done(); } };
    st.raf = requestAnimationFrame(step); tw = st;
  }
  const easeOut = t => 1 - Math.pow(1 - t, 3.2), easeIn = t => t * t * t;

  /* ------------------------------------------------------------ intro: ≤ 4 s, skippable */
  let introOn = !reduced, introT = [];
  function endIntro() {
    if (!introOn) return;
    introOn = false; introT.forEach(clearTimeout);
    if (tw) { cancelAnimationFrame(tw.raf); tw = null; }
    setTrain(1040);
    body.classList.remove('intro', 'go', 'arrive');
  }
  if (!introOn) { body.classList.remove('intro'); setTrain(1040); }
  else {
    setTrain(-760);
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add('go')));
    introT.push(setTimeout(() => tweenTrain(1040, 2700, easeOut), 350));
    introT.push(setTimeout(() => body.classList.add('arrive'), 1500));
    introT.push(setTimeout(endIntro, 3500));
    const skip = e => { if (introOn) { if (e && e.type === 'keydown' && e.key === 'Tab') return; endIntro(); } };
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => window.addEventListener(t, skip, { passive: true }));
  }
  $('#skip').addEventListener('click', endIntro);

  /* ------------------------------------------------------------ the lever */
  const arm = $('#leverArm'), lever = $('#lever');
  let signed = false, cardIdx = 0, drag = null;
  const setArm = deg => { arm.style.transform = `rotate(${deg}deg)`; };
  function showCard() {
    const c = cards[cardIdx], s = M.sam[c.id];
    $('#c0t').textContent = 'Chase ' + c.invoice;
    $('#c0s').textContent = `${c.client} · ${money(c.amount)} · ${c.days} days past due` + (s && !s.agree ? ' · one witness' : '');
    $('#plateTxt').textContent = `${c.invoice} · G3`;
    $('#lhB').textContent = `Lever ${cardIdx + 1} · G3`;
    $('#lhS').textContent = s && !s.agree ? 'One witness only: in the roof this card opens first. Here, pull to sign.' : 'Pull it to sign: drag down, or press Enter.';
    lever.setAttribute('aria-label', `Pull lever ${cardIdx + 1} at signal G3: sign the chase for ${c.invoice}`);
  }
  function commit() {
    if (introOn) endIntro();
    if (signed) return resetLever();
    signed = true; setArm(-28); body.classList.add('signed');
    const c = cards[cardIdx];
    $('#lhB').textContent = 'Signed · runs once';
    $('#lhS').textContent = `The chase for ${c.invoice} runs once on Ledgerbox; the approval is spent. Pull again for the next card.`;
    lever.setAttribute('aria-label', 'Bring the next proposal to G3');
    setTimeout(() => tweenTrain(2950, 2600, easeIn), reduced ? 0 : 450);
  }
  function resetLever() {
    signed = false; cardIdx = (cardIdx + 1) % cards.length;
    body.classList.remove('signed'); setArm(14); showCard();
    setTrain(-760); tweenTrain(1040, 2400, easeOut);
  }
  lever.addEventListener('pointerdown', e => {
    if (introOn) endIntro();
    drag = { x: e.clientX, y: e.clientY, p: 0, moved: 0 };
    arm.classList.add('drag'); lever.setPointerCapture(e.pointerId); e.preventDefault();
  });
  lever.addEventListener('pointermove', e => {
    if (!drag || signed) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    drag.p = Math.max(0, Math.min(1, (dy - dx * 0.5) / 150));
    setArm(14 - 42 * drag.p);
  });
  const up = () => {
    if (!drag) return;
    arm.classList.remove('drag');
    const d = drag; drag = null;
    if (d.moved < 6 || d.p > 0.5 || signed) commit(); else setArm(14);
  };
  lever.addEventListener('pointerup', up); lever.addEventListener('pointercancel', up);
  lever.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(); } });
  $('#pullBtn').addEventListener('click', () => { commit(); if (!mobile) lever.focus({ preventScroll: true }); });
  showCard();

  /* ------------------------------------------------------------ the overview: plates and centre stage */
  const plates = $('#plates');
  plates.innerHTML = ITEMS.map((it, i) => `<button class="plate" type="button" data-item="${it.id}" data-i="${i}" style="--c:${it.c}" aria-label="${it.n} ${esc(it.name)}: ${esc(it.short)}">
    <svg viewBox="0 0 58 58" aria-hidden="true">${ICON[it.id]}</svg><span class="pn">${it.n}</span><span class="pt">${esc(it.name)}</span><span class="bar"></span></button>`).join('');
  const plateEls = Array.from(plates.querySelectorAll('.plate'));
  const spot = $('#spot');
  const LEDE = $('#lede').textContent, KICK = $('#kick').innerHTML;
  let hotT = null;
  function setHot(i) {
    clearTimeout(hotT);
    if (level !== 0) return;
    const it = ITEMS[i];
    body.dataset.hot = it.id;
    spot.setAttribute('cx', it.loc[0]); spot.setAttribute('cy', it.loc[1]);
    plateEls.forEach((p, j) => p.classList.toggle('hot', j === i));
    $('#hMain').classList.add('out');
    const h = $('#hItem'); h.querySelector('.num').textContent = `${it.n} · ${it.kick}`; h.querySelector('.num').style.color = it.c;
    h.querySelector('.nm').textContent = it.name; h.querySelector('.nm').style.color = '#f6f1e4'; h.classList.add('on');
    $('#lede').textContent = it.short;
    $('#kick').innerHTML = `Choose to open · <b style="color:${it.c}">${esc(it.name)}</b>`;
  }
  function clearHot() {
    hotT = setTimeout(() => {
      delete body.dataset.hot; plateEls.forEach(p => p.classList.remove('hot'));
      $('#hMain').classList.remove('out'); $('#hItem').classList.remove('on');
      $('#lede').textContent = LEDE; $('#kick').innerHTML = KICK;
    }, 120);
  }
  plateEls.forEach((p, i) => {
    p.addEventListener('mouseenter', () => setHot(i)); p.addEventListener('focus', () => setHot(i));
    p.addEventListener('mouseleave', clearHot); p.addEventListener('blur', clearHot);
    p.addEventListener('click', () => openItem(i));
  });

  /* ------------------------------------------------------------ levels */
  let level = 0, cur = -1;
  const itemEl = $('#item'), detEl = $('#detail');
  function renderItem(i) {
    const it = ITEMS[i], prev = ITEMS[(i + ITEMS.length - 1) % ITEMS.length], next = ITEMS[(i + 1) % ITEMS.length];
    itemEl.style.setProperty('--c', it.c);
    itemEl.innerHTML = `<button class="back" type="button" data-act="up">← All six</button>
      <nav class="crumbs" aria-label="Where you are"><button type="button" data-act="up">Blue Hour</button><span>›</span><b>${it.n} ${esc(it.name)}</b></nav>
      <div class="col"><div class="num">${it.n} · ${esc(it.kick)}</div><h2 tabindex="-1">${esc(it.name)}</h2>
        <ul>${it.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        <div class="tags">${it.tags.map(t => `<span class="tag ${t[0]}">${esc(t[1])}</span>`).join('')}</div>
        <button class="btn primary" type="button" data-act="detail">${esc(it.detail)} →</button></div>
      <div class="ill">${ILL[it.id]()}<span class="cap">Stylised illustration · not a screenshot</span></div>
      <div class="pager"><button type="button" data-act="prev">‹ ${prev.n} ${esc(prev.name)}</button><button type="button" data-act="next">${next.n} ${esc(next.name)} ›</button></div>`;
    itemEl.classList.remove('enter', 'leave'); void itemEl.offsetWidth; itemEl.classList.add('enter');
  }
  function aimCamera(i) {
    if (mobile) return;
    const it = ITEMS[i];
    for (const sv of [scene, tLayer]) { sv.style.transformOrigin = `${it.loc[0] + 600}px ${it.loc[1] + 300}px`; sv.style.transform = 'scale(2.4)'; }
  }
  function openItem(i) {
    if (introOn) endIntro();
    clearTimeout(hotT); delete body.dataset.hot; plateEls.forEach(p => p.classList.remove('hot'));
    $('#hMain').classList.remove('out'); $('#hItem').classList.remove('on'); $('#lede').textContent = LEDE; $('#kick').innerHTML = KICK;
    level = 1; cur = i; body.classList.add('l1'); body.classList.remove('l2');
    detEl.hidden = true;
    aimCamera(i);
    itemEl.hidden = false; renderItem(i);
    if (mobile) itemEl.scrollTop = 0;
    setTimeout(() => { const h = itemEl.querySelector('h2'); if (h && level === 1) h.focus({ preventScroll: true }); }, reduced ? 0 : 300);
  }
  function step(d) { const i = (cur + d + ITEMS.length) % ITEMS.length; cur = i; aimCamera(i); renderItem(i); if (mobile) itemEl.scrollTop = 0; }
  function closeItem() {
    if (level === 2) closeDetail();
    level = 0; body.classList.remove('l1', 'l2');
    scene.style.transform = ''; tLayer.style.transform = '';
    itemEl.classList.remove('enter'); itemEl.classList.add('leave');
    setTimeout(() => { if (level === 0) { itemEl.hidden = true; itemEl.classList.remove('leave'); } }, reduced ? 0 : 430);
    const p = plateEls[cur]; if (p) p.focus({ preventScroll: true });
  }
  function openDetail() {
    const it = ITEMS[cur];
    level = 2; body.classList.add('l2');
    detEl.style.setProperty('--c', it.c);
    detEl.innerHTML = `<nav class="crumbs" aria-label="Where you are"><button class="back" type="button" data-act="down">← Back to ${esc(it.name)}</button>
        <span>Blue Hour › ${it.n} ${esc(it.name)} › <b>${esc(it.detail)}</b></span></nav>
      <h3 tabindex="-1">${esc(it.detail)}</h3>${DET[it.id]()}`;
    detEl.hidden = false; detEl.scrollTop = 0;
    detEl.classList.remove('enter2'); void detEl.offsetWidth; detEl.classList.add('enter2');
    setTimeout(() => { const h = detEl.querySelector('h3'); if (h) h.focus({ preventScroll: true }); }, 50);
  }
  function closeDetail() {
    level = 1; body.classList.remove('l2'); detEl.hidden = true;
    const b = itemEl.querySelector('[data-act="detail"]'); if (b) b.focus({ preventScroll: true });
  }
  itemEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'up') closeItem(); else if (a === 'detail') openDetail(); else if (a === 'prev') step(-1); else if (a === 'next') step(1);
  });
  detEl.addEventListener('click', e => { const b = e.target.closest('[data-act="down"]'); if (b) closeDetail(); });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (level === 2) closeDetail(); else if (level === 1) closeItem(); return; }
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (level === 1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); return; }
    if (level === 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const i = plateEls.indexOf(document.activeElement);
      const j = i < 0 ? 0 : (i + (e.key === 'ArrowRight' ? 1 : -1) + plateEls.length) % plateEls.length;
      e.preventDefault(); plateEls[j].focus();
    }
  });

  window.landing = { level: () => level, open: openItem, items: ITEMS.map(i => i.id) };

  /* ------------------------------------------------------------ motes in the lamp light */
  const cv = $('#motes'), cx = cv.getContext('2d');
  const motes = [];
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) motes.push({ x: rnd() * 760, y: rnd() * 480, r: 0.6 + rnd() * 1.8, vx: (rnd() - .5) * 6, vy: -3 - rnd() * 7, ph: rnd() * 6.28 });
  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (reduced || mobile || level !== 0 || document.hidden) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    cx.clearRect(0, 0, 760, 480);
    for (const m of motes) {
      m.x += m.vx * dt; m.y += m.vy * dt; m.ph += dt * 1.3;
      if (m.y < -6) { m.y = 486; m.x = rnd() * 760; }
      if (m.x < -6) m.x = 766; if (m.x > 766) m.x = -6;
      const dx = (m.x - 420) / 380, dy = (m.y - 200) / 260, fall = Math.max(0, 1 - (dx * dx + dy * dy));
      cx.globalAlpha = (0.25 + 0.35 * Math.sin(m.ph) ** 2) * fall;
      cx.fillStyle = '#ffd9a0'; cx.beginPath(); cx.arc(m.x, m.y, m.r, 0, 6.283); cx.fill();
    }
  }
  if (!reduced) requestAnimationFrame(frame);
})();
