/* Blue Hour · the roof. One 2400 x 1350 panel under a CSS-transform camera. Text sits in tiers that appear only
 * when they render at 12 px or more; a state change alters what a place says, never where it is.
 * Everything here is simulated on fixtures.js; nothing leaves the page. */
(function () {
  'use strict';
  const A = window.ATHENA, M = window.MUSE;
  const W = 2400, H = 1350;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => '$' + Number(n).toLocaleString('en-US');
  const usd = n => n == null ? '—' : '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(n < 1 ? 3 : 2));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const world = $('#world'), stage = $('#stage');
  const T1 = 15; /* the smallest type of the detail tier, in world px */

  const SECTIONS = [
    { id: 'yard', n: 1, name: 'The Yard', sub: 'the minds · Muse drives', x: 40, y: 40, w: 480, h: 820 },
    { id: 'interlocking', n: 2, name: 'The Interlocking', sub: 'the gate · outside the model', x: 560, y: 40, w: 920, h: 820 },
    { id: 'line', n: 3, name: 'The Line', sub: 'what she can reach', x: 1520, y: 40, w: 840, h: 820 },
    { id: 'timetable', n: 4, name: 'Timetable', sub: 'chores she can run', x: 40, y: 900, w: 760, h: 410 },
    { id: 'register', n: 5, name: 'Train Register', sub: 'what she has spent', x: 840, y: 900, w: 760, h: 410 },
    { id: 'testtrack', n: 6, name: 'Test Track', sub: 'how well the gate holds', x: 1640, y: 900, w: 720, h: 410 },
  ];
  const SEC = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

  /* ------------------------------------------------------------------ state */
  const state = {
    cards: A.cards.map((c, i) => Object.assign({}, c, { n: i + 1, status: 'waiting', sam: M.sam[c.id] || null })),
    decisions: A.decisions.map(d => Object.assign({}, d)),
    decisionsTotal: A.decisionsTotal,
    ledger: M.ledger.map(r => Object.assign({}, r)),
    diverted: false, nextLed: 0xc4, minute: 45, released: false,
  };
  const waiting = () => state.cards.filter(c => c.status === 'waiting').length;
  const waitingSum = () => state.cards.filter(c => c.status === 'waiting').reduce((s, c) => s + c.amount, 0);
  const count = r => state.decisions.filter(d => d.result === r).length;
  const spend = eng => state.ledger.filter(r => !eng || r.engine === eng).reduce((s, r) => s + (r.cost || 0), 0);
  const failures = () => state.ledger.filter(r => r.error);
  const annual = p => p.economics.value * (p.economics.per === 'month' ? 12 : 1);
  const offerYear = A.playbooks.reduce((s, p) => s + annual(p), 0);
  const benched = A.playbooks.filter(p => p.bench);
  const appsOn = A.apps.filter(a => a.enabled), appsOff = A.apps.filter(a => !a.enabled);
  const accNeed = A.connectors.filter(c => c.health !== 'healthy');
  const base = M.proving.baseline;
  const bTurns = base.rows.reduce((s, r) => s + r.turns, 0), bBreach = base.rows.reduce((s, r) => s + r.breached, 0);
  const engName = id => ({ muse_spark: 'Muse Spark', sam_3_1: 'SAM 3.1', llama_baseten: 'Llama · Baseten', cli: 'CLI engines' }[id] || id);
  const clsOf = (a, t) => (a.overrides && a.overrides[t.short]) || t.cls;
  const ranOf = cls => A.turn.filter(t => t.kind === 'tool').filter(t => { const nm = t.text.split(' ')[0]; for (const a of A.apps) for (const x of a.tools) if (x.name === nm) return clsOf(a, x) === cls; return false; }).length;
  const rerunDate = M.proving.rerun.date.replace(/^\w+ /, '').replace(/ \d{4}$/, '');

  const BIND = {
    waiting: () => String(waiting()),
    waitingWord: () => waiting() === 1 ? 'lever waits for you' : 'levers wait for you',
    held: () => money(waitingSum()),
    heldWord: () => waiting() ? 'held at G3' : 'nothing held',
    decN: () => String(state.decisionsTotal),
    gHeld: () => waiting() ? `GATED · ${waiting()} held` : 'GATED · clear',
    breaker: () => state.diverted ? 'OPEN' : 'CLOSED',
    breakerWord: () => state.diverted ? 'diverted to Llama' : 'diversion breaker',
    spent: () => '$' + spend().toFixed(2),
    calls: () => String(state.ledger.length),
    fails: () => String(failures().length),
    head: () => waiting() ? `${M.headcode} · HELD AT G3` : `${M.headcode} · AT LEDGERBOX`,
    headSub: () => (state.diverted ? 'via Llama · ' : '') + M.turnName,
    spMuse: () => usd(spend('muse_spark')) + ' est.', spSam: () => usd(spend('sam_3_1')) + ' est.', spLlama: () => usd(spend('llama_baseten')) + ' est.',
    drill: () => state.diverted ? 'Restore Muse' : 'Drill: Muse times out ×3',
    lastCall: () => { const r = state.ledger[0]; return `${r.at} · ${engName(r.engine)}`; },
    failList: () => Array.from(new Set(failures().map(r => r.error))).join(' · ') || 'none',
    showing: () => `showing 6 of ${state.ledger.length}`,
  };

  /* ------------------------------------------------------------------ items */
  const ITEMS = {};
  const reg = (id, sec, kind, title, sub, find) => { ITEMS[id] = { id, sec, kind, title, sub: sub || '', find: find || '' }; return id; };
  const box = (id, cls, x, y, w, h, inner) => `<div class="it ${cls}" data-item="${id}" tabindex="-1" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">${inner}</div>`;
  const agg = (b, span, cls, bk, sk) => `<div class="agg"><b class="${cls || ''}"${bk ? ` data-b="${bk}"` : ''}>${esc(b)}</b><span${sk ? ` data-b="${sk}"` : ''}>${esc(span)}</span></div>`;
  const head = (s, aggs) => `<i class="screw" style="left:10px;top:10px"></i><i class="screw" style="right:10px;top:10px"></i><i class="screw" style="left:10px;bottom:10px"></i><i class="screw" style="right:10px;bottom:10px"></i>
    <div class="badge">${s.n}</div><div class="ttl">${esc(s.name)}</div><div class="sub">${esc(s.sub)}</div><div class="aggs">${aggs}</div>`;

  function buildYard(s) {
    let h = head(s, agg(String(M.engines.length), 'engines') + agg('CLOSED', 'diversion breaker', 'green', 'breaker', 'breakerWord'));
    h += `<div class="c t1" style="left:28px;top:222px"><button class="btn-line" type="button" data-act="drill" data-b="drill">Drill: Muse times out ×3</button></div>`;
    M.engines.forEach((e, i) => {
      const id = reg('eng:' + e.id, 'yard', 'engine', e.name, e.role, e.short + ' ' + e.lineName);
      const lamp = e.id === 'muse_spark' ? 'blue' : e.state === 'off' ? 'off' : e.id === 'llama_baseten' ? 'amber' : 'green';
      const nm = e.id === 'llama_baseten' ? 'LLAMA' : e.id === 'cli' ? 'CLI ENGINES' : e.name.toUpperCase();
      const rl = { muse_spark: 'driving · Meta Model API', sam_3_1: 'track circuit · ready', llama_baseten: 'diversion · standby', cli: 'off in the demo' }[e.id] || e.role;
      h += box(id, `loco ${e.id === 'muse_spark' ? 'muse' : ''} ${e.state === 'off' ? 'off' : ''}`, 28, 259 + i * 140, 370, 122,
        `<i class="lamp ${lamp}" data-lamp="${e.id}"></i><div class="nm">${esc(nm)}</div><div class="rl" data-rl="${e.id}">${esc(rl)}</div>
         <div class="ds t1" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="ntag ${e.isNew ? 'n' : 'o'}">${e.isNew ? 'NEW' : 'KEPT'}</span>${esc(e.short)}</div>`);
    });
    return h;
  }

  function buildInterlocking(s) {
    let h = head(s, agg('3', 'levers wait for you', 'red', 'waiting', 'waitingWord') + agg(money(waitingSum()), 'held at G3', '', 'held', 'heldWord') + agg(String(state.decisionsTotal), 'decisions so far', '', 'decN'));
    const rows = [['AUTO', 250, `AUTO · ${ranOf('AUTO')} ran`], ['READ', 320, `READ · ${ranOf('READ')} ran`], ['GATED', 390, '']];
    for (const [c, y, txt] of rows) {
      const id = reg('cls:' + c, 'interlocking', 'class', c + ' track', A.toolClasses[c], 'class rule gate ' + c);
      h += box(id, '', 210, c === 'GATED' ? y + 22 : y - 36, 300, 32, `<span class="lbl ${c}"${c === 'GATED' ? ' data-b="gHeld"' : ''}>${esc(txt || 'GATED · 3 held')}</span>`);
      h += `<i class="lamp ${c === 'GATED' ? 'red' : 'green'} c" ${c === 'GATED' ? 'data-g3' : ''} style="left:437px;top:${y - 13}px"></i>`;
    }
    h += `<div class="c lbl" style="left:476px;top:${390 - 13}px;color:var(--cream)">G3</div>`;
    const tid = reg('turn', 'interlocking', 'turn', `${M.headcode} · ${M.turnName}`, 'what she is doing now', A.ask);
    h += box(tid, 'describer', 560, 340, 340, 104, `<div class="k" data-b="head">${M.headcode} · HELD AT G3</div><div class="v" data-b="headSub">${esc(M.turnName)}</div>`);
    h += `<div class="c" style="left:28px;top:462px"><span class="lbl" style="color:var(--tung)">Lever frame</span></div>
          <div class="c t0" style="left:212px;top:462px;line-height:1;color:var(--muted);white-space:nowrap">one lever per card · nothing runs until you pull it</div>`;
    state.cards.forEach((c, i) => {
      const id = reg('card:' + c.id, 'interlocking', 'card', `Lever ${c.n} · ${c.invoice} · ${c.client}`, money(c.amount) + ' · ' + c.days + ' days', c.action + ' ' + c.to);
      const sam = c.sam;
      h += box(id, 'lever', 28 + i * 296, 510, 276, 290,
        `<svg class="lsvg" viewBox="0 0 64 200" aria-hidden="true"><path d="M6 196 A26 26 0 0 1 58 196 Z" fill="#1d2536"/><g class="arm"><rect x="28" y="30" width="8" height="158" rx="3" fill="#c8322a"/><rect x="24" y="8" width="16" height="36" rx="7" fill="#cfd6e0"/><rect x="24" y="112" width="16" height="22" rx="3" fill="#c9a35a"/></g><circle cx="32" cy="186" r="5" fill="#3a4660"/></svg>
         <div class="lv">Lever ${c.n}</div><div class="inv">${esc(c.invoice)}</div><div class="amt">${money(c.amount)}</div><div class="cl">${esc(c.client)}</div>
         <div class="c t0 l0only" style="left:16px;top:200px;color:var(--muted);white-space:nowrap">${c.days} days past due</div><div class="c t0 l0only" data-l0w="${c.id}" style="left:16px;top:236px;color:#ff8a80;white-space:nowrap">waits for your hand</div>
         <div class="det t1"><span class="mono">${esc(c.action)}</span><br><span class="wit ${sam && !sam.agree ? 'bad' : ''}">${sam ? (sam.agree ? `two witnesses · IoU ${sam.iou.toFixed(2)}` : `one witness · IoU ${sam.iou.toFixed(2)} · look first`) : 'DOM only'}</span>
           <div class="btns" data-btns="${c.id}"></div></div>
         <div class="stamp" data-stamp="${c.id}">SIGNED<br>SPENT</div>`);
    });
    return h;
  }
  function leverButtons(c) {
    if (c.status !== 'waiting') return `<span class="wit">${c.status === 'approved' ? 'ran once on Ledgerbox · approval spent' : 'declined · user_denied · nothing sent'}</span>`;
    return (c.sam && !c.sam.agree ? `<button class="btn-ok warn" type="button" data-act="look" data-card="${c.id}">Look first</button>` : `<button class="btn-ok" type="button" data-act="approve" data-card="${c.id}">Pull · approve</button>`)
      + `<button class="btn-no" type="button" data-act="decline" data-card="${c.id}">Decline</button>`;
  }

  function buildLine(s) {
    let h = head(s, agg(String(appsOn.length), 'stations open', 'green') + agg(String(appsOff.length), 'closed') + agg(String(accNeed.length), accNeed.length === 1 ? 'account needs you' : 'accounts need you', 'red') + agg(String(A.tabs.length), 'tabs open'));
    h += `<div class="c t1" style="left:28px;top:232px;display:flex;gap:8px;flex-wrap:wrap;width:780px">${A.tabs.map(t => `<span class="cls ${t.focused ? 'READ' : 'AUTO'}" style="font-size:15px;text-transform:none;letter-spacing:0;padding:5px 8px">${esc(t.title)} · ${esc(t.url.replace(/^https?:\/\//, ''))}</span>`).join('')}</div>`;
    const sum = a => { const n = { AUTO: 0, READ: 0, GATED: 0 }; a.tools.forEach(t => { n[clsOf(a, t)]++; }); return Object.entries(n).filter(e => e[1]).map(e => e[1] + ' ' + e[0].toLowerCase()).join(' · '); };
    const tools = a => a.tools.map(t => `<div><span class="cls ${clsOf(a, t)}">${clsOf(a, t)}</span><span class="mono">${esc(t.short)}</span></div>`).join('');
    const app = (a, x, y, w, hh, stCls, stTxt, l0, d1, lamp) => {
      const id = reg('app:' + a.id, 'line', 'app', a.name, a.kind + ' · ' + a.origin, a.tools.map(t => t.short).join(' '));
      return box(id, `station ${a.enabled ? '' : 'closed'}`, x, y, w, hh, `${lamp ? `<i class="lamp ${lamp}"></i>` : ''}<div class="nm">${esc(a.name.toUpperCase())}</div><div class="st ${stCls}">${esc(stTxt)}</div>${l0 ? `<div class="big26 l0only" style="margin-top:6px">${esc(l0)}</div>` : ''}<div class="tools t1" style="margin-top:-24px">${d1}</div>`);
    };
    const by = id => A.apps.find(a => a.id === id);
    const lb = by('ledgerbox'), ib = by('inbox'), dc = by('docs'), crm = by('crm'), cal = by('calendar');
    h += app(lb, 28, 350, 380, 170, 'ok', `open · ${lb.tools.length} own tools`, sum(lb), `<div style="columns:2;margin-top:30px">${tools(lb)}</div>`, 'green');
    h += app(ib, 432, 350, 380, 170, 'ok', 'open · reads the page', `tier 2 hands · ${ib.lastSeen}`, `<div style="margin-top:30px">${tools(ib)}<div>registers no tools · last seen ${esc(ib.lastSeen)}</div></div>`, 'green');
    h += app(dc, 28, 540, 380, 116, 'warn', 'no bridge · timeout', '', `<div style="margin-top:30px">reads the page anyway · ${esc(dc.lastSeen)}</div>`, 'amber');
    h += app(crm, 432, 540, 184, 116, 'closed', 'closed', '', `<div style="margin-top:30px">switched off · ${esc(crm.lastSeen)}</div>`);
    h += app(cal, 628, 540, 184, 116, 'closed', 'closed', '', `<div style="margin-top:30px">never seen</div>`);
    A.connectors.forEach((c, i) => {
      const id = reg('acc:' + c.id, 'line', 'account', c.label, (c.health === 'healthy' ? 'connected' : 'needs reconnecting') + ' · account', c.tools.map(t => t.name).join(' '));
      const bad = c.health !== 'healthy';
      h += box(id, `station ${bad ? 'bad' : ''}`, 28 + i * 404, 676, 380, 120, `<i class="lamp ${bad ? 'red' : 'green'}"></i><div class="nm">${esc(c.label.toUpperCase())}</div><div class="st ${bad ? 'bad' : 'ok'}">${bad ? 'needs you · reconnect' : 'connected · account'}</div>
        <div class="tools t1">${bad ? esc(c.lastFlow.detail) : esc(c.identity)} · ${c.tools.length} tools · writes off</div>`);
    });
    return h;
  }

  function buildTimetable(s) {
    let h = head(s, agg('~$' + Math.round(offerYear / 1000) + 'k', 'a year on offer · est.', 'amber') + agg(String(A.playbooks.length), 'chores') + agg(`${benched.filter(p => p.bench.verdict === 'exceeds').length} of ${benched.length}`, 'benched beat the bar'));
    A.playbooks.forEach((p, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const id = reg('pb:' + p.id, 'timetable', 'playbook', p.title, p.domain, p.promise);
      const lamp = p.bench ? (p.bench.verdict === 'exceeds' ? 'green' : 'amber') : 'off';
      h += box(id, 'dep', 28 + col * 364, 214 + row * 48, 340, 42, `<i class="lamp ${lamp}"></i><span class="tt">${esc(p.title)}</span><span class="t1">${money(p.economics.value)}/${p.economics.per === 'month' ? 'mo' : 'yr'}</span>`);
    });
    return h;
  }

  function buildRegister(s) {
    let h = head(s, agg('$0.13', 'spent today · est.', '', 'spent') + agg('14', 'model calls', '', 'calls') + agg('2', 'failed · reason kept', 'amber', 'fails'));
    const sid = reg('spend', 'register', 'spend', 'Spend by engine', 'every figure an estimate', 'cost price ledger spend');
    h += box(sid, 'bars', 28, 214, 300, 180, `
      <div class="barrow"><div class="bl"><span>MUSE</span><span class="mono" data-b="spMuse"></span></div><div class="bt"><i data-bar="muse_spark" style="background:var(--muse)"></i></div></div>
      <div class="barrow"><div class="bl"><span>SAM</span><span class="mono" data-b="spSam"></span></div><div class="bt"><i data-bar="sam_3_1" style="background:var(--green)"></i></div></div>
      <div class="barrow"><div class="bl"><span>LLAMA</span><span class="mono" data-b="spLlama"></span></div><div class="bt"><i data-bar="llama_baseten" style="background:var(--amber)"></i></div></div>`);
    h += `<div class="c t1" id="ledRows" style="left:344px;top:210px;width:392px"></div>`;
    h += `<div class="c l0only big26" style="left:350px;top:220px;width:380px">last call<br><em data-b="lastCall"></em><br><span style="display:block;margin-top:14px">failures</span><em data-b="failList"></em></div>`;
    for (let i = 0; i < 6; i++) reg('led:' + i, 'register', 'ledger', 'Ledger row', '', 'ledger row');
    return h;
  }

  function buildTest(s) {
    let h = head(s, agg(`${bBreach} / ${bTurns}`, 'breaches · other models', 'green') + agg(rerunDate, 'Muse re-run · planned', 'amber'));
    const bid = reg('baseline', 'testtrack', 'baseline', `Gauntlet baseline · ${base.date}`, 'measured · not on Muse', 'gauntlet breaches proving baseline');
    let sq = '';
    const r0 = base.rows[0].turns, r1 = base.rows[1].turns, pr = base.rows[1].pressure;
    for (let i = 0; i < r0; i++) sq += `<i class="sq held" data-sq style="left:${16 + (i % 19) * 18}px;top:${52 + Math.floor(i / 19) * 18}px"></i>`;
    for (let i = 0; i < r1; i++) sq += `<i class="sq ${i < pr ? 'press' : 'held'}" data-sq style="left:${16 + i * 18}px;top:${130}px"></i>`;
    h += box(bid, 'runbox', 28, 214, 380, 180, `<div class="big26 l0only" style="position:absolute;left:16px;top:10px"><em>${bTurns} turns · ${bBreach} breached</em></div>
      <div class="big26 l0only" style="position:absolute;left:16px;top:146px">measured ${esc(base.date.replace(/ \d{4}$/, ''))} · not Muse</div>
      <div class="t1" style="position:absolute;left:16px;right:12px;top:10px;display:flex;justify-content:space-between;align-items:center;font-size:15px">CLI engine · <b>${r0} held</b><button class="btn-line" type="button" data-act="replay">▶ Replay</button></div>${sq}
      <div class="t1" style="position:absolute;left:16px;top:148px;font-size:15px">Nemotron · <b>${r1} held</b> · ${pr} pressed · repeats ${M.proving.repeats.map(r => `0 of ${r.turns}`).join(', ')} breached</div>`);
    const rid = reg('rerun', 'testtrack', 'rerun', 'Gauntlet on Muse', 'planned · not run', 'gauntlet muse rerun pixel injection planned');
    let pq = '';
    for (let i = 0; i < 36; i++) pq += `<i class="sq plan" style="left:${16 + (i % 12) * 19}px;top:${116 + Math.floor(i / 12) * 19}px"></i>`;
    h += box(rid, 'runbox plan', 424, 214, 268, 180, `<span class="lbl" style="color:var(--amber)">Muse re-run</span>
      <div class="big26 l0only" style="margin-top:8px"><em>not run</em> · ${esc(rerunDate)}</div>
      <div class="t1" style="font-size:15px;margin-top:6px;line-height:1.4">planned ${esc(M.proving.rerun.date)} · <b>no result</b><br>Llama attacks · Muse drives</div>${pq}`);
    return h;
  }

  /* ------------------------------------------------------------------ tracks */
  const P = {
    museIn: 'M 438 360 H 680', auto: 'M 680 360 C 710 360 710 290 740 290 H 1020 C 1050 290 1050 360 1080 360', read: 'M 680 360 H 1080',
    gated: 'M 680 360 C 710 360 710 430 740 430 H 1020 C 1050 430 1050 360 1080 360',
    exit: 'M 1080 360 H 1520', line: 'M 1520 360 H 2344', toLb: 'M 1520 360 H 1738',
    llama: 'M 438 640 H 480 Q 510 640 510 610 V 390 Q 510 360 540 360', sam: 'M 438 500 H 520 V 488 H 1010 V 446', cli: 'M 438 780 H 500',
    spLb: 'M 1738 360 V 390', spIb: 'M 2142 360 V 390', gut: 'M 1940 360 V 776', stub1: 'M 1928 598 H 1952', stub2: 'M 1928 776 H 1952',
  };
  const LEG1 = 'M 560 360 H 680 C 710 360 710 430 740 430 H 930';
  const LEG2 = 'M 930 430 H 1020 C 1050 430 1050 360 1080 360 H 1738';
  function buildTracks() {
    let g = '';
    const bed = Object.keys(P).filter(k => k !== 'toLb' && k !== 'sam').map(k => `<path d="${P[k]}" stroke="#04070d" stroke-width="20" fill="none" stroke-linecap="round"/>`).join('');
    const seg = (k, extra) => `<path data-seg="${k}" d="${P[k]}" fill="none" stroke-linecap="round" ${extra || ''}/>`;
    g += bed;
    for (const k of Object.keys(P)) if (k !== 'sam' && k !== 'toLb') g += seg(k, 'stroke-width="10"');
    g += seg('toLb', 'stroke-width="10"');
    g += `<path data-seg="sam" d="${P.sam}" fill="none" stroke="#5b97ff" stroke-width="4" stroke-dasharray="10 9" opacity=".8"/>`;
    g += `<rect x="496" y="764" width="10" height="32" rx="2" fill="#7a2a24"/>`;
    return `<svg id="tracks" viewBox="0 0 ${W} ${H}" aria-hidden="true">${g}</svg>`;
  }
  function paintTracks() {
    const lit = '#ffe2a8', dim = '#2c3a55', blue = '#5b97ff', amb = '#ffb547';
    const set = (k, col, glow) => { const p = $(`[data-seg="${k}"]`); if (!p) return; p.setAttribute('stroke', col); p.style.filter = glow ? `drop-shadow(0 0 7px ${col})` : 'none'; };
    for (const k of Object.keys(P)) if (k !== 'sam') set(k, dim, false);
    set('museIn', state.diverted ? '#24375c' : blue, !state.diverted);
    set('llama', state.diverted ? amb : '#4a3a1c', state.diverted);
    set('auto', '#3d5170'); set('read', '#3d5170');
    if (!state.released) set('gated', lit, true); else { set('gated', '#3d5170'); set('toLb', lit, true); set('spLb', lit, true); }
    set('cli', '#3a2a24');
  }

  /* ------------------------------------------------------------------ build */
  function build() {
    let h = `<div id="panel"></div>`;
    const builders = { yard: buildYard, interlocking: buildInterlocking, line: buildLine, timetable: buildTimetable, register: buildRegister, testtrack: buildTest };
    for (const s of SECTIONS) h += `<div class="sec" data-section="${s.id}" id="sec-${s.id}" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px" aria-label="${esc(s.name)}">${builders[s.id](s)}</div>`;
    h += buildTracks();
    h += `<div id="train" style="offset-path:path('${LEG1}');offset-distance:100%">${M.headcode}</div>`;
    world.innerHTML = h;
    /* tracks sit between the plates and the labels: lift every item above the svg */
    $$('.sec > *:not(.screw)', world).forEach(e => { e.style.zIndex = 3; });
    $$('.sec', world).forEach(e => { e.style.zIndex = 'auto'; });
  }
  build();

  /* ------------------------------------------------------------------ refresh */
  function refresh() {
    for (const el of $$('[data-b]')) { const f = BIND[el.dataset.b]; if (f) { const v = f(); if (el.textContent !== v) el.textContent = v; } }
    const b = $('[data-b="breaker"]'); if (b) b.className = state.diverted ? 'amber' : 'green';
    const wv = $('[data-b="waiting"]'); if (wv) wv.className = waiting() ? 'red' : 'green';
    $('#brandLamp').classList.toggle('clear', !waiting());
    const g3 = $('[data-g3]'); if (g3) g3.className = `lamp c ${waiting() ? 'red' : 'green'}`;
    for (const c of state.cards) {
      const el = itemEl('card:' + c.id); if (!el) continue;
      el.classList.toggle('approved', c.status === 'approved'); el.classList.toggle('declined', c.status === 'declined');
      const st = $(`[data-stamp="${c.id}"]`, el); if (st) st.innerHTML = c.status === 'declined' ? 'DECLINED<br>AT DANGER' : 'SIGNED<br>SPENT';
      const l0 = $(`[data-l0w="${c.id}"]`, el); if (l0) { l0.textContent = c.status === 'waiting' ? 'waits for your hand' : c.status === 'approved' ? 'ran once · spent' : 'declined · not sent'; l0.style.color = c.status === 'waiting' ? '#ff8a80' : c.status === 'approved' ? '#8ff0bd' : 'var(--dim)'; }
      const bt = $(`[data-btns="${c.id}"]`, el); if (bt) bt.innerHTML = leverButtons(c);
    }
    const lm = $('[data-lamp="muse_spark"]'); if (lm) lm.className = `lamp ${state.diverted ? 'amber' : 'blue'}`;
    const ll = $('[data-lamp="llama_baseten"]'); if (ll) ll.className = `lamp ${state.diverted ? 'blue' : 'amber'}`;
    const rm = $('[data-rl="muse_spark"]'); if (rm) rm.textContent = state.diverted ? 'breaker open · timed out' : 'driving · Meta Model API';
    const rl = $('[data-rl="llama_baseten"]'); if (rl) rl.textContent = state.diverted ? 'driving · diverted' : 'diversion · standby';
    $('#train').classList.toggle('div', state.diverted);
    $('#liveLine').innerHTML = liveLine();
    renderLedgerRows(); renderBars(); paintTracks(); drawKeyplan();
    if (mobile) renderMobile();
  }
  function liveLine() {
    const w = waiting();
    return `<b>${esc(M.clock)}</b> · ${M.headcode} ${esc(M.turnName)} · ` + (w ? `<span class="r">held at G3 · ${w} ${w === 1 ? 'lever waits' : 'levers wait'} for your hand</span>` : '<span class="g">released to Ledgerbox</span>')
      + (state.diverted ? ' · <span class="r">DIVERTED to Llama — the levers did not move</span>' : '') + ` · $${spend().toFixed(2)} spent today, est.`;
  }
  function renderLedgerRows() {
    const el = $('#ledRows'); if (!el) return;
    el.innerHTML = state.ledger.slice(0, 6).map((r, i) => `<div class="lrow ${r.fresh ? 'fresh' : ''}" data-item="led:${i}"><span>${esc(r.at)}</span><span>${esc((r.engine.split('_')[0] + '    ').slice(0, 5))}</span>${r.error ? `<span class="e">${esc(r.error)}</span>` : `<span>${usd(r.cost)} est.</span>`}</div>`).join('')
      + `<div class="lrow" style="color:var(--dim)" data-b="showing">${BIND.showing()}</div>`;
    state.ledger.forEach(r => { r.fresh = false; });
  }
  function renderBars() {
    const max = Math.max(spend('muse_spark'), 0.0001);
    for (const i of $$('[data-bar]')) i.style.width = Math.max(2, 100 * spend(i.dataset.bar) / max) + '%';
  }
  const itemEl = id => world.querySelector(`[data-item="${CSS.escape(id)}"]`);

  /* ------------------------------------------------------------------ camera */
  const cam = { x: 0, y: 0, k: 1 };
  const PAD = 18;
  const size = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const dzSpace = () => dz.hidden ? 0 : dz.offsetWidth + 28;
  function fit(r, pad) {
    const s = size(), p = pad == null ? PAD : pad, aw = s.w - dzSpace();
    const k = Math.min((aw - 2 * p) / r.w, (s.h - 2 * p) / r.h);
    return { k, x: (aw - r.w * k) / 2 - r.x * k, y: (s.h - r.h * k) / 2 - r.y * k };
  }
  const homeCam = () => fit({ x: -24, y: -24, w: W + 48, h: H + 48 }, 10);
  function rectOf(id) {
    if (SEC[id]) return SEC[id];
    const el = itemEl(id); if (!el) return null;
    const secEl = el.closest('.sec'); const s = SEC[secEl.dataset.section];
    const x = s.x + el.offsetLeft, y = s.y + el.offsetTop;
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function apply() {
    world.style.transform = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px) scale(${cam.k.toFixed(4)})`;
    world.classList.toggle('show1', cam.k * T1 >= 12);
    drawViewport();
  }
  let flyRaf = 0;
  function fly(to, dur) {
    cancelAnimationFrame(flyRaf);
    if (reduced || dur === 0) { Object.assign(cam, to); apply(); return; }
    const from = Object.assign({}, cam), t0 = performance.now(), d = dur || 650;
    const e = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = now => {
      const t = Math.min(1, (now - t0) / d), q = e(t);
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * q);
      cam.k = k; cam.x = from.x + (to.x - from.x) * q; cam.y = from.y + (to.y - from.y) * q; apply();
      if (t < 1) flyRaf = requestAnimationFrame(step);
    };
    flyRaf = requestAnimationFrame(step);
  }
  function zoomAt(px, py, f) {
    const hk = homeCam().k;
    const k = clamp(cam.k * f, hk * 0.85, 3.2);
    const wx = (px - cam.x) / cam.k, wy = (py - cam.y) / cam.k;
    cam.k = k; cam.x = px - wx * k; cam.y = py - wy * k; apply();
    navFromCamSoon();
  }

  /* ------------------------------------------------------------------ navigation */
  const nav = { level: 0, sec: null, item: null };
  const dz = $('#dossier');
  function setNav(n) {
    Object.assign(nav, n);
    $$('.sec', world).forEach(e => e.classList.toggle('focus', e.dataset.section === nav.sec && nav.level >= 1));
    $$('.it.sel', world).forEach(e => e.classList.remove('sel'));
    if (nav.item) { const el = itemEl(nav.item); if (el) el.classList.add('sel'); }
    renderCrumbs(); renderLadder();
  }
  function home() { closeDossier(); setNav({ level: 0, sec: null, item: null }); fly(homeCam()); }
  function openSection(id) { closeDossier(); setNav({ level: 1, sec: id, item: null }); fly(fit(SEC[id], 24)); }
  function openItem(id) {
    const it = ITEMS[id]; if (!it) return;
    setNav({ level: 2, sec: it.sec, item: id });
    renderDossier(id);
    const r = rectOf(id) || SEC[it.sec];
    const s = SEC[it.sec];
    /* frame the item inside its section, so the place around it stays legible */
    const pad = 110;
    const fr = { x: Math.max(s.x, r.x - pad), y: Math.max(s.y, r.y - pad), w: 0, h: 0 };
    fr.w = Math.min(s.x + s.w, r.x + r.w + pad) - fr.x; fr.h = Math.min(s.y + s.h, r.y + r.h + pad) - fr.y;
    const f = fit(fr, 24);
    if (f.k > 1.45) { const c = { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 }; const ss = size(); f.k = 1.45; f.x = (ss.w - dzSpace()) / 2 - c.x * f.k; f.y = ss.h / 2 - c.y * f.k; }
    fly(f);
  }
  function back() {
    if (nav.level === 2) { const s = nav.sec; closeDossier(); setNav({ level: 1, sec: s, item: null }); fly(fit(SEC[s], 24)); }
    else if (nav.level === 1) home();
  }
  function closeDossier() { if (!dz.hidden) { dz.hidden = true; } }
  let navT = 0;
  function navFromCamSoon() { clearTimeout(navT); navT = setTimeout(navFromCam, 160); }
  function navFromCam() {
    if (nav.level === 2) return;
    const s = size(), vx = -cam.x / cam.k, vy = -cam.y / cam.k, vw = s.w / cam.k, vh = s.h / cam.k;
    if (cam.k <= homeCam().k * 1.12) { if (nav.level !== 0) setNav({ level: 0, sec: null, item: null }); return; }
    let best = null, bestA = 0;
    for (const sc of SECTIONS) {
      const ix = Math.max(0, Math.min(sc.x + sc.w, vx + vw) - Math.max(sc.x, vx)), iy = Math.max(0, Math.min(sc.y + sc.h, vy + vh) - Math.max(sc.y, vy));
      const a = ix * iy / (vw * vh); if (a > bestA) { bestA = a; best = sc.id; }
    }
    if (best && bestA > 0.3) { if (nav.sec !== best || nav.level !== 1) setNav({ level: 1, sec: best, item: null }); }
    else if (nav.level !== 0) setNav({ level: 0, sec: null, item: null });
  }
  function itemTitle(id) { const it = ITEMS[id]; if (!it) return id; if (it.kind === 'ledger') { const r = state.ledger[+id.slice(4)]; return r ? `Ledger · ${r.at} · ${engName(r.engine)}` : 'Ledger row'; } return it.title; }
  function renderCrumbs() {
    const c = $('#crumbs');
    let h = nav.level === 0 ? '<b>The whole panel</b>' : '<button type="button" data-go="home">Panel</button>';
    if (nav.sec) h += ' › ' + (nav.level === 1 ? `<b>${esc(SEC[nav.sec].name)}</b>` : `<button type="button" data-go="sec">${esc(SEC[nav.sec].name)}</button>`);
    if (nav.item) h += ' › <b>' + esc(itemTitle(nav.item)) + '</b>';
    c.innerHTML = h;
  }
  $('#crumbs').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (!b) return; if (b.dataset.go === 'home') home(); else openSection(nav.sec); });
  function renderLadder() { for (const b of $$('#ladder button')) b.setAttribute('aria-current', String(+b.dataset.lv === nav.level)); }
  $('#ladder').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const lv = +b.dataset.lv;
    if (lv === 0) home(); else if (lv === 1) openSection(nav.sec || 'interlocking'); else openItem(nav.item || ('card:' + state.cards[0].id));
  });

  /* key plan */
  const kp = $('#keyplan');
  function drawKeyplan() {
    let h = `<rect x="0" y="0" width="${W}" height="${H}" fill="#070c16"/>`;
    for (const s of SECTIONS) h += `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="30" fill="${nav.sec === s.id ? '#3a4a6a' : '#1a2740'}" stroke="#c9a35a" stroke-opacity=".5" stroke-width="10"/>`;
    if (waiting()) h += `<circle cx="1010" cy="430" r="90" fill="#ff4a3d"/>`;
    h += `<rect id="kpView" fill="none" stroke="#ffd38a" stroke-width="28"/>`;
    kp.innerHTML = h; drawViewport();
  }
  function drawViewport() {
    const v = $('#kpView', kp); if (!v) return;
    const s = size();
    const x = clamp(-cam.x / cam.k, 0, W), y = clamp(-cam.y / cam.k, 0, H);
    const w = clamp(s.w / cam.k, 0, W - x), h = clamp(s.h / cam.k, 0, H - y);
    v.setAttribute('x', x); v.setAttribute('y', y); v.setAttribute('width', w); v.setAttribute('height', h);
  }
  kp.addEventListener('click', e => {
    const r = kp.getBoundingClientRect(); const wx = (e.clientX - r.left) / r.width * W, wy = (e.clientY - r.top) / r.height * H;
    const s = SECTIONS.find(s => wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h);
    if (s) openSection(s.id); else home();
  });

  /* ------------------------------------------------------------------ input */
  let drag = null, dragged = false;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; dragged = false;
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    if (!dragged) { dragged = true; stage.classList.add('dragging'); cancelAnimationFrame(flyRaf); }
    cam.x = drag.cx + dx; cam.y = drag.cy + dy; apply();
  });
  window.addEventListener('pointerup', () => { if (drag && dragged) navFromCamSoon(); drag = null; stage.classList.remove('dragging'); });
  stage.addEventListener('wheel', e => {
    e.preventDefault(); cancelAnimationFrame(flyRaf);
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
    else { cam.x -= e.deltaX; apply(); navFromCamSoon(); }
  }, { passive: false });
  stage.addEventListener('click', e => {
    if (dragged) { dragged = false; return; }
    const a = e.target.closest('[data-act]');
    if (a) { act(a.dataset.act, a.dataset.card); return; }
    const it = e.target.closest('[data-item]');
    if (it && world.contains(it)) {
      const sec = it.closest('.sec').dataset.section;
      if (nav.level === 0 && cam.k * T1 < 12) { openSection(sec); return; }
      openItem(it.dataset.item); return;
    }
    const s = e.target.closest('[data-section]');
    if (s) openSection(s.dataset.section);
  });
  $('#zoomIn').addEventListener('click', () => { const s = size(); zoomAt(s.w / 2, s.h / 2, 1.35); });
  $('#zoomOut').addEventListener('click', () => { const s = size(); zoomAt(s.w / 2, s.h / 2, 1 / 1.35); });
  $('#homeBtn').addEventListener('click', home);
  $('#dzBack').addEventListener('click', back);
  const ORDER = ['yard', 'interlocking', 'line', 'timetable', 'register', 'testtrack'];
  function walk(d) {
    if (nav.level === 2) {
      const ids = Object.keys(ITEMS).filter(i => ITEMS[i].sec === nav.sec && itemEl(i));
      const j = (ids.indexOf(nav.item) + d + ids.length) % ids.length; openItem(ids[j]); return;
    }
    const i = nav.sec ? ORDER.indexOf(nav.sec) : -1;
    openSection(ORDER[(i + d + ORDER.length) % ORDER.length]);
  }
  window.addEventListener('keydown', e => {
    if (mobile) { if (e.key === 'Escape') mBack(); return; }
    if (!$('#find').hidden) return;
    if (e.target.closest && e.target.closest('input')) return;
    const k = e.key;
    if (k === '/') { e.preventDefault(); openFind(); }
    else if (k === 'Escape') { e.preventDefault(); back(); }
    else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); walk(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); walk(-1); }
    else if (k === 'Home') home();
    else if (k === '+' || k === '=') $('#zoomIn').click();
    else if (k === '-') $('#zoomOut').click();
    else if ((k === 'a' || k === 'A' || k === 'd' || k === 'D') && nav.item && nav.item.startsWith('card:')) {
      const c = state.cards.find(x => 'card:' + x.id === nav.item);
      if (c) act(k.toLowerCase() === 'a' ? (c.sam && !c.sam.agree ? 'approveAnyway' : 'approve') : 'decline', c.id);
    }
    else if (k === 'Enter' && nav.level === 0) openSection('interlocking');
    else if (k === 'Enter' && nav.level === 1) { const first = Object.keys(ITEMS).find(i => ITEMS[i].sec === nav.sec); if (first) openItem(first); }
  });
  window.addEventListener('resize', () => { checkMobile(); if (mobile) return; if (nav.level === 0) fly(homeCam(), 0); else if (nav.level === 1) fly(fit(SEC[nav.sec], 24), 0); else openItem(nav.item); });

  /* ------------------------------------------------------------------ actions */
  let toastT = 0;
  function toast(msg) { const t = $('#toast'); t.innerHTML = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 4600); }
  const stamp = () => `30 Sep, 09:${String(state.minute++).padStart(2, '0')}`;
  function addLedger(row) { row.id = 'led_0000000000' + (state.nextLed++).toString(16); row.fresh = true; state.ledger.unshift(row); }
  function act(a, cardId) {
    const c = cardId ? state.cards.find(x => x.id === cardId) : null;
    if (a === 'look') { if (mobile) return mOpenItem('card:' + cardId); return openItem('card:' + cardId); }
    if ((a === 'approve' || a === 'approveAnyway') && c && c.status === 'waiting') {
      if (a === 'approve' && c.sam && !c.sam.agree) { if (mobile) return mOpenItem('card:' + cardId); return openItem('card:' + cardId); }
      c.status = 'approved';
      const at = stamp();
      state.decisions.unshift({ id: c.id, action: c.action, result: 'approved', reason: null, at }); state.decisionsTotal++;
      toast(`<b>Lever ${c.n} pulled.</b> The chase for ${esc(c.invoice)} ran once on Ledgerbox, with exactly the card's parameters; the approval is now spent. <i>Simulated.</i>`);
      setTimeout(() => {
        const eng = state.diverted ? 'llama_baseten' : 'muse_spark';
        addLedger({ at: at.slice(-5), engine: eng, rounds: 1, tin: 19800, tout: 140, cost: eng === 'muse_spark' ? 0.0254 : 0.0029, error: null, note: `heard the page's answer: chase ${c.invoice} sent` });
        refresh();
      }, reduced ? 0 : 600);
    } else if (a === 'decline' && c && c.status === 'waiting') {
      c.status = 'declined';
      state.decisions.unshift({ id: c.id, action: c.action, result: 'declined', reason: 'user_denied', at: stamp() }); state.decisionsTotal++;
      toast(`<b>Lever ${c.n} stays at danger.</b> ${esc(c.invoice)} is recorded <span class="mono">user_denied</span>; nothing was sent.`);
    } else if (a === 'drill') {
      state.diverted = !state.diverted;
      if (state.diverted) {
        for (let i = 0; i < 3; i++) addLedger({ at: '09:' + String(state.minute).padStart(2, '0'), engine: 'muse_spark', rounds: 1, tin: 7000, tout: 0, cost: null, error: 'timeout', note: `drill: timeout ${i + 1} of 3` });
        state.minute++;
        toast('<b>Breaker open.</b> Three Muse timeouts in 60 s (a simulated drill): the turn diverts to Llama on Baseten. Every waiting lever stayed exactly where it was; each timeout is a register row.');
      } else toast('<b>Breaker closed.</b> Muse Spark drives again. The drill\'s three timeouts stay in the register.');
    } else if (a === 'replay') { replay(); }
    refresh();
    if (nav.level === 2 && nav.item && !mobile) renderDossier(nav.item);
    if (mobile && mv.level === 2 && mv.item) mRenderItem();
    if (!waiting() && !state.released) releaseTrain();
  }
  function replay() {
    const sq = $$('[data-sq]');
    if (reduced) { toast(`Replay: ${bTurns} hostile turns, ${bBreach} breached (measured ${esc(base.date)}, on other models).`); return; }
    sq.forEach(s => { s.dataset.c = s.className; s.className = 'sq'; });
    sq.forEach((s, i) => setTimeout(() => { s.className = s.dataset.c; }, 250 + i * 20));
    toast(`Replaying the measured ${esc(base.date)} baseline: ${bTurns} hostile turns on her CLI engine and on Nemotron, ${bBreach} breached. <b>Not a Muse result.</b>`);
  }
  function releaseTrain() {
    state.released = true;
    const t = $('#train');
    t.classList.remove('go'); t.style.offsetPath = `path('${LEG2}')`; t.style.offsetDistance = '0%';
    void t.offsetWidth;
    if (!reduced) t.classList.add('go');
    t.style.offsetDistance = '100%';
    paintTracks();
    toast(`<b>No lever waits.</b> G3 clears and ${M.headcode} runs on to the Ledgerbox platform.`);
  }

  /* ------------------------------------------------------------------ dossier */
  const tag = t => { const k = /estimate/.test(t) ? 'estimate' : /press/.test(t) ? 'press' : /event/.test(t) ? 'event' : /measured/.test(t) ? 'measured' : /planned/.test(t) ? 'planned' : /simulated/.test(t) ? 'simulated' : /decision|design/.test(t) ? 'decision' : 'unverified'; return `<span class="tag ${k}">${esc(t)}</span>`; };
  const code = o => '<pre>' + esc(JSON.stringify(o, null, 2)) + '</pre>';
  function samSvg(c) {
    const s = c.sam;
    let g = `<svg class="shot" viewBox="0 0 380 196" role="img" aria-label="Stylised drawing of the Ledgerbox invoice list with the DOM box and the SAM mask"><rect width="380" height="28" fill="#e4e8ee"/><text x="12" y="19" font-size="13" font-family="Segoe UI, sans-serif" fill="#334">ledgerbox.local/invoices · stylised</text>`;
    state.cards.forEach((r, i) => {
      const y = 42 + i * 50, me = r.id === c.id;
      g += `<rect x="8" y="${y - 6}" width="364" height="42" rx="4" fill="${me ? '#fff8e6' : '#ffffff'}" stroke="#d5dae0"/><text x="18" y="${y + 19}" font-size="13" font-family="Consolas, monospace" fill="#223">${r.invoice}</text><text x="88" y="${y + 19}" font-size="13" font-family="Segoe UI, sans-serif" fill="#445">${esc(r.client)}</text>`
        + `<rect x="196" y="${y + 3}" width="82" height="24" rx="4" fill="#2856c8"/><text x="205" y="${y + 20}" font-size="12.5" font-family="Segoe UI, sans-serif" fill="#fff">Send chase</text><rect x="284" y="${y + 3}" width="82" height="24" rx="4" fill="#e9edf2" stroke="#c2c9d1"/><text x="300" y="${y + 20}" font-size="12.5" font-family="Segoe UI, sans-serif" fill="#334">Snooze</text>`;
      if (me) {
        g += `<rect x="192" y="${y - 1}" width="90" height="32" rx="5" fill="none" stroke="#2f6bff" stroke-width="2.5" stroke-dasharray="6 4"/>`;
        g += s && s.agree ? `<rect x="196" y="${y + 3}" width="82" height="24" rx="4" fill="rgba(52,211,153,.45)" stroke="#0e9f6e" stroke-width="2"/>` : `<rect x="284" y="${y + 3}" width="82" height="24" rx="4" fill="rgba(245,176,65,.5)" stroke="#c77700" stroke-width="2"/>`;
      }
    });
    return g + '</svg>';
  }
  function dossierHtml(id) {
    const it = ITEMS[id]; if (!it) return '';
    let b = '';
    if (it.kind === 'card') {
      const c = state.cards.find(x => 'card:' + x.id === id), s = c.sam;
      const st = c.status === 'waiting' ? tag('planned · waiting for your hand') : c.status === 'approved' ? '<span class="tag measured">signed · ran once · spent</span>' : '<span class="tag unverified">declined · user_denied</span>';
      b += `<h2>Lever ${c.n} · ${esc(c.invoice)}</h2><p class="lede">${esc(c.client)} · ${money(c.amount)} · ${c.days} days past due &nbsp;${st}</p>`;
      b += `<h3>What runs, exactly once, if you pull it</h3>` + code({ action: c.action, params: { invoice: c.invoice, to: c.to }, card: c.id, expires: 'in 24 h', spent: 'on first run' });
      b += `<h3>Why she proposes it</h3><p>${esc(c.why)}</p>`;
      b += `<h3>Track circuit: two witnesses</h3>${samSvg(c)}<p style="margin-top:8px">Dashed blue: the DOM ref the gate will click. Filled: the SAM 3.1 mask from the screenshot captured for this card. `
        + (s.agree ? `IoU <b>${s.iou.toFixed(2)}</b>, above 0.80: <b>two witnesses agree.</b>` : `IoU <b>${s.iou.toFixed(2)}</b>: <b>one witness only.</b> ${esc(s.note)}`) + ` ${tag('simulated')}</p>`;
      b += `<div class="claim">The driver never sets the signal. Muse proposed this card; only your hand clears G3.</div>`;
      if (c.status === 'waiting') b += `<div class="acts">${s.agree ? `<button class="btn-ok" type="button" data-dact="approve">Pull · approve (A)</button>` : `<button class="btn-ok warn" type="button" data-dact="approveAnyway">I checked the outline · approve (A)</button>`}<button class="btn-no" type="button" data-dact="decline">Decline (D)</button></div>`;
    } else if (it.kind === 'engine') {
      const e = M.engines.find(x => 'eng:' + x.id === id);
      b += `<h2>${esc(e.name)}</h2><p class="lede">${esc(e.role)} · ${esc(e.lineName)} &nbsp;${e.isNew ? '<span class="tag press">new in the window</span>' : '<span class="tag event">carried over</span>'}</p>`;
      b += `<p>${esc(e.does)}</p><p class="muted">${esc(e.effort)}</p>`;
      b += `<h3>What is known, and how</h3><table><tr><th>Fact</th><th>Value</th><th>Kind</th></tr>${e.facts.map(f => `<tr><td>${esc(f[0])}</td><td>${esc(f[1])}</td><td>${tag(f[2])}</td></tr>`).join('')}</table>`;
      b += `<h3>When it fails</h3><p>${esc(e.fallback)}</p><h3>Configuration</h3><pre>${esc(e.config)}</pre>`;
      if (e.id === 'muse_spark' || e.id === 'llama_baseten') b += `<div class="acts"><button class="btn-line" type="button" data-dact="drill">${esc(BIND.drill())}</button></div>`;
    } else if (it.kind === 'app') {
      const a = A.apps.find(x => 'app:' + x.id === id);
      b += `<h2>${esc(a.name)}</h2><p class="lede">${esc(a.kind)} · <span class="mono">${esc(a.origin)}</span> · ${a.enabled ? 'open' : 'closed'} · last seen ${esc(a.lastSeen)}</p><p>${esc(a.blurb)}</p>`;
      b += `<h3>Tools she may address here</h3>` + (a.tools.length ? `<table><tr><th>Tool</th><th>Class</th><th>Tier</th><th>Does</th></tr>${a.tools.map(t => { const c2 = clsOf(a, t); return `<tr><td class="mono">${esc(t.short)}</td><td><span class="cls ${c2}">${c2}</span>${c2 !== t.cls ? ' <span class="muted">tightened</span>' : ''}</td><td>${t.tier}</td><td>${esc(t.desc)}</td></tr>`; }).join('')}</table>` : '<p class="muted">None registered. The generic hands still read the page; each is GATED on first sight for a new origin.</p>');
      b += `<h3>Gate facts</h3><ul><li>Transport: ${esc(a.transport || 'none answered')}${a.problem ? ` · problem: <b>${esc(a.problem)}</b>` : ''}</li><li>A turn is pinned to its origin; another tab's tools are only ever cards.</li><li>A class comes from the manifest's own flags; a surface may tighten it, never loosen it.</li></ul>`;
    } else if (it.kind === 'account') {
      const c = A.connectors.find(x => 'acc:' + x.id === id);
      b += `<h2>${esc(c.label)}</h2><p class="lede">${esc(c.identity)} · ${esc(c.status)} · health <b>${esc(c.health)}</b></p><p>${esc(c.description)}</p>`;
      if (c.healthDetail) b += `<div class="claim">${esc(c.healthDetail)}. Last flow: ${esc(c.lastFlow.detail)}.</div>`;
      b += `<h3>Tools</h3><table><tr><th>Tool</th><th>Reversible</th><th>Side effect</th></tr>${c.tools.map(t => `<tr><td class="mono">${esc(t.name)}</td><td>${t.reversible ? 'yes' : 'no'}</td><td>${esc(t.side)}</td></tr>`).join('')}</table>`;
      b += `<h3>The vault</h3><ul><li>Writes: ${c.writes ? 'on' : 'off'} · egress allow-list by ${esc(c.egress)}</li><li>Sealed with ${esc(c.seal)} · dials only ${c.hosts.map(esc).join(', ')}</li><li>${esc(c.guideNote)}</li></ul>`;
    } else if (it.kind === 'class') {
      const k = id.slice(4);
      const txt = { AUTO: 'Fires after its validator passes, and only for a tool whose manifest says reversible with no external side effects.', READ: 'Runs at once; the answer is capped at 1,600 characters and announces "(showing N of M)". It becomes a recorded episode.', GATED: 'Writes an approval row and a decision card. It runs only after a resolved decision, through POST /decisions/<id>, which a model cannot reach. An approval is spent when the gate lets its action through; a replay is refused.' }[k];
      b += `<h2>${k} track</h2><p class="lede">${esc(A.toolClasses[k])}</p><p>${esc(txt)}</p>`;
      b += `<div class="claim">On Muse, a native tool call is a proposal like any other. The schema she is offered is generated from this catalog; the gate decides what it is.</div>`;
      b += `<h3>The lever log</h3><table><tr><th>When</th><th>Card</th><th>Result</th><th>Reason</th></tr>${state.decisions.map(d => `<tr><td>${esc(d.at)}</td><td class="mono">…${esc(d.id.slice(-4))}</td><td>${esc(d.result)}</td><td class="mono">${esc(d.reason || '—')}</td></tr>`).join('')}</table><p class="muted">(showing ${state.decisions.length} of ${state.decisionsTotal})</p>`;
    } else if (it.kind === 'turn') {
      b += `<h2>${M.headcode} · ${esc(M.turnName)}</h2><p class="lede">The turn on the line now · driven by ${state.diverted ? 'Llama on Baseten (diverted)' : 'Muse Spark'}</p>`;
      b += `<h3>The transcript</h3><ul>${A.turn.map(t => `<li><b>${esc(t.kind)}</b>${t.at ? ` <span class="mono">${esc(t.at)}</span>` : ''}: ${esc(t.text)}</li>`).join('')}</ul>`;
      b += `<h3>Where it stands</h3><p>${waiting() ? `Held at G3: ${waiting()} of ${state.cards.length} levers wait for you (${money(waitingSum())}).` : 'Released: every lever is answered.'} Up to eight provider rounds make one turn and one register row.</p>`;
      b += `<p class="muted">Cost of the turn: ${usd(state.ledger.find(r => /chase turn/.test(r.note)).cost)} ${tag('estimate')}</p>`;
    } else if (it.kind === 'playbook') {
      const p = A.playbooks.find(x => 'pb:' + x.id === id);
      b += `<h2>${esc(p.title)}</h2><p class="lede">${esc(p.domain)} · ${esc(p.audience)} · ${money(p.economics.value)} a ${esc(p.economics.per)} <span class="tag estimate">author's estimate</span></p><p>${esc(p.promise)}</p>`;
      if (p.command) b += `<div class="claim" style="border-color:var(--tung)">“${esc(p.command)}”</div>`;
      if (p.steps && p.steps.length) b += `<h3>How she runs it</h3><ol>${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
      if (p.gate) b += `<h3>The lever</h3><p><b>${esc(p.gate.label)}</b> (<span class="mono">${esc(p.gate.action)}</span>): ${esc(p.gate.why)}</p>`;
      if (p.traps && p.traps.length) b += `<h3>Traps she must leave alone</h3><ul>${p.traps.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
      if (p.bench) {
        const x = p.bench;
        b += `<h3>Latest bench ${tag('measured · not on Muse')}</h3><table><tr><td>Verdict</td><td><b>${esc(x.label)}</b>${x.reason ? ' · ' + esc(x.reason) : ''}</td></tr><tr><td>Found</td><td>${x.found} of ${x.eligible} · $${x.valueFound} of $${x.valueTotal}</td></tr><tr><td>False claims</td><td>${x.falseClaims} · traps filed ${x.trapsFiled} of ${x.trapsTotal}</td></tr><tr><td>Time · cost</td><td>${x.minutes} min · $${x.cost} · ${x.turns} turns</td></tr></table><p class="muted">“${esc(x.closing)}”</p><p>The bench is re-run on Muse in the window before any Muse number is quoted.</p>`;
      } else b += `<p class="muted">Not benched yet.</p>`;
    } else if (it.kind === 'ledger') {
      const r = state.ledger[+id.slice(4)];
      b += `<h2>Ledger row · ${esc(r.at)}</h2><p class="lede">${esc(engName(r.engine))} · ${esc(r.note)}</p>`;
      b += code({ id: r.id, at: '30 Sep, ' + r.at, engine: r.engine, rounds: r.rounds, tokens_in: r.tin, tokens_out: r.tout, cost_usd: r.cost, cost_estimated: true, error: r.error });
      b += `<p>One row per model invocation, failures included, with a reason from a closed set. Muse prices are a third-party listing, so every Muse cost is ${tag('estimate')}.</p>`;
    } else if (it.kind === 'spend') {
      b += `<h2>Spend by engine</h2><p class="lede">Today · ${state.ledger.length} calls · ${failures().length} failed</p>`;
      b += `<table><tr><th>Engine</th><th>Calls</th><th>Spent</th></tr>${['muse_spark', 'sam_3_1', 'llama_baseten'].map(e => `<tr><td>${engName(e)}</td><td>${state.ledger.filter(r => r.engine === e).length}</td><td class="mono">${usd(spend(e))} est.</td></tr>`).join('')}<tr><td>CLI engines</td><td>0</td><td class="mono">$0 · off in the demo</td></tr></table>`;
      b += `<h3>Every row (showing ${state.ledger.length} of ${state.ledger.length})</h3><table>${state.ledger.map(r => `<tr><td class="mono">${esc(r.at)}</td><td class="mono">${esc(r.engine.split('_')[0])}</td><td class="mono">${r.error ? esc(r.error) : usd(r.cost)}</td><td>${esc(r.note)}</td></tr>`).join('')}</table>`;
      b += `<p class="muted" style="margin-top:10px">Prices: ~$1.25 / 1M input, ~$4.25 / 1M output for Muse Spark, from a third-party listing ${tag('unverified')}. Nothing here was measured on Muse.</p>`;
    } else if (it.kind === 'baseline') {
      b += `<h2>Gauntlet baseline</h2><p class="lede">Run <span class="mono">${base.run}</span> · ${base.date} ${tag('measured')} · <b>not on Muse</b></p>`;
      b += `<p>Attackers: ${esc(base.attackers)}. Each attack meets its own throwaway Athena; the verdict is read off the gate's records, never off a model.</p>`;
      b += `<table><tr><th>Athena under test</th><th>Turns</th><th>Held</th><th>Breached</th><th>Pressure</th></tr>${base.rows.map(r => `<tr><td>${esc(r.who)}</td><td>${r.turns}</td><td>${r.held}</td><td>${r.breached}</td><td>${r.pressure}</td></tr>`).join('')}</table>`;
      b += `<h3>Repeat runs</h3><table>${M.proving.repeats.map(r => `<tr><td>seed ${r.seed}</td><td class="mono">${r.run}</td><td>0 of ${r.turns} breached</td></tr>`).join('')}</table>`;
      b += `<p>Approve path: ${esc(M.proving.approvePath)}. Valid-attack ratio ${base.validRatio} · ${base.minutes} min · ${esc(base.cost)}.</p>`;
      b += `<div class="claim">These numbers say nothing about Athena on Muse until the Gauntlet is re-run there.</div><div class="acts"><button class="btn-line" type="button" data-dact="replay">▶ Replay the measured run</button></div>`;
    } else if (it.kind === 'rerun') {
      const r = M.proving.rerun;
      b += `<h2>The Gauntlet on Muse</h2><p class="lede">${tag('planned')} ${esc(r.date)} · repeats ${esc(r.repeats)} · <b>no result exists yet</b></p>`;
      b += `<h3>Roles, all on Meta models</h3><table>${r.roles.map(x => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td></tr>`).join('')}</table>`;
      b += `<h3>Surfaces</h3><table><tr><th>Surface</th><th>Origin</th><th>Status</th></tr>${r.surfaces.map(x => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td><td>${tag(x[2])}</td></tr>`).join('')}</table>`;
      b += `<h3>The bar</h3><p>${esc(r.bar)}. The pixel surface is new because Muse reads screenshots: an order painted into an image is evidence, never instruction.</p>`;
    }
    return b;
  }
  function renderDossier(id) {
    const it = ITEMS[id]; if (!it) return;
    $('#dzBackTo').textContent = 'Back to ' + SEC[it.sec].name;
    $('#dzKind').textContent = (it.kind === 'card' ? 'decision card' : it.kind) + ' · L2';
    $('#dzBody').innerHTML = dossierHtml(id);
    if (dz.hidden) { dz.hidden = false; dz.classList.add('out'); void dz.offsetWidth; dz.classList.remove('out'); }
  }
  function dact(a) {
    if (a === 'drill') return act('drill');
    if (a === 'replay') return act('replay');
    const cur = mobile ? mv.item : nav.item;
    const id = cur && cur.startsWith('card:') ? cur.slice(5) : null;
    if (id) act(a, id);
  }
  $('#dzBody').addEventListener('click', e => { const b = e.target.closest('button[data-dact]'); if (b) dact(b.dataset.dact); });

  /* ------------------------------------------------------------------ find */
  function buildIndex() {
    const out = [];
    for (const s of SECTIONS) out.push({ k: 'section', t: s.name, s: s.sub, go: () => openSection(s.id) });
    for (const id in ITEMS) { const it = ITEMS[id]; if (it.kind === 'ledger') continue; out.push({ k: it.kind, t: it.title, s: it.sub + ' ' + it.find, go: () => openItem(id) }); }
    for (const a of A.apps) for (const t of a.tools) out.push({ k: 'tool', t: t.name, s: `${clsOf(a, t)} · ${t.desc}`, go: () => openItem('app:' + a.id) });
    for (const c of A.connectors) for (const t of c.tools) out.push({ k: 'tool', t: `${c.label} · ${t.name}`, s: t.desc, go: () => openItem('acc:' + c.id) });
    state.ledger.forEach((r, i) => out.push({ k: 'ledger', t: `${r.at} · ${engName(r.engine)}`, s: r.error || r.note, go: () => { if (i < 6) openItem('led:' + i); else openItem('spend'); } }));
    return out;
  }
  let hits = [], hi = 0;
  function openFind() { $('#find').hidden = false; const i = $('#findIn'); i.value = ''; runFind(''); setTimeout(() => i.focus(), 0); }
  function closeFind() { $('#find').hidden = true; stage.focus({ preventScroll: true }); }
  function runFind(q) {
    const idx = buildIndex(), ql = q.trim().toLowerCase();
    hits = (ql ? idx.filter(x => (x.t + ' ' + x.s + ' ' + x.k).toLowerCase().includes(ql)) : idx.filter(x => x.k === 'section' || x.k === 'card')).slice(0, 14); hi = 0; drawHits();
  }
  function drawHits() { $('#findOut').innerHTML = hits.length ? hits.map((h, i) => `<li data-i="${i}" aria-selected="${i === hi}"><span class="k">${esc(h.k)}</span><span>${esc(h.t)}</span><span class="s">${esc(h.s)}</span></li>`).join('') : '<li>Nothing matches.</li>'; }
  function pick(i) { const h = hits[i]; if (!h) return; closeFind(); h.go(); }
  $('#findIn').addEventListener('input', e => runFind(e.target.value));
  $('#findIn').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hits.length - 1, hi + 1); drawHits(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); drawHits(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hi); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  $('#findOut').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pick(+li.dataset.i); });
  $('#find').addEventListener('click', e => { if (e.target.id === 'find') closeFind(); });
  $('#findBtn').addEventListener('click', openFind);

  /* ------------------------------------------------------------------ phone */
  let mobile = false;
  const mv = { level: 0, sec: null, item: null };
  const mEl = $('#mobile');
  function checkMobile() {
    const m = matchMedia('(max-width: 759px)').matches;
    if (m !== mobile) { mobile = m; document.body.classList.toggle('mobile', m); if (m) renderMobile(); else { fly(homeCam(), 0); } }
  }
  const secAgg = id => ({
    yard: `<b>${M.engines.length}</b> engines · breaker <b>${BIND.breaker()}</b>`,
    interlocking: `<b>${waiting()}</b> ${BIND.waitingWord()} · <b>${money(waitingSum())}</b> held · ${state.decisionsTotal} decisions`,
    line: `<b>${appsOn.length}</b> open · ${appsOff.length} closed · <b>${accNeed.length}</b> account needs you · ${A.tabs.length} tabs`,
    timetable: `<b>~$${Math.round(offerYear / 1000)}k</b> a year on offer (est.) · ${A.playbooks.length} chores`,
    register: `<b>$${spend().toFixed(2)}</b> spent today (est.) · ${state.ledger.length} calls · ${failures().length} failed`,
    testtrack: `<b>${bBreach} / ${bTurns}</b> breaches, other models · Muse re-run planned ${esc(rerunDate)}`,
  }[id]);
  function mCard(c) {
    const s = c.sam;
    return `<div class="m-card ${c.status}"><div class="lv">Lever ${c.n} · ${c.status === 'waiting' ? 'waits for your hand' : c.status === 'approved' ? 'signed · ran once · spent' : 'declined · not sent'}</div>
      <div class="row"><span class="inv">${esc(c.invoice)}</span><span class="amt">${money(c.amount)}</span></div><div class="cl">${esc(c.client)} · ${c.days} days past due · <span class="mono">${esc(c.action)}</span></div>
      <div class="wit ${s && !s.agree ? 'bad' : ''}">${s ? (s.agree ? `two witnesses · IoU ${s.iou.toFixed(2)}` : `one witness · IoU ${s.iou.toFixed(2)} · look first`) : 'DOM only'} · simulated</div>
      ${c.status === 'waiting' ? `<div class="btns">${s && !s.agree ? `<button class="btn-ok warn" type="button" data-act="look" data-card="${c.id}">Look first</button>` : `<button class="btn-ok" type="button" data-act="approve" data-card="${c.id}">Approve</button>`}<button class="btn-no" type="button" data-act="decline" data-card="${c.id}">Decline</button></div>` : ''}</div>`;
  }
  const mTop = () => `<div class="m-top"><span class="brand"><i class="${waiting() ? '' : 'clear'}"></i>The roof</span><span class="sp"></span><a class="toLanding" href="index.html">← The landing</a></div>`;
  function renderMobile() {
    if (!mobile) return;
    if (mv.level === 2) return mRenderItem();
    let h = mTop();
    if (mv.level === 0) {
      h += `<div class="m-sim">Simulated · fixtures · nothing leaves this page · Muse figures are estimates</div><div class="m-live">${liveLine()}</div>`;
      h += `<h1 class="m-h">${waiting() ? `<span class="red">${waiting()}</span> ${BIND.waitingWord()}` : 'No lever waits'}</h1><div class="m-sub">${M.headcode} · ${esc(M.turnName)} · ${waiting() ? money(waitingSum()) + ' held at G3' : 'released to Ledgerbox'}</div>`;
      h += state.cards.map(mCard).join('');
      h += `<h2 class="m-h" style="font-size:26px">The whole system</h2><div class="m-secs">${SECTIONS.map(s => `<button class="m-sec" type="button" data-section="${s.id}"><div class="t"><i>${s.n}</i>${esc(s.name)}</div><div class="a">${secAgg(s.id)}</div></button>`).join('')}</div>`;
    } else {
      const s = SEC[mv.sec];
      h += `<button class="m-back" type="button" data-mback>← The whole roof</button><h1 class="m-h">${esc(s.name)}</h1><div class="m-sub">${esc(s.sub)} · ${secAgg(s.id)}</div>`;
      if (s.id === 'interlocking') h += state.cards.map(mCard).join('');
      if (s.id === 'yard') h += `<div style="padding:0 14px 8px"><button class="btn-line" type="button" data-act="drill">${esc(BIND.drill())}</button></div>`;
      h += `<div class="m-list">${Object.keys(ITEMS).filter(i => ITEMS[i].sec === s.id && ITEMS[i].kind !== 'card').map(i => `<button class="m-item" type="button" data-mitem="${i}">${esc(itemTitle(i))}<small>${esc(ITEMS[i].kind === 'ledger' ? (state.ledger[+i.slice(4)] || {}).note || '' : ITEMS[i].sub)}</small></button>`).join('')}</div>`;
    }
    mEl.innerHTML = h;
  }
  function mRenderItem() {
    const it = ITEMS[mv.item];
    mEl.innerHTML = mTop() + `<button class="m-back" type="button" data-mback>← Back to ${esc(SEC[it.sec].name)}</button><div class="m-dz"><div class="dz-body">${dossierHtml(mv.item)}</div></div>`;
  }
  function mOpenItem(id) { mv.level = 2; mv.item = id; mv.sec = ITEMS[id].sec; mRenderItem(); window.scrollTo(0, 0); }
  function mBack() { if (mv.level === 2) { mv.level = 1; mv.item = null; } else if (mv.level === 1) { mv.level = 0; mv.sec = null; } renderMobile(); window.scrollTo(0, 0); }
  mEl.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (a) { act(a.dataset.act, a.dataset.card); return; }
    const d = e.target.closest('[data-dact]'); if (d) { dact(d.dataset.dact); return; }
    if (e.target.closest('[data-mback]')) { mBack(); return; }
    const s = e.target.closest('[data-section]'); if (s) { mv.level = 1; mv.sec = s.dataset.section; renderMobile(); window.scrollTo(0, 0); return; }
    const m = e.target.closest('[data-mitem]'); if (m) mOpenItem(m.dataset.mitem);
  });

  /* ------------------------------------------------------------------ go */
  window.roof = { level: () => mobile ? mv.level : nav.level, open: openSection, item: openItem, home };
  checkMobile();
  refresh();
  setNav({ level: 0, sec: null, item: null });
  fly(homeCam(), 0);
  if (!reduced && !mobile) {
    /* arrival: the panel lights from the main line outward, then hands over */
    world.style.opacity = '0';
    requestAnimationFrame(() => { world.style.transition = 'opacity .9s ease'; world.style.opacity = '1'; setTimeout(() => { world.style.transition = ''; }, 1000); });
  }
})();
