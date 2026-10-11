/* ================= CLAUDE × QUANT — terminal UI ================= */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const C = {};
const TRIGGER_ID = '__TRIGGER_ID__'; // scheduled task that copies the quant-data branch into this page's db (claude.ai only)
function readPalette() { const cs = getComputedStyle(document.body);
  for (const k of ['bg', 'panel', 'panel2', 'inset', 'line', 'line2', 'grid', 'txt', 'dim', 'dim2', 'green', 'green2', 'red', 'red2', 'amber', 'orange', 'cyan', 'magenta', 'violet', 'white']) C[k] = cs.getPropertyValue('--' + k).trim(); }
function rgba(hex, a) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(x => x + x).join(''); const n = parseInt(hex, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
const FONT = (s, w = 600) => `${w} ${s}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
function cv(id) { const el = $(id); if (!el) return null; const r = el.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(20, r.width), h = Math.max(20, r.height); const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (el.width !== W || el.height !== H) { el.width = W; el.height = H; } const x = el.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return { x, w, h, el }; }

/* ---------- formatting ---------- */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v, d = 0) => (v < 0 ? '−$' : '$') + (d ? nf2 : nf0).format(Math.abs(v));
const pct = (v, d = 1, s = true) => !isFinite(v) ? '—' : (s && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d) + '%';
const pp = (v, d = 2, s = true) => v == null || !isFinite(v) ? '—' : (s && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
const fcfa = v => v == null ? '—' : (Math.abs(v) < 100 && v % 1 !== 0) ? v.toFixed(2).replace('.', ',') : Math.round(v).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const compact = v => { const a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0)); };
const MONTHS = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
const dshort = d => d.slice(8, 10) + ' ' + MONTHS[+d.slice(5, 7) - 1];
const dfr = d => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : 'fl';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CTY = { CI: "Côte d'Ivoire", SN: 'Sénégal', BF: 'Burkina Faso', BJ: 'Bénin', ML: 'Mali', NE: 'Niger', TG: 'Togo' };

/* ---------- state ---------- */
const S = { P: null, tf: '1D', bars: 90, mode: 'vj', view: 'grid', sort: { k: 'score', dir: -1 }, H: 252, seed: 7, hover: null, reveal: 1, rot: 0 };
const BARSTEPS = [40, 60, 90, 120, 180, 250, 500, 1000, 2500];
let HIST, BRV, REF, M, MK, LIVE = null, R = {}, BR;
const LS = { get(k) { try { return JSON.parse(localStorage.getItem('cq:' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('cq:' + k, JSON.stringify(v)); } catch (e) { } } };

/* ---------- explanations (FR) ---------- */
const INFO = {
  pnl: "<p><b>Résultat du backtest</b> de la stratégie active (par défaut ton algo : QQQ vs SMA200 → TQQQ simulé 3×, exécution à la clôture).</p><p>Gros chiffre = capital final. Encadré = P&L de la dernière séance et performance totale. TRADES / WIN RATE / AVG R/R (gain moyen ÷ perte moyenne) / SHARPE (net du taux sans risque).</p><p><b>DD RISK</b> = drawdown actuel rapporté à ton seuil de ruine (50 % par défaut). Le trait blanc = pire drawdown historique. Clique sur l'identifiant pour ouvrir la console.</p>",
  chart: "<p><b>QQQ en bougies</b> (1D / 1W, et 5M quand le flux live tourne) avec SMA200 (ambre) et SMA50 (cyan). Les ▲/▼ sont les entrées/sorties de la stratégie backtestée.</p><p>La colonne de droite remplace le carnet L2 : les <b>niveaux clés</b> au-dessus (résistances, rouge) et en dessous (supports, vert) — pivots de la veille, SMA20/50/200, plus haut/bas 52 semaines — avec la distance en %. Au milieu : l'écart à la SMA200, le chiffre qui pilote ton algo.</p>",
  grid: "<p><b>Les 48 actions BRVM</b> (Bridge Bank Group CI est la 48e). Couleur = variation du jour par défaut ; les onglets recolorent et retrient par YTD, rendement du dividende, PER ou score quant.</p><p><b>SCORE</b> = 35 % rendement + 30 % valorisation (PER bas) + 20 % momentum YTD + 15 % liquidité, en rangs centiles sur les 48 titres. Clique une case pour la fiche complète et un simulateur de dividende. TABLE = vue triable.</p><p>Rendement et PER sont recalculés au cours actuel à partir du dernier dividende net et du PER publiés au BOC.</p>",
  surv: "<p><b>Combien de temps durent les drawdowns ?</b> Courbe de survie de Kaplan-Meier : part des drawdowns (≥ 5 %) encore non récupérés après N jours de bourse.</p><p>Vert = ta stratégie, rouge = QQQ buy & hold, orange = 3× buy & hold. P50 = durée médiane, P90 = 9 drawdowns sur 10 sont récupérés avant ce délai. Le drawdown en cours est traité comme censuré.</p>",
  aurora: "<p><b>Pression du tape</b> sur 200 séances : chaque jour, le volume est réparti entre acheteurs et vendeurs selon où la clôture se situe dans la range (Close Location Value).</p><p>Rouge qui tombe du haut = pression vendeuse, vert qui monte = acheteuse, pics blancs = volume anormal (> 2σ). Ligne verte = CVD cumulé. Bande du bas : cyan = tendance, magenta = range/chop (efficiency ratio de Kaufman &lt; 0,3).</p>",
  mem: "<p><b>Nappe de momentum</b> : 16 horizons (2 à 252 jours) empilés en profondeur. Chaque ligne = rendement sur l'horizon, normalisé par la volatilité (z-score), sur les 150 dernières séances.</p><p>Tout vert = momentum aligné sur tous les horizons (tendance saine). Rouge à l'avant et vert à l'arrière = repli court terme dans une tendance longue (zone d'achat classique). ALIGN = % d'horizons positifs. STATE passe à STRESSED si la vol 20 j dépasse 30 %.</p>",
  vortex: "<p><b>Synchronisation des marchés</b> (modèle de Kuramoto). La phase du cycle de chaque marché (QQQ + 21 valeurs tech) est extraite par le transformateur de Hilbert d'Ehlers.</p><p><b>SYNC</b> = paramètre d'ordre R (0 = chacun sa vie, 100 % = tout le monde bouge ensemble). Synchro élevée = risque systémique, les corrélations montent. <b>K</b> = corrélation moyenne des rendements sur 60 j. Listes : marchés en phase / hors phase avec le champ moyen. L'aiguille pointe la phase moyenne.</p>",
  ruin: "<p><b>Cône de ruine</b> : 1 000 futurs simulés en ré-échantillonnant par blocs de 20 jours les rendements quotidiens réels de la stratégie (bootstrap par blocs).</p><p><b>P(RUIN)</b> = probabilité de toucher, sur l'horizon, un drawdown au moins égal à ton seuil (50 % par défaut, réglable dans la console). Histogramme à droite = distribution du capital final. 1Y / 3Y pour l'horizon.</p>",
  analog: "<p><b>« Déjà vu »</b> : on prend les 64 dernières séances de QQQ, on les normalise, et on scanne environ 50 000 fenêtres historiques (QQQ + 21 marchés) par corrélation, puis on affine les meilleures par DTW (Dynamic Time Warping).</p><p>Les 6 analogues retenus montrent <b>ce qui s'est passé ensuite</b> sur 26 séances (ajusté de la volatilité). UP / DOWN = vote. TARGET / STOP = médianes de la meilleure et de la pire excursion des analogues (MFE / MAE).</p>",
  bayes: "<p><b>Probabilité que QQQ soit plus haut dans 21 séances.</b> Prior = fréquence historique. Chaque signal (tendance, momentum, volatilité, RSI, synchro…) ajuste la probabilité via son rapport de vraisemblance appris sur l'historique.</p><p>Les signaux sont corrélés, donc les log-odds sont tempérés par λ calibré sur l'historique. EV = espérance sur 21 j. Kelly ½ = taille de position suggérée (plafonnée). CONF dépend du nombre de jours passés qui avaient exactement la même configuration.</p>"
};

/* ================================================================== boot */
async function boot() {
  readPalette();
  S.P = Object.assign({}, DEFAULT_P, LS.get('P') || {});
  S.mode = LS.get('mode') || 'vj';
  if (LS.get('skin') === 'light') { document.body.classList.add('light'); readPalette(); }
  let d = window.__QDATA__;
  if (!d) { try { d = await loadRemote(); } catch (e) { console.warn('remote data unavailable', e); } }
  if (!d) { $('agentMsg').textContent = 'Données introuvables : data/history.json'; return; }
  ingest(d); computeStatic(); computeBT(); renderAll(true); wire(); loop(); clock();
  if (!window.__QDATA__) setInterval(pollLive, 5 * 60 * 1000);
  initSample(); initFeed(); initSync();
}
async function fetchJSON(u) { const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
async function loadRemote() {
  const [history, brvm, ref] = await Promise.all([fetchJSON('data/history.json'), fetchJSON('data/brvm.json'), fetchJSON('data/brvm_ref.json')]);
  let live = null; try { live = await fetchJSON('data/live.json'); } catch (e) { }
  return { history, brvm, ref, live };
}
async function pollLive() {
  try {
    const d = await loadRemote();
    const histChanged = d.history.asof !== HIST.asof || d.history.d.length !== HIST.d.length;
    ingest(d); if (histChanged) { computeStatic(); computeBT(); } else { BR = brvmModel(BRV, REF); }
    renderAll(false); flashGrid();
  } catch (e) { console.warn('poll failed', e); }
}
function ingest(d) {
  HIST = d.history; BRV = d.brvm; REF = d.ref; LIVE = d.live || null;
  M = buildMarket(HIST); MK = HIST.mk;
}
function computeStatic() {
  const t0 = performance.now();
  R.ku = kuramoto(M, MK); R.an = analogMatch(M, MK); R.by = bayes(M, R.ku.R); R.tp = tapePressure(M); R.mem = membrane(M);
  R.pe = permEntropy(Array.from(M.lr.slice(M.n - 64))); BR = brvmModel(BRV, REF);
  const pk = R.an.pick; R.an.mfe = U.q(pk.map(p => Math.max(...p.fwd)).sort((a, b) => a - b), .5); R.an.mae = U.q(pk.map(p => Math.min(...p.fwd)).sort((a, b) => a - b), .5);
  R.staticMs = performance.now() - t0;
}
function computeBT() {
  const t0 = performance.now();
  const P = S.P; R.bt = runBacktest(M, P); R.lb = leaderboard(M, P);
  const bt = R.bt; const pB = { ...P, strat: 'bh', lev: 1 };
  R.eps = { s: ddEpisodes(bt.eq, bt.s0, bt.s1), q: ddEpisodes(bt.bh, bt.s0, bt.s1), x: ddEpisodes(bt.bh3, bt.s0, bt.s1) };
  R.km = { s: kaplanMeier(R.eps.s), q: kaplanMeier(R.eps.q), x: kaplanMeier(R.eps.x) };
  runMC();
  R.btMs = performance.now() - t0;
}
function runMC() { R.mc = monteCarlo(R.bt.st.rets, { H: S.H, N: 1000, block: +S.P.block || 20, ruin: (+S.P.ruin || 50) / 100, seed: S.seed }); S.reveal = RM ? 1 : 0; }

/* ================================================================== live feed (artifact db, written by the sync task) */
const FEED = { daily: false };
function mergeDaily(doc) {
  const rows = (doc && doc.rows) || []; let added = 0;
  for (const r of rows) {
    if (!r || !r.d || r.d <= HIST.d[HIST.d.length - 1] || !(r.c > 0)) continue;
    HIST.d.push(r.d); HIST.o.push(r.o ?? r.c); HIST.h.push(r.h ?? r.c); HIST.l.push(r.l ?? r.c); HIST.c.push(r.c); HIST.v.push(r.v || 0); HIST.div.push(r.div || 0);
    for (const k of Object.keys(HIST.mk)) { const a = HIST.mk[k]; const v = r.mk && r.mk[k] != null ? r.mk[k] : a[a.length - 1]; a.push(v ?? null); }
    added++;
  }
  if (added) HIST.asof = HIST.d[HIST.d.length - 1];
  return added > 0;
}
let applyT = null;
function scheduleApply() {
  clearTimeout(applyT);
  applyT = setTimeout(() => {
    if (FEED.daily) { FEED.daily = false; M = buildMarket(HIST); MK = HIST.mk; computeStatic(); computeBT(); } else BR = brvmModel(BRV, REF);
    PARTS = null; renderAll(false); flashGrid();
  }, 300);
}
async function initFeed() {
  if (!window.claude || !window.claude.use) return;
  let db = null; try { db = await window.claude.use('db'); } catch (e) { }
  if (!db) return;
  const sub = (id, fn) => { try { db.doc('feed/' + id).onSnapshot(snap => { if (!snap.exists) return; if (fn(snap.data())) scheduleApply(); }, e => console.warn('feed/' + id, e && e.code)); } catch (e) { } };
  sub('daily', d => { if (mergeDaily(d)) { FEED.daily = true; return true; } return false; });
  sub('live', d => { if (d && d.qqq && (!LIVE || (d.ts || 0) > (LIVE.ts || 0))) { LIVE = d; return true; } return false; });
  sub('brvm', d => { if (d && d.rows && d.rows.length >= 40 && (!BRV || d.asof > BRV.asof || (d.ts || 0) > (BRV.ts || 0))) { BRV = d; return true; } return false; });
}
function toast(msg, ms = 7000) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
async function initSync() {
  if (!/^trig_/.test(TRIGGER_ID) || !window.claude || !window.claude.use) return;
  let mcp = null; try { mcp = await window.claude.use('mcp'); } catch (e) { }
  if (!mcp) return;
  const b = $('syncBtn'); b.hidden = false;
  b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = '… SYNC';
    try {
      await mcp.callTool('Claude Code Remote', 'fire_trigger', { trigger_id: TRIGGER_ID }, { cache: false });
      toast('Synchronisation lancée : les cours du dernier relevé GitHub (15 min) arrivent dans 2 à 4 minutes, sans recharger la page.', 9000);
      b.textContent = '✓ SYNC';
    } catch (e) {
      const c = e && e.code; b.textContent = '⟳ SYNC';
      toast(c === 'rate_limited' ? 'Trop de demandes rapprochées : réessaie dans quelques minutes.'
        : c === 'not_granted' || c === 'consent_required' ? "Autorisation refusée : ouvre le menu Autorisations de la page pour permettre la synchro."
        : c === 'server_not_connected' || c === 'server_not_found' ? "Le connecteur Claude Code Remote n'est pas disponible sur ce compte."
        : 'La synchro n’a pas pu être lancée (' + (c || 'erreur') + '). La mise à jour planifiée tourne quand même.', 9000);
    } finally { setTimeout(() => { b.disabled = false; b.textContent = '⟳ SYNC'; }, 60000); }
  });
}

/* ================================================================== header / rank / tape */
function liveState() {
  if (!LIVE || !LIVE.qqq) return null;
  const age = Date.now() / 1000 - (LIVE.ts || 0);
  return { ...LIVE.qqq, fresh: age < 40 * 60, age };
}
function renderHeader() {
  const L = liveState(), st = $('status');
  if (L && L.fresh && L.state === 'REGULAR') { st.classList.remove('eod'); $('statusTxt').textContent = 'LIVE ·'; $('statusSub').textContent = 'FEED 15M'; }
  else if (L) { st.classList.add('eod'); $('statusTxt').textContent = (L.state || 'EOD') + ' ·'; $('statusSub').textContent = 'MAJ ' + new Date((LIVE.ts || 0) * 1000).toISOString().slice(11, 16) + ' UTC'; }
  else { st.classList.add('eod'); $('statusTxt').textContent = 'EOD ·'; $('statusSub').textContent = dshort(M.d[M.n - 1]) + ' ' + M.d[M.n - 1].slice(0, 4); }
  $('lat').textContent = Math.max(1, Math.round(R.btMs)) + 'MS';
  $('barn').textContent = '#' + nf0.format(M.n);
  $('fitLab').textContent = S.bars >= 2500 ? 'ALL' : S.bars + (S.tf === '5M' ? '×5M' : S.tf === '1W' ? 'W' : 'D');
}
function clock() { const tick = () => { const d = new Date(); $('clock').textContent = d.toISOString().slice(11, 19); }; tick(); setInterval(tick, 1000); }
function renderRank() {
  const lb = R.lb, me = lb.findIndex(x => x.k === S.P.strat) + 1, bt = R.bt;
  const out = bt.st.final - bt.stB.final;
  const trophy = `<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v3h4v3a5 5 0 0 1-5 5h-.3A6 6 0 0 1 13 16.9V19h4v2H7v-2h4v-2.1A6 6 0 0 1 8.3 14H8a5 5 0 0 1-5-5V6h4V3zm0 5H5v1a3 3 0 0 0 2 2.8V8zm12 0h-2v3.8A3 3 0 0 0 19 9V8z"/></svg>`;
  $('rank').innerHTML = `<span class="trophy">${trophy}#${me} / ${lb.length} STRATS</span>
    <span>SHARPE <b style="color:var(--amber)">${bt.st.sharpe.toFixed(2)}</b></span><span class="sep">·</span>
    <span class="hide-m">BEATING ${lb.length - me} STRATÉGIES</span><span class="sep hide-m">·</span>
    <span class="g">▲ CAGR ${pct(bt.st.cagr)} / AN</span><span class="sep">·</span>
    <span class="hide-m">${out >= 0 ? 'OUT-PERFORMING' : 'UNDER-PERFORMING'} QQQ B&amp;H BY ${usd(Math.abs(out)).replace('$', '$')}</span>
    <span class="right">SIM ${S.P.lev}× ≈ ${S.P.lev == 3 ? 'TQQQ' : S.P.lev == 2 ? 'QLD' : 'QQQ'} · DATA ${dfr(M.d[M.n - 1])}</span>`;
}
function renderTape() {
  const items = [];
  const L = liveState(); const qp = L ? L.price : M.c[M.n - 1], qc = L ? L.chg : M.c[M.n - 1] / M.c[M.n - 2] - 1;
  items.push(`<span><b>QQQ</b> ${nf2.format(qp)} <span class="${cls(qc)}">${qc >= 0 ? '▲' : '▼'} ${pct(qc, 2, false)}</span></span>`);
  for (const x of BR.idx) items.push(`<span><b>${x.k}</b> ${x.v.toFixed(2)} <span class="${cls(x.vj)}">${x.vj >= 0 ? '▲' : '▼'} ${pp(x.vj, 2, false)}</span></span>`);
  const rows = BR.rows.slice().sort((a, b) => Math.abs(b.vj) - Math.abs(a.vj));
  for (const r of rows) items.push(`<span><b>${r.t}</b> ${fcfa(r.c)} <span class="${cls(r.vj)}">${r.vj > 0 ? '▲' : r.vj < 0 ? '▼' : '■'} ${pp(r.vj, 2, false)}</span> · VOL ${compact(r.vol)}</span>`);
  const html = items.join('');
  $('tape').innerHTML = html + html;
  $('tapeTag').lastChild.textContent = ' BRVM ' + BR.asof.slice(8, 10) + '/' + BR.asof.slice(5, 7);
}

/* ================================================================== PNL */
let bigCur = 0, bigAnim = null;
function renderPNL(first) {
  const bt = R.bt, st = bt.st, P = S.P;
  $('pid').textContent = bt.id;
  $('psub').textContent = `${STRATS[P.strat].name} · ${P.lev}× · ${P.exec === 'close' ? 'ON-CLOSE' : 'NEXT-OPEN'} · ${dfr(M.d[bt.s0])} → ${dfr(M.d[bt.s1])}`;
  $('pnlSpan').textContent = `BACKTEST PNL · ${st.years.toFixed(1)}Y`;
  const target = st.final; const from = first ? +P.cap : bigCur; const t0 = performance.now(), dur = RM ? 0 : 1100;
  cancelAnimationFrame(bigAnim);
  const step = t => { const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3); bigCur = from + (target - from) * e;
    $('big').innerHTML = '<sup>$</sup>' + nf0.format(Math.round(bigCur)); if (k < 1) bigAnim = requestAnimationFrame(step); };
  bigAnim = requestAnimationFrame(step);
  $('big').classList.toggle('neg', target < P.cap);
  const ld = st.lastDay; $('dbox').textContent = (ld >= 0 ? '▲ +' : '▼ −') + usd(Math.abs(ld)).replace('−', ''); $('dbox').classList.toggle('neg', ld < 0);
  $('dlab').innerHTML = `SETTLED · <b>QQQ ${dshort(M.d[bt.s1])}</b> · ${bt.ex[bt.s1] > 0 ? 'LONG ' + Math.round(bt.ex[bt.s1] * 100) + '%' : 'CASH'}`;
  $('dpct').textContent = pct(st.total, 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  $('kT').textContent = nf0.format(st.trades);
  $('kW').textContent = isFinite(st.win) ? (st.win * 100).toFixed(1) + '%' : '—';
  $('kR').textContent = isFinite(st.rr) ? st.rr.toFixed(2) : '∞';
  $('kS').textContent = st.sharpe.toFixed(2);
  $('eqlab').innerHTML = `EQUITY CURVE · ${st.years.toFixed(1)}Y · <em>LOG</em> <span style="color:var(--dim)">— QQQ B&amp;H</span>`;
  const ruin = (+P.ruin || 50) / 100, risk = Math.min(10, Math.abs(st.ddNow) / ruin * 10);
  $('riskv').textContent = risk.toFixed(1);
  const rb = $('riskb'); rb.textContent = risk < 3 ? 'SAFE' : risk < 6 ? 'WATCH' : 'DANGER'; rb.className = 'bdg ' + (risk < 3 ? 'g' : risk < 6 ? 'a' : 'r');
  $('riskv').style.color = risk < 3 ? 'var(--green)' : risk < 6 ? 'var(--amber)' : 'var(--red)';
  $('riskbox').style.borderColor = risk < 3 ? 'rgba(63,224,138,.35)' : risk < 6 ? 'rgba(246,183,60,.45)' : 'rgba(255,59,85,.5)';
  $('rfill').style.width = (risk * 10) + '%'; $('rmark').style.left = Math.min(99, Math.abs(st.mdd) / ruin * 100) + '%';
  $('rnote').textContent = `DD ACTUEL ${pct(st.ddNow)} · PIRE ${pct(st.mdd)} · SEUIL −${P.ruin}%`;
}
function drawEquity() {
  const g = cv('cv-eq'); if (!g) return; const { x, w, h } = g, bt = R.bt; x.clearRect(0, 0, w, h);
  const s0 = bt.s0, s1 = bt.s1, N = s1 - s0; let lo = Infinity, hi = -Infinity;
  for (let i = s0; i <= s1; i++) { lo = Math.min(lo, bt.eq[i], bt.bh[i]); hi = Math.max(hi, bt.eq[i], bt.bh[i]); }
  lo = Math.log(lo); hi = Math.log(hi); const pad = (hi - lo) * .12; lo -= pad; hi += pad;
  const X = i => 4 + (i - s0) / N * (w - 10), Y = v => h - 4 - (Math.log(v) - lo) / (hi - lo) * (h - 18);
  x.strokeStyle = rgba(C.dim, .25); x.lineWidth = 1; x.setLineDash([2, 3]); x.beginPath();
  for (let i = s0; i <= s1; i += 2) { const px = X(i), py = Y(bt.bh[i]); i === s0 ? x.moveTo(px, py) : x.lineTo(px, py); } x.stroke(); x.setLineDash([]);
  const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, rgba(C.amber, .22)); gr.addColorStop(1, rgba(C.amber, 0));
  x.beginPath(); for (let i = s0; i <= s1; i++) { const px = X(i), py = Y(bt.eq[i]); i === s0 ? x.moveTo(px, py) : x.lineTo(px, py); }
  x.lineTo(X(s1), h); x.lineTo(X(s0), h); x.closePath(); x.fillStyle = gr; x.fill();
  x.beginPath(); for (let i = s0; i <= s1; i++) { const px = X(i), py = Y(bt.eq[i]); i === s0 ? x.moveTo(px, py) : x.lineTo(px, py); }
  x.strokeStyle = C.amber; x.lineWidth = 1.6; x.shadowColor = C.amber; x.shadowBlur = 8; x.stroke(); x.shadowBlur = 0;
  x.fillStyle = C.amber; x.beginPath(); x.arc(X(s1), Y(bt.eq[s1]), 2.6, 0, 7); x.fill();
}

/* ================================================================== QQQ chart */
function chartSeries() {
  const n = M.n, L = liveState();
  if (S.tf === '5M' && LIVE && LIVE.intraday && LIVE.intraday.t && LIVE.intraday.t.length) {
    const I = LIVE.intraday; return { t: I.t.map(s => new Date(s * 1000).toISOString().slice(5, 16).replace('T', ' ')), o: I.o, h: I.h, l: I.l, c: I.c, v: I.v, intra: true };
  }
  let s = { t: M.d.slice(), o: M.o.slice(), h: M.h.slice(), l: M.l.slice(), c: M.c.slice(), v: M.v.slice(), sma200: Array.from(M.sma200), sma50: Array.from(M.sma50), ex: Array.from(R.bt.ex), prov: -1 };
  if (L && L.day && L.day > M.d[n - 1] && L.price) {
    s.t.push(L.day); s.o.push(L.open || L.price); s.h.push(Math.max(L.dayHigh || L.price, L.price)); s.l.push(Math.min(L.dayLow || L.price, L.price)); s.c.push(L.price); s.v.push(L.vol || 0);
    s.sma200.push((M.sma200[n - 1] * 200 - M.c[n - 200] + L.price) / 200); s.sma50.push((M.sma50[n - 1] * 50 - M.c[n - 50] + L.price) / 50); s.ex.push(R.bt.ex[n - 1]); s.prov = s.t.length - 1;
  }
  if (S.tf === '1W') {
    const w = { t: [], o: [], h: [], l: [], c: [], v: [], sma200: [], sma50: [], ex: [] }; let key = null;
    for (let i = 0; i < s.t.length; i++) { const dt = new Date(s.t[i] + 'T12:00:00Z'); const mon = new Date(dt - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
      if (mon !== key) { key = mon; w.t.push(s.t[i]); w.o.push(s.o[i]); w.h.push(s.h[i]); w.l.push(s.l[i]); w.c.push(s.c[i]); w.v.push(s.v[i]); w.sma200.push(s.sma200[i]); w.sma50.push(s.sma50[i]); w.ex.push(s.ex[i]); }
      else { const k = w.t.length - 1; w.h[k] = Math.max(w.h[k], s.h[i]); w.l[k] = Math.min(w.l[k], s.l[i]); w.c[k] = s.c[i]; w.v[k] += s.v[i]; w.sma200[k] = s.sma200[i]; w.sma50[k] = s.sma50[i]; w.ex[k] = s.ex[i]; } }
    w.prov = -1; return w;
  }
  return s;
}
function drawChart() {
  const g = cv('cv-chart'); if (!g) return; const { x, w, h } = g; x.clearRect(0, 0, w, h);
  const s = chartSeries(), len = s.c.length, N = Math.min(S.bars, len), i0 = len - N;
  const padT = 52, padB = 18, padR = 52, volH = (h - padT - padB) * .2, ph = h - padT - padB - volH - 6;
  let lo = Infinity, hi = -Infinity, vmax = 0;
  for (let i = i0; i < len; i++) { lo = Math.min(lo, s.l[i]); hi = Math.max(hi, s.h[i]); vmax = Math.max(vmax, s.v[i]); }
  const span0 = hi - lo;
  for (const arr of [s.sma200, s.sma50]) if (arr) for (let i = i0; i < len; i++) { const v = arr[i]; if (isFinite(v) && v > lo - span0 * .3 && v < hi + span0 * .3) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  const pd = (hi - lo) * .06; lo -= pd; hi += pd;
  const cw = (w - padR - 8) / N, X = i => 6 + (i - i0 + .5) * cw, Y = v => padT + (hi - v) / (hi - lo) * ph;
  S.cl = { i0, N, cw, len, s, X, Y, padR, w, h };
  x.font = FONT(9, 500); x.textAlign = 'left'; x.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); x.strokeStyle = rgba(C.dim, .12); x.lineWidth = 1; x.beginPath(); x.moveTo(0, y); x.lineTo(w - padR, y); x.stroke();
    x.fillStyle = rgba(C.dim, .8); x.fillText(nf2.format(v), w - padR + 6, y); }
  const vb = h - padB;
  for (let i = i0; i < len; i++) { const up = s.c[i] >= s.o[i], vh = vmax ? s.v[i] / vmax * volH : 0;
    x.fillStyle = rgba(up ? C.green : C.red, i === s.prov ? .35 : .55); x.fillRect(X(i) - cw * .36, vb - vh, Math.max(1, cw * .72), vh); }
  const line = (arr, col, lw, dash) => { x.strokeStyle = col; x.lineWidth = lw; x.setLineDash(dash || []); x.beginPath(); let st = false;
    for (let i = i0; i < len; i++) { const v = arr[i]; if (!isFinite(v)) continue; const px = X(i), py = Y(v); st ? x.lineTo(px, py) : (x.moveTo(px, py), st = true); } x.stroke(); x.setLineDash([]); };
  x.save(); x.beginPath(); x.rect(0, padT - 8, w - padR, ph + 14); x.clip();
  if (s.sma50) line(s.sma50, rgba(C.cyan, .55), 1);
  if (s.sma200) { x.shadowColor = C.amber; x.shadowBlur = 6; line(s.sma200, C.amber, 1.5); x.shadowBlur = 0; }
  x.restore();
  if (s.sma200 && isFinite(s.sma200[len - 1]) && (s.sma200[len - 1] < lo || s.sma200[len - 1] > hi)) { const v = s.sma200[len - 1], below = v < lo;
    x.font = FONT(8.5, 800); x.fillStyle = C.amber; x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillText(`SMA200 ${nf2.format(v)} ${below ? '↓' : '↑'} ${pct(v / s.c[len - 1] - 1, 1)}`, w - padR - 6, below ? padT + ph - 4 : padT + 2); }
  for (let i = i0; i < len; i++) {
    const up = s.c[i] >= s.o[i], col = up ? C.green : C.red, px = X(i); x.globalAlpha = i === s.prov ? .5 : 1;
    x.strokeStyle = col; x.lineWidth = 1; x.beginPath(); x.moveTo(px, Y(s.h[i])); x.lineTo(px, Y(s.l[i])); x.stroke();
    const yo = Y(s.o[i]), yc = Y(s.c[i]); x.fillStyle = col; x.fillRect(px - cw * .34, Math.min(yo, yc), Math.max(1, cw * .68), Math.max(1, Math.abs(yc - yo)));
    x.globalAlpha = 1;
  }
  if (s.ex && !s.intra) for (let i = Math.max(i0, 1); i < len; i++) {
    const a = s.ex[i - 1] > 0, b = s.ex[i] > 0; if (a === b) continue; const px = X(i);
    if (b) { const y = Y(s.l[i]) + 10; x.fillStyle = C.green; x.beginPath(); x.moveTo(px, y - 5); x.lineTo(px - 4.5, y + 3); x.lineTo(px + 4.5, y + 3); x.fill(); }
    else { const y = Y(s.h[i]) - 10; x.fillStyle = C.red; x.beginPath(); x.moveTo(px, y + 5); x.lineTo(px - 4.5, y - 3); x.lineTo(px + 4.5, y - 3); x.fill(); }
  }
  const lp = s.c[len - 1], ly = Y(lp); x.strokeStyle = rgba(C.amber, .55); x.setLineDash([2, 3]); x.beginPath(); x.moveTo(0, ly); x.lineTo(w - padR, ly); x.stroke(); x.setLineDash([]);
  const tag = nf2.format(lp); x.font = FONT(10, 800); const tw = x.measureText(tag).width + 12;
  x.fillStyle = C.panel; x.fillRect(w - padR - tw + 2, ly - 9, tw, 18); x.strokeStyle = C.amber; x.lineWidth = 1.5; x.strokeRect(w - padR - tw + 2, ly - 9, tw, 18);
  x.shadowColor = C.amber; x.shadowBlur = 10; x.strokeRect(w - padR - tw + 2, ly - 9, tw, 18); x.shadowBlur = 0;
  x.fillStyle = C.amber; x.textAlign = 'center'; x.fillText(tag, w - padR - tw / 2 + 2, ly + .5);
  x.font = FONT(8.5, 500); x.fillStyle = rgba(C.dim, .9); x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const every = Math.max(1, Math.round(N / 6)); for (let i = len - 1; i >= i0; i -= every) x.fillText(s.intra ? s.t[i].slice(6) : s.t[i].slice(2), X(i), h - 4);
  if (S.hover != null && S.hover >= i0 && S.hover < len) {
    const i = S.hover, px = X(i); x.strokeStyle = rgba(C.txt, .35); x.setLineDash([3, 3]); x.beginPath(); x.moveTo(px, padT - 6); x.lineTo(px, h - padB); x.stroke(); x.setLineDash([]);
    $('xhair').innerHTML = `${s.t[i]} · O <b>${nf2.format(s.o[i])}</b> H <b>${nf2.format(s.h[i])}</b> L <b>${nf2.format(s.l[i])}</b> C <b style="color:${s.c[i] >= s.o[i] ? 'var(--green)' : 'var(--red)'}">${nf2.format(s.c[i])}</b> · V ${compact(s.v[i])}${s.sma200 && isFinite(s.sma200[i]) ? ' · SMA200 ' + nf2.format(s.sma200[i]) : ''}`;
  } else $('xhair').innerHTML = s.intra ? 'INTRADAY 5M · YAHOO' : `SMA200 <b style="color:var(--amber)">${nf2.format(s.sma200[len - 1])}</b> · SMA50 <b style="color:var(--cyan)">${nf2.format(s.sma50[len - 1])}</b> · ▲▼ SIGNAUX ${STRATS[S.P.strat].short}`;
  const prev = s.c[len - 2], chg = lp / prev - 1;
  $('cprice').innerHTML = `$${nf2.format(lp)}<small class="${cls(chg)}">${pct(chg, 2)}</small>`;
  $('chTitle').innerHTML = `QQQ / USD · <span style="color:var(--amber)">${s.intra ? '5M' : S.tf}</span> · $${nf2.format(lp)} <span class="${cls(chg)}">${chg >= 0 ? '▲' : '▼'} ${pct(chg, 2, false)}</span>`;
  const L = liveState(); $('chSrc').textContent = s.intra ? 'INTRADAY · YAHOO' : L && L.fresh ? 'LIVE · YAHOO 15M' : 'EOD · YAHOO';
}
function renderTF() {
  const has5 = LIVE && LIVE.intraday && LIVE.intraday.t && LIVE.intraday.t.length > 10;
  const tfs = (has5 ? ['5M'] : []).concat(['1D', '1W']); if (!tfs.includes(S.tf)) S.tf = '1D';
  $('ctf').innerHTML = tfs.map(t => `<button class="${t === S.tf ? 'on' : ''}" data-tf="${t}">${t}</button>`).join('');
}
function renderLadder() {
  const n = M.n, L = liveState(), px = L && L.price ? L.price : M.c[n - 1];
  const Hh = M.h[n - 1], Ll = M.l[n - 1], Cc = M.c[n - 1], Pp = (Hh + Ll + Cc) / 3;
  let hi52 = 0, lo52 = Infinity, ath = 0; for (let i = 0; i < n; i++) { ath = Math.max(ath, M.h[i]); if (i >= n - 252) { hi52 = Math.max(hi52, M.h[i]); lo52 = Math.min(lo52, M.l[i]); } }
  const c = [{ k: 'R1', v: 2 * Pp - Ll }, { k: 'R2', v: Pp + (Hh - Ll) }, { k: 'R3', v: Hh + 2 * (Pp - Ll) }, { k: 'S1', v: 2 * Pp - Hh }, { k: 'S2', v: Pp - (Hh - Ll) }, { k: 'S3', v: Ll - 2 * (Hh - Pp) },
    { k: 'PIVOT', v: Pp }, { k: 'SMA20', v: M.sma20[n - 1] }, { k: 'SMA50', v: M.sma50[n - 1] }, { k: 'SMA200', v: M.sma200[n - 1] }, { k: 'HI 52S', v: hi52 }, { k: 'LO 52S', v: lo52 }, { k: 'ATH', v: ath }];
  const uniq = []; for (const l of c.sort((a, b) => a.v - b.v)) if (!uniq.some(u => Math.abs(u.v / l.v - 1) < .0004)) uniq.push(l);
  const above = uniq.filter(l => l.v > px).slice(0, 5).reverse(), below = uniq.filter(l => l.v <= px).reverse().slice(0, 5);
  const row = (l, k) => `<div class="lv ${k}"><b>${nf2.format(l.v)}</b><small>${l.k} ${pct(l.v / px - 1, 1)}</small></div>`;
  const d200 = px / M.sma200[n - 1] - 1;
  $('ladder').innerHTML = `<div class="lh"><span>KEY LEVELS</span><span>DIST</span></div>${above.map(l => row(l, 'r')).join('')}
    <div class="spread"><span>Δ SMA200</span><b>${pct(d200, 1)}</b></div>${below.map(l => row(l, 'g')).join('')}`;
}

/* ================================================================== BRVM grid */
const MODES = [{ k: 'vj', l: 'JOUR' }, { k: 'ytd', l: 'YTD' }, { k: 'yld', l: 'RDT' }, { k: 'per', l: 'PER' }, { k: 'score', l: 'SCORE' }, { k: 'table', l: 'TABLE' }];
function cellState(r, m) {
  const v = m === 'vj' ? r.vj : m === 'ytd' ? r.ytd : m === 'yld' ? (r.fresh ? r.yld : 0) : m === 'per' ? r.per : r.score;
  if (v == null || !isFinite(v)) return 's-0';
  if (m === 'vj') return v >= 2 ? 's-up2' : v > 0 ? 's-up1' : v === 0 ? 's-0' : v > -2 ? 's-dn1' : 's-dn2';
  if (m === 'ytd') return v >= 60 ? 's-up2' : v > 0 ? 's-up1' : v > -10 ? 's-dn1' : 's-dn2';
  if (m === 'yld') return v >= 7 ? 's-up2' : v >= 5 ? 's-up1' : v >= 3 ? 's-0' : 's-dn1';
  if (m === 'per') return v < 10 ? 's-up2' : v < 15 ? 's-up1' : v < 20 ? 's-0' : v < 40 ? 's-dn1' : 's-dn2';
  return v >= 70 ? 's-up2' : v >= 55 ? 's-up1' : v >= 40 ? 's-0' : v >= 25 ? 's-dn1' : 's-dn2';
}
function metric(r, m) { return m === 'vj' ? r.vj : m === 'ytd' ? r.ytd : m === 'yld' ? (r.yld || 0) : m === 'per' ? (r.per == null || r.per <= 0 ? null : -r.per) : r.score; }
function renderGrid() {
  const m = S.mode === 'table' ? 'score' : S.mode;
  $('gUp').textContent = 'HAUSSE ' + BR.upN; $('gDn').textContent = 'BAISSE ' + BR.dnN;
  const ix = BR.idx; const c0 = ix[0], c1 = ix[1];
  $('gSub').innerHTML = `${c0.k} <b>${c0.v.toFixed(2)}</b> <span class="${cls(c0.vj)}">${pp(c0.vj)}</span> · YTD <span class="${cls(c0.ytd)}">${pp(c0.ytd, 1)}</span> · ${c1.k} <b>${c1.v.toFixed(2)}</b> · CAPI <b>${(BR.capA / 1e12).toFixed(2)}</b> K MDS · ${BR.session.toUpperCase()}`;
  $('gModes').innerHTML = MODES.map(x => `<button class="chip ${S.mode === x.k ? 'on' : ''}" data-mode="${x.k}">${x.l}</button>`).join('');
  if (S.mode === 'table') { $('bgrid').hidden = true; $('btable').hidden = false; renderTable(); return; }
  $('bgrid').hidden = false; $('btable').hidden = true;
  const rows = BR.rows.slice().sort((a, b) => { const A = metric(a, m), B = metric(b, m); return (B == null ? -1e9 : B) - (A == null ? -1e9 : A); });
  const absMax = Math.max(...rows.map(r => Math.abs(metric(r, m) || 0)), 1e-9);
  $('bgrid').innerHTML = rows.map(r => {
    let main, foot;
    if (m === 'vj') { main = fcfa(r.c); foot = `<b class="${cls(r.vj)}">${pp(r.vj)}</b>`; }
    else if (m === 'ytd') { main = pp(r.ytd, 0); foot = fcfa(r.c); }
    else if (m === 'yld') { main = r.yld != null ? r.yld.toFixed(1) + '%' : '—'; foot = r.per ? 'PER ' + r.per.toFixed(1) : '—'; }
    else if (m === 'per') { main = r.per != null ? r.per.toFixed(1) : '—'; foot = r.yld != null ? 'RDT ' + r.yld.toFixed(1) + '%' : '—'; }
    else { main = r.score; foot = '#' + r.rank; }
    const bw = Math.min(100, Math.abs(metric(r, m) || 0) / absMax * 100);
    return `<button class="cell ${cellState(r, m)}" data-t="${r.t}" title="${esc(r.n)}"><span class="ct"><span>${r.t}</span><span>${r.cty}</span></span><span class="cv">${main}</span><span class="cb"><i style="width:${bw}%"></i></span><span class="cf"><span>${r.noTrade ? 'S/T' : compact(r.vol)}</span>${foot}</span></button>`;
  }).join('');
}
function flashGrid() { if (RM) return; [...document.querySelectorAll('.cell')].forEach((c, i) => setTimeout(() => { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }, i * 18)); }
function renderTable() {
  const cols = [['t', 'TICKER'], ['n', 'NOM'], ['sec', 'SECT'], ['cty', 'PAYS'], ['c', 'COURS'], ['vj', 'VAR J'], ['ytd', 'YTD'], ['yld', 'RDT'], ['per', 'PER'], ['div', 'DIV NET'], ['divd', 'PAIEMENT'], ['vol', 'VOL'], ['score', 'SCORE']];
  const { k, dir } = S.sort;
  const rows = BR.rows.slice().sort((a, b) => { const A = a[k], B = b[k]; if (A == null) return 1; if (B == null) return -1; return (typeof A === 'string' ? A.localeCompare(B) : A - B) * dir; });
  $('btable').innerHTML = `<table><thead><tr>${cols.map(([c, l]) => `<th data-k="${c}" class="${c === k ? 'on' : ''}">${l}${c === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr data-t="${r.t}">
    <td><b>${r.t}</b></td><td>${esc(r.n)}</td><td>${r.sec}</td><td>${r.cty}</td><td><b>${fcfa(r.c)}</b></td><td class="${cls(r.vj)}">${pp(r.vj)}</td><td class="${cls(r.ytd)}">${pp(r.ytd, 1)}</td>
    <td style="${r.fresh ? '' : 'color:var(--dim)'}">${r.yld != null ? r.yld.toFixed(2) + '%' + (r.fresh ? '' : '*') : '—'}</td><td>${r.per != null ? r.per.toFixed(1) : '—'}</td><td>${r.div != null ? fcfa(r.div) : '—'}</td><td>${r.divd ? dfr(r.divd) : '—'}</td><td>${compact(r.vol)}</td><td style="color:var(--amber)"><b>${r.score}</b></td></tr>`).join('')}</tbody></table>`;
}
function openStock(t) {
  const r = BR.rows.find(x => x.t === t); if (!r) return;
  $('mTitle').textContent = `${r.t} · ${r.n}`;
  $('mSub').textContent = `${(BR.sectors[r.sec] || r.sec).toUpperCase()} · ${(CTY[r.cty] || r.cty).toUpperCase()} · SÉANCE ${dfr(BR.asof)}`;
  const notes = [];
  if (r.noTrade) notes.push('Aucune transaction sur la séance : cours = cours de référence.');
  if (r.div != null && !r.fresh) notes.push(`Dernier dividende ancien (${r.divd ? dfr(r.divd) : '—'}) : rendement exclu du score.`);
  if (r.per != null && r.per > 60) notes.push('PER très élevé : bénéfice faible ou exceptionnel, à vérifier dans les comptes.');
  if (r.yld != null && r.yld > 20) notes.push('Rendement exceptionnel (dividende non récurrent probable).');
  if (r.ytd == null) notes.push('Introduction récente : pas de variation annuelle de référence.');
  $('mBody').innerHTML = `
    <div class="mprice"><b>${fcfa(r.c)} <small style="font-size:13px;color:var(--dim)">FCFA</small></b><span class="${cls(r.vj)}" style="font-weight:800">${pp(r.vj)}</span><span style="color:var(--dim)">YTD <b class="${cls(r.ytd)}">${pp(r.ytd, 1)}</b></span></div>
    <div class="mkv">
      <div><span>VEILLE</span><b>${fcfa(r.prev)}</b></div><div><span>OUVERTURE</span><b>${r.o ? fcfa(r.o) : '—'}</b></div><div><span>VOLUME</span><b>${fcfa(r.vol)}</b></div>
      <div><span>VALEUR ÉCHANGÉE</span><b>${compact(r.val)}</b></div><div><span>DIVIDENDE NET</span><b>${r.div != null ? fcfa(r.div) : '—'}</b></div><div><span>PAIEMENT</span><b>${r.divd ? dfr(r.divd) : '—'}</b></div>
      <div><span>RENDEMENT</span><b style="color:${r.fresh ? 'var(--green)' : 'var(--dim)'}">${r.yld != null ? r.yld.toFixed(2) + '%' : '—'}</b></div><div><span>PER</span><b>${r.per != null ? r.per.toFixed(1) : '—'}</b></div><div><span>PAYS</span><b>${r.cty}</b></div>
    </div>
    <div class="score"><div><div style="font-size:9px;color:var(--dim);letter-spacing:.14em">QUANT SCORE</div><div class="sv">${r.score}<small style="font-size:12px;color:var(--dim)">/100</small></div><div style="font-size:10px;color:var(--dim)">RANG #${r.rank} / ${BR.rows.length}</div></div>
      <div class="sbars">${[['RENDEMENT', r.sc.y], ['VALORISATION', r.sc.v], ['MOMENTUM YTD', r.sc.m], ['LIQUIDITÉ', r.sc.l]].map(([l, v]) => `<div><span>${l}</span><span class="sb"><i style="width:${Math.round(v * 100)}%"></i></span><span>${Math.round(v * 100)}</span></div>`).join('')}</div></div>
    <div class="sim"><span>INVESTIR</span><input id="simIn" type="number" value="1000000" step="50000" min="0" aria-label="Montant en FCFA"><span>FCFA →</span><span id="simOut"></span></div>
    ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}
    <div class="note">Source : ${esc(BR.src)}. Rendement et PER recalculés au cours affiché.</div>`;
  const sim = () => { const a = +$('simIn').value || 0, q = Math.floor(a / r.c), dv = r.div && r.fresh ? q * r.div : 0;
    $('simOut').innerHTML = `<b>${fcfa(q)}</b> titres · dividende net annuel ≈ <b>${fcfa(dv)}</b> FCFA${r.div && !r.fresh ? ' (pas de dividende récent)' : ''}`; };
  $('simIn').addEventListener('input', sim); sim();
  $('modal').classList.add('on'); $('scrim').classList.add('on'); $('mClose').focus();
}
function closeOverlays() { $('modal').classList.remove('on'); $('drawer').classList.remove('open'); $('scrim').classList.remove('on'); }

/* ================================================================== survival */
function drawSurvival() {
  const g = cv('cv-surv'); if (!g) return; const { x, w, h } = g; x.clearRect(0, 0, w, h);
  const pl = 34, pr = 8, pt = 8, pb = 26, W = w - pl - pr, Hh = h - pt - pb;
  const all = [...R.eps.s, ...R.eps.q, ...R.eps.x].map(e => e.dur).sort((a, b) => a - b); const tMax = Math.max(40, U.q(all, .95) * 1.1);
  const X = t => pl + Math.min(1, t / tMax) * W, Y = s => pt + (1 - s) * Hh;
  x.font = FONT(8.5, 500); x.textBaseline = 'middle'; x.textAlign = 'right';
  for (const s of [0, .25, .5, .75, 1]) { x.strokeStyle = rgba(C.dim, .12); x.beginPath(); x.moveTo(pl, Y(s)); x.lineTo(w - pr, Y(s)); x.stroke(); x.fillStyle = rgba(C.dim, .85); x.fillText(Math.round(s * 100) + '%', pl - 5, Y(s)); }
  x.textAlign = 'center'; x.textBaseline = 'alphabetic'; const step = tMax > 300 ? 100 : tMax > 120 ? 50 : 20;
  for (let t = 0; t <= tMax; t += step) x.fillText(t + 'J', X(t), h - 13);
  const path = (km) => { x.beginPath(); x.moveTo(X(0), Y(1)); let s = 1; for (const p of km) { x.lineTo(X(p.t), Y(s)); x.lineTo(X(p.t), Y(p.S)); s = p.S; } x.lineTo(X(tMax), Y(s)); return s; };
  const area = (km, col, a) => { path(km); x.lineTo(X(tMax), Y(0)); x.lineTo(X(0), Y(0)); x.closePath(); const gr = x.createLinearGradient(0, pt, 0, pt + Hh); gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, a * .25)); x.fillStyle = gr; x.fill(); };
  area(R.km.q, C.red, .45); x.strokeStyle = C.red; x.lineWidth = 1.3; path(R.km.q); x.stroke();
  x.setLineDash([3, 3]); x.strokeStyle = C.orange; x.lineWidth = 1.3; path(R.km.x); x.stroke(); x.setLineDash([]);
  area(R.km.s, C.green, .5); x.strokeStyle = C.green; x.lineWidth = 1.8; x.shadowColor = C.green; x.shadowBlur = 6; path(R.km.s); x.stroke(); x.shadowBlur = 0;
  const p50 = kmQuantile(R.km.s, .5);
  if (isFinite(p50)) { const px = X(p50); x.strokeStyle = rgba(C.amber, .8); x.setLineDash([2, 3]); x.beginPath(); x.moveTo(px, pt); x.lineTo(px, pt + Hh); x.stroke(); x.setLineDash([]);
    const lab = 'P50 · ' + p50 + 'J'; x.font = FONT(8.5, 800); const tw = x.measureText(lab).width + 10; x.fillStyle = rgba(C.green, .2); x.strokeStyle = C.green; x.fillRect(px + 4, Y(.5) - 8, tw, 15); x.strokeRect(px + 4, Y(.5) - 8, tw, 15);
    x.fillStyle = C.green; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(lab, px + 9, Y(.5)); }
  x.textBaseline = 'middle'; x.textAlign = 'left'; x.font = FONT(8.5, 800); let lx = pl + 6; const ly = h - 5;
  for (const [l, c] of [['● STRAT', C.green], ['● QQQ B&H', C.red], ['● 3× B&H', C.orange]]) { x.fillStyle = c; x.fillText(l, lx, ly); lx += x.measureText(l).width + 12; }
  const q = (km, p) => { const v = kmQuantile(km, p); return isFinite(v) ? v + 'J' : '>' + Math.round(tMax) + 'J'; };
  $('sP50').textContent = 'P50 ' + q(R.km.s, .5); $('sP90').textContent = 'P90 ' + q(R.km.s, .9); $('sNow').textContent = 'DD ' + pct(R.bt.st.ddNow);
  const mx = a => a.length ? Math.max(...a.map(e => e.dur)) : 0, bar = (v, m, c) => `<span class="bar"><i style="width:${Math.min(100, v / m * 100)}%;background:${c}"></i></span>`;
  const mm = Math.max(mx(R.eps.s), mx(R.eps.q), mx(R.eps.x), 1);
  $('sstats').innerHTML = `<div><span>STRAT MED</span><b style="color:var(--green)">${q(R.km.s, .5)}</b></div>${bar(kmQuantile(R.km.s, .5), mm, 'var(--green)')}
    <div><span>QQQ MED</span><b style="color:var(--red)">${q(R.km.q, .5)}</b></div>${bar(kmQuantile(R.km.q, .5), mm, 'var(--red)')}
    <div><span>3× MED</span><b style="color:var(--orange)">${q(R.km.x, .5)}</b></div>${bar(kmQuantile(R.km.x, .5), mm, 'var(--orange)')}
    <div><span>MAX STRAT</span><b>${mx(R.eps.s)}J</b></div><div><span>ÉPISODES</span><b>${R.eps.s.length}</b></div>
    <div><span>PIRE DD</span><b style="color:var(--red)">${pct(R.bt.st.mdd, 0)}</b></div><div><span>EN COURS</span><b>${R.eps.s.some(e => e.cens) ? R.eps.s.find(e => e.cens).dur + 'J' : '—'}</b></div>`;
}

/* ================================================================== aurora */
function drawAurora(t = 0) {
  const g = cv('cv-aurora'); if (!g) return; const { x, w, h } = g; x.clearRect(0, 0, w, h);
  const rows = R.tp.rows, N = rows.length, pl = 4, pr = 4, W = w - pl - pr, X = k => pl + k / (N - 1) * W;
  const yTop = 2, yB = h * .58, bandTop = h * .70, bandBot = h - 15;
  let vmax = 0; for (const r of rows) vmax = Math.max(vmax, r.buy, r.sell); const ema = (arr, a) => { let e = arr[0]; return arr.map(v => e = a * v + (1 - a) * e); };
  const sell = rows.map(r => r.sell / vmax), buy = rows.map(r => r.buy / vmax), sellS = ema(sell, .35), buyS = ema(buy, .35);
  // sell curtain
  const curtain = (arr, a) => { x.beginPath(); x.moveTo(X(0), yTop); for (let k = 0; k < N; k++) x.lineTo(X(k), yTop + Math.pow(arr[k], .8) * (yB - yTop) * .95); x.lineTo(X(N - 1), yTop); x.closePath();
    const gr = x.createLinearGradient(0, yTop, 0, yB); gr.addColorStop(0, rgba(C.red, a)); gr.addColorStop(.7, rgba(C.red2, a * .55)); gr.addColorStop(1, rgba(C.red2, 0)); x.fillStyle = gr; x.fill(); };
  curtain(sellS, .55); curtain(sell, .75);
  x.strokeStyle = rgba(C.red, .9); x.lineWidth = 1; x.beginPath(); for (let k = 0; k < N; k++) { const y = yTop + Math.pow(sell[k], .8) * (yB - yTop) * .95; k ? x.lineTo(X(k), y) : x.moveTo(X(k), y); } x.stroke();
  // buy rise
  const rise = (arr, a) => { x.beginPath(); x.moveTo(X(0), bandTop); for (let k = 0; k < N; k++) x.lineTo(X(k), bandTop - Math.pow(arr[k], .8) * (bandTop - yTop) * .55); x.lineTo(X(N - 1), bandTop); x.closePath();
    const gr = x.createLinearGradient(0, yB - 40, 0, bandTop); gr.addColorStop(0, rgba(C.green, a)); gr.addColorStop(1, rgba(C.green2, a * .5)); x.fillStyle = gr; x.fill(); };
  rise(buyS, .35); rise(buy, .45);
  // volume spikes
  const spikes = rows.map((r, k) => ({ k, vz: r.vz })).filter(s => s.vz > 2);
  for (const s of spikes) { const px = X(s.k), top = yTop + Math.max(0, 1 - s.vz / 6) * (yB - yTop) * .5; const gr = x.createLinearGradient(0, top, 0, bandTop); gr.addColorStop(0, rgba(C.white, .95)); gr.addColorStop(.5, rgba(C.green, .8)); gr.addColorStop(1, rgba(C.green, .2));
    x.strokeStyle = gr; x.lineWidth = 2; x.shadowColor = C.green; x.shadowBlur = 8; x.beginPath(); x.moveTo(px, bandTop); x.lineTo(px, top); x.stroke(); x.shadowBlur = 0; }
  // CVD
  const cv0 = rows.map(r => r.cvd), cmin = Math.min(...cv0), cmax = Math.max(...cv0);
  x.strokeStyle = rgba(C.green, .9); x.lineWidth = 1.2; x.beginPath(); for (let k = 0; k < N; k++) { const y = yB + 18 - (cv0[k] - cmin) / (cmax - cmin || 1) * (h * .3); k ? x.lineTo(X(k), y) : x.moveTo(X(k), y); } x.stroke();
  // balance line + pulse
  x.strokeStyle = C.amber; x.lineWidth = 2; x.shadowColor = C.amber; x.shadowBlur = 10; x.beginPath(); x.moveTo(X(0), yB); x.lineTo(X(N - 1), yB); x.stroke(); x.shadowBlur = 0;
  const pulse = 3 + 2 * Math.sin(t / 300); x.fillStyle = C.amber; x.shadowColor = C.amber; x.shadowBlur = 16; x.beginPath(); x.arc(X(N - 1) - 2, yB, pulse, 0, 7); x.fill(); x.shadowBlur = 0;
  // regime band
  x.fillStyle = rgba(C.cyan, .55); x.fillRect(pl, bandTop, W, bandBot - bandTop); x.fillStyle = rgba(C.cyan, .95); x.fillRect(pl, bandTop, W, 2);
  const chop = ema(rows.map(r => isFinite(r.er) ? Math.max(0, (.3 - r.er) / .3) : 0), .15);
  x.beginPath(); x.moveTo(X(0), bandTop + 2); for (let k = 0; k < N; k++) x.lineTo(X(k), bandTop + 2 + chop[k] * (bandBot - bandTop - 4)); x.lineTo(X(N - 1), bandTop + 2); x.closePath();
  const mg = x.createLinearGradient(0, bandTop, 0, bandBot); mg.addColorStop(0, rgba(C.magenta, .95)); mg.addColorStop(1, rgba(C.magenta, .6)); x.fillStyle = mg; x.fill();
  // annotations
  x.font = FONT(8.5, 800); x.textBaseline = 'middle';
  const big = rows.reduce((b, r, k) => r.dollar > b.v ? { v: r.dollar, k, r } : b, { v: 0 });
  const lab = `${big.r.clv >= 0 ? 'BUY' : 'SELL'} $${compact(big.v)}`; const tw = x.measureText(lab).width + 10; const bx = U.clamp(X(big.k) - tw / 2, 2, w - tw - 2);
  x.fillStyle = rgba('#000000', .75); x.fillRect(bx, yTop + 6, tw, 15); x.strokeStyle = rgba(C.txt, .5); x.strokeRect(bx, yTop + 6, tw, 15); x.fillStyle = '#fff'; x.textAlign = 'left'; x.fillText(lab, bx + 5, yTop + 13.5);
  for (const s of spikes.sort((a, b) => b.vz - a.vz).slice(0, 3)) { const l = '+' + s.vz.toFixed(1) + 'σ'; const tw2 = x.measureText(l).width + 8; const lx = U.clamp(X(s.k) - tw2 / 2, 2, w - tw2 - 2);
    x.fillStyle = rgba(C.red2, .85); x.fillRect(lx, bandTop - 18, tw2, 13); x.fillStyle = '#fff'; x.fillText(l, lx + 4, bandTop - 11.5); }
  x.font = FONT(8, 500); x.fillStyle = rgba(C.dim, .95); x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  for (let k = 0; k < N; k += 40) x.fillText(dshort(rows[k].d), X(k), h - 3);
  const c20 = R.tp.cvd20; $('aCvd').textContent = 'CVD 20J ' + (c20 >= 0 ? '+' : '') + compact(c20); $('aCvd').className = 'bdg ' + (c20 >= 0 ? 'g' : 'r');
  const reg = R.tp.er > .3 ? 'TREND' : 'CHOP'; $('aReg').textContent = 'REGIME ' + reg; $('aEr').textContent = `ER ${R.tp.er.toFixed(2)} · ${reg}`;
}

/* ================================================================== membrane */
function drawMembrane(t = 0) {
  const g = cv('cv-mem'); if (!g) return; const { x, w, h } = g; x.clearRect(0, 0, w, h);
  const m = R.mem, rows = m.rows, RN = rows.length, T = m.T;
  if (!m.zs) m.zs = rows.map(r => { const sd = U.std(r.z) || 1; return r.z.map(v => U.clamp(v / sd, -2.6, 2.6)); });
  const amp = Math.min(13, h * .05), x0 = 40, baseY = h - 40 - 2.3 * amp, dxT = w * .13, dyT = (baseY - 18 - 2.4 * amp) * .92, W0 = w - x0 - dxT - 16;
  const P = (r, k) => { const f = r / (RN - 1), sc = 1 - .1 * f; return [x0 + f * dxT + k / (T - 1) * W0 * sc, baseY - f * dyT - m.zs[r][k] * amp * (1 - .3 * f)]; };
  const scan = RM ? -1 : ((t / 45) % (T + 30)) - 15;
  x.font = FONT(7.5, 600); x.textBaseline = 'middle';
  for (let r = RN - 1; r >= 0; r--) {
    const f = r / (RN - 1), by = baseY - f * dyT; const pts = []; for (let k = 0; k < T; k++) pts.push(P(r, k));
    x.beginPath(); x.moveTo(pts[0][0], by + 6); for (const p of pts) x.lineTo(p[0], p[1]); x.lineTo(pts[T - 1][0], by + 6); x.closePath(); x.fillStyle = rgba(C.panel, .78); x.fill();
    if (r < RN - 1) for (let k = 0; k < T; k += 5) { const a = pts[k], b = P(r + 1, k); x.strokeStyle = rgba(rows[r].z[k] >= 0 ? C.green : C.red, .12); x.lineWidth = 1; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); }
    for (let k = 1; k < T; k++) { const z = rows[r].z[k], hl = Math.abs(k - scan) < 4; const col = z >= 0 ? (r % 3 === 0 ? C.cyan : C.green) : (r % 3 === 0 ? C.magenta : C.red);
      x.strokeStyle = hl ? rgba(C.white, .95) : rgba(col, .35 + .55 * (1 - f)); x.lineWidth = hl ? 1.6 : 1 + (1 - f) * .6; x.beginPath(); x.moveTo(pts[k - 1][0], pts[k - 1][1]); x.lineTo(pts[k][0], pts[k][1]); x.stroke(); }
    if (r % 5 === 0) { x.fillStyle = rgba(C.dim, .95); x.textAlign = 'right'; x.fillText(rows[r].h + 'J', pts[0][0] - 5, by); }
  }
  x.strokeStyle = rgba(C.white, .85); x.lineWidth = 2; x.beginPath(); x.moveTo(x0, baseY + 4); x.lineTo(x0 + W0, baseY + 4); x.stroke();
  const lp = P(0, T - 1); x.fillStyle = C.amber; x.shadowColor = C.amber; x.shadowBlur = 14; x.beginPath(); x.arc(lp[0], lp[1], 3, 0, 7); x.fill(); x.shadowBlur = 0;
  const bx = x0, bw = w * .38, bh = 22, byy = h - 26; x.fillStyle = rgba(C.dim, .9); x.textAlign = 'left'; x.fillText('VOL RÉALISÉE 20J', bx, byy - 5);
  const vmax = Math.max(...m.vb.filter(isFinite)); const n = m.vb.length;
  for (let k = 0; k < n; k++) { const v = m.vb[k]; if (!isFinite(v)) continue; const hh = v / vmax * bh; x.fillStyle = rgba(v > .3 ? C.red : C.green, .7); x.fillRect(bx + k / n * bw, byy + bh - hh, Math.max(1, bw / n - .4), hh); }
  x.textAlign = 'right'; x.font = FONT(9, 700); x.fillStyle = C.txt; const rx = w - 10;
  x.fillText(`σ20 ${(m.v20 * 100).toFixed(1)}%`, rx, h - 20); x.fillStyle = C.dim; x.fillText(`σ60 ${(m.v60 * 100).toFixed(1)}%`, rx, h - 7); x.fillText(`DISP ${m.disp.toFixed(2)}`, rx - 96, h - 7);
  x.fillStyle = m.drive >= 0 ? C.green : C.red; x.fillText(`DRIVE ${m.drive >= 0 ? '+' : ''}${m.drive.toFixed(2)}σ`, rx - 96, h - 20);
  $('mAlign').textContent = `ALIGN ${Math.round(m.align * 100)}%`; const ms = $('mState'); ms.textContent = 'STATE ' + m.state; ms.className = 'bdg ' + (m.state === 'STRESSED' || m.state === 'BEARISH' ? 'r' : m.state === 'TRENDING' ? 'g' : 'a');
  $('mDrive').textContent = `${m.pos}/${RN} HORIZONS > 0`;
}

/* ================================================================== vortex */
let PARTS = null;
function initParticles() { const rng = U.rng(42), mk = R.ku.mk; PARTS = [];
  for (let i = 0; i < 760; i++) { const m = mk[i % mk.length]; const g = () => { let s = 0; for (let k = 0; k < 4; k++) s += rng(); return (s - 2) / 2; };
    PARTS.push({ m, r: .3 + Math.pow(rng(), .7) * .7, a: m.th + g() * (1.2 + (1 - R.ku.r) * 2.2), sp: .4 + rng() * .5, len: .08 + rng() * .25 }); } }
function renderVortex() {
  const K = R.ku, mk = K.mk.slice().sort((a, b) => b.align - a.align), half = Math.ceil(mk.length / 2);
  const row = m => { const c = m.align > Math.SQRT1_2 ? 'var(--green)' : m.align > 0 ? 'var(--amber)' : 'var(--red)';
    return `<div class="vl" title="phase ${(m.th * 180 / Math.PI).toFixed(0)}° · 1J ${pct(m.ret1, 1)}"><span>${m.k}</span><span class="vb"><i style="width:${Math.round((m.align + 1) / 2 * 100)}%;background:${c}"></i></span><u style="background:${c}"></u></div>`; };
  $('vL').innerHTML = '<h4>EN PHASE · ' + half + '</h4>' + mk.slice(0, half).map(row).join('');
  $('vR').innerHTML = '<h4>HORS PHASE · ' + (mk.length - half) + '</h4>' + mk.slice(half).map(row).join('');
  const r = K.r, reg = r >= .7 ? ['HERD', 'RISQUE SYSTÉMIQUE · RÉDUIRE'] : r >= .4 ? (R.tp.er > .3 ? ['TREND', 'RISK-ON · TAILLE PLEINE'] : ['MIXED', 'SÉLECTIF · DEMI-TAILLE']) : ['DISPERSED', 'STOCK-PICKING · PEU DE BÊTA'];
  $('vInfo').innerHTML = `<div class="box"><h4>FIELD</h4><div class="kv"><span>COUPLING K</span><b>${K.K.toFixed(2)}</b></div><div class="kv"><span>LOCKED</span><b style="color:var(--green)">${K.locked}/${K.mk.length}</b></div><div class="kv"><span>DISPERSION</span><b style="color:var(--red)">${(1 - r).toFixed(2)}</b></div></div>
    <div class="box"><h4>COHERENCE · 30J</h4><div class="vcoh"><canvas id="cv-coh"></canvas></div></div>
    <div class="box"><h4>REGIME</h4><div class="reg" style="color:${reg[0] === 'HERD' ? 'var(--red)' : reg[0] === 'DISPERSED' ? 'var(--amber)' : 'var(--green)'}">${reg[0]}</div><div class="regs">${reg[1]}</div></div>
    <div class="box"><h4>LAST IMPULSE</h4><div class="kv"><b>${K.imp.k}</b><b class="${cls(K.imp.ret1)}">${pct(K.imp.ret1, 1)}</b></div></div>`;
  $('vK').textContent = 'K ' + K.K.toFixed(2); $('vSync').textContent = 'SYNC ' + Math.round(r * 100) + '%';
  $('vSynced').textContent = r >= .6 ? 'SYNCHRONIZED' : r >= .35 ? 'PARTIAL LOCK' : 'DESYNCHRONIZED';
  const g = cv('cv-coh'); if (g) { const { x, w, h } = g; const hs = K.hist, n = hs.length; for (let i = 0; i < n; i++) { const v = isFinite(hs[i]) ? hs[i] : 0; x.fillStyle = rgba(v >= .6 ? C.green : v >= .35 ? C.amber : C.red, .85); x.fillRect(i / n * w, h - v * h, w / n - 1, v * h); } }
}
function drawVortex(dt = 0) {
  const g = cv('cv-vortex'); if (!g) return; const { x, w, h } = g, K = R.ku;
  if (!PARTS) initParticles();
  x.fillStyle = rgba(C.panel, RM || dt === 0 ? 1 : .22); x.fillRect(0, 0, w, h);
  const cx = w * .55, cy = h / 2, Rm = Math.min(w * .42, h * .42);
  S.rot += dt * (.25 + Math.max(0, K.K) * .6);
  x.lineCap = 'round';
  for (let i = 0; i < 46; i++) { const a = Math.PI * (.62 + i / 46 * .76), r0 = Rm * 1.02; const sx = cx + Math.cos(a) * r0, sy = cy + Math.sin(a) * r0;
    x.strokeStyle = rgba(i % 3 ? C.green : C.amber, .05 + (i % 5) * .012); x.lineWidth = 1; x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(cx - Rm * 1.4, cy + (sy - cy) * .6, 0, cy + (sy - cy) * 1.5 + Math.sin(S.rot + i) * 6); x.stroke(); }
  for (const p of PARTS) {
    p.a += dt * p.sp * (1.35 - p.r * .7) * (.6 + K.r);
    const a = p.a + S.rot, rr = p.r * Rm * .92, al = p.m.align;
    const col = al > Math.SQRT1_2 ? C.green : al > .2 ? C.amber : al > -.3 ? C.orange : C.red;
    x.strokeStyle = rgba(col, .25 + .45 * p.r); x.lineWidth = .8 + p.r * 1.2;
    x.beginPath(); x.arc(cx, cy, rr, a - p.len, a); x.stroke();
  }
  x.lineCap = 'butt';
  x.strokeStyle = C.green; x.lineWidth = 5; x.shadowColor = C.green; x.shadowBlur = 18; x.beginPath(); x.arc(cx, cy, Rm * 1.02, 0, 7); x.stroke(); x.shadowBlur = 0;
  x.strokeStyle = rgba(C.green, .5); x.lineWidth = 1; x.beginPath(); x.arc(cx, cy, Rm * 1.09, 0, 7); x.stroke();
  for (let k = 0; k < 72; k++) { const a = k / 72 * Math.PI * 2, big = k % 6 === 0, r1 = Rm * 1.09, r2 = Rm * (big ? 1.17 : 1.12);
    x.strokeStyle = rgba(C.green, big ? .9 : .45); x.lineWidth = big ? 2 : 1; x.beginPath(); x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); x.stroke(); }
  x.strokeStyle = rgba(C.amber, .95); x.lineWidth = 2; x.shadowColor = C.amber; x.shadowBlur = 8; x.beginPath(); x.arc(cx, cy, Rm * .74, 0, 7); x.stroke(); x.shadowBlur = 0;
  const na = K.psi + S.rot; x.strokeStyle = C.amber; x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(na) * Rm * .74, cy + Math.sin(na) * Rm * .74); x.stroke();
  x.fillStyle = rgba(C.bg, .88); x.beginPath(); x.arc(cx, cy, Rm * .24, 0, 7); x.fill();
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = FONT(7.5, 700); x.fillStyle = C.dim; x.fillText('COHERENCE', cx, cy - Rm * .1);
  x.font = FONT(Math.max(16, Rm * .2), 800); x.fillStyle = K.r >= .6 ? C.red : C.green; x.shadowColor = x.fillStyle; x.shadowBlur = 10; x.fillText(Math.round(K.r * 100) + '%', cx, cy + Rm * .06); x.shadowBlur = 0;
  x.font = FONT(8, 700); x.fillStyle = C.green; x.fillText(`● PHASE-LOCKED ${K.locked}/${K.mk.length} · ψ ${((K.psi * 180 / Math.PI + 360) % 360).toFixed(0)}°`, cx, Math.min(h - 8, cy + Rm * 1.27));
}

/* ================================================================== ruin cone */
function drawRuin() {
  const g = cv('cv-ruin'); if (!g) return; const { x, w, h } = g; x.clearRect(0, 0, w, h);
  const mc = R.mc, pl = 46, pr = 74, pt = 12, pb = 18, W = w - pl - pr, Hh = h - pt - pb, ruin = (+S.P.ruin || 50) / 100;
  const lo = Math.log(Math.max(.08, U.q(mc.ts, .01) * .9, (1 - ruin) * .8)), hi = Math.log(U.q(mc.ts, .985) * 1.05);
  const X = t => pl + t / mc.H * W, Y = v => pt + (hi - Math.log(Math.max(v, 1e-6))) / (hi - lo) * Hh;
  const ry = Y(1 - ruin);
  x.fillStyle = rgba(C.red2, .55); x.fillRect(pl, ry, W + pr - 2, h - pb - ry);
  x.fillStyle = rgba(C.red, .9); x.fillRect(pl, ry, W, 1.5);
  const tShow = Math.floor(mc.H * U.clamp(S.reveal, 0, 1));
  x.lineWidth = .8;
  for (let p = 0; p < mc.paths.length; p++) {
    const path = mc.paths[p], term = path[mc.H], ru = mc.ruinF[p];
    const col = ru ? C.red : term < 1 ? C.orange : term > U.q(mc.ts, .75) ? C.white : C.green;
    x.strokeStyle = rgba(col, ru ? .3 : col === C.white ? .14 : .2);
    x.beginPath(); x.moveTo(X(0), Y(1)); for (let t = 2; t <= tShow; t += 2) x.lineTo(X(t), Y(path[t])); x.stroke();
  }
  x.strokeStyle = rgba(C.bg, .9); x.lineWidth = 4; x.beginPath(); mc.bands.forEach((b, i) => { if (b.t > tShow) return; i ? x.lineTo(X(b.t), Y(b.q50)) : x.moveTo(X(b.t), Y(b.q50)); }); x.stroke();
  x.strokeStyle = C.green2; x.lineWidth = 2.2; x.beginPath(); mc.bands.forEach((b, i) => { if (b.t > tShow) return; i ? x.lineTo(X(b.t), Y(b.q50)) : x.moveTo(X(b.t), Y(b.q50)); }); x.stroke();
  x.fillStyle = rgba(C.bg, .35); x.fillRect(X(mc.H * .72), pt, W * .28, Hh);
  x.strokeStyle = C.amber; x.lineWidth = 2; x.beginPath(); x.moveTo(pl - 2, pt - 6); x.lineTo(pl - 2, h - pb); x.stroke();
  x.font = FONT(8.5, 700); x.textAlign = 'right'; x.textBaseline = 'middle';
  for (const v of [.25, .5, .75, 1, 1.5, 2, 3, 4, 6, 8, 12]) { const y = Y(v); if (y < pt - 2 || y > h - pb) continue; x.fillStyle = rgba(C.amber, .9); x.fillText(v + '×', pl - 6, y); x.strokeStyle = rgba(C.dim, .08); x.lineWidth = 1; x.beginPath(); x.moveTo(pl, y); x.lineTo(pl + W, y); x.stroke(); }
  const sy = Y(1); x.fillStyle = rgba(C.green2, .9); x.fillRect(pl, sy - 7, 40, 14); x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText('NOW', pl + 20, sy);
  const nb = 14, bins = new Array(nb).fill(0), bRu = new Array(nb).fill(0);
  for (let p = 0; p < mc.N; p++) { const v = Math.log(Math.max(mc.term[p], 1e-6)); const b = U.clamp(Math.floor((hi - v) / (hi - lo) * nb), 0, nb - 1); bins[b]++; if (mc.ruinF[p]) bRu[b]++; }
  const bmax = Math.max(...bins), bh = Hh / nb;
  for (let b = 0; b < nb; b++) { const y = pt + b * bh, len = bins[b] / bmax * (pr - 8), mid = Math.exp(hi - (b + .5) / nb * (hi - lo));
    const col = mid < 1 - ruin ? C.red : mid < 1 ? C.orange : C.green; x.fillStyle = rgba(col, .85); x.fillRect(w - 4 - len, y + 1, len, bh - 2);
    if (bins[b] / mc.N >= .03 && bh > 10) { x.fillStyle = '#0b0f17'; x.font = FONT(7.5, 800); x.textAlign = 'right'; x.fillText(Math.round(bins[b] / mc.N * 100) + '%', w - 7, y + bh / 2); } }
  x.font = FONT(8, 600); x.fillStyle = rgba(C.dim, .95); x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const yrs = mc.H / 252; for (let k = 0; k <= 4; k++) { const t = mc.H * k / 4; x.fillText(k === 0 ? 'T0' : yrs >= 2 ? (yrs * k / 4).toFixed(1).replace('.0', '') + 'A' : Math.round(12 * yrs * k / 4) + 'M', X(t), h - 4); }
  $('rStats').innerHTML = `${nf0.format(mc.N)} TRAJ. · BLOC ${S.P.block}J · MÉD <b>×${mc.med.toFixed(2)}</b> · P5 ×${mc.p05.toFixed(2)} · P(PERTE) ${pct(mc.pLoss, 0, false)}`;
  x.fillStyle = C.red; x.textAlign = 'right'; x.font = FONT(8, 800); x.fillText(`RUIN · DD ≥ ${S.P.ruin}%`, pl + W - 4, ry + 11);
  const rp = $('rP'); rp.textContent = `P(RUIN) ${(mc.pRuin * 100).toFixed(2)}%`; rp.className = 'bdg ' + (mc.pRuin < .05 ? 'g' : mc.pRuin < .15 ? 'a' : 'r');
}

/* ================================================================== analog matcher */
function drawAnalog(t = 0) {
  const g = cv('cv-analog'); if (!g) return; const { x, w, h } = g; x.clearRect(0, 0, w, h); const A = R.an;
  const bcH = 13, pl = 8, pr = 54, pt = bcH + 30, pb = 20, W = w - pl - pr, Hh = h - pt - pb;
  const nb = A.barcode.length; for (let b = 0; b < nb; b++) { const v = A.barcode[b]; const col = v > .8 ? C.green : v > .6 ? rgba(C.green, .55) : v > .3 ? rgba(C.violet, .5) : rgba(C.dim, .35);
    x.fillStyle = col; x.fillRect(pl + b / nb * W, 2, W / nb + .5, bcH); }
  if (!RM) { const sx = pl + ((t / 22) % W); x.fillStyle = rgba(C.white, .85); x.fillRect(sx, 1, 2, bcH + 2); }
  x.font = FONT(8, 800); x.fillStyle = rgba('#000000', .7); x.fillRect(pl, 2, 128, bcH); x.fillStyle = C.txt; x.textBaseline = 'middle'; x.textAlign = 'left'; x.fillText(`SCAN · ${compact(A.scanned)} FENÊTRES`, pl + 4, 2 + bcH / 2);
  const total = A.W + A.H, X = k => pl + (k + A.W - 1) / (total - 1) * W;
  const past = A.pick.map(p => p.z.map(z => Math.exp(A.sdCur * (z - p.z[A.W - 1])) - 1));
  let lo = Math.min(...A.curPct), hi = Math.max(...A.curPct); for (const p of A.pick) for (const v of p.fwd) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pd = (hi - lo) * .1; lo -= pd; hi += pd; const Y = v => pt + (hi - v) / (hi - lo) * Hh;
  x.fillStyle = rgba(C.green, .06); x.fillRect(X(0), pt - 8, X(A.H) - X(0), Hh + 8);
  x.beginPath(); for (let j = 0; j <= A.H; j++) x.lineTo(X(j), Y(Math.max(...A.pick.map(p => p.fwd[j])))); for (let j = A.H; j >= 0; j--) x.lineTo(X(j), Y(Math.min(...A.pick.map(p => p.fwd[j])))); x.closePath(); x.fillStyle = rgba(C.green, .13); x.fill();
  const dl = (v, col, lab) => { const y = Y(v); x.strokeStyle = col; x.setLineDash([5, 4]); x.lineWidth = 1; x.beginPath(); x.moveTo(pl, y); x.lineTo(pl + W, y); x.stroke(); x.setLineDash([]); x.font = FONT(8.5, 800); x.fillStyle = col; x.textAlign = 'left'; x.fillText(lab, pl + 4, y - 7); };
  dl(A.mfe, C.amber, `TARGET ${pct(A.mfe, 1)}`); dl(A.mae, C.red, `STOP ${pct(A.mae, 1)}`);
  past.forEach(pp => { x.strokeStyle = rgba(C.violet, .28); x.lineWidth = 1; x.beginPath(); pp.forEach((v, k) => { const px = X(k - A.W + 1), py = Y(v); k ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); });
  x.strokeStyle = '#e9e4ff'; x.lineWidth = 2.6; x.shadowColor = C.violet; x.shadowBlur = 12; x.beginPath(); A.curPct.forEach((v, k) => { const px = X(k - A.W + 1), py = Y(v); k ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); x.shadowBlur = 0;
  const labs = [];
  A.pick.forEach((p, i) => { const col = p.final > .02 ? (i % 2 ? C.cyan : C.green) : p.final >= 0 ? C.cyan : (i % 2 ? C.magenta : C.violet);
    x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); p.fwd.forEach((v, j) => { const px = X(j), py = Y(v); j ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); labs.push({ y: Y(p.final), v: p.final, col }); });
  labs.sort((a, b) => a.y - b.y); for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12;
  x.font = FONT(8, 800); x.textAlign = 'left'; for (const l of labs) { const s = pct(l.v, 1); const tw = x.measureText(s).width + 6; x.fillStyle = rgba('#05070d', .85); x.fillRect(pl + W + 3, l.y - 6, tw, 12); x.strokeStyle = l.col; x.lineWidth = 1; x.strokeRect(pl + W + 3, l.y - 6, tw, 12); x.fillStyle = l.col; x.fillText(s, pl + W + 6, l.y + .5); }
  const nx = X(0); x.strokeStyle = C.amber; x.lineWidth = 2; x.beginPath(); x.moveTo(nx, pt - 14); x.lineTo(nx, pt + Hh + 4); x.stroke();
  x.fillStyle = C.amber; x.fillRect(nx - 16, pt - 24, 32, 13); x.fillStyle = '#14100a'; x.textAlign = 'center'; x.font = FONT(8.5, 800); x.fillText('NOW', nx, pt - 17); x.fillStyle = C.amber; x.textAlign = 'left'; x.fillText('WHAT HAPPENED NEXT →', nx + 22, pt - 17);
  x.fillStyle = C.txt; x.font = FONT(8.5, 800); x.fillText('CURRENT WINDOW · 64 BARS · Z-SCORED', pl + 4, pt - 17);
  x.font = FONT(8, 600); x.fillStyle = C.dim; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  for (const k of [-64, -48, -32, -16, 0]) x.fillText(k, X(k), h - 6);
  x.fillStyle = C.green; x.fillText(`MEDIAN ${pct(A.median, 1)} · ${A.H} BARS`, (X(0) + X(A.H)) / 2, pt + Hh - 2);
  x.fillStyle = C.amber; x.font = FONT(8, 800); x.fillText(`+${A.H} PROJECTED · K-NN`, (X(0) + X(A.H)) / 2, h - 6);
}
function renderAnalogStats() {
  const A = R.an; $('aDtw').textContent = 'DTW ' + A.dtwBest.toFixed(3); $('aScan').textContent = `SCAN ${nf0.format(A.scanned)} · ${Math.round(A.ms)}MS`;
  $('astats').innerHTML = `<div class="abox m"><span><i></i>MATCH</span><b>${A.match.toFixed(2)}</b></div>
    <div class="abox u"><span><i></i>UP</span><b>${A.up}</b></div><div class="abox d"><span><i></i>DOWN</span><b>${A.down}</b></div>
    <div class="akv">MEDIAN<b class="am">${pct(A.median, 1)}</b> FWD</div><div class="akv">HORIZON<b>${A.H}</b> BARS</div>
    <div class="akv" style="font-size:8px;line-height:1.6">${A.pick.slice(0, 4).map(p => `${p.k} ${p.date.slice(2)} · ρ ${p.corr.toFixed(2)}`).join('<br>')}</div>`;
}

/* ================================================================== bayes */
function drawBayes() {
  const g = cv('cv-bayes'); if (!g) return; const { x, w, h } = g; x.clearRect(0, 0, w, h); const B = R.by;
  const pl = 10, pr = 10, pt = 34, pb = 56, W = w - pl - pr, Hh = h - pt - pb, p0 = .2, p1 = 1;
  const X = p => pl + (p - p0) / (p1 - p0) * W; const G = 220; const pdf = (a, b) => { const o = []; for (let i = 0; i <= G; i++) { const p = p0 + (p1 - p0) * i / G; o.push([p, U.betaPdf(p, a, b)]); } return o; };
  const pr0 = pdf(B.a0, B.b0), li = pdf(B.lik.a, B.lik.b), po = pdf(B.a1, B.b1); const mx = Math.max(...pr0.map(v => v[1]), ...li.map(v => v[1]), ...po.map(v => v[1]));
  const Y = v => pt + Hh - v / mx * Hh * .92;
  const fill = (arr, col, a, line, dash) => { x.beginPath(); x.moveTo(X(p0), Y(0)); for (const [p, v] of arr) x.lineTo(X(p), Y(v)); x.lineTo(X(p1), Y(0)); x.closePath(); if (a) { x.fillStyle = rgba(col, a); x.fill(); }
    if (line) { x.strokeStyle = col; x.lineWidth = 1.6; x.setLineDash(dash || []); x.beginPath(); arr.forEach(([p, v], i) => i ? x.lineTo(X(p), Y(v)) : x.moveTo(X(p), Y(v))); x.stroke(); x.setLineDash([]); } };
  for (let k = 2; k <= 10; k++) { const px = X(k / 10); x.strokeStyle = rgba(C.dim, .1); x.beginPath(); x.moveTo(px, pt); x.lineTo(px, pt + Hh); x.stroke(); }
  fill(pr0, C.dim, .35, true, [3, 3]); fill(po, C.green, .45, false); x.shadowColor = C.green; x.shadowBlur = 10; fill(po, C.green, 0, true); x.shadowBlur = 0; fill(li, C.orange, 0, true);
  const ed = (B.post - B.p0) * 100, up = ed >= 0;
  x.fillStyle = rgba(up ? C.green : C.red, .14); x.fillRect(pl, 4, W, 22); x.strokeStyle = rgba(up ? C.green : C.red, .6); x.strokeRect(pl + .5, 4.5, W - 1, 21);
  x.font = FONT(8.5, 800); x.fillStyle = up ? C.green : C.red; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(`POSTERIOR ${up ? '↑' : '↓'} ${ed >= 0 ? '+' : ''}${ed.toFixed(1)} PTS · EVIDENCE ${Math.abs(ed) < 1 ? 'NEUTRAL' : up ? 'CONFIRMS' : 'CONTRADICTS'}`, pl + 8, 15);
  const vl = (p, col, lab, y) => { const px = X(p); x.strokeStyle = col; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(px, pt - 4); x.lineTo(px, pt + Hh); x.stroke(); x.setLineDash([]);
    if (lab) { x.font = FONT(8, 800); const tw = x.measureText(lab).width + 8; x.fillStyle = rgba('#000000', .7); x.fillRect(px + 3, y - 7, tw, 13); x.strokeStyle = col; x.strokeRect(px + 3, y - 7, tw, 13); x.fillStyle = col; x.textAlign = 'left'; x.fillText(lab, px + 7, y); } };
  vl(B.p0, rgba(C.txt, .6), '', 0); vl(B.post, C.amber, `EDGE ${ed >= 0 ? '+' : ''}${ed.toFixed(1)}`, pt + 10);
  x.font = FONT(8, 600); x.fillStyle = C.dim; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; for (let k = 2; k <= 10; k += 2) x.fillText(k * 10 + '%', X(k / 10), pt + Hh + 11);
  let lx = pl + 4; const ly = pt + Hh - 8; x.textAlign = 'left'; x.font = FONT(7.5, 800);
  for (const [l, c] of [['PRIOR', C.dim], ['LIKELIHOOD', C.orange], ['POSTERIOR', C.green]]) { x.fillStyle = rgba('#000000', .55); const tw = x.measureText(l).width + 16; x.fillRect(lx, ly - 7, tw, 13); x.fillStyle = c; x.fillRect(lx + 3, ly - 3, 6, 6); x.fillText(l, lx + 12, ly + .5); lx += tw + 4; }
  const hy = h - 30, hh = 24, n = B.hist.length; x.fillStyle = C.dim; x.font = FONT(7, 700); x.fillText('POSTERIOR · 40 DERNIÈRES SÉANCES', pl, hy - 6);
  for (let i = 0; i < n; i++) { const v = B.hist[i], bh = U.clamp((v - .4) / .4, .08, 1) * hh; x.fillStyle = v >= .68 ? C.green : v >= .6 ? rgba(C.dim, .8) : v >= .52 ? C.orange : C.red; if (i === n - 1) x.fillStyle = C.amber; x.fillRect(pl + i / n * W, hy + hh - bh, W / n - 2, bh); }
}
function renderBayesSide() {
  const B = R.by, mx = Math.max(...B.ev.map(e => Math.abs(e.llr)), .01);
  $('bev').innerHTML = `<h4>EVIDENCE · LOG-ODDS (λ ${B.lam.toFixed(2)})</h4>` + B.ev.map(e => `<div class="ev"><span>${e.k} <b style="color:${e.v ? 'var(--txt)' : 'var(--dim)'}">${e.v ? 'OUI' : 'NON'}</b></span><b class="${cls(e.llr)}">${e.llr >= 0 ? '+' : '−'}${Math.abs(e.llr).toFixed(3)}</b><span class="eb"><i style="left:0;width:${Math.abs(e.llr) / mx * 100}%;background:${e.llr >= 0 ? 'var(--green)' : 'var(--red)'}"></i></span></div>`).join('');
  $('bEv').textContent = `EV ${pct(B.EV, 2)} / 21J`; $('bEv').className = 'bdg ' + (B.EV >= 0 ? 'g' : 'r');
  const ed = (B.post - B.p0) * 100; $('bEdge').textContent = `EDGE ${ed >= 0 ? '+' : ''}${ed.toFixed(1)} PTS`;
  $('bSub').textContent = `PRIOR : ${nf0.format(B.T)} SÉANCES · VRAISEMBLANCE : ${B.F.length} SIGNAUX · NAÏF TEMPÉRÉ`;
  $('bUpd').textContent = 'UPD ' + dshort(M.d[M.n - 1]) + ' · EOD';
  const k = Math.max(0, B.kelly / 2);
  $('bfoot').innerHTML = `<span>PRIOR<b>${(B.p0 * 100).toFixed(0)}%</b></span><span>POSTERIOR<b style="color:var(--green)">${(B.post * 100).toFixed(0)}%</b></span><span>KL<b>${B.kl.toFixed(2)}</b></span><span>KELLY ½<b style="color:var(--amber)">${Math.min(25, k * 100).toFixed(0)}%</b></span><span class="r">CONF<b>${B.conf.toFixed(2)}</b></span>`;
}

/* ================================================================== agent + footer */
let agentMsgs = [], agentIdx = 0, typer = null;
function buildAgent() {
  const n = M.n, bt = R.bt, d200 = M.c[n - 1] / M.sma200[n - 1] - 1, reg = R.tp.er > .3 ? 'TREND' : 'CHOP';
  const inPos = bt.ex[bt.s1] > 0, since = bt.open ? M.d[bt.open.i] : null;
  const top = BR.rows.slice().sort((a, b) => b.vj - a.vj)[0], bot = BR.rows.slice().sort((a, b) => a.vj - b.vj)[0], best = BR.rows.slice().sort((a, b) => b.score - a.score)[0];
  agentMsgs = [
    `scan <b>QQQ/1D</b> · Δsma200 <em>${pct(d200, 1)}</em> · regime <em>${reg}</em> · entropy <b>${R.pe.toFixed(2)}</b>`,
    `signal <b>${STRATS[S.P.strat].short}</b> → ${inPos ? `<em>LONG ${S.P.lev}×</em> depuis ${since ? dfr(since) : '—'} (${bt.open ? bt.open.days : 0}j, ${pct(bt.open ? bt.open.ret : 0, 1)})` : '<i>CASH</i>'} · stop si clôture < <b>${nf2.format(M.sma200[n - 1] * (1 - S.P.band / 100))}</b>`,
    `analog k=${R.an.K} · up <em>${R.an.up}</em> / down <i>${R.an.down}</i> · median <b>${pct(R.an.median, 1)}</b> @${R.an.H} · kelly ½ <b>${Math.min(25, Math.max(0, R.by.kelly / 2) * 100).toFixed(0)}%</b>`,
    `brvm breadth <em>${BR.upN}▲</em> <i>${BR.dnN}▼</i> · top <b>${top.t}</b> <em>${pp(top.vj)}</em> · worst <b>${bot.t}</b> <i>${pp(bot.vj)}</i> · score #1 <b>${best.t}</b> ${best.score}`,
    `vortex sync <b>${Math.round(R.ku.r * 100)}%</b> · K ${R.ku.K.toFixed(2)} · locked ${R.ku.locked}/${R.ku.mk.length} · impulse <b>${R.ku.imp.k}</b> ${pct(R.ku.imp.ret1, 1)}`,
    `monte carlo ${nf0.format(R.mc.N)} paths · P(DD≥${S.P.ruin}%) <i>${(R.mc.pRuin * 100).toFixed(1)}%</i> · médiane ×<b>${R.mc.med.toFixed(2)}</b> · P(perte) ${pct(R.mc.pLoss, 0, false)}`,
    `bayes P(↑21j) <em>${(R.by.post * 100).toFixed(0)}%</em> vs prior ${(R.by.p0 * 100).toFixed(0)}% · EV ${pct(R.by.EV, 2)} · membrane <b>${R.mem.state}</b>`
  ];
}
function typeAgent() {
  clearInterval(typer); const el = $('agentMsg'); const html = agentMsgs[agentIdx % agentMsgs.length]; agentIdx++;
  if (RM) { el.innerHTML = html + '<span class="cur"></span>'; return; }
  const tmp = document.createElement('div'); tmp.innerHTML = html; const plain = tmp.textContent; let k = 0;
  typer = setInterval(() => { k += 3; if (k >= plain.length) { clearInterval(typer); el.innerHTML = html + '<span class="cur"></span>'; } else el.textContent = plain.slice(0, k); }, 16);
}
function renderFooter() {
  const bt = R.bt, contacts = BR.rows.filter(r => Math.abs(r.vj) >= 3).length, ruin = +S.P.ruin;
  const items = [`DD GUARD <b>${bt.st.ddNow > -ruin / 100 ? 'ARMED' : 'TRIGGERED'}</b>`, `CB GUARD <b>ARMED</b> (S&amp;P L1+L2 → EXIT)`, `ANALOG MATCH <b>${R.an.match.toFixed(2)}</b>`,
    `KELLY ½ · CAP <b>${Math.min(25, Math.max(0, R.by.kelly / 2) * 100).toFixed(0)}%</b>`, `SONAR CONTACTS <b>${contacts}</b>`, `POSTERIOR <b>${(R.by.post * 100).toFixed(0)}%</b>`,
    `SLIPPAGE <b>${S.P.slip}BP</b>`, `EXPOSURE <b>${Math.round(bt.st.expo * 100)}%</b>`, `LATENCY <b>${Math.round(R.btMs)}MS</b>`, `DATA <b>${dfr(M.d[M.n - 1])}</b>`];
  const html = items.map(s => `<span>${s}</span><span style="color:var(--dim2)">·</span>`).join('');
  $('foot').innerHTML = html + html;
  $('src').innerHTML = `<span>QQQ &amp; 21 marchés : Yahoo Finance quotidien${LIVE ? ' + flux 15 min' : ''} · BRVM : ${esc(BR.src)} · Taux Fed approx. · Levier simulé (3× ≈ TQQQ, écart &lt; 3 pts/an 2018-2025)</span><span>Outil d'analyse, pas un conseil en investissement.</span>`;
}

/* ================================================================== drawer */
function fillDrawer() {
  const P = S.P; $('fStrat').innerHTML = Object.entries(STRATS).map(([k, v]) => `<option value="${k}" ${k === P.strat ? 'selected' : ''}>${v.name}</option>`).join('');
  const set = (id, v) => { $(id).value = v; };
  set('fN', P.n); set('fFast', P.fast); set('fBand', P.band); set('fTv', P.tv); set('fLev', P.lev); set('fExec', P.exec); set('fStart', P.start); set('fCap', P.cap);
  set('fFee', P.fee); set('fSlip', P.slip); set('fSpread', P.spread); set('fEr', P.er); set('fCash', P.cash); set('fRuin', P.ruin); set('fBlock', P.block);
  stratFields();
}
function stratFields() { const st = STRATS[$('fStrat').value]; $('fDesc').textContent = st.desc;
  $('lN').hidden = !st.uses.includes('n'); $('lFast').hidden = !st.uses.includes('fast'); $('lBand').hidden = !st.uses.includes('band'); $('lTv').hidden = !st.uses.includes('tv'); }
function readDrawer() { const g = id => $(id).value; return { strat: g('fStrat'), n: +g('fN') || 200, fast: +g('fFast') || 50, band: +g('fBand') || 0, tv: +g('fTv') || 30, lev: +g('fLev'), exec: g('fExec'),
  start: g('fStart') || DEFAULT_P.start, cap: Math.max(100, +g('fCap') || 10000), fee: +g('fFee') || 0, slip: +g('fSlip') || 0, spread: +g('fSpread') || 0, er: +g('fEr') || 0, cash: +g('fCash'), ruin: U.clamp(+g('fRuin') || 50, 10, 95), block: U.clamp(+g('fBlock') || 20, 1, 120) }; }
function renderDrawerResults() {
  const bt = R.bt, a = bt.st, b = bt.stB, c = bt.stB3;
  const rows = [['CAGR', s => pct(s.cagr)], ['TOTAL', s => pct(s.total, 0)], ['VOLATILITÉ', s => pct(s.vol, 1, false)], ['SHARPE', s => s.sharpe.toFixed(2)], ['SORTINO', s => s.sortino.toFixed(2)],
    ['MAX DD', s => pct(s.mdd)], ['CALMAR', s => isFinite(s.calmar) ? s.calmar.toFixed(2) : '—'], ['DD ACTUEL', s => pct(s.ddNow)], ['PLUS LONG DD', s => s.maxDur + 'J'], ['CAPITAL FINAL', s => usd(s.final)]];
  $('dRes').innerHTML = `<table class="mt"><tr><th></th><th style="color:var(--amber)">STRAT</th><th>QQQ B&amp;H</th><th>3× B&amp;H</th></tr>${rows.map(([l, f]) => `<tr><td>${l}</td><td><b>${f(a)}</b></td><td>${f(b)}</td><td>${f(c)}</td></tr>`).join('')}
    <tr><td>TRADES</td><td><b>${a.trades}</b></td><td>1</td><td>1</td></tr><tr><td>WIN RATE</td><td><b>${isFinite(a.win) ? (a.win * 100).toFixed(1) + '%' : '—'}</b></td><td>—</td><td>—</td></tr>
    <tr><td>AVG R/R</td><td><b>${isFinite(a.rr) ? a.rr.toFixed(2) : '∞'}</b></td><td>—</td><td>—</td></tr><tr><td>PROFIT FACTOR</td><td><b>${isFinite(a.pf) ? a.pf.toFixed(2) : '∞'}</b></td><td>—</td><td>—</td></tr>
    <tr><td>EXPOSITION</td><td><b>${Math.round(a.expo * 100)}%</b></td><td>100%</td><td>100%</td></tr></table>`;
  const ys = Object.keys(a.yearly);
  $('dYear').innerHTML = `<table class="mt"><tr><th>ANNÉE</th><th style="color:var(--amber)">STRAT</th><th>QQQ</th><th>3×</th></tr>${ys.map(y => `<tr><td>${y}${y === M.d[M.n - 1].slice(0, 4) ? ' YTD' : ''}</td><td class="${cls(a.yearly[y])}"><b>${pct(a.yearly[y])}</b></td><td class="${cls(b.yearly[y])}">${pct(b.yearly[y])}</td><td class="${cls(c.yearly[y])}">${pct(c.yearly[y])}</td></tr>`).join('')}</table>`;
  const tr = bt.trades.slice(-12).reverse(); const op = bt.open;
  $('dTrades').innerHTML = `<table class="mt"><tr><th>ENTRÉE</th><th>SORTIE</th><th>JOURS</th><th>QQQ</th><th>RÉSULTAT</th></tr>${op ? `<tr><td>${dfr(M.d[op.i])}</td><td style="color:var(--amber)">OUVERT</td><td>${op.days}</td><td>${nf2.format(op.px)}</td><td class="${cls(op.ret)}"><b>${pct(op.ret)}</b></td></tr>` : ''}${tr.map(t => `<tr><td>${dfr(M.d[t.i0])}</td><td>${dfr(M.d[t.i1])}</td><td>${t.days}</td><td>${nf2.format(t.px0)} → ${nf2.format(t.px1)}</td><td class="${cls(t.ret)}"><b>${pct(t.ret)}</b></td></tr>`).join('')}</table>`;
  $('dLb').innerHTML = `<table class="mt"><tr><th>#</th><th>STRATÉGIE</th><th>SHARPE</th><th>CAGR</th><th>MAX DD</th><th>TRADES</th></tr>${R.lb.map((l, i) => `<tr style="${l.k === S.P.strat ? 'color:var(--amber)' : ''}"><td>${i + 1}</td><td style="text-align:left">${l.name}</td><td><b>${l.sharpe.toFixed(2)}</b></td><td>${pct(l.cagr)}</td><td>${pct(l.mdd, 0)}</td><td>${l.trades}</td></tr>`).join('')}</table>`;
  $('dNote').innerHTML = `Levier simulé au quotidien : L × rendement total de QQQ − (L−1) × (taux Fed + spread) − frais de l'ETF. Le 3× colle à TQQQ (2022 : −78,7 % simulé vs −79,1 % réel ; 2023 : +200 % vs +198 %). Hors marché, le cash est rémunéré au taux Fed approximatif si l'option est active. Données depuis le ${dfr(M.d[0])} (warm-up des moyennes inclus), donc pas de 2000 ni de 2008 : le cône de ruine aide à compenser. Le classement réutilise ton levier et tes coûts avec les paramètres par défaut de chaque stratégie.`;
}

/* ================================================================== sample (Ask Claude) */
async function initSample() {
  if (!window.claude || !window.claude.use) return;
  let sample = null; try { sample = await window.claude.use('sample'); } catch (e) { }
  if (!sample) return;
  $('askForm').hidden = false; let ctl = null;
  $('askForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const q = $('askIn').value.trim(); if (!q) return; ctl?.abort(); ctl = new AbortController();
    $('answer').hidden = false; $('ansTxt').textContent = 'Réflexion…';
    const ctx = snapshotContext();
    try {
      await sample(`Tu es l'agent d'un terminal quant. Réponds en français, de façon concise et chiffrée (8 lignes max), sans conseil personnalisé définitif : donne les faits et les signaux, et ce qu'ils impliquent pour la règle de l'utilisateur.\n\nCONTEXTE (calculé par le terminal, données au ${M.d[M.n - 1]}):\n${ctx}\n\nQUESTION : ${q}`,
        { signal: ctl.signal, onText: ({ text }) => { $('ansTxt').textContent = text; } });
    } catch (e) { $('ansTxt').textContent = (e && e.text) || (e && e.code === 'not_granted' ? "Accès à Claude refusé pour cette page." : e && e.code === 'rate_limited' ? 'Trop de requêtes, réessaie dans un instant.' : e && e.code === 'cancelled' ? '' : 'Réponse indisponible.'); }
  });
}
function snapshotContext() {
  const n = M.n, bt = R.bt, b = R.by;
  return JSON.stringify({
    qqq: { close: M.c[n - 1], sma200: +M.sma200[n - 1].toFixed(2), sma50: +M.sma50[n - 1].toFixed(2), d200: +(M.c[n - 1] / M.sma200[n - 1] - 1).toFixed(4), vol20: +M.vol20[n - 1].toFixed(3), rsi14: +M.rsi14[n - 1].toFixed(1), live: liveState() },
    strategy: { name: STRATS[S.P.strat].name, lev: S.P.lev, cagr: +bt.st.cagr.toFixed(3), sharpe: +bt.st.sharpe.toFixed(2), maxDD: +bt.st.mdd.toFixed(3), ddNow: +bt.st.ddNow.toFixed(3), inPosition: bt.ex[bt.s1] > 0, openTrade: bt.open && { since: M.d[bt.open.i], ret: +bt.open.ret.toFixed(3) } },
    montecarlo: { pRuin: R.mc.pRuin, ruinThreshold: S.P.ruin, median1y: +R.mc.med.toFixed(2) },
    bayes: { prior: +b.p0.toFixed(3), posterior: +b.post.toFixed(3), ev21d: +b.EV.toFixed(4), evidence: b.ev.map(e => [e.k, e.v, +e.llr.toFixed(3)]) },
    analog: { up: R.an.up, down: R.an.down, median: +R.an.median.toFixed(4), match: +R.an.match.toFixed(2) },
    vortex: { sync: +R.ku.r.toFixed(2), K: +R.ku.K.toFixed(2) }, membrane: R.mem.state,
    brvm: { session: BR.asof, up: BR.upN, down: BR.dnN, composite: BR.idx[0], top5score: BR.rows.slice().sort((a, c) => c.score - a.score).slice(0, 5).map(r => [r.t, r.score, r.yld && +r.yld.toFixed(2), r.per && +r.per.toFixed(1)]) }
  });
}

/* ================================================================== wiring + loop */
function renderAll(first) {
  readPalette(); renderHeader(); renderRank(); renderTape(); renderPNL(first); drawEquity(); renderTF(); drawChart(); renderLadder();
  renderGrid(); drawSurvival(); drawAurora(performance.now()); drawMembrane(performance.now()); renderVortex(); drawVortex(0); drawRuin();
  buildAgent(); renderAnalogStats(); drawAnalog(performance.now()); drawBayes(); renderBayesSide(); renderFooter();
  if (first) { typeAgent(); flashGrid(); }
  if ($('drawer').classList.contains('open')) renderDrawerResults();
}
function redrawCanvases() { readPalette(); drawEquity(); drawChart(); drawSurvival(); drawAurora(performance.now()); drawMembrane(performance.now()); renderVortex(); PARTS = null; drawVortex(0); drawRuin(); drawAnalog(performance.now()); drawBayes(); }
function wire() {
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-mode],[data-t],[data-tf],[data-h],[data-k],.info'); if (!t) return;
    if (t.classList.contains('info')) { const p = t.closest('.panel'); const ex = p.querySelector('.explain'); if (ex) { ex.remove(); t.setAttribute('aria-expanded', 'false'); return; }
      document.querySelectorAll('.explain').forEach(e => e.remove()); document.querySelectorAll('.info').forEach(b => b.setAttribute('aria-expanded', 'false'));
      const d = document.createElement('div'); d.className = 'explain'; d.innerHTML = INFO[t.dataset.info] || ''; p.appendChild(d); t.setAttribute('aria-expanded', 'true'); return; }
    if (t.dataset.mode) { S.mode = t.dataset.mode; LS.set('mode', S.mode); renderGrid(); if (S.mode !== 'table') flashGrid(); return; }
    if (t.dataset.tf) { S.tf = t.dataset.tf; renderTF(); drawChart(); renderHeader(); return; }
    if (t.dataset.h) { S.H = +t.dataset.h; document.querySelectorAll('#p-ruin [data-h]').forEach(b => b.classList.toggle('on', b === t)); runMC(); drawRuin(); buildAgent(); return; }
    if (t.dataset.k && t.tagName === 'TH') { const k = t.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (['t', 'n', 'sec', 'cty', 'per'].includes(k) ? 1 : -1) }; renderTable(); return; }
    if (t.dataset.t) { openStock(t.dataset.t); return; }
  });
  document.addEventListener('click', ev => { if (!ev.target.closest('.explain,.info')) { document.querySelectorAll('.explain').forEach(e => e.remove()); document.querySelectorAll('.info').forEach(b => b.setAttribute('aria-expanded', 'false')); } }, true);
  $('rResample').addEventListener('click', () => { S.seed = (S.seed * 7919 + 13) % 100003; runMC(); drawRuin(); buildAgent(); });
  const openBT = () => { fillDrawer(); renderDrawerResults(); $('drawer').classList.add('open'); $('scrim').classList.add('on'); $('fStrat').focus(); };
  $('openBT').addEventListener('click', openBT); $('pid').addEventListener('click', openBT);
  $('closeBT').addEventListener('click', closeOverlays); $('scrim').addEventListener('click', closeOverlays); $('mClose').addEventListener('click', closeOverlays);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlays(); });
  $('fStrat').addEventListener('change', () => { const d = STRATS[$('fStrat').value].d; for (const [k, v] of Object.entries(d)) { const el = { n: 'fN', fast: 'fFast', band: 'fBand', tv: 'fTv' }[k]; if (el) $(el).value = v; } stratFields(); });
  $('runBT').addEventListener('click', () => { S.P = readDrawer(); LS.set('P', S.P); computeBT(); renderAll(false); renderDrawerResults(); });
  $('resetBT').addEventListener('click', () => { S.P = { ...DEFAULT_P }; LS.set('P', S.P); fillDrawer(); computeBT(); renderAll(false); renderDrawerResults(); });
  $('fitMinus').addEventListener('click', () => { const i = BARSTEPS.findIndex(b => b >= S.bars); S.bars = BARSTEPS[Math.max(0, i - 1)]; drawChart(); renderHeader(); });
  $('fitPlus').addEventListener('click', () => { const i = BARSTEPS.findIndex(b => b >= S.bars); S.bars = BARSTEPS[Math.min(BARSTEPS.length - 1, i + 1)]; drawChart(); renderHeader(); });
  $('skin').addEventListener('click', () => { document.body.classList.toggle('light'); LS.set('skin', document.body.classList.contains('light') ? 'light' : 'dark'); $('skin').textContent = document.body.classList.contains('light') ? '◑ DARK' : '◐ LIGHT'; redrawCanvases(); });
  if (document.body.classList.contains('light')) $('skin').textContent = '◑ DARK';
  const ch = $('cv-chart');
  ch.addEventListener('mousemove', e => { const r = ch.getBoundingClientRect(), L = S.cl; if (!L) return; const i = L.i0 + Math.floor((e.clientX - r.left - 6) / L.cw); S.hover = U.clamp(i, L.i0, L.len - 1); drawChart(); });
  ch.addEventListener('mouseleave', () => { S.hover = null; drawChart(); });
  ch.addEventListener('wheel', e => { e.preventDefault(); const i = BARSTEPS.findIndex(b => b >= S.bars); S.bars = BARSTEPS[U.clamp(i + (e.deltaY > 0 ? 1 : -1), 0, BARSTEPS.length - 1)]; drawChart(); renderHeader(); }, { passive: false });
  $('ansX').addEventListener('click', () => { $('answer').hidden = true; });
  let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(redrawCanvases, 120); });
  setInterval(typeAgent, 6500);
}
const VIS = {};
function loop() {
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => VIS[e.target.id] = e.isIntersecting), { threshold: .01 }) : null;
  ['cv-vortex', 'cv-mem', 'cv-analog', 'cv-aurora', 'cv-ruin'].forEach(id => { VIS[id] = true; io && io.observe($(id)); });
  if (RM) return;
  let last = performance.now(), lm = 0, la = 0, lau = 0;
  const f = t => { requestAnimationFrame(f); if (document.hidden) { last = t; return; } const dt = Math.min(.05, (t - last) / 1000); last = t;
    if (VIS['cv-vortex']) drawVortex(dt);
    if (VIS['cv-mem'] && t - lm > 50) { drawMembrane(t); lm = t; }
    if (VIS['cv-analog'] && t - la > 66) { drawAnalog(t); la = t; }
    if (VIS['cv-aurora'] && t - lau > 90) { drawAurora(t); lau = t; }
    if (S.reveal < 1) { S.reveal = Math.min(1, S.reveal + dt / 1.6); drawRuin(); }
  };
  requestAnimationFrame(f);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
