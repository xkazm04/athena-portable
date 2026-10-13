/* Fathom — one page, one presence, layers as depths.
 * The surface is Athena and the conversation; every other capability of the app is a depth
 * below her that you dive into and rise out of. Escape always rises one level.
 * All data comes from data.js (the product's fixtures). No daemon: actions are simulated. */
(() => {
  "use strict";
  const A = window.ATHENA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const usd = (n, d = 0) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const yearly = (p) => p.economics.value * (p.economics.per === "month" ? 12 : 1);
  const mins = (m) => (m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0).replace(/\.0$/, "") + " h" : Math.round(m) + " min");
  const nowClock = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  /* ---------------- motion ---------------- */
  const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
  let calm = rm.matches;
  const applyCalm = () => {
    document.documentElement.classList.toggle("calm-motion", calm);
    document.body.classList.toggle("anim", !calm);
    $("#motion-toggle").setAttribute("aria-pressed", String(calm));
  };

  /* ---------------- state ---------------- */
  const KEY = "athena-fathom-v1";
  const params = new URLSearchParams(location.search);
  if (params.has("fresh")) { try { localStorage.removeItem(KEY); } catch (e) { /* storage off */ } }
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }

  const S = {
    ready: params.has("ready") || !!saved.ready,
    engine: saved.engine || (params.has("ready") ? "claude_code" : null),
    appsOn: saved.appsOn || Object.fromEntries(A.apps.map((a) => [a.id, a.enabled])),
    connOn: saved.connOn || { gmail: true, notion: true },
    voice: saved.voice ?? true,
    listener: "whisper",
    setupStep: 0,
    codex: "not_found",
    bot: "resting",
    botLine: "",
    busy: false,
    tape: [],
    slips: [],
    leaving: {},
    answered: [],
    ledgerNew: [],
    project: null,
    hover: null,
    conns: Object.fromEntries(A.connectors.map((c) => [c.id, { status: c.status, health: c.health, identity: c.identity, lastFlow: c.lastFlow, writes: c.writes, flow: null }])),
    runTurn: {},
    installs: {},
    models: Object.fromEntries(A.voice.stt[0].models.map((m) => [m.id, m.installed])),
    greeted: false,
  };
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ ready: S.ready, engine: S.engine, appsOn: S.appsOn, connOn: S.connOn, voice: S.voice })); } catch (e) { /* storage off */ }
  };

  const app = (id) => A.apps.find((a) => a.id === id);
  const book = (id) => A.playbooks.find((p) => p.id === id);
  const conn = (id) => A.connectors.find((c) => c.id === id);
  const engineLabel = (id) => (A.engines.find((e) => e.id === id) || {}).label || "no engine";
  const reachList = () => [...A.apps.map((a) => !!S.appsOn[a.id]), ...A.connectors.map((c) => !!S.connOn[c.id])];
  const reachCount = () => reachList().filter(Boolean).length;
  const appsOnCount = () => A.apps.filter((a) => S.appsOn[a.id]).length;
  const needsYou = () => A.connectors.filter((c) => S.conns[c.id].status !== "connected").length;
  const totalYear = A.playbooks.reduce((s, p) => s + yearly(p), 0);

  /* ---------------- the layers below her ---------------- */
  const LAYERS = [
    { id: "apps", name: "Apps", title: "The apps she works in",
      count: () => `${A.tabs.length} tabs open · ${appsOnCount()} apps on`,
      sentence: () => `${A.tabs.length} open tabs and ${A.apps.length} registered apps. Ledgerbox gives her ${app("ledgerbox").tools.length} tools of its own.` },
    { id: "chores", name: "Chores", title: "Chores worth starting",
      count: () => `${A.playbooks.length} playbooks · ${usd(Math.round(totalYear / 1000))}k a year`,
      sentence: () => `${A.playbooks.length} chores that span apps nobody integrates, worth ${usd(totalYear)} a year by their authors' estimates.` },
    { id: "accounts", name: "Accounts", title: "Accounts she can reach",
      count: () => (needsYou() ? `${A.connectors.length} accounts · ${needsYou()} needs you` : `${A.connectors.length} accounts · all well`), human: () => needsYou() > 0,
      sentence: () => (needsYou() ? "Gmail needs reconnecting; its last attempt was refused. Notion is connected." : "Gmail and Notion are both connected.") },
    { id: "voice", name: "Voice", title: "Her voice",
      count: () => (S.voice ? `${A.voice.tts.voice.name} · ${S.listener === "whisper" ? "Whisper " + currentModel() : "OpenAI"}` : "Silent"),
      sentence: () => `She speaks as ${A.voice.tts.voice.name}, “${A.voice.tts.voice.blurb}” and listens on this machine while you hold Space.` },
    { id: "mind", name: "Mind", title: "What she thinks with",
      count: () => `${engineLabel(S.engine)} · ready`,
      sentence: () => `The engine she borrows a mind from, and the setup you can run again at any time.` },
    { id: "ledger", name: "Ledger", title: "What she has done",
      count: () => `${A.ledger.total + S.ledgerNew.length} turns · ${A.decisionsTotal + S.answered.length} decisions`,
      sentence: () => "One line for every time she thought, failures included, and every decision you signed or refused." },
  ];
  const currentModel = () => Object.keys(S.models).find((k) => k === "base.en" && S.models[k]) || Object.keys(S.models).find((k) => S.models[k]) || "base.en";

  /* ---------------- drawing: Athena ---------------- */
  function defs() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.innerHTML = `<defs>
      <radialGradient id="bellFill" cx=".5" cy=".28" r=".78"><stop offset="0" stop-color="#67e8f9" stop-opacity=".62"/><stop offset=".34" stop-color="#22d3ee" stop-opacity=".26"/><stop offset=".72" stop-color="#0e7490" stop-opacity=".16"/><stop offset="1" stop-color="#0e7490" stop-opacity=".05"/></radialGradient>
      <radialGradient id="halo"><stop offset="0" stop-color="#22d3ee" stop-opacity=".42"/><stop offset=".55" stop-color="#06b6d4" stop-opacity=".1"/><stop offset="1" stop-color="#06b6d4" stop-opacity="0"/></radialGradient>
      <radialGradient id="coreGlow"><stop offset="0" stop-color="#e0f2fe"/><stop offset=".45" stop-color="#67e8f9" stop-opacity=".9"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
      <radialGradient id="coreAsk"><stop offset="0" stop-color="#fdf2f8"/><stop offset=".45" stop-color="#f472b6" stop-opacity=".9"/><stop offset="1" stop-color="#f472b6" stop-opacity="0"/></radialGradient>
      <linearGradient id="tendril" gradientUnits="userSpaceOnUse" x1="0" y1="200" x2="0" y2="410"><stop offset="0" stop-color="#67e8f9" stop-opacity=".95"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient>
      <linearGradient id="arm" gradientUnits="userSpaceOnUse" x1="0" y1="190" x2="0" y2="380"><stop offset="0" stop-color="#a5f3fc" stop-opacity=".5"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient>
      <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0f2fe" stop-opacity="0"/><stop offset=".5" stop-color="#e0f2fe" stop-opacity=".55"/><stop offset="1" stop-color="#e0f2fe" stop-opacity="0"/></linearGradient>
      <clipPath id="bellClip"><path d="${BELL}"/></clipPath>
      <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
      <filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
    </defs>`;
    document.body.prepend(svg);
  }
  const BELL = (() => {
    let d = "M70 200 C70 112 126 54 200 54 C274 54 330 112 330 200";
    const n = 8, w = 260 / n;
    for (let i = 0; i < n; i++) {
      const x0 = 330 - i * w, x1 = x0 - w;
      d += ` Q${(x0 - w / 2).toFixed(1)} ${i % 2 ? 214 : 219} ${x1.toFixed(1)} 200`;
    }
    return d + " Z";
  })();

  function athenaSVG(mini) {
    const tendrils = mini ? "" : `<g class="tendrils">${Array.from({ length: 7 }, (_, i) => `<path class="t" data-i="${i}" fill="none" stroke="url(#tendril)" stroke-linecap="round"/><circle class="tip" data-i="${i}" r="3.6" fill="#a5f3fc"/>`).join("")}
      ${Array.from({ length: 3 }, (_, i) => `<path class="arm" data-a="${i}" fill="none" stroke="url(#arm)" stroke-width="${9 - i * 2}" stroke-linecap="round"/>`).join("")}</g>`;
    const miniT = mini ? `<g stroke="url(#tendril)" stroke-width="5" fill="none" stroke-linecap="round"><path d="M140 208 C136 260 150 300 140 350"/><path d="M200 210 C206 270 192 310 200 370"/><path d="M260 208 C266 260 250 300 262 350"/></g>` : "";
    return `<svg viewBox="0 0 400 420" role="img" aria-label="Athena, drawn as a light in deep water (stylised)">
      <circle class="halo" cx="200" cy="150" r="170" fill="url(#halo)"/>
      ${tendrils}${miniT}
      <g class="bell">
        <g class="bell-body">
          <path d="${BELL}" fill="url(#bellFill)"/>
          <g clip-path="url(#bellClip)">
            <g class="rings"><ellipse cx="200" cy="150" rx="104" ry="62" fill="none" stroke="#67e8f9" stroke-opacity=".38" stroke-dasharray="2 7"/><ellipse cx="200" cy="150" rx="78" ry="45" fill="none" stroke="#67e8f9" stroke-opacity=".3" stroke-dasharray="16 7"/></g>
            <g class="rings2"><ellipse cx="200" cy="150" rx="56" ry="31" fill="none" stroke="#a5f3fc" stroke-opacity=".42" stroke-dasharray="1 5"/></g>
            <path d="M84 196 C120 150 280 150 316 196" fill="none" stroke="#a5f3fc" stroke-opacity=".18" stroke-width="10"/>
            <g class="scan"><rect x="60" y="60" width="280" height="46" fill="url(#scanGrad)"/></g>
          </g>
          <path d="M104 172 C106 116 146 80 196 74" fill="none" stroke="#e0f2fe" stroke-opacity=".35" stroke-width="4" stroke-linecap="round"/>
          <path class="rim" d="${BELL}" fill="none" stroke="#22d3ee" stroke-opacity=".8" stroke-width="2.2"/>
        </g>
        <g class="core">
          <circle class="core-glow" cx="200" cy="138" r="46" fill="url(#coreGlow)"/>
          <g transform="translate(176 113) scale(1.5)" fill="none" stroke="#04222a" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 24.4 16 7.4l7.4 17"/><path d="M11.9 19.2l3.2 3 5.2-6.2" stroke-width="2.3"/></g>
        </g>
        <g class="motes" fill="#a5f3fc"><circle cx="150" cy="190" r="2.4"/><circle cx="182" cy="196" r="1.8"/><circle cx="214" cy="192" r="2.6"/><circle cx="246" cy="196" r="1.6"/><circle cx="268" cy="188" r="2"/></g>
      </g>
      <ellipse class="ripple" cx="200" cy="140" rx="150" ry="104" fill="none" stroke="#22d3ee" stroke-width="2"/>
      <ellipse class="ripple" cx="200" cy="140" rx="150" ry="104" fill="none" stroke="#22d3ee" stroke-width="2"/>
      <ellipse class="ripple" cx="200" cy="140" rx="150" ry="104" fill="none" stroke="#22d3ee" stroke-width="1.5"/>
    </svg>`;
  }

  /* tendrils: one per thing she may touch; they lean toward what you look at */
  let lean = 0, leanTarget = 0, raf = 0, lastDraw = 0;
  function drawTendrils(t) {
    const reach = reachList();
    lean += (leanTarget - lean) * 0.06;
    $$(".athena .tendrils").forEach((g) => {
      const paths = g.querySelectorAll("path.t"), tips = g.querySelectorAll("circle.tip"), arms = g.querySelectorAll("path.arm");
      paths.forEach((p, i) => {
        const x0 = 96 + i * 34.7, y0 = 206, L = 150 + ((i * 37) % 3) * 24;
        const sw = Math.sin(t * 0.0011 + i * 0.9) * 10, sw2 = Math.sin(t * 0.0008 + i * 1.7) * 16;
        const lx = lean * 46 * (0.6 + (i % 3) * 0.2);
        const ex = x0 + sw2 + lx, ey = y0 + L - Math.abs(lean) * 14;
        p.setAttribute("d", `M${x0.toFixed(1)} ${y0} C${(x0 + sw * 0.5 + lx * 0.25).toFixed(1)} ${(y0 + L * 0.35).toFixed(1)} ${(x0 - sw + lx * 0.7).toFixed(1)} ${(y0 + L * 0.72).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
        const lit = reach[i];
        p.setAttribute("stroke-width", lit ? "2.6" : "1.2");
        p.setAttribute("stroke-opacity", lit ? "1" : ".28");
        tips[i].setAttribute("cx", ex.toFixed(1)); tips[i].setAttribute("cy", ey.toFixed(1));
        tips[i].setAttribute("opacity", lit ? (0.75 + Math.sin(t * 0.003 + i) * 0.25).toFixed(2) : "0");
      });
      arms.forEach((p, i) => {
        const x0 = 178 + i * 22, y0 = 196, L = 150 - i * 18;
        const w = Math.sin(t * 0.0009 + i * 2.1) * 18;
        p.setAttribute("d", `M${x0} ${y0} C${x0 + w} ${y0 + L * 0.3} ${x0 - w} ${y0 + L * 0.6} ${x0 + w * 0.6 + lean * 30} ${y0 + L}`);
      });
    });
  }
  function loop(t) {
    raf = 0;
    if (document.hidden) return;
    if (t - lastDraw > 30) { drawTendrils(t); lastDraw = t; }
    if (!calm && $(".athena .tendrils")) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (calm) { drawTendrils(4000); return; } if (!raf) raf = requestAnimationFrame(loop); };
  document.addEventListener("visibilitychange", kick);

  /* ---------------- drawing: glyphs (stylised art per item) ---------------- */
  const G = {
    apps: `<g class="float"><rect x="18" y="20" width="56" height="40" rx="6" fill="rgba(34,211,238,.06)" stroke="#5b8390" stroke-width="1.5"/><rect x="34" y="30" width="56" height="40" rx="6" fill="rgba(34,211,238,.08)" stroke="#94c5d4" stroke-width="1.5"/><rect x="50" y="40" width="56" height="40" rx="6" fill="rgba(13,32,37,.9)" stroke="#22d3ee" stroke-width="2"/><path d="M50 49h56" stroke="#22d3ee" stroke-opacity=".6"/><circle cx="56" cy="44.5" r="1.6" fill="#22d3ee"/><circle cx="61" cy="44.5" r="1.6" fill="#22d3ee" fill-opacity=".6"/><path d="M58 58h28M58 64h38M58 70h20" stroke="#a5f3fc" stroke-width="2" stroke-linecap="round" stroke-opacity=".8"/></g>`,
    chores: `<g class="float"><path d="M20 70 L44 48 L66 56 L92 26" fill="none" stroke="#22d3ee" stroke-opacity=".45" stroke-dasharray="2 4"/><circle cx="20" cy="70" r="5" fill="#0e7490" stroke="#22d3ee"/><circle cx="44" cy="48" r="8" fill="rgba(167,139,250,.25)" stroke="#a78bfa" stroke-width="1.5"/><circle cx="66" cy="56" r="6" fill="rgba(135,208,251,.2)" stroke="#87d0fb" stroke-width="1.5"/><circle cx="92" cy="26" r="15" fill="rgba(34,211,238,.18)" stroke="#67e8f9" stroke-width="2"/><circle cx="92" cy="26" r="6" fill="#a5f3fc"/><circle cx="104" cy="62" r="4" fill="rgba(52,211,153,.3)" stroke="#34d399"/></g>`,
    accounts: `<g class="float"><circle cx="46" cy="46" r="20" fill="none" stroke="#94c5d4" stroke-width="3"/><circle cx="72" cy="46" r="20" fill="none" stroke="#22d3ee" stroke-width="3"/><path d="M80 64 l10 16 M86 74 l6-4 M90 80 l6-4" stroke="#22d3ee" stroke-width="3" stroke-linecap="round"/><circle cx="38" cy="30" r="4.5" fill="#fbbf24"><animate attributeName="opacity" values="1;.35;1" dur="2.4s" repeatCount="indefinite"/></circle></g>`,
    voice: `<g class="float" fill="none" stroke-linecap="round"><path d="M44 34 C44 26 54 22 60 22 C66 22 76 26 76 34 L76 44 C76 48 74 50 70 50 L50 50 C46 50 44 48 44 44 Z" fill="rgba(34,211,238,.18)" stroke="#67e8f9" stroke-width="2"/><path d="M52 50 C50 60 54 66 52 76 M60 50 C62 62 58 68 60 80 M68 50 C66 60 70 66 68 76" stroke="#22d3ee" stroke-opacity=".7" stroke-width="1.6"/><path d="M86 26 C92 32 92 42 86 48 M94 20 C104 30 104 44 94 54" stroke="#22d3ee" stroke-width="2"/><path d="M34 26 C28 32 28 42 34 48 M26 20 C16 30 16 44 26 54" stroke="#22d3ee" stroke-width="2" stroke-opacity=".5"/></g>`,
    mind: `<g class="float"><path d="M60 12 L86 30 L80 66 L60 82 L40 66 L34 30 Z" fill="rgba(34,211,238,.1)" stroke="#67e8f9" stroke-width="2"/><path d="M60 12 L60 82 M34 30 L86 30 M40 66 L80 66 M34 30 L60 50 L86 30 M40 66 L60 50 L80 66" stroke="#22d3ee" stroke-opacity=".45" fill="none"/><circle cx="60" cy="50" r="6" fill="#e0f2fe"/><circle cx="60" cy="50" r="14" fill="url(#coreGlow)" opacity=".7"/></g>`,
    ledger: `<g class="float" fill="none" stroke-linecap="round"><path d="M14 30 C34 24 50 34 70 28 S100 26 108 30" stroke="#5b8390" stroke-width="2"/><path d="M14 44 C34 38 50 48 70 42 S100 40 108 44" stroke="#94c5d4" stroke-width="2"/><path d="M14 58 C34 52 50 62 70 56 S100 54 108 58" stroke="#22d3ee" stroke-width="2.4"/><path d="M14 72 C34 66 50 76 70 70 S100 68 108 72" stroke="#67e8f9" stroke-width="2.6"/><circle cx="38" cy="44" r="3" fill="#34d399" stroke="none"/><circle cx="74" cy="56" r="3" fill="#34d399" stroke="none"/><circle cx="56" cy="30" r="3" fill="#94c5d4" stroke="none"/></g>`,
  };
  const ICON = {
    ledgerbox: `<rect x="10" y="8" width="28" height="34" rx="3" fill="rgba(34,211,238,.12)" stroke="currentColor" stroke-width="2"/><path d="M16 17h16M16 23h16M16 29h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M30 33l3 3 5-6" stroke="#34d399" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    inbox: `<rect x="7" y="12" width="34" height="24" rx="3" fill="rgba(135,208,251,.12)" stroke="currentColor" stroke-width="2"/><path d="M8 14l16 12 16-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    docs: `<path d="M12 6h18l8 8v28H12z" fill="rgba(148,197,212,.1)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M18 36V26a6 6 0 0 1 12 0v10" fill="none" stroke="currentColor" stroke-width="2"/>`,
    crm: `<circle cx="18" cy="18" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="20" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 38c1-7 6-10 10-10s9 3 10 10M26 38c1-5 4-8 7-8s6 3 7 8" fill="none" stroke="currentColor" stroke-width="2"/>`,
    calendar: `<rect x="8" y="10" width="32" height="30" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 18h32M16 6v8M32 6v8" stroke="currentColor" stroke-width="2"/><g fill="currentColor"><rect x="14" y="23" width="5" height="5"/><rect x="22" y="23" width="5" height="5"/><rect x="30" y="23" width="5" height="5" opacity=".4"/><rect x="14" y="31" width="5" height="5" opacity=".4"/></g>`,
    "E-commerce": `<path d="M8 16l16-8 16 8v18l-16 8-16-8z" fill="rgba(34,211,238,.12)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 16l16 8 16-8M24 24v18M16 12l16 8" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    Payments: `<rect x="6" y="12" width="36" height="24" rx="4" fill="rgba(167,139,250,.14)" stroke="currentColor" stroke-width="2"/><path d="M6 19h36" stroke="currentColor" stroke-width="3"/><path d="M12 30h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    "Daily life": `<path d="M6 28l14-3 10-15 4 1-4 13 10-2 3-5 3 1-2 8 2 8-3 1-3-5-10-2 4 13-4 1-10-15-14-3z" fill="rgba(135,208,251,.14)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" transform="rotate(-20 24 24) scale(.9) translate(2 2)"/>`,
    SaaS: `<rect x="8" y="10" width="32" height="22" rx="3" fill="rgba(52,211,153,.12)" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="21" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M26 18h9M26 24h6M16 40h16M24 32v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    Logistics: `<rect x="5" y="16" width="38" height="20" rx="2" fill="rgba(251,191,36,.12)" stroke="currentColor" stroke-width="2"/><path d="M12 16v20M19 16v20M26 16v20M33 16v20" stroke="currentColor" stroke-width="1.4"/><path d="M14 10h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    Property: `<path d="M8 22L24 9l16 13v18H8z" fill="rgba(148,197,212,.12)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><rect x="20" y="28" width="8" height="12" fill="none" stroke="currentColor" stroke-width="2"/>`,
    Clinics: `<circle cx="24" cy="24" r="17" fill="rgba(103,232,249,.1)" stroke="currentColor" stroke-width="2"/><path d="M24 15v18M15 24h18" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`,
  };
  const APP_COLOR = { ledgerbox: "#22d3ee", inbox: "#87d0fb", docs: "#94c5d4", crm: "#a78bfa", calendar: "#34d399" };
  const DOMAIN_COLOR = { "E-commerce": "#22d3ee", Payments: "#a78bfa", "Daily life": "#87d0fb", SaaS: "#34d399", Logistics: "#fbbf24", Property: "#94c5d4", Clinics: "#67e8f9" };
  const icon = (key, color) => `<svg viewBox="0 0 48 48" style="color:${color}" aria-hidden="true">${ICON[key] || ICON.docs}</svg>`;

  const connArt = (id, status) => id === "gmail"
    ? `<svg viewBox="0 0 300 140" aria-hidden="true"><defs><radialGradient id="gm" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="${status === "connected" ? "#22d3ee" : "#fbbf24"}" stop-opacity=".3"/><stop offset="1" stop-color="#0a1214" stop-opacity="0"/></radialGradient></defs><circle cx="150" cy="70" r="80" fill="url(#gm)"/><path d="M150 0 V22" stroke="#5b8390" stroke-dasharray="3 4"/><g transform="translate(150 78)"><rect x="-56" y="-36" width="112" height="72" rx="8" fill="rgba(13,32,37,.9)" stroke="${status === "connected" ? "#22d3ee" : "#fbbf24"}" stroke-width="2.5"/><path d="M-54 -32 L0 8 L54 -32" fill="none" stroke="${status === "connected" ? "#67e8f9" : "#fbbf24"}" stroke-width="2.5" stroke-linejoin="round"/><path d="M-54 34 L-14 -2 M54 34 L14 -2" stroke="#5b8390" stroke-width="1.5"/>${status === "connected" ? `<circle cx="52" cy="-34" r="12" fill="#0d2025" stroke="#34d399" stroke-width="2"/><path d="M46 -34l4 4 8-8" stroke="#34d399" stroke-width="2.5" fill="none" stroke-linecap="round"/>` : `<circle cx="52" cy="-34" r="12" fill="#0d2025" stroke="#fbbf24" stroke-width="2"/><path d="M52 -40v7M52 -28v.5" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"><animate attributeName="opacity" values="1;.3;1" dur="1.8s" repeatCount="indefinite"/></path>`}</g></svg>`
    : `<svg viewBox="0 0 300 140" aria-hidden="true"><defs><radialGradient id="nt" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#22d3ee" stop-opacity="${status === "connected" ? ".3" : ".1"}"/><stop offset="1" stop-color="#0a1214" stop-opacity="0"/></radialGradient></defs><circle cx="150" cy="70" r="80" fill="url(#nt)"/><path d="M150 0 V18" stroke="#5b8390" stroke-dasharray="3 4"/><g transform="translate(150 76)"><rect x="-30" y="-50" width="76" height="92" rx="6" fill="rgba(13,32,37,.6)" stroke="#5b8390" stroke-width="1.5" transform="rotate(8)"/><rect x="-44" y="-52" width="76" height="96" rx="6" fill="rgba(13,32,37,.95)" stroke="#22d3ee" stroke-width="2.5"/><path d="M-32 -34h40M-32 -22h52M-32 -10h46M-32 2h30" stroke="#a5f3fc" stroke-opacity=".75" stroke-width="3" stroke-linecap="round"/><rect x="-32" y="14" width="28" height="18" rx="3" fill="rgba(34,211,238,.18)" stroke="#22d3ee"/>${status === "connected" ? `<circle cx="30" cy="-50" r="12" fill="#0d2025" stroke="#34d399" stroke-width="2"/><path d="M24 -50l4 4 8-8" stroke="#34d399" stroke-width="2.5" fill="none" stroke-linecap="round"/>` : ""}</g></svg>`;

  /* ---------------- routing ---------------- */
  let path = [];
  const parse = () => (location.hash.replace(/^#\/?/, "").split("/").filter(Boolean)).map(decodeURIComponent);
  function valid(p) {
    const [a, b, c] = p;
    if (!a) return [];
    if (!LAYERS.some((l) => l.id === a)) return [];
    if (a === "apps" && b) { const x = app(b); if (!x) return ["apps"]; if (c && x.tools.some((t) => t.short === c)) return [a, b, c]; return [a, b]; }
    if (a === "chores" && b) { const x = book(b); if (!x) return ["chores"]; if (c === "run" && x.bench) return [a, b, "run"]; return [a, b]; }
    if (a === "accounts" && b) return conn(b) ? [a, b] : ["accounts"];
    if (a === "mind" && b === "setup") return ["mind", "setup"];
    return [a];
  }
  function nameOf(p) {
    const [a, b, c] = p;
    if (!a) return "Surface";
    const L = LAYERS.find((l) => l.id === a);
    if (p.length === 1) return L.name;
    if (a === "apps") return p.length === 2 ? app(b).name : c;
    if (a === "chores") return p.length === 2 ? book(b).title : "The bench run";
    if (a === "accounts") return conn(b).label;
    if (a === "mind") return "Setup";
    return L.name;
  }

  /* ---------------- scenes ---------------- */
  const ink = (i) => `class="ink" style="--i:${i}"`;
  function sceneFor(p) {
    if (!S.ready && p.length === 0) return setupScene(false);
    const [a, b, c] = p;
    if (!a) return surfaceScene();
    if (a === "apps") return !b ? appsScene() : !c ? appScene(app(b)) : toolScene(app(b), app(b).tools.find((t) => t.short === c));
    if (a === "chores") return !b ? choresScene() : !c ? bookScene(book(b)) : runScene(book(b));
    if (a === "accounts") return !b ? accountsScene() : connScene(conn(b));
    if (a === "voice") return voiceScene();
    if (a === "mind") return b === "setup" ? setupScene(true) : mindScene();
    if (a === "ledger") return ledgerScene();
    return surfaceScene();
  }

  /* L0 — the surface */
  function surfaceScene() {
    return { cls: "surface", html: `
      <section class="tape" aria-label="What she is doing"><div class="tape-head"><span class="label">What she is doing</span><span class="label" id="tape-meta"></span></div><ol id="tape"></ol></section>
      <section class="center">
        <div class="athena" data-state="${S.bot}">${athenaSVG(false)}</div>
        <div class="headline" id="headline"></div>
        <form class="composer" id="composer" autocomplete="off">
          <label class="sr" for="say">Tell Athena what to do</label>
          <input id="say" name="say" placeholder="Tell her a chore…" title="Press / to type" />
          <button type="button" class="ptt" id="ptt" aria-pressed="false" aria-label="Hold to talk (or hold Space)"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>
          <button type="submit" class="send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg></button>
        </form>
        <div class="suggest" id="suggest"></div>
      </section>
      <section class="slips" aria-label="Waiting on you"><div class="slips-head"><span class="label" id="slips-label">Waiting on you</span><span class="label" id="slips-count"></span></div><div id="slips"></div></section>
      <nav class="descents" aria-label="Dive into a layer">
        ${LAYERS.map((L, i) => `<button class="descent" data-go="${L.id}" data-key="${L.id}" data-layer="${L.id}" style="--i:${i}" aria-label="${esc(L.title)} — ${esc(L.count())}">
          <span class="art"><svg class="glyph" viewBox="0 0 120 90" aria-hidden="true">${G[L.id]}</svg></span>
          <span class="name">${L.name}</span><span class="count${L.human && L.human() ? " human" : ""}" data-count="${L.id}">${esc(L.count())}</span></button>`).join("")}
        <span class="keys-hint"><kbd>←</kbd> <kbd>→</kbd> to look · <kbd>Enter</kbd> to dive · <kbd>Esc</kbd> to rise</span>
      </nav>`,
      after: (el) => { renderTape(); renderSlips(); renderHeadline(); renderSuggest(); bindComposer(el); } };
  }

  let ART = "";
  const keyArt = (inner, vb, color) => `<div class="scene-art ink" style="--i:3;color:${color || "#22d3ee"}" aria-hidden="true"><svg viewBox="-70 -70 140 140" class="art-rings"><circle r="66" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-dasharray="2 6"/><circle r="52" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-dasharray="18 8"/><circle r="40" fill="url(#halo)"/></svg><svg viewBox="${vb}" class="art-glyph">${inner}</svg><span class="stylised" style="left:0;bottom:0">key art · stylised</span></div>`;
  const layerArt = (id) => keyArt(G[id], "0 0 120 90");
  const itemArt = (key, color) => keyArt(ICON[key] || ICON.docs, "0 0 48 48", color);
  function layerShell(eyebrow, title, lede, body, extraHead = "", mq = null) {
    const art = ART; ART = "";
    return `<div class="layer-head">
        <span class="eyebrow" ${ink(0)}>${eyebrow}</span>
        <h1 class="display ink" style="--i:1" tabindex="-1">${title}</h1>
        ${lede ? `<p class="lede ink" style="--i:2">${lede}</p>` : ""}
        ${extraHead}
        ${art}
        <div class="marquee" aria-hidden="true" data-default-eye="${esc(mq ? mq.eye : "")}" data-default-title="${esc(mq ? mq.title : "")}" data-default-sub="${esc(mq ? mq.sub : "")}">
          <span class="eyebrow mq-eye">${mq ? mq.eye : ""}</span><div class="display mq-title">${mq ? mq.title : ""}</div><div class="sub mq-sub">${mq ? mq.sub : ""}</div></div>
      </div>
      <div class="layer-body">${body}</div>`;
  }
  const mqAttr = (eye, title, sub) => `data-mq-eye="${esc(eye)}" data-mq-title="${esc(title)}" data-mq-sub="${esc(sub)}"`;

  function appStatus(a) {
    if (!S.appsOn[a.id]) return `<span class="chip">Off</span>`;
    if (a.tools.length && a.transport) return `<span class="chip ok"><span class="dot"></span>Ready · ${a.tools.length} tools</span>`;
    if (a.problem) return `<span class="chip warn"><span class="dot"></span>No bridge · reads the page</span>`;
    return `<span class="chip ext"><span class="dot"></span>Reads the page</span>`;
  }

  /* L1 — apps */
  function appsScene() {
    ART = layerArt("apps");
    const panes = A.tabs.map((t, i) => {
      const a = t.app ? app(t.app) : null;
      const sub = a ? (a.tools.length && a.transport ? `${a.name} · ${a.tools.length} tools answered` : a.problem ? `${a.name} · nothing answered; she reads the page` : `${a.name} · she reads the page`) : "Blank tab · nothing to work on";
      return `<button class="pane${t.focused ? " focused" : ""} ink" style="--i:${i + 2}" ${a ? `data-go="apps/${a.id}" data-key="${a.id}"` : `data-act="blank"`} ${mqAttr(t.focused ? "Open tab · in front of you" : "Open tab", t.title, t.url)}>
        <div class="bar"><i></i><i></i><i></i><span>${esc(t.url)}</span></div>
        <div class="body"><div class="sketch" aria-hidden="true"><b></b><b></b><b style="width:80%"></b><b style="width:50%"></b></div><div><div class="t">${esc(t.title)}</div><div class="s">${esc(sub)}</div></div></div></button>`;
    }).join("");
    const rows = A.apps.map((a, i) => `<div class="row split${S.appsOn[a.id] ? "" : " off"} ink" style="--i:${i + 6}">
        <button class="open" data-go="apps/${a.id}" data-key="${a.id}" ${mqAttr(a.kind, a.name, a.blurb)}><span class="ico">${icon(a.id, APP_COLOR[a.id])}</span><span><span class="t">${a.name}</span><span class="s mono">${esc(a.origin)}</span></span></button>
        <span class="meta">${appStatus(a)}<button class="switch" role="switch" aria-checked="${!!S.appsOn[a.id]}" aria-label="She may work in ${a.name}" data-act="toggle-app" data-id="${a.id}"></button></span></div>`).join("");
    return { cls: "layer", html: layerShell("Depth 1 · Apps", "The apps she works in",
      "She works inside the tabs you already have open. An app that registers its own tools lets her act on it directly; any other page she can still read, the way you see it.",
      `<div class="section-t"><span class="label">Open now · ${A.tabs.length} tabs</span><span class="quiet" style="font-size:.85rem">window sketches, stylised</span></div><div class="panes">${panes}</div>
       <div class="section-t"><span class="label">Registered apps · ${appsOnCount()} of ${A.apps.length} on</span></div><div class="rows">${rows}</div>`,
      "", { eye: "In front of you", title: A.tabs[0].title, sub: "Ledgerbox · 4 tools · one of them waits for your signature" }) };
  }

  /* L2 — one app */
  function appScene(a) {
    ART = itemArt(a.id, APP_COLOR[a.id]);
    const tools = a.tools.length ? `<div class="tools">${a.tools.map((t, i) => `<button class="tool ink" style="--i:${i + 3}" data-go="apps/${a.id}/${t.short}" data-key="${t.short}" ${mqAttr(t.cls + " · tier " + t.tier, t.short, t.desc)}>
        <span style="display:flex;justify-content:space-between;align-items:center;gap:.6rem"><span class="n">${t.short}</span><span class="cls ${t.cls}">${t.cls}</span></span><span class="d">${esc(t.desc)}</span></button>`).join("")}</div>`
      : `<div class="calm ink" style="--i:3"><b>No tools registered here.</b> ${a.problem ? "The page was asked and nothing answered — the ordinary case for a real site." : ""} She reads what you see, and nothing she does on this page can send, pay or delete.</div>`;
    const overrides = Object.entries(a.overrides);
    const tabs = A.tabs.filter((t) => t.app === a.id);
    return { cls: "layer", html: layerShell(`Depth 2 · ${esc(a.kind)}`, esc(a.name), esc(a.blurb), `
      <div class="section-t"><span class="label">Her tools here · ${a.tools.length}</span></div>${tools}
      <div class="section-t"><span class="label">Rules you set</span></div>
      ${overrides.length ? `<div class="rows">${overrides.map(([k, v]) => `<div class="row split"><span class="open" style="cursor:default"><span class="ico">${icon("ledgerbox", "#f472b6")}</span><span><span class="t mono">${k}</span><span class="s">Always ${v}: every ${k} becomes a slip you sign.</span></span></span><span class="meta"><span class="cls ${v}">${v}</span></span></div>`).join("")}</div>` : `<p class="quiet">No overrides. Each tool keeps the class the app declared, and anything that changes the world is gated regardless.</p>`}
      <div class="section-t"><span class="label">Open on this app · ${tabs.length}</span></div>
      ${tabs.length ? tabs.map((t) => `<p class="mono" style="margin:.3rem 0">${esc(t.title)} <span class="quiet">— ${esc(t.url)}</span></p>`).join("") : `<p class="quiet">No tab is open on ${esc(a.name)} right now.</p>`}`,
      `<p class="mono quiet ink" style="--i:3;margin:.6rem 0 0">${esc(a.origin)}</p>
       <div class="actions ink" style="--i:4">${appStatus(a)}<span class="chip">Last seen ${esc(a.lastSeen)}</span>${a.transport ? `<span class="chip ext">${esc(a.transport)}</span>` : ""}
       <label style="display:flex;align-items:center;gap:.6rem">She may work here <button class="switch" role="switch" aria-checked="${!!S.appsOn[a.id]}" data-act="toggle-app" data-id="${a.id}" aria-label="She may work in ${esc(a.name)}"></button></label></div>`,
      { eye: "Tools", title: a.tools.length ? `${a.tools.length} ways in` : "Read only", sub: a.tools.length ? "Hover a tool to read what it does; open it for what happens when she calls it." : "She sees the page as you see it." }) };
  }

  /* L3 — one tool */
  function toolScene(a, t) {
    ART = itemArt(a.id, t.cls === "GATED" ? "#f472b6" : t.cls === "READ" ? "#87d0fb" : "#22d3ee");
    const what = { AUTO: "Runs without asking. It only reads; nothing leaves this machine.", READ: "Runs without asking, and every call is written to the ledger.", GATED: "Each call becomes a pink slip on her surface. Nothing runs until you approve it — not even after you approved one just like it." }[t.cls];
    const card = A.cards[0];
    const example = t.cls === "GATED" && a.id === "ledgerbox" ? `<div class="section-t"><span class="label">What you would see · an example slip</span></div>
      <div class="slip" style="animation:none;max-width:30rem"><div class="gate-line"><span class="cls GATED">GATED</span>${esc(card.action)}</div><div class="why">${esc(card.why)}</div><dl><dt>Invoice</dt><dd>${card.invoice}</dd><dt>To</dt><dd>${card.to}</dd></dl><div class="acts"><span class="btn human" aria-hidden="true">Approve <kbd>A</kbd></span><span class="btn" aria-hidden="true">Decline <kbd>D</kbd></span></div><div class="note">Example only — the live ones arrive on the surface.</div></div>` : "";
    return { cls: "layer", html: layerShell(`Depth 3 · ${esc(a.name)} tool`, `<span class="mono" style="font-weight:400;font-size:.8em">${t.short}</span>`, esc(t.desc), `
      <div class="facts"><div class="fact ink" style="--i:3"><div class="v"><span class="cls ${t.cls}" style="font-size:1.4rem">${t.cls}</span></div><div class="k">${esc(A.toolClasses[t.cls])}</div></div>
        <div class="fact ink" style="--i:4"><div class="v">Tier ${t.tier}</div><div class="k">${t.tier === 1 ? "Registered by the app itself" : t.tier === 2 ? "Reading the page, as any page allows" : "Her own"}</div></div>
        <div class="fact ink" style="--i:5"><div class="v">${a.overrides[t.short] ? "Yours" : "App's"}</div><div class="k">${a.overrides[t.short] ? `You set ${t.short} to ${a.overrides[t.short]}` : "The class the app declared"}</div></div></div>
      <div class="section-t"><span class="label">When she calls it</span></div><p style="font-size:1.25rem;max-width:44rem;margin:0">${what}</p>
      <p class="mono quiet" style="margin-top:1rem">${esc(t.name)}</p>${example}`, "",
      { eye: "The gate is the policy", title: t.cls === "GATED" ? "You sign." : "She may.", sub: "A model never decides whether something is gated, and an app cannot argue a tool out of it." }) };
  }

  /* L1 — chores */
  function choresScene() {
    ART = layerArt("chores");
    const FW = 52, FH = 34;
    const P = A.playbooks.map((p) => {
      const v = yearly(p), r = (3 + Math.sqrt(v / 26000) * 4.4) / 2;
      return { p, v, r, x: 6 + ((p.edge.difficulty - 1.5) / 3.5) * (FW - 14), y: 4.5 + ((5 - p.edge.usefulness) / 4) * (FH - 10) };
    });
    for (let it = 0; it < 120; it++) {
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const a = P[i], b = P[j]; let dx = b.x - a.x, dy = b.y - a.y; const need = a.r + b.r + 2.6;
        let d = Math.hypot(dx, dy); if (d < 0.01) { dx = 1; dy = 0.3; d = 1.04; }
        if (d < need) { const push = (need - d) / 2; a.x -= (dx / d) * push; a.y -= (dy / d) * push; b.x += (dx / d) * push; b.y += (dy / d) * push; }
      }
      P.forEach((o) => { o.x = Math.max(o.r + 1, Math.min(FW - o.r - 1, o.x)); o.y = Math.max(o.r + 1.5, Math.min(FH - o.r - 3, o.y)); });
    }
    const orbs = P.map(({ p, v, r, x, y }, i) => {
      const size = r * 2;
      const col = DOMAIN_COLOR[p.domain] || "#22d3ee";
      return `<button class="orb ink" style="--i:${i + 3};left:${(x / FW) * 100}%;top:${(y / FH) * 100}%;width:${size}rem;height:${size}rem" data-go="chores/${p.id}" data-key="${p.id}" aria-label="${esc(p.title)}, ${usd(v)} a year" ${mqAttr(p.domain + " · " + (p.bench ? p.bench.label : "not benched"), p.title, usd(v) + " a year · " + p.promise)}>
        <svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="o-${p.id}" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="${col}" stop-opacity=".55"/><stop offset=".7" stop-color="${col}" stop-opacity=".12"/><stop offset="1" stop-color="${col}" stop-opacity=".02"/></radialGradient></defs>
        <circle cx="50" cy="50" r="48" fill="url(#o-${p.id})" stroke="${col}" stroke-opacity=".75" stroke-width="2"/>${p.bench ? `<circle cx="50" cy="50" r="43" fill="none" stroke="${p.bench.verdict === "exceeds" ? "#34d399" : "#fbbf24"}" stroke-width="3" stroke-dasharray="${p.bench.verdict === "exceeds" ? "none" : "6 5"}"/>` : ""}
        <g transform="translate(26 26)" style="color:${col}">${ICON[p.domain] || ""}</g></svg><span class="lbl">${esc(p.title)}</span></button>`;
    }).join("");
    const list = [...A.playbooks].sort((a, b) => yearly(b) - yearly(a)).map((p, i) => `<button class="row ink" style="--i:${i + 10}" data-go="chores/${p.id}" data-key="${p.id}" ${mqAttr(p.domain, p.title, usd(yearly(p)) + " a year · " + p.promise)}>
      <span class="ico">${icon(p.domain, DOMAIN_COLOR[p.domain])}</span><span><span class="t">${esc(p.title)}</span><span class="s">${esc(p.promise)}</span></span>
      <span class="meta"><b style="font-size:1.2rem;font-weight:500">${usd(yearly(p))}</b><span class="quiet" style="font-size:.85rem">/ yr</span>${p.bench ? `<span class="chip ${p.bench.verdict === "exceeds" ? "ok" : "warn"}">${p.bench.label}</span>` : `<span class="chip">Not benched</span>`}</span></button>`).join("");
    return { cls: "layer", html: layerShell("Depth 1 · Chores", "Chores worth starting",
      `Each spans apps nobody integrates and ends in something you sign. Together worth <b>${usd(totalYear)}</b> a year, by their authors' estimates.`,
      `<div class="field" role="group" aria-label="Chores placed by how hard they are for anyone else and how useful they are to you">
         <span class="zone"><span>ONLY ATHENA</span></span>
         <span class="axis" style="left:1rem;bottom:.6rem">harder for anyone else →</span><span class="axis" style="left:1rem;top:.8rem">more useful to you ↑</span>
         ${orbs}<span class="stylised" style="right:1rem;bottom:.6rem">size: value a year · ring: bench verdict</span></div>
       <div class="section-t" style="margin-top:2rem"><span class="label">Worth most first</span></div><div class="rows">${list}</div>`, "",
      { eye: "Hover a chore", title: "Biggest: " + [...A.playbooks].sort((a, b) => yearly(b) - yearly(a))[0].title, sub: "Each orb is drawn at the size of what it is worth in a year." }) };
  }

  /* L2 — one chore */
  function bookScene(p) {
    ART = itemArt(p.domain, DOMAIN_COLOR[p.domain]);
    const b = p.bench;
    const facts = `<div class="facts">
      <div class="fact ink" style="--i:3"><div class="v">${usd(yearly(p))}</div><div class="k">a year${p.economics.per === "month" ? ` (${usd(p.economics.value)} a month)` : ""}, the author's estimate</div></div>
      <div class="fact ink" style="--i:4"><div class="v">${mins(p.economics.manualMin)}</div><div class="k">by hand, each time</div></div>
      <div class="fact ink" style="--i:5"><div class="v">${b ? mins(b.minutes) : "—"}</div><div class="k">${b ? `with her on the bench · ${b.yourTime} of yours` : "not benched yet: nothing measured"}</div></div></div>`;
    return { cls: "layer", html: layerShell(`Depth 2 · ${esc(p.domain)} chore`, esc(p.title), esc(p.promise), `
      ${facts}
      ${p.command ? `<div class="section-t"><span class="label">What you would say</span></div><p style="font-size:1.2rem;margin:0;max-width:46rem">“${esc(p.command)}”</p>` : ""}
      <div class="two"><div>${p.steps.length ? `<div class="section-t"><span class="label">What she does</span></div><ol class="list num">${p.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : `<div class="section-t"><span class="label">What she does</span></div><p class="quiet">This playbook is a sketch: its steps are not written yet.</p>`}</div>
        <div>${p.apps.length ? `<div class="section-t"><span class="label">Apps it spans</span></div><ul class="list">${p.apps.map((x) => `<li><b>${esc(x.name)}</b> — ${esc(x.role)}${x.api ? `<br><span class="quiet" style="font-size:.9rem">${esc(x.api)}</span>` : ""}</li>`).join("")}</ul>` : ""}
          ${p.traps.length ? `<div class="section-t"><span class="label">Traps she walks past</span></div><ul class="list trap">${p.traps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</div></div>
      ${p.gate ? `<div class="gatebox"><b>Gated: ${esc(p.gate.label)}.</b> ${esc(p.gate.why)} Every one is a slip you sign.</div>` : ""}
      ${p.economics.incumbent ? `<p class="quiet" style="margin-top:1rem">Today: ${esc(p.economics.incumbent)}</p>` : ""}
      ${b ? `<p class="honest">Measured once on an invented portal world, not on your accounts.</p>` : ""}`,
      `<div class="actions ink" style="--i:4"><button class="btn primary" data-act="hand" data-id="${p.id}">Hand it to Athena</button>
        ${b ? `<button class="btn" data-go="chores/${p.id}/run" data-key="run">Watch the bench run</button><span class="chip ${b.verdict === "exceeds" ? "ok" : "warn"}">${b.label}${b.reason ? " · " + esc(b.reason) : ""}</span>` : `<span class="chip">Not benched</span>`}</div>
        ${p.persona ? `<p class="quiet ink" style="--i:5;margin-top:1rem">Written for: ${esc(p.persona)}</p>` : ""}`,
      { eye: "Hand it over", title: "She starts; you sign.", sub: "Handing it puts the command in her composer. Nothing runs until you press send, and every claim waits for you." }) };
  }

  /* L3 — the bench run */
  function runScene(p) {
    ART = itemArt(p.domain, DOMAIN_COLOR[p.domain]);
    const b = p.bench, n = S.runTurn[p.id] || 0;
    const tr = b.trace;
    let body;
    if (tr.length) {
      const t = tr[n];
      body = `<div class="turns" role="tablist" aria-label="Turns">${tr.map((_, i) => `<button role="tab" aria-label="Turn ${i + 1}" aria-current="${i === n}" class="${i < n ? "past" : ""}" data-act="turn" data-id="${p.id}" data-n="${i}"></button>`).join("")}</div>
        <div class="turn-card" id="turn-card"><span class="portal">Turn ${n + 1} of ${tr.length} · ${esc(t.portal)}</span>
          ${t.user ? `<p class="you">You: “${esc(t.user)}”</p>` : ""}
          <p class="said">${esc(t.said)}</p>
          <div class="claims">${t.reads.map((r) => `<span class="chip ext mono">${esc(r)}</span>`).join("")}</div>
          ${t.cards.length ? `<div class="section-t" style="margin-top:1rem"><span class="label">Claims she drafted · each one a slip</span></div><div class="claims">${t.cards.map(([k, v]) => `<span class="claim">${k}<b>${usd(v, 2)}</b></span>`).join("")}</div>` : ""}</div>
        <div class="actions"><button class="btn" data-act="run-prev" data-id="${p.id}" ${n === 0 ? "disabled" : ""}>Previous turn</button><button class="btn primary" data-act="run-next" data-id="${p.id}" ${n === tr.length - 1 ? "disabled" : ""}>Next turn</button><span class="quiet">or <kbd>←</kbd> <kbd>→</kbd></span></div>
        ${n === tr.length - 1 ? `<p style="font-size:1.15rem;margin-top:1.4rem;max-width:46rem">${esc(b.closing)}</p>` : ""}`;
    } else {
      body = `<div class="calm">No turn-by-turn trace was kept for this run. Its result is below.</div><p style="font-size:1.2rem;margin-top:1.2rem;max-width:46rem">${esc(b.closing)}</p>`;
    }
    return { cls: "layer", html: layerShell(`Depth 3 · ${esc(p.title)}`, "The bench run",
      `${b.label}. ${b.verdict === "exceeds" ? `All ${b.found} of ${b.eligible} found, nothing false, in ${mins(b.minutes)}.` : `Found ${b.found} of ${b.eligible}; ${b.reason}.`}`,
      `<div class="facts"><div class="fact"><div class="v">${usd(b.valueFound, 2)}</div><div class="k">found, of ${usd(b.valueTotal, 2)} planted</div></div>
        <div class="fact"><div class="v">${b.trapsTotal - b.trapsFiled} of ${b.trapsTotal}</div><div class="k">traps walked past · ${b.falseClaims} false claim${b.falseClaims === 1 ? "" : "s"}</div></div>
        <div class="fact"><div class="v">${usd(b.cost, 2)}</div><div class="k">of engine time · ${b.turns} turns</div></div></div>${body}
        <p class="honest">Replayed from the bench record: invented portals, invented parcels. Not your accounts.</p>`, "",
      { eye: "Replay", title: tr.length ? `Turn ${n + 1}` : "Result", sub: "Step through what she read, what she said and what she drafted." }) };
  }

  /* L1 — accounts */
  function accountsScene() {
    ART = layerArt("accounts");
    const cards = A.connectors.map((c, i) => {
      const st = S.conns[c.id];
      const chips = st.status === "connected" ? `<span class="chip ok"><span class="dot"></span>Connected</span><span class="chip">${esc(st.identity)}</span>${st.writes ? `<span class="chip warn">Writes on</span>` : `<span class="chip">Read only</span>`}`
        : st.status === "needs_reauth" ? `<span class="chip warn"><span class="dot"></span>Needs reconnecting</span><span class="chip">${esc(st.identity)}</span>${st.lastFlow ? `<span class="chip err">Last try refused</span>` : ""}`
        : `<span class="chip">Not connected</span>`;
      return `<button class="anchor${st.status !== "connected" ? " needs" : ""} ink" style="--i:${i + 3}" data-go="accounts/${c.id}" data-key="${c.id}" ${mqAttr(c.auth === "oauth" ? "Signed in with Google · your own client" : "Internal integration token", c.label, c.description)}>
        <div class="art">${connArt(c.id, st.status)}</div><div class="t">${c.label}</div><div class="s">${esc(c.description)}</div><div class="state">${chips}</div></button>`;
    }).join("");
    return { cls: "layer", html: layerShell("Depth 1 · Accounts", "Accounts she can reach",
      "Connectors let her reach an account directly, without a tab. Each one is yours — your own client or token, sealed on this machine — and anything that sends still waits for your signature.",
      `<div class="anchors">${cards}</div><p class="quiet" style="margin-top:1.4rem">Emblems are stylised drawings, not the services' marks.</p>`, "",
      needsYou() ? { eye: "Needs you", title: "Gmail", sub: "Its grant lapsed and the last reconnect was refused (access_denied). Two moves to fix: open it, press Reconnect." } : { eye: "All well", title: "Both connected", sub: "Open one to see its tools and its writes switch." }) };
  }

  /* L2 — one connector */
  function connScene(c) {
    ART = itemArt(c.id === "gmail" ? "inbox" : "docs", S.conns[c.id].status === "connected" ? "#22d3ee" : "#fbbf24");
    const st = S.conns[c.id];
    const flow = st.flow;
    const flowBox = flow ? `<div class="flow" id="flow"><span class="label">Reconnecting · simulated, no browser opens</span>
        <ol><li>${flow.phase === "starting" ? "Opening the consent page in your browser…" : "Consent page opened."}</li>
        ${flow.phase !== "starting" ? `<li>${flow.phase === "awaiting" ? "Waiting for you to approve it in the browser." : "Answer received on the loopback port, which then closed."}</li>` : ""}</ol>
        ${flow.phase === "awaiting" ? `<div class="actions"><button class="btn primary" data-act="flow-ok" data-id="${c.id}">I approved it in the browser</button><button class="btn" data-act="flow-refuse" data-id="${c.id}">I refused it</button></div>` : `<div class="bar-progress"><i style="width:${flow.phase === "starting" ? 35 : 90}%"></i></div>`}</div>` : "";
    const state = st.status === "connected"
      ? `<span class="chip ok"><span class="dot"></span>Connected as ${esc(st.identity)}</span><span class="chip ok">Healthy</span>`
      : st.status === "needs_reauth" ? `<span class="chip warn"><span class="dot"></span>Needs reconnecting</span><span class="chip err">${esc(c.healthDetail)}</span>` : `<span class="chip">Not connected</span>`;
    return { cls: "layer", html: layerShell(`Depth 2 · ${c.auth === "oauth" ? "Mail account" : "Workspace"}`, c.label, esc(c.description), `
      ${flowBox}
      ${st.lastFlow && !flow ? `<div class="calm" style="border-color:rgba(248,113,113,.4)"><b style="color:var(--err)">The last reconnect failed:</b> ${esc(st.lastFlow.detail)}. Nothing changed; you can try again.</div>` : ""}
      <div class="section-t"><span class="label">What she can do with it · ${c.tools.length}</span></div>
      <div class="rows">${c.tools.map((t) => `<div class="row split"><span class="open" style="cursor:default"><span class="ico">${icon(t.reversible ? "docs" : "inbox", t.reversible ? "#22d3ee" : "#f472b6")}</span><span><span class="t mono">${t.name}</span><span class="s" style="white-space:normal">${esc(t.desc)}</span></span></span><span class="meta">${t.reversible ? `<span class="cls AUTO">READS</span>` : `<span class="cls GATED">GATED</span>`}</span></div>`).join("")}</div>
      <div class="section-t"><span class="label">Writing</span></div>
      <div class="row split"><span class="open" style="cursor:default"><span class="ico">${icon("ledgerbox", "#fbbf24")}</span><span><span class="t">Let her write</span><span class="s" style="white-space:normal">${st.writes ? `On. She may write to the ${c.egress} you allow; the list is empty, so she will ask for each.` : `Off. She can search and read, never send or change.`}</span></span></span><span class="meta"><button class="switch" role="switch" aria-checked="${st.writes}" data-act="toggle-writes" data-id="${c.id}" aria-label="Let her write with ${c.label}" ${st.status !== "connected" ? "disabled" : ""}></button></span></div>
      <div class="section-t"><span class="label">How it connects · your own ${c.auth === "oauth" ? "client" : "token"}</span></div>
      <p class="quiet" style="margin:0 0 .6rem">${esc(c.guideNote)}</p><ol class="list num">${c.guide.map((g) => `<li>${esc(g)}</li>`).join("")}</ol>
      <p class="mono quiet" style="font-size:.85rem">Reaches ${c.hosts.join(", ")} · sealed with ${st.status === "connected" || c.seal ? c.seal.toUpperCase() : "—"} on this machine</p>`,
      `<div class="actions ink" style="--i:3">${state}</div>
       <div class="actions ink" style="--i:4">${st.status === "connected" ? `<button class="btn" data-act="disconnect" data-id="${c.id}">Disconnect</button>` : `<button class="btn primary" data-act="reconnect" data-id="${c.id}" ${flow ? "disabled" : ""}>${st.status === "needs_reauth" ? "Reconnect" : "Connect"}</button>`}</div>`,
      { eye: "Yours", title: st.status === "connected" ? "Connected" : "One move away", sub: st.status === "connected" ? "Revoke it any time here or at the provider." : "Reconnect opens the provider's own consent page; the answer comes back to this machine only." }) };
  }

  /* L1 — voice */
  function voiceScene() {
    ART = layerArt("voice");
    const v = A.voice, w = v.stt[0], o = v.stt[1];
    const bars = Array.from({ length: 36 }, (_, i) => `<i style="--h:${30 + Math.round(Math.abs(Math.sin(i * 1.7)) * 65)}%;animation-delay:${(i % 9) * 0.07}s"></i>`).join("");
    return { cls: "layer", html: layerShell("Depth 1 · Voice", "Her voice",
      "She can say what she is doing, and listen while you hold Space. Both run on this machine unless you choose otherwise.", `
      <div class="glass" style="padding:1.4rem 1.6rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap"><div><span class="label">She speaks as</span><div class="display h-l">${v.tts.voice.name}</div><p style="margin:.4rem 0 0">${esc(v.tts.voice.blurb)}</p></div>
          <div class="actions" style="margin:0"><span class="chip ok"><span class="dot"></span>${v.tts.label} · local · ${v.tts.sizeMb} MB</span><span class="chip">${v.tts.voice.language} · grade ${v.tts.voice.grade}</span></div></div>
        <div class="wave" id="wave" aria-hidden="true">${bars}</div>
        <div class="actions" style="margin-top:0"><button class="btn primary" data-act="hear">Hear her</button><span class="quiet" id="hear-line">“${esc(S.greeted ? v.testLine : v.greeting)}”</span></div></div>
      <div class="section-t" style="margin-top:2rem"><span class="label">How she listens · the same sentence, two ways</span></div>
      <div class="takes" role="radiogroup" aria-label="Listening engine">
        ${v.stt.map((s) => `<button class="take" role="radio" aria-checked="${S.listener === s.id}" data-act="listener" data-id="${s.id}" ${s.state !== "ready" ? "aria-disabled=\"true\"" : ""}>
          <span style="display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap"><b>${s.label}</b><span class="chip ${s.state === "ready" ? "ok" : "warn"}">${s.kind} · ${s.take.ms} ms</span></span>
          <q>${esc(s.take.text)}</q><span class="quiet" style="font-size:.92rem">${esc(s.note)}</span></button>`).join("")}</div>
      <div class="section-t"><span class="label">Whisper models on this machine</span></div>
      <div class="models">${w.models.map((m) => { const inst = S.models[m.id], pr = S.installs[m.id];
        return pr != null ? `<span class="chip ext" style="min-width:12rem">${m.id} · downloading ${Math.round(pr)}%<span class="bar-progress" style="flex:1;margin:0"><i style="width:${pr}%"></i></span></span>`
          : inst ? `<span class="chip ok">${m.id} · ${m.sizeMb} MB · installed${m.id === currentModel() ? " · in use" : ""}</span>` : `<button class="chip" data-act="install" data-id="${m.id}">Install ${m.id} · ${m.sizeMb} MB</button>`; }).join("")}</div>
      <p class="mono quiet" style="font-size:.85rem;margin-top:1rem">Voice files live in ${esc(v.home)}</p>`,
      `<div class="actions ink" style="--i:3"><label style="display:flex;align-items:center;gap:.7rem">She speaks aloud <button class="switch" role="switch" aria-checked="${S.voice}" data-act="voice-on" aria-label="She speaks aloud"></button></label></div>`,
      { eye: "Push to talk", title: "Hold Space", sub: "On her surface, hold Space or the microphone; let go and she hears it. Nothing is listened to otherwise." }) };
  }

  /* L1 — mind */
  function mindScene() {
    ART = layerArt("mind");
    const f = A.setupFacts;
    return { cls: "layer", html: layerShell("Depth 1 · Mind", "What she thinks with",
      "Athena borrows a mind from an engine already installed on this computer. Choose another here; the rest of her stays the same.", `
      <div class="engines" role="radiogroup" aria-label="Engine">${engineCards()}</div>
      <div class="section-t" style="margin-top:2rem"><span class="label">This machine</span></div>
      <dl class="kv"><dt>Her memory</dt><dd>${esc(f.brainPath)}</dd><dt>Her records</dt><dd>${esc(f.storePath)}</dd><dt>Microphone</dt><dd>${f.mic.state} · ${esc(f.mic.detail)}</dd><dt>She may touch</dt><dd>${reachCount()} things · ${appsOnCount()} apps, ${A.connectors.filter((c) => S.connOn[c.id]).length} accounts</dd><dt>Theme</dt><dd>${f.theme}</dd></dl>`,
      `<div class="actions ink" style="--i:3"><button class="btn" data-go="mind/setup" data-key="setup">Run the setup again</button></div>`,
      { eye: "In use", title: engineLabel(S.engine), sub: (A.engines.find((e) => e.id === S.engine) || {}).detail || "" }) };
  }
  function engineCards() {
    return A.engines.map((e) => {
      const missing = e.id === "codex" && S.codex !== "found";
      return `<button class="engine${missing ? " missing" : ""}" role="radio" aria-checked="${S.engine === e.id}" data-act="engine" data-id="${e.id}" ${missing ? "aria-disabled=\"true\"" : ""}>
        <span style="display:flex;justify-content:space-between;align-items:center;gap:.6rem"><span class="t">${e.label}</span>${missing ? `<span class="chip warn">${S.codex === "checking" ? "Checking…" : "Not found"}</span>` : `<span class="chip ok"><span class="dot"></span>Found</span>`}</span>
        <div class="d">${esc(missing ? e.detail : (e.id === "codex" ? "codex-cli 0.41.0" : e.detail))}</div><div class="p">${esc(missing ? e.plain : e.id === "codex" ? "Found after checking again." : e.plain)}</div>
        ${missing ? `<span class="btn" style="margin-top:.8rem" data-act="check" role="button">Check again</span>` : ""}</button>`;
    }).join("");
  }

  /* L1 — ledger */
  const REASON = { foreign_origin: "Refused: it belonged to a different app than the one in front of you.", user_denied: "You declined it.", engine_error: "The engine stopped with an error." };
  function ledgerScene() {
    ART = layerArt("ledger");
    const dec = [...S.answered.map((d) => ({ ...d, isNew: true })), ...A.decisions];
    const rows = [...S.ledgerNew.map((r) => ({ ...r, isNew: true })), ...A.ledger.rows];
    return { cls: "layer", html: layerShell("Depth 1 · Ledger", "What she has done",
      "One line for every time she thought, failures included, and every decision you made. Nothing is left out without saying so.", `
      <div class="section-t"><span class="label">Your decisions</span></div>
      <div class="strata">${dec.map((d, i) => `<div class="stratum${d.isNew ? " new" : ""}" style="animation-delay:${i * 40}ms"><span class="when">${esc(d.at)}</span><span class="what">${esc(d.action)}${d.invoice ? ` · ${d.invoice}` : ""}<small>${d.reason ? esc(REASON[d.reason] || d.reason) : d.result === "approved" ? "You approved it; it ran once." : "You declined it; nothing ran."}</small></span>
        <span class="chip ${d.result === "approved" ? "ok" : d.result === "refused" ? "err" : ""}">${d.result}</span></div>`).join("")}</div>
      <p class="showing">(showing ${dec.length} of ${A.decisionsTotal + S.answered.length})</p>
      <div class="section-t" style="margin-top:2rem"><span class="label">Her turns · one row per time she thought</span></div>
      <div class="strata">${rows.map((r, i) => `<div class="stratum${r.isNew ? " new" : ""}" style="animation-delay:${i * 40}ms"><span class="when">${esc(r.at)}</span><span class="what">${engineLabel(r.engine)} · ${r.rounds} round${r.rounds === 1 ? "" : "s"}<small>${r.error ? esc(REASON[r.error] || r.error) : r.cost != null ? `${usd(r.cost, 4)} of engine time` : "cost not reported"}</small></span>
        <span class="chip ${r.error ? "err" : "ok"}">${r.error ? "error" : "ok"}</span></div>`).join("")}</div>
      <p class="showing">(showing ${rows.length} of ${A.ledger.total + S.ledgerNew.length})</p>`, "",
      { eye: "Today", title: `${S.answered.length} signed by you`, sub: "Decisions you make on her surface land here the moment you make them." }) };
  }

  /* setup: the first act, and a layer you can return to */
  function setupScene(again) {
    const step = S.setupStep;
    const titles = [S.engine ? "She has a mind." : "She is asleep.", `She can reach ${reachCount()} things.`, S.voice ? "She has a voice." : "She will work in silence."];
    const left = `<div class="left"><div class="athena" data-state="${S.engine ? (step === 2 && S.voice ? "speaking" : "resting") : "asleep"}">${athenaSVG(false)}</div>
      <h2 class="display" id="setup-title">${titles[step]}</h2>
      <p class="sub">${step === 0 ? "Three things and she wakes. Each one you choose lights a part of her." : step === 1 ? "Every lit tendril is something she may touch. Switch one off and it goes dark." : "Her voice is optional. She works the same in silence."}</p></div>`;
    let pane;
    if (step === 0) pane = `<div class="step-pane${S.stepped ? " stepped" : ""}"><span class="eyebrow">Step 1 of 3 · her mind</span><h1 class="display" tabindex="-1">What will she think with?</h1>
      <p class="lede">Athena borrows a mind from an engine already on this computer. We looked; this is what answered.</p>
      <div class="engines" role="radiogroup" aria-label="Engine">${engineCards()}</div>
      <div class="setup-foot"><button class="btn primary" data-act="setup-next" ${S.engine ? "" : "disabled"}>Next: what she may touch</button>${S.engine ? "" : `<span class="quiet">Choose an engine to wake her.</span>`}</div></div>`;
    else if (step === 1) pane = `<div class="step-pane${S.stepped ? " stepped" : ""}"><span class="eyebrow">Step 2 of 3 · her reach</span><h1 class="display" tabindex="-1">What may she touch?</h1>
      <p class="lede">She works only in what you switch on. Anything that sends, pays or deletes still waits for your signature.</p>
      <div class="reach">${A.apps.map((a) => `<div class="reach-item"><span class="t">${a.name}</span><span class="s">${esc(a.kind)} · ${a.tools.length ? a.tools.length + " tools" : "reads the page"}</span><button class="switch" role="switch" aria-checked="${!!S.appsOn[a.id]}" data-act="toggle-app" data-id="${a.id}" aria-label="${a.name}"></button></div>`).join("")}
        ${A.connectors.map((c) => `<div class="reach-item"><span class="t">${c.label}</span><span class="s" style="${S.conns[c.id].status !== "connected" ? "color:var(--warn)" : ""}">${S.conns[c.id].status === "connected" ? "Connected · " + esc(S.conns[c.id].identity) : "Needs reconnecting · fix it later in Accounts"}</span><button class="switch" role="switch" aria-checked="${!!S.connOn[c.id]}" data-act="toggle-conn" data-id="${c.id}" aria-label="${c.label}"></button></div>`).join("")}</div>
      <div class="setup-foot"><button class="btn" data-act="setup-step" data-n="0">Back</button><button class="btn primary" data-act="setup-next">Next: her voice</button></div></div>`;
    else pane = `<div class="step-pane${S.stepped ? " stepped" : ""}"><span class="eyebrow">Step 3 of 3 · optional</span><h1 class="display" tabindex="-1">Should she speak?</h1>
      <p class="lede">${esc(A.voice.tts.voice.name)}: ${esc(A.voice.tts.voice.blurb)} She runs on this machine (${A.voice.tts.label}, ${A.voice.tts.sizeMb} MB) and listens with Whisper while you hold Space.</p>
      <div class="actions"><button class="btn" data-act="hear">Hear her</button><span class="quiet" id="hear-line">“${esc(A.voice.greeting)}”</span></div>
      <div class="reach" style="margin-top:1.2rem"><div class="reach-item"><span class="t">She speaks aloud</span><span class="s">You can change this any time in Voice.</span><button class="switch" role="switch" aria-checked="${S.voice}" data-act="voice-on" aria-label="She speaks aloud"></button></div></div>
      <div class="setup-foot"><button class="btn" data-act="setup-step" data-n="1">Back</button><button class="btn primary" data-act="wake">${again ? "Done — back to her" : "Wake Athena"}</button><span class="quiet">Demo: nothing is installed or sent.</span></div></div>`;
    const nav = `<div class="steps-nav" role="list">${["Mind", "Reach", "Voice"].map((t, i) => `<button role="listitem" data-act="setup-step" data-n="${i}" ${i === step ? 'aria-current="step"' : ""} class="${i < step || (i === 0 && S.engine) ? "done" : ""}" ${i > 0 && !S.engine ? "disabled" : ""}><b>${i < step ? "✓" : i + 1}</b>${t}</button>`).join("")}</div>`;
    return { cls: "setup", html: left + `<div>${nav}${pane}</div>` };
  }

  /* ---------------- surface parts ---------------- */
  const HEAD = {
    resting: () => ({ word: "Resting · " + greetingTitle(), title: S.project ? `Ready for ${S.project}` : "What shall we do?", sub: "She works in the apps you already have open. Type a chore, or hold Space and say it." }),
    reading: () => ({ word: "Reading", title: S.botLine || "Reading Invoices — March", sub: "Nothing leaves while she reads." }),
    working: () => ({ word: "Working", title: S.botLine || "Working it out", sub: "Every step lands on the tape to the left." }),
    asking: () => ({ word: "Waiting on you", ask: true, title: `${S.slips.length} ${S.slips.length === 1 ? "chase waits" : "chases wait"} for your signature`, sub: "Nothing runs until you approve. A approves the top slip, D declines it." }),
    speaking: () => ({ word: "Speaking", title: S.botLine, sub: S.voice ? "Aloud, as Heart." : "Shown here; her voice is off." }),
    listening: () => ({ word: "Listening", ask: true, title: S.partial ? `“${S.partial}”` : "I'm listening…", sub: "Let go of Space to send it." }),
  };
  function greetingTitle() { const h = new Date().getHours(); return h < 12 && h >= 5 ? "Good morning" : h < 18 && h >= 12 ? "Good afternoon" : "Good evening"; }
  function renderHeadline() {
    const el = $("#headline"); if (!el) return;
    const L = S.hover && LAYERS.find((l) => l.id === S.hover);
    if (L) {
      el.className = "headline hovered";
      el.innerHTML = `<span class="state-word">Dive · ${L.name}</span><div class="display">${esc(L.title)}</div><div class="sub">${esc(L.sentence())}</div>`;
      return;
    }
    const h = HEAD[S.bot]();
    el.className = "headline";
    el.innerHTML = `<span class="state-word${h.ask ? " ask" : ""}">${h.word}</span><div class="display">${esc(h.title)}</div><div class="sub">${esc(h.sub)}</div>`;
  }
  function renderSuggest() {
    const el = $("#suggest"); if (!el) return;
    if (S.busy) { el.innerHTML = ""; return; }
    el.innerHTML = (S.project ? `<span class="project">Working toward: ${esc(S.project)}</span>` : "") +
      `<button type="button" data-act="suggest" data-text="${esc(A.ask)}">${esc(A.ask)}</button><button type="button" data-act="suggest" data-text="${esc(A.offer.text)}">${esc(A.offer.text)}</button>`;
  }
  function renderTape() {
    const el = $("#tape"); if (!el) return;
    const meta = $("#tape-meta");
    if (!S.tape.length) {
      el.innerHTML = `<li class="decision"><span class="who">Earlier · ${esc(A.decisions[0].at)}</span>You approved a chase in Ledgerbox. It ran once.</li>
        <li class="decision declined"><span class="who">Earlier · ${esc(A.decisions[1].at)}</span>A chase was refused: it belonged to a different app than the one in front of you.</li>
        <li><span class="who">Now</span><span class="empty">Nothing running. She is in <b>Invoices — March</b>, the tab in front of you.</span></li>`;
      if (meta) meta.textContent = "";
      return;
    }
    el.innerHTML = S.tape.map((t) => `<li class="${t.kind}${t.declined ? " declined" : ""}"><span class="who">${{ user: "You", assistant: "Athena", tool: "Tool · tier " + (t.tier ?? 1), decision: "Decision" }[t.kind]}${t.at ? " · " + t.at : ""}</span><span class="txt">${t.typing ? `<span class="typing"><i></i><i></i><i></i></span>` : esc(t.text)}</span></li>`).join("");
    el.scrollTop = el.scrollHeight;
    if (meta) meta.textContent = S.busy ? "live" : "";
  }
  function renderSlips() {
    const el = $("#slips"); if (!el) return;
    $("#slips-count").textContent = S.slips.length ? `${S.slips.length} waiting` : "";
    if (!S.slips.length) {
      el.innerHTML = `<div class="calm"><b>Nothing waits for you.</b><br>When she wants to send, pay or delete, it lands here first — and nothing runs until you sign.</div>`;
      return;
    }
    const top = S.slips[0];
    el.innerHTML = `<article class="slip" aria-label="Approval slip for ${top.invoice}" data-slip="${top.id}">
      <div class="gate-line"><span class="cls GATED">GATED</span>${esc(top.action)}</div>
      <div class="why">${esc(top.why)}</div>
      <dl><dt>Invoice</dt><dd>${top.invoice} · ${top.client}</dd><dt>To</dt><dd>${top.to}</dd><dt>Overdue</dt><dd>${top.days} days</dd></dl>
      <div class="acts"><button class="btn human" data-act="approve" data-id="${top.id}">Approve <kbd>A</kbd></button><button class="btn" data-act="decline" data-id="${top.id}">Decline <kbd>D</kbd></button></div>
      <div class="note">Nothing runs until you sign. Or hold Space and say “approve”.</div></article>
      ${S.slips.slice(1).map(() => `<div class="slip-under"></div>`).join("")}`;
  }
  function renderBot() {
    $$(".surface .athena").forEach((a) => (a.dataset.state = S.bot));
    $("#dock-state").textContent = { resting: "resting", reading: "reading", working: "working", asking: "waiting on you", speaking: "speaking", listening: "listening" }[S.bot];
    const w = $("#dock-wait");
    w.hidden = !S.slips.length; w.textContent = `${S.slips.length} waiting`;
    $(".dock-bell") && ($(".dock-bell").dataset.state = S.bot);
    renderHeadline();
    LAYERS.forEach((L) => { const c = $(`[data-count="${L.id}"]`); if (c) { c.textContent = L.count(); c.classList.toggle("human", !!(L.human && L.human())); } });
  }

  /* ---------------- the turn (simulated) ---------------- */
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  function setBot(state, line) { S.bot = state; if (line !== undefined) S.botLine = line; renderBot(); }
  function addTape(e) { S.tape.push({ at: nowClock(), ...e }); renderTape(); }
  function send(text) {
    text = text.trim(); if (!text) return;
    if (S.busy) { toast("She is mid-turn. Your words are kept; send again when she is done."); return; }
    S.busy = true; renderSuggest();
    addTape({ kind: "user", text });
    const inv = /invoice|chase|overdue|30 days|past due/i.test(text);
    const pb = A.playbooks.find((p) => text.includes(p.command) || text.toLowerCase().includes(p.title.toLowerCase()));
    setBot("reading", inv ? "Reading Invoices — March" : "Reading the tab in front of you");
    addTape({ kind: "assistant", typing: true });
    const done = (rounds) => { S.ledgerNew.unshift({ id: "led_new_" + Date.now(), at: "Today, " + nowClock(), engine: S.engine || "claude_code", rounds, cost: +(0.012 + Math.random() * 0.03).toFixed(4), error: null }); S.busy = false; renderSuggest(); renderBot(); };
    if (inv) {
      const T = A.turn;
      later(900, () => { S.tape.pop(); addTape({ kind: "assistant", text: T[1].text }); setBot("working", "Listing what is overdue"); });
      later(1900, () => addTape({ kind: "tool", text: T[2].text, tier: 1 }));
      later(2800, () => { addTape({ kind: "tool", text: T[3].text, tier: 1 }); setBot("working", "Drafting three chases"); });
      later(3900, () => { addTape({ kind: "assistant", text: T[4].text }); });
      later(4600, () => {
        S.slips = A.cards.map((c) => ({ ...c }));
        setBot("asking"); renderSlips(); done(2);
        if (path.length) toast(`Athena is waiting on you · ${S.slips.length} chases to sign`, true);
        speak("Three invoices are over 30 days. Each chase waits for you.", true);
      });
    } else {
      const reply = pb ? `I have ${pb.title} in front of me. ${pb.steps.length ? "First: " + pb.steps[0].toLowerCase() : "Its steps are not written yet, so I will ask you as I go."} Anything I file waits for your signature. (Demo: the portals are not open here, so I stop at the plan.)`
        : /approve/i.test(text) && S.slips.length ? null
        : `I read Invoices — March in Ledgerbox, the tab in front of you. Nothing in it needs you right now. If you like, I can find every invoice over 30 days and draft a chase for each.`;
      if (reply === null) { S.tape.pop(); S.busy = false; decide(S.slips[0].id, "approve", "voice"); return; }
      later(1300, () => { S.tape.pop(); addTape({ kind: "assistant", text: reply }); setBot("resting"); done(1); speak(reply.split(". ")[0] + ".", false); });
    }
  }
  function speak(line, keepAsking) {
    const back = () => setBot(S.slips.length ? "asking" : "resting");
    if (!S.voice) { if (!keepAsking) back(); return; }
    setBot("speaking", line);
    try { if (window.speechSynthesis && userSpoke) { const u = new SpeechSynthesisUtterance(line); u.rate = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } } catch (e) { /* no voice */ }
    later(Math.min(5000, 900 + line.length * 45), back);
  }
  let userSpoke = false; // only speak aloud after the person asked to hear her once

  function decide(id, kind, by) {
    const card = S.slips.find((c) => c.id === id); if (!card || S.leaving[id]) return;
    S.leaving[id] = true;
    const el = $(`[data-slip="${id}"]`);
    const finish = () => {
      delete S.leaving[id];
      S.slips = S.slips.filter((c) => c.id !== id);
      S.answered.unshift({ id, action: card.action, invoice: card.invoice, result: kind === "approve" ? "approved" : "declined", reason: kind === "approve" ? null : "user_denied", at: "Today, " + nowClock() });
      addTape({ kind: "decision", declined: kind !== "approve", text: kind === "approve" ? `You approved the chase for ${card.invoice}. Sent to ${card.to} (simulated — nothing left this page).` : `You declined the chase for ${card.invoice}. Nothing was sent.` });
      renderSlips();
      if (kind === "approve") { setBot("working", `Sending the chase for ${card.invoice}`); later(900, () => setBot(S.slips.length ? "asking" : "resting")); }
      else setBot(S.slips.length ? "asking" : "resting");
      if (!S.slips.length) speak(kind === "approve" ? "Done. Everything you signed is in the ledger." : "All answered. Nothing else waits for you.", false);
    };
    if (el && !calm) {
      el.insertAdjacentHTML("beforeend", `<span class="stamp${kind === "approve" ? "" : " declined"}">${kind === "approve" ? "APPROVED" : "DECLINED"}</span>`);
      $$("button", el).forEach((b) => (b.disabled = true));
      setTimeout(() => el.classList.add("stamped"), 380);
      setTimeout(finish, 1150);
    } else finish();
  }

  /* push-to-talk */
  let listenTimer = 0;
  function startListening() {
    if (S.bot === "listening" || !$("#say")) return;
    S.prevBot = S.bot; S.partial = ""; setBot("listening");
    $("#ptt").setAttribute("aria-pressed", "true");
    const words = (S.slips.length ? "approve" : A.ask).split(" "); let i = 0;
    listenTimer = setInterval(() => { if (i >= words.length) return; S.partial = words.slice(0, ++i).join(" "); $("#say").value = S.partial; renderHeadline(); }, calm ? 60 : 170);
  }
  function stopListening() {
    if (S.bot !== "listening") return;
    clearInterval(listenTimer);
    $("#ptt") && $("#ptt").setAttribute("aria-pressed", "false");
    const text = S.partial; S.partial = "";
    setBot(S.prevBot === "listening" ? "resting" : S.prevBot || "resting");
    if (text) { if (/^approve$/i.test(text) && S.slips.length) { $("#say").value = ""; decide(S.slips[0].id, "approve", "voice"); } else { $("#say").value = ""; send(text); } }
  }

  function bindComposer(el) {
    const form = $("#composer", el), ptt = $("#ptt", el);
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = $("#say", el).value; $("#say", el).value = ""; send(v); });
    ptt.addEventListener("pointerdown", (e) => { e.preventDefault(); ptt.setPointerCapture(e.pointerId); startListening(); });
    ptt.addEventListener("pointerup", stopListening);
    ptt.addEventListener("pointercancel", stopListening);
    ptt.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); startListening(); } });
    ptt.addEventListener("keyup", (e) => { if (e.key === "Enter" || e.key === " ") stopListening(); });
    $$(".descent", el).forEach((d) => {
      const on = () => { S.hover = d.dataset.layer; leanTarget = (($$(".descent", el).indexOf(d)) - 2.5) / 2.5; renderHeadline(); };
      const off = () => { S.hover = null; leanTarget = 0; renderHeadline(); };
      d.addEventListener("pointerenter", on); d.addEventListener("focus", on);
      d.addEventListener("pointerleave", off); d.addEventListener("blur", off);
    });
  }

  /* ---------------- navigation: dive and rise ---------------- */
  const scenesEl = $("#scenes");
  let current = null;
  function go(next, opts = {}) {
    next = valid(next);
    const from = path, dir = next.length > from.length ? "down" : next.length < from.length ? "up" : "side";
    const origin = opts.origin;
    path = next;
    if (!opts.fromPop) { const h = "#/" + next.map(encodeURIComponent).join("/"); if (location.hash !== h) history.pushState(null, "", h); }
    // abort anything mid-flight: a move in flight lands on a clean level
    $$(".scene.leaving", scenesEl).forEach((s) => s.remove());
    S.hover = null; leanTarget = 0;
    const sc = sceneFor(next);
    const el = document.createElement("div");
    el.className = "scene " + sc.cls;
    el.innerHTML = sc.html;
    if (current && !opts.instant && !calm) {
      const old = current;
      old.classList.add("leaving", dir === "up" ? "leave-up" : "leave-down");
      if (origin && dir !== "up") {
        const r = origin.getBoundingClientRect(), sr = old.getBoundingClientRect();
        old.style.transformOrigin = `${r.left + r.width / 2 - sr.left}px ${r.top + r.height / 2 - sr.top}px`;
      }
      old.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      old.setAttribute("aria-hidden", "true"); old.inert = true;
      setTimeout(() => old.remove(), 760);
      el.classList.add(dir === "up" ? "enter-up" : "enter-down");
      boost(dir === "up" ? -1 : 1);
    } else if (current) current.remove();
    scenesEl.appendChild(el);
    current = el;
    sc.after && sc.after(el);
    chrome(from);
    bindMarquee(el);
    kick();
    // focus follows the level: down to the new heading, up to the place you came from
    const back = dir === "up" && from[next.length] ? el.querySelector(`[data-key="${CSS.escape(from[next.length])}"]`) : null;
    const target = opts.focus ? el.querySelector(opts.focus) : back || (next.length ? el.querySelector("h1") : null);
    if (target && !opts.noFocus) target.focus({ preventScroll: true });
    if (window.innerWidth <= 760) window.scrollTo(0, 0);
  }
  function chrome() {
    const d = path.length;
    document.body.dataset.depth = String(Math.min(d, 3));
    const rise = $("#rise"); rise.hidden = d === 0 || !S.ready;
    if (d) $("#rise-to").textContent = d === 1 ? "the surface" : nameOf(path.slice(0, -1));
    const crumbs = [[], ...path.map((_, i) => path.slice(0, i + 1))];
    $("#crumbs").innerHTML = S.ready ? crumbs.map((p, i) => `${i ? '<span class="sep">›</span>' : ""}<button type="button" data-go="${p.join("/")}" ${i === crumbs.length - 1 ? 'aria-current="location"' : ""}>${esc(i === 0 ? "Surface" : nameOf(p))}</button>`).join("") : `<button type="button" aria-current="step">Waking her · setup</button>`;
    $("#gauge-mark").style.top = `${Math.min(d, 3) * 33}%`;
    $("#gauge-label").style.top = `${Math.min(d, 3) * 33}%`;
    $("#gauge-label").textContent = d ? `Depth ${d} · ${nameOf(path)}` : "Surface";
    $("#gauge").hidden = !S.ready;
    $("#dock").hidden = d === 0 || !S.ready;
    renderBot();
  }
  function bindMarquee(el) {
    const mq = $(".marquee", el); if (!mq) return;
    const set = (eye, title, sub) => { $(".mq-eye", mq).textContent = eye; $(".mq-title", mq).textContent = title; $(".mq-sub", mq).textContent = sub; };
    const reset = () => set(mq.dataset.defaultEye, mq.dataset.defaultTitle, mq.dataset.defaultSub);
    $$("[data-mq-title]", el).forEach((n) => {
      const on = () => set(n.dataset.mqEye, n.dataset.mqTitle, n.dataset.mqSub);
      n.addEventListener("pointerenter", on); n.addEventListener("focus", on);
      n.addEventListener("pointerleave", reset); n.addEventListener("blur", reset);
    });
  }
  function rerender(focusSel) {
    // the same level, redrawn in place (state changed): no camera
    const active = document.activeElement;
    const key = active && active.dataset ? (active.dataset.act ? `[data-act="${active.dataset.act}"]${active.dataset.id ? `[data-id="${CSS.escape(active.dataset.id)}"]` : ""}${active.dataset.n ? `[data-n="${active.dataset.n}"]` : ""}` : null) : null;
    const scrollEl = $(".layer-body", current); const sTop = scrollEl ? scrollEl.scrollTop : 0;
    const sc = sceneFor(path);
    current.className = "scene " + sc.cls;
    current.innerHTML = sc.html;
    sc.after && sc.after(current);
    bindMarquee(current);
    const sb = $(".layer-body", current); if (sb) sb.scrollTop = sTop;
    const f = focusSel ? $(focusSel, current) : key ? $(key, current) : null;
    if (f) f.focus({ preventScroll: true });
    chrome(); kick();
  }

  /* ---------------- actions ---------------- */
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    const a = e.target.closest("[data-act]");
    if (a && (!g || g.contains(a))) { act(a, e); return; }
    if (g) { e.preventDefault(); const p = g.dataset.go.split("/").filter(Boolean); go(p, { origin: g }); }
  });
  function act(el, e) {
    const id = el.dataset.id, k = el.dataset.act;
    if (el.getAttribute("aria-disabled") === "true" && k !== "check") { if (k === "engine") { const c = el.querySelector('[data-act="check"]'); if (c) act(c, e); return; } else if (k === "listener") toast("OpenAI listening needs your own key. No key is stored, so she listens with Whisper."); return; }
    e.preventDefault(); e.stopPropagation();
    switch (k) {
      case "toggle-app": S.appsOn[id] = !S.appsOn[id]; save(); rerender(); break;
      case "toggle-conn": S.connOn[id] = !S.connOn[id]; save(); rerender(); break;
      case "engine": S.engine = id; save(); rerender(); break;
      case "check": S.codex = "checking"; rerender(); setTimeout(() => { S.codex = "not_found"; rerender(); toast("Checked again: `codex` was not found."); }, 1100); break;
      case "setup-step": S.setupStep = +el.dataset.n; S.stepped = true; rerender("h1"); S.stepped = false; break;
      case "setup-next": S.setupStep = Math.min(2, S.setupStep + 1); S.stepped = true; rerender("h1"); S.stepped = false; break;
      case "wake": {
        const first = !S.ready; S.ready = true; S.setupStep = 0; save();
        if (first) { S.botLine = A.voice.greeting; go([], { focus: "#say" }); S.bot = "speaking"; renderBot(); later(2600, () => setBot("resting")); }
        else go([], { focus: "#say" });
        break;
      }
      case "hear": {
        userSpoke = true;
        const line = S.greeted ? A.voice.testLine : A.voice.greeting; S.greeted = true;
        try { if (window.speechSynthesis) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(line)); } } catch (err) { /* none */ }
        const w = $("#wave"); if (w) { w.classList.add("live"); setTimeout(() => w.classList.remove("live"), 2600); }
        const l = $("#hear-line"); if (l) l.textContent = `“${line}”`;
        $$(".athena").forEach((x) => (x.dataset.state = "speaking")); setTimeout(() => $$(".setup .athena").forEach((x) => (x.dataset.state = S.engine ? "resting" : "asleep")), 2600);
        break;
      }
      case "voice-on": S.voice = !S.voice; save(); rerender(); break;
      case "listener": S.listener = id; rerender(); break;
      case "install": S.installs[id] = 0; rerender(); { const t = setInterval(() => { S.installs[id] += 7 + Math.random() * 9; if (S.installs[id] >= 100) { clearInterval(t); delete S.installs[id]; S.models[id] = true; toast(`Whisper ${id} installed (simulated).`); } if (path[0] === "voice") rerender(); }, 260); } break;
      case "reconnect": S.conns[id].flow = { phase: "starting" }; rerender(); setTimeout(() => { if (S.conns[id].flow) { S.conns[id].flow.phase = "awaiting"; if (path[1] === id) rerender(); } }, 1300); break;
      case "flow-ok": S.conns[id].flow = { phase: "exchanging" }; rerender(); setTimeout(() => { Object.assign(S.conns[id], { flow: null, status: "connected", health: "healthy", lastFlow: null }); if (path[1] === id) rerender(); toast(`${conn(id).label} connected as ${S.conns[id].identity} (simulated).`); }, 1000); break;
      case "flow-refuse": Object.assign(S.conns[id], { flow: null, lastFlow: { phase: "failed", detail: "the provider refused: access_denied" } }); rerender(); break;
      case "disconnect": Object.assign(S.conns[id], { status: "disconnected", writes: false }); rerender(); break;
      case "toggle-writes": if (S.conns[id].status === "connected") { S.conns[id].writes = !S.conns[id].writes; rerender(); } break;
      case "hand": { const p = book(id); S.project = p.title; go([], { focus: "#say" }); const i = $("#say"); if (i) i.value = p.command; renderHeadline(); renderSuggest(); toast(`${p.title} is in her composer. Press send when you are ready.`); break; }
      case "turn": S.runTurn[id] = +el.dataset.n; rerender(); break;
      case "run-prev": S.runTurn[id] = Math.max(0, (S.runTurn[id] || 0) - 1); rerender('[data-act="run-prev"]'); break;
      case "run-next": S.runTurn[id] = Math.min(book(id).bench.trace.length - 1, (S.runTurn[id] || 0) + 1); rerender('[data-act="run-next"]'); break;
      case "approve": decide(id, "approve", "click"); break;
      case "decline": decide(id, "decline", "click"); break;
      case "suggest": { const i = $("#say"); if (i) { i.value = el.dataset.text; i.focus(); } break; }
      case "blank": toast("A blank tab: nothing there for her to work on."); break;
      case "toast-go": hideToast(); go([]); break;
    }
  }

  let toastT = 0;
  function toast(msg, toSurface) {
    const t = $("#toast"); t.hidden = false;
    t.innerHTML = `<div>${esc(msg)}</div>${toSurface ? `<button class="btn human" data-act="toast-go">Go to her</button>` : ""}`;
    t.style.borderColor = toSurface ? "" : "var(--line-strong)";
    clearTimeout(toastT); toastT = setTimeout(hideToast, toSurface ? 9000 : 4200);
  }
  const hideToast = () => { $("#toast").hidden = true; };

  /* ---------------- keyboard ---------------- */
  const typing = () => { const a = document.activeElement; return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"); };
  document.addEventListener("keydown", (e) => {
    if (document.body.classList.contains("intro")) endIntro();
    if (e.key === "Escape") {
      if (S.bot === "listening") { clearInterval(listenTimer); S.partial = ""; $("#say") && ($("#say").value = ""); $("#ptt") && $("#ptt").setAttribute("aria-pressed", "false"); setBot(S.prevBot || "resting"); return; }
      if (!$("#toast").hidden) { hideToast(); return; }
      if (typing() && document.activeElement.value) { document.activeElement.blur(); return; }
      if (path.length) { e.preventDefault(); go(path.slice(0, -1)); return; }
      if (!S.ready && S.setupStep > 0) { S.setupStep--; rerender("h1"); }
      return;
    }
    const atSurface = path.length === 0 && S.ready;
    const emptyComposer = typing() && document.activeElement.id === "say" && !document.activeElement.value;
    if (emptyComposer && atSurface && S.slips.length && /^[aAdD]$/.test(e.key)) { e.preventDefault(); decide(S.slips[0].id, /a/i.test(e.key) ? "approve" : "decline", "key"); return; }
    if (typing()) return;
    if (atSurface && e.key === " " && !e.repeat && (document.activeElement === document.body || document.activeElement.id === "ptt" || !document.activeElement.matches("button, a, [role=switch], [role=radio]"))) { e.preventDefault(); startListening(); return; }
    if (atSurface && e.key === "/") { e.preventDefault(); $("#say").focus(); return; }
    if (atSurface && S.slips.length && (e.key === "a" || e.key === "A")) { decide(S.slips[0].id, "approve", "key"); return; }
    if (atSurface && S.slips.length && (e.key === "d" || e.key === "D")) { decide(S.slips[0].id, "decline", "key"); return; }
    if (path[0] === "chores" && path[2] === "run" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const id = path[1], n = S.runTurn[id] || 0, max = book(id).bench.trace.length - 1;
      S.runTurn[id] = Math.max(0, Math.min(max, n + (e.key === "ArrowRight" ? 1 : -1))); rerender(); return;
    }
    if (atSurface && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const ds = $$(".descent", current), i = ds.indexOf(document.activeElement);
      const n = i < 0 ? 0 : (i + (e.key === "ArrowRight" ? 1 : -1) + ds.length) % ds.length; ds[n].focus(); e.preventDefault();
    }
  });
  document.addEventListener("keyup", (e) => { if (e.key === " " && S.bot === "listening" && !typing()) stopListening(); });
  window.addEventListener("popstate", () => go(parse(), { fromPop: true }));

  /* ---------------- chrome buttons ---------------- */
  $("#rise").addEventListener("click", () => go(path.slice(0, -1)));
  $("#brand").addEventListener("click", (e) => { e.preventDefault(); if (S.ready) go([]); });
  $("#dock-athena").addEventListener("click", () => go([], { focus: "#say" }));
  $("#motion-toggle").addEventListener("click", () => { calm = !calm; applyCalm(); kick(); });
  rm.addEventListener && rm.addEventListener("change", () => { calm = rm.matches; applyCalm(); kick(); });
  $("#dock .dock-bell").innerHTML = athenaSVG(true);

  /* ---------------- marine snow ---------------- */
  const cv = $("#snow"), cx = cv.getContext("2d");
  let W = 0, H = 0, flakes = [], vy = 0, snowRaf = 0;
  function size() { const dpr = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function seed() { const n = Math.round(Math.min(140, (W * H) / 16000)); flakes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.3, s: Math.random() * 0.25 + 0.05, a: Math.random() * 0.5 + 0.12, p: Math.random() * 6.28 })); }
  function snow(t) {
    snowRaf = 0;
    cx.clearRect(0, 0, W, H);
    vy *= 0.94;
    for (const f of flakes) {
      if (!calm) { f.y -= f.s + vy * (f.r + 0.5) * 3; f.x += Math.sin(t * 0.0003 + f.p) * 0.15; }
      if (f.y < -5) { f.y = H + 5; f.x = Math.random() * W; } if (f.y > H + 6) { f.y = -4; f.x = Math.random() * W; }
      cx.globalAlpha = f.a; cx.fillStyle = f.r > 1.4 ? "#a5f3fc" : "#94c5d4";
      cx.beginPath(); cx.arc(f.x, f.y, f.r, 0, 6.283); cx.fill();
    }
    cx.globalAlpha = 1;
    if (!calm && !document.hidden) snowRaf = requestAnimationFrame(snow);
  }
  function boost(dir) { vy = dir * 3.2; if (!snowRaf && !calm) snowRaf = requestAnimationFrame(snow); }
  window.addEventListener("resize", () => { size(); seed(); if (calm) snow(0); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !calm && !snowRaf) snowRaf = requestAnimationFrame(snow); });

  /* ---------------- start ---------------- */
  function endIntro() { document.body.classList.remove("intro"); $("#skip-intro").hidden = true; }
  defs();
  applyCalm();
  size(); seed(); snow(0);
  if (!calm) { document.body.classList.add("intro"); $("#skip-intro").hidden = false; setTimeout(endIntro, 3600); }
  $("#skip-intro button").addEventListener("click", endIntro);
  document.addEventListener("pointerdown", () => { if (document.body.classList.contains("intro")) endIntro(); }, { once: true });
  const start = valid(parse());
  path = [];
  go(S.ready ? start : [], { instant: true, fromPop: true, noFocus: true });
  if (!S.ready && start.length) history.replaceState(null, "", "#/");
  if (params.has("slips") && S.ready) { S.tape = A.turn.map((t) => ({ ...t, at: t.at || "09:41" })); S.slips = A.cards.map((c) => ({ ...c })); S.bot = "asking"; renderTape(); renderSlips(); renderBot(); }
})();
