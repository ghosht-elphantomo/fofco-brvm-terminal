/* ================= FQT — data, formatting, command line, router ================= */
'use strict';
const $ = id => document.getElementById(id);
const Q = { base: 'data/', sum: null, by: {}, ser: {}, M: {}, json: {}, live: null, quotes: null };
const ST = { fn: 'MON', sec: 'QQQ', gp: { range: '1A', type: 'candle', ov: { sma50: true, sma200: true }, st: { vol: true }, log: false, cmp: [] }, corr: { u: 'MIX', win: 104, pair: null },
  brvm: { sort: { k: 'mcap', dir: -1 }, sector: 'ALL' }, dvd: { sort: { k: 'yld', dir: -1 } }, ev: { cat: '', tk: '', q: '', page: 0 }, bt: null, qlab: {} };
const FNS = [['MON', 'Marchés'], ['BRVM', 'BRVM'], ['GP', 'Graphique'], ['DES', 'Fiche'], ['BTST', 'Backtest'], ['QLAB', 'Quant Lab'], ['CORR', 'Corrélations'],
  ['SEAS', 'Saisonnalité'], ['MACRO', 'Macro & Or'], ['FX', 'Franc CFA'], ['DVD', 'Dividendes'], ['EVTS', 'Avis BRVM'], ['HELP', 'Aide']];
const SECFN = new Set(['GP', 'DES', 'BTST', 'QLAB', 'SEAS']);

const TRIGGER_ID = '__TRIGGER_ID__';

/* ---------- formatting (French conventions) ---------- */
const NF = {}; const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const num = (v, d = 2) => v == null || !isFinite(v) ? '—' : nf(d).format(v).replace(/ /g, ' ');
const pxd = s => s && (s.ccy === 'XOF' && s.cls === 'Equity') ? 0 : s && s.last < 1 ? 4 : 2;
const px = (s, v) => num(v, pxd(s));
const sgn = (v, d = 2, suf = '%', mul = 100) => v == null || !isFinite(v) ? '<span class="fl">—</span>' : `<span class="${v > 0 ? 'up' : v < 0 ? 'dn' : 'fl'}">${v > 0 ? '+' : ''}${num(v * mul, d)}${suf}</span>`;
const pc = (v, d = 2) => sgn(v, d);
const big = v => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); return a >= 1e12 ? num(v / 1e12, 2) + ' T' : a >= 1e9 ? num(v / 1e9, 1) + ' Md' : a >= 1e6 ? num(v / 1e6, 1) + ' M' : a >= 1e3 ? num(v / 1e3, 1) + ' k' : num(v, 0); };
const fd = d => d ? fmtD(d) : '—';
const fds = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—';
const i2s = d => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}-${String(d % 100).padStart(2, '0')}`;
const s2i = s => +s.replace(/-/g, '');
const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : 'fl';

/* ---------- data ---------- */
async function getJSON(path) { if (!Q.json[path]) Q.json[path] = fetch(Q.base + path, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); }); return Q.json[path]; }
async function series(id) {
  if (!Q.ser[id]) Q.ser[id] = getJSON('s/' + id.replace('.', '_') + '.json').then(b => {
    const n = b.d.length; const s = { id, f: b.f, x: b.d, d: b.d.map(i2s), c: b.c, o: b.o || b.c, h: b.h || b.c, l: b.l || b.c, v: b.v || new Array(n).fill(0), val: b.val || null, div: b.div || new Array(n).fill(0) };
    applyQuoteToSeries(s); return s; });
  return Q.ser[id];
}
async function market(id) { if (!Q.M[id]) { const s = await series(id); Q.M[id] = buildMarket({ d: s.d, o: s.o, h: s.h, l: s.l, c: s.c, v: s.v, div: s.div }); } return Q.M[id]; }
function sec(id) { return Q.by[id]; }
function secsWhere(f) { return Q.sum.secs.filter(f); }
function applyQuotes() {
  const q = Q.quotes && Q.quotes.q; if (!q) return;
  for (const [id, r] of Object.entries(q)) { const s = Q.by[id]; if (!s || !r.last) continue; const day = r.d ? s2i(r.d) : s.dt;
    if (day > s.dt) { s.prev = s.last; s.dt = day; } s.last = r.last; s.pct = r.pct != null ? r.pct : s.last / s.prev - 1; if (r.vol != null) s.shd = r.vol; s.live = true; }
}
function applyQuoteToSeries(s) {
  const q = Q.quotes && Q.quotes.q && Q.quotes.q[s.id]; if (!q || !q.last || !q.d) return; const day = s2i(q.d), n = s.x.length;
  if (day > s.x[n - 1]) { s.x.push(day); s.d.push(q.d); s.c.push(q.last); s.o.push(q.o || q.last); s.h.push(Math.max(q.h || q.last, q.last)); s.l.push(Math.min(q.l || q.last, q.last)); s.v.push(q.vol || 0); s.div.push(0); if (s.val) s.val.push(q.val || 0); s.prov = true; }
  else if (day === s.x[n - 1]) { s.c[n - 1] = q.last; s.h[n - 1] = Math.max(s.h[n - 1], q.last); s.l[n - 1] = Math.min(s.l[n - 1], q.last); if (q.vol != null) s.v[n - 1] = q.vol; }
}

/* ---------- command line ---------- */
function searchSecs(qs) {
  const q = qs.trim().toUpperCase(); if (!q) return [];
  const out = []; for (const s of Q.sum.secs) { const id = s.id.toUpperCase(), tk = s.tk.toUpperCase(), n = (s.n || '').toUpperCase(), sh = (s.short || '').toUpperCase();
    const sc = id === q ? 0 : tk.startsWith(q) ? 1 : id.startsWith(q) ? 2 : n.startsWith(q) || sh.startsWith(q) ? 3 : n.includes(q) || sh.includes(q) ? 4 : 9; if (sc < 9) out.push([sc, s]); }
  return out.sort((a, b) => a[0] - b[0] || (b[1].liq || 0) - (a[1].liq || 0)).map(x => x[1]);
}
function parseCmd(txt) {
  const toks = txt.trim().toUpperCase().replace(/<GO>|\bGO\b|EQUITY|INDEX|CURNCY|COMDTY/g, ' ').split(/\s+/).filter(Boolean);
  let fn = null, s = null; for (const t of toks) { if (!fn && FNS.some(f => f[0] === t)) { fn = t; continue; } if (t === 'AIDE') { fn = 'HELP'; continue; } if (!s) { const m = Q.by[t] || searchSecs(t)[0]; if (m) s = m.id; } }
  if (!s && toks.length > 1 && !fn) { const m = searchSecs(toks.join(' '))[0]; if (m) s = m.id; }
  return { fn, s };
}
function runCmd(txt) { const { fn, s } = parseCmd(txt); if (!fn && !s) { toast('Commande inconnue. Exemples : SNTS GP · QQQ BTST · MACRO · EVTS'); return; }
  go(fn || (SECFN.has(ST.fn) ? ST.fn : 'GP'), s || ST.sec); }
function initCmd() {
  const inp = $('cmd'), ac = $('ac'); let sel = 0, items = [];
  const show = () => { const v = inp.value; const parts = v.trim().split(/\s+/); const last = parts[parts.length - 1] || '';
    const fns = FNS.filter(f => last && (f[0].startsWith(last.toUpperCase()) || f[1].toUpperCase().startsWith(last.toUpperCase()))).map(f => ({ k: 'fn', id: f[0], a: f[0], b: f[1], c: 'FONCTION' }));
    const ss = searchSecs(last).slice(0, 12).map(s => ({ k: 'sec', id: s.id, a: s.tk, b: s.n, c: s.cls === 'Equity' ? (s.mkt === 'BRVM' ? 'BRVM' : s.typ) : s.cls }));
    items = fns.concat(ss).slice(0, 14); sel = 0;
    ac.hidden = !items.length; ac.innerHTML = items.map((it, i) => `<div class="${i === sel ? 'on' : ''}" data-i="${i}"><b>${esc(it.a)}</b><span>${esc(it.b)}</span><span>${it.c}</span></div>`).join(''); };
  const pick = i => { const it = items[i]; if (!it) return; ac.hidden = true; inp.value = ''; if (it.k === 'fn') go(it.id, ST.sec); else go(SECFN.has(ST.fn) ? ST.fn : 'GP', it.id); inp.blur(); };
  inp.addEventListener('input', show);
  inp.addEventListener('keydown', e => { if (ac.hidden) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; [...ac.children].forEach((c, i) => c.classList.toggle('on', i === sel)); }
    if (e.key === 'Tab') { e.preventDefault(); pick(sel); } if (e.key === 'Escape') { ac.hidden = true; } });
  ac.addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pick(+d.dataset.i); } });
  $('cmdForm').addEventListener('submit', e => { e.preventDefault(); if (!ac.hidden && items.length && inp.value.trim().split(/\s+/).length === 1 && !FNS.some(f => f[0] === inp.value.trim().toUpperCase())) { pick(sel); return; } const v = inp.value; ac.hidden = true; inp.value = ''; inp.blur(); runCmd(v); });
  inp.addEventListener('blur', () => setTimeout(() => { ac.hidden = true; }, 150));
  document.addEventListener('keydown', e => { if (e.target.matches('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return; if (/^[a-zA-Z0-9]$/.test(e.key)) { inp.focus(); } if (e.key === 'Escape') go('MON'); });
}

/* ---------- router ---------- */
let renderSeq = 0;
function go(fn, s) { if (fn) ST.fn = fn; if (s && Q.by[s]) ST.sec = s; try { history.replaceState(null, '', '#' + ST.fn + (SECFN.has(ST.fn) ? '~' + ST.sec : '')); } catch (e) { } render(); window.scrollTo(0, 0); }
function fromHash() { const h = decodeURIComponent(location.hash.slice(1)); if (!h) return; const [f, s] = h.split('~'); if (FNS.some(x => x[0] === f)) ST.fn = f; if (s && Q.by[s]) ST.sec = s; }
async function render() {
  const seq = ++renderSeq; untip(); renderKeys(); renderSecbar(); renderStatus();
  const m = $('main'); m.innerHTML = '<div class="empty">Chargement…</div>';
  try { await PAGES[ST.fn](m, () => seq === renderSeq); }
  catch (e) { console.error(e); if (seq === renderSeq) m.innerHTML = `<div class="empty">Impossible d'afficher cette fonction : ${esc(e.message)}</div>`; }
}
function renderKeys() { $('fkeys').innerHTML = FNS.map((f, i) => `<button class="fk ${ST.fn === f[0] ? 'on' : ''}" data-fn="${f[0]}"><em>${i + 1})</em><b>${f[0]}</b>${f[1]}</button>`).join(''); }
function renderSecbar() {
  const b = $('secbar'); if (!SECFN.has(ST.fn)) { b.hidden = true; return; } b.hidden = false; const s = sec(ST.sec);
  b.innerHTML = `<span class="tk">${s.tk}<small>${s.cls === 'Equity' ? 'Equity' : s.cls}</small></span><span class="nm">${esc(s.n)}</span>
    <span class="px">${px(s, s.last)}</span><span class="kv">${s.ccy}</span><span>${sgn(s.last - s.prev, pxd(s), '', 1)} ${pc(s.pct)}</span>
    <span class="kv">Date<b>${fd(s.dt)}${s.live ? ' · séance' : ''}</b></span>
    ${s.shd != null ? `<span class="kv">Vol<b>${num(s.shd, 0)}</b></span>` : ''}
    <span class="kv">52 sem.<b>${px(s, s.lo52)} – ${px(s, s.hi52)}</b></span><span class="kv">YTD<b>${pc(s.ytd, 1)}</b></span><span class="kv">1 an<b>${pc(s.r1y, 1)}</b></span>
    ${s.mcap ? `<span class="kv">Capi<b>${big(s.mcap)} XOF</b></span>` : ''}${s.per ? `<span class="kv">PER<b>${num(s.per, 1)}</b></span>` : ''}${s.yld ? `<span class="kv">Rdt<b>${num(s.yld * 100, 2)}%</b></span>` : ''}
    <span class="kv">${s.grp ? esc(s.grp) : ''}${s.cty ? ' · ' + esc(Q.sum.cty[s.cty] || s.cty) : ''}</span>`;
}
function renderStatus() {
  const L = Q.live && Q.live.qqq, ss = Q.sum.session;
  $('status').innerHTML = `<span>Données au <b>${fd(Q.sum.asof)}</b> · ${Q.sum.secs.length} titres · séance BRVM <b>${ss ? fds(ss.asof) : '—'}</b>${L ? ` · QQQ <b>${num(L.price, 2)}</b> (${L.state === 'REGULAR' ? 'séance' : L.state === 'CLOSED' ? 'clôturé' : L.state}, ${new Date(L.time * 1000).toISOString().slice(11, 16)} UTC)` : ''}</span>
    <span>Tapez un ticker ou une fonction puis <b>Entrée</b> · double-clic sur un graphique : vue initiale · molette : zoom</span>
    <span>Sources : Yahoo Finance · brvm.org · BRVMetrics · datasets.io — outil d'analyse, pas un conseil en investissement</span>`;
}
function clocks() { const z = [['ABJ', 'Africa/Abidjan'], ['PAR', 'Europe/Paris'], ['NY', 'America/New_York'], ['TPE', 'Asia/Taipei']];
  const t = () => { $('clocks').innerHTML = z.map(([k, tz]) => `<span>${k} <b>${new Date().toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: k === 'ABJ' ? '2-digit' : undefined })}</b></span>`).join(''); };
  t(); setInterval(t, 1000); }
function feedState() { const L = Q.live && Q.live.qqq, f = $('feed'); const age = Q.live ? Date.now() / 1000 - (Q.live.ts || 0) : 1e9;
  const live = L && L.state === 'REGULAR' && age < 40 * 60; f.classList.toggle('live', !!live);
  $('feedTxt').textContent = live ? 'FLUX 15 MIN' : Q.live ? 'MAJ ' + new Date(Q.live.ts * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'EOD ' + fd(Q.sum.asof); }
function toast(msg, ms = 6000) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- live feed (artifact db written by the sync task) + polling (static hosting) ---------- */
async function initFeed() {
  if (!window.claude || !window.claude.use) { setInterval(pollStatic, 5 * 60 * 1000); return; }
  let db = null; try { db = await window.claude.use('db'); } catch (e) { } if (!db) return;
  const apply = () => { applyQuotes(); for (const p of Object.values(Q.ser)) p.then(applyQuoteToSeries); Q.M = {}; feedState(); renderSecbar(); renderStatus(); if (['MON', 'BRVM'].includes(ST.fn)) render(); };
  try { db.doc('feed/live').onSnapshot(sn => { if (sn.exists) { const d = sn.data(); if (!Q.live || (d.ts || 0) >= (Q.live.ts || 0)) { Q.live = d; apply(); } } }, () => { }); } catch (e) { }
  try { db.doc('feed/quotes').onSnapshot(sn => { if (sn.exists) { const d = sn.data(); if (!Q.quotes || (d.ts || 0) >= (Q.quotes.ts || 0)) { Q.quotes = d; apply(); } } }, () => { }); } catch (e) { }
}
async function pollStatic() { try { const [l, q] = await Promise.all([fetch(Q.base + 'live.json?t=' + Date.now()).then(r => r.ok ? r.json() : null), fetch(Q.base + 'quotes.json?t=' + Date.now()).then(r => r.ok ? r.json() : null)]);
  if (l) Q.live = l; if (q) { Q.quotes = q; applyQuotes(); Q.ser = {}; Q.M = {}; } feedState(); renderSecbar(); renderStatus(); if (['MON', 'BRVM'].includes(ST.fn)) render(); } catch (e) { } }
async function initSync() {
  if (!/^trig_/.test(TRIGGER_ID) || !window.claude || !window.claude.use) return; let mcp = null; try { mcp = await window.claude.use('mcp'); } catch (e) { } if (!mcp) return;
  const b = $('syncBtn'); b.hidden = false;
  b.addEventListener('click', async () => { b.disabled = true; b.textContent = '…';
    try { await mcp.callTool('Claude Code Remote', 'fire_trigger', { trigger_id: TRIGGER_ID }, { cache: false }); toast('Synchronisation lancée : le dernier relevé GitHub (15 min) arrive dans 2 à 4 minutes, sans recharger la page.', 9000); b.textContent = 'OK'; }
    catch (e) { const c = e && e.code; b.textContent = 'SYNC'; toast(c === 'rate_limited' ? 'Trop de demandes rapprochées : réessaie dans quelques minutes.' : c === 'not_granted' || c === 'consent_required' ? 'Autorisation refusée : ouvre le menu Autorisations de la page.' : 'La synchro n’a pas pu être lancée (' + (c || 'erreur') + '). La mise à jour planifiée tourne quand même.', 9000); }
    finally { setTimeout(() => { b.disabled = false; b.textContent = 'SYNC'; }, 60000); } });
}

/* ---------- boot ---------- */
async function boot() {
  readCL(); renderKeysSkeleton();
  try { Q.sum = await getJSON('summary.json'); } catch (e) { $('main').innerHTML = `<div class="empty">Données introuvables (data/summary.json).</div>`; return; }
  for (const s of Q.sum.secs) Q.by[s.id] = s;
  try { Q.live = await getJSON('live.json'); } catch (e) { } try { Q.quotes = await getJSON('quotes.json'); applyQuotes(); } catch (e) { }
  fromHash(); initCmd(); clocks(); feedState();
  document.addEventListener('click', e => { const f = e.target.closest('[data-fn]'); if (f) { go(f.dataset.fn, f.dataset.s); return; }
    const s = e.target.closest('[data-sec]'); if (s && !e.target.closest('a')) { const id = s.dataset.sec; go(s.dataset.to || (SECFN.has(ST.fn) ? ST.fn : 'GP'), id); } });
  render(); initFeed(); initSync();
}
function renderKeysSkeleton() { $('fkeys').innerHTML = FNS.map((f, i) => `<button class="fk" data-fn="${f[0]}"><em>${i + 1})</em><b>${f[0]}</b>${f[1]}</button>`).join(''); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
