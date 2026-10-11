/* ================= FQT — quant engine (pure functions, no DOM) ================= */
'use strict';

/* Approximate effective Fed Funds rate by quarter (annual %). Used for cash yield and leveraged-ETF financing. */
const RF_Y = { 2000: 6.2, 2001: 3.9, 2002: 1.7, 2003: 1.1, 2004: 1.35, 2005: 3.2, 2006: 5.0, 2007: 5.0, 2008: 1.9, 2009: .16, 2010: .18, 2011: .1, 2012: .14, 2013: .11, 2014: .09, 2015: .13, 2016: .4 };
const RF_Q = {
  '2016Q3': .40, '2016Q4': .41, '2017Q1': .70, '2017Q2': .95, '2017Q3': 1.15, '2017Q4': 1.20, '2018Q1': 1.45, '2018Q2': 1.74,
  '2018Q3': 1.92, '2018Q4': 2.22, '2019Q1': 2.40, '2019Q2': 2.40, '2019Q3': 2.15, '2019Q4': 1.64, '2020Q1': 1.26,
  '2020Q2': .06, '2020Q3': .09, '2020Q4': .09, '2021Q1': .08, '2021Q2': .07, '2021Q3': .08, '2021Q4': .08,
  '2022Q1': .12, '2022Q2': .77, '2022Q3': 2.19, '2022Q4': 3.65, '2023Q1': 4.52, '2023Q2': 4.99, '2023Q3': 5.26,
  '2023Q4': 5.33, '2024Q1': 5.33, '2024Q2': 5.33, '2024Q3': 5.26, '2024Q4': 4.65, '2025Q1': 4.33, '2025Q2': 4.33,
  '2025Q3': 4.29, '2025Q4': 3.89, '2026Q1': 3.64, '2026Q2': 3.62
};
function rfFor(d) {
  const k = d.slice(0, 4) + 'Q' + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1);
  if (RF_Q[k] != null) return RF_Q[k];
  const y = +d.slice(0, 4); if (RF_Y[y] != null) return RF_Y[y];
  return y < 2000 ? 5 : 3.6; // after the table: last known level
}

const U = {
  sma(a, n) { const o = new Float64Array(a.length).fill(NaN); let s = 0, k = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; k++; if (k > n) s -= a[i - n]; if (k >= n) o[i] = s / n; } return o; },
  ema(a, n, start = 0) { const o = new Float64Array(a.length).fill(NaN); const k = 2 / (n + 1); let e = NaN;
    for (let i = start; i < a.length; i++) { const v = a[i]; if (!isFinite(v)) continue; e = isFinite(e) ? v * k + e * (1 - k) : v; o[i] = e; } return o; },
  rsi(c, n) { const o = new Float64Array(c.length).fill(NaN); let ag = 0, al = 0;
    for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
      if (i <= n) { ag += g / n; al += l / n; if (i === n) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
      else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    return o; },
  rollStd(r, n) { const o = new Float64Array(r.length).fill(NaN); let s = 0, s2 = 0;
    for (let i = 0; i < r.length; i++) { s += r[i]; s2 += r[i] * r[i]; if (i >= n) { s -= r[i - n]; s2 -= r[i - n] * r[i - n]; }
      if (i >= n) { const m = s / n; o[i] = Math.sqrt(Math.max(0, (s2 / n - m * m) * n / (n - 1))); } } return o; },
  rollMax(a, n) { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (a[j] > m) m = a[j]; o[i] = m; } return o; },
  mean(a) { let s = 0; for (const v of a) s += v; return s / a.length; },
  std(a) { const m = U.mean(a); let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / Math.max(1, a.length - 1)); },
  q(sorted, p) { if (!sorted.length) return NaN; const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); },
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
  hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); },
  lgamma(x) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, .1208650973866179e-2, -.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + .5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); },
  betaPdf(p, a, b) { if (p <= 0 || p >= 1) return 0; return Math.exp((a - 1) * Math.log(p) + (b - 1) * Math.log(1 - p) + U.lgamma(a + b) - U.lgamma(a) - U.lgamma(b)); }
};

/* ---------------------------------------------------------------- market model */
function buildMarket(H) {
  const n = H.d.length, M = { d: H.d, o: H.o, h: H.h, l: H.l, c: H.c, v: H.v, div: H.div, n };
  M.r = new Float64Array(n); M.lr = new Float64Array(n); M.tr = new Float64Array(n); M.tr[0] = 1;
  for (let i = 1; i < n; i++) { M.r[i] = (H.c[i] + (H.div[i] || 0)) / H.c[i - 1] - 1; M.lr[i] = Math.log(1 + M.r[i]); M.tr[i] = M.tr[i - 1] * (1 + M.r[i]); }
  M.rf = Float64Array.from(H.d, rfFor);
  M.sma20 = U.sma(H.c, 20); M.sma50 = U.sma(H.c, 50); M.sma200 = U.sma(H.c, 200);
  M.rsi14 = U.rsi(H.c, 14);
  const sd = U.rollStd(M.lr, 20); M.vol20 = sd.map(v => v * Math.sqrt(252));
  M.hi252 = U.rollMax(H.c, 252);
  M.mom63 = new Float64Array(n).fill(NaN); for (let i = 63; i < n; i++) M.mom63[i] = M.tr[i] / M.tr[i - 63] - 1;
  M.er20 = new Float64Array(n).fill(NaN);
  for (let i = 20; i < n; i++) { let p = 0; for (let j = i - 19; j <= i; j++) p += Math.abs(H.c[j] - H.c[j - 1]); M.er20[i] = p > 0 ? Math.abs(H.c[i] - H.c[i - 20]) / p : 0; }
  return M;
}

/* ---------------------------------------------------------------- strategies */
const STRATS = {
  sma:   { name: 'SMA200 · LEVIER', short: 'SMA', d: { n: 200, band: 0 }, uses: ['n', 'band'],
           desc: "Ton algo : long (avec levier) quand QQQ clôture au-dessus de sa SMA N, cash sinon. La bande ± % évite les allers-retours quand le prix colle à la moyenne." },
  smavt: { name: 'TREND × VOL TARGET', short: 'TVT', d: { n: 200, band: 0, tv: 35 }, uses: ['n', 'band', 'tv'],
           desc: "Filtre SMA N, puis taille de position = vol cible / (levier × vol réalisée 20 j). Réduit l'exposition quand la volatilité explose." },
  cross: { name: 'GOLDEN CROSS', short: 'GX', d: { n: 200, fast: 50 }, uses: ['n', 'fast'],
           desc: "Long quand la SMA rapide est au-dessus de la SMA lente (50/200 par défaut)." },
  donch: { name: 'DONCHIAN BREAKOUT', short: 'DON', d: { n: 55, fast: 20 }, uses: ['n', 'fast'],
           desc: "Entrée sur plus haut de N jours, sortie sur plus bas de « rapide » jours (tortues)." },
  mom:   { name: 'ABS MOMENTUM', short: 'MOM', d: { n: 252 }, uses: ['n'],
           desc: "Fin de mois : long si le rendement total sur N jours bat le cash, sinon cash." },
  rsi2:  { name: 'RSI(2) MEAN-REV', short: 'RSI', d: { n: 200 }, uses: ['n'],
           desc: "Achète les replis (RSI2 < 10) en tendance haussière (prix > SMA N), sort au-dessus de la SMA5 ou après 10 jours." },
  vt:    { name: 'VOL TARGET', short: 'VT', d: { tv: 25 }, uses: ['tv'],
           desc: "Toujours investi, exposition = vol cible / (levier × vol réalisée 20 j), plafonnée à 100 %." },
  bh:    { name: 'BUY & HOLD', short: 'B&H', d: {}, uses: [],
           desc: "Référence : investi en permanence avec le levier choisi." }
};
const DEFAULT_P = { strat: 'sma', n: 200, fast: 50, band: 0, tv: 35, lev: 3, exec: 'close', fee: 1, slip: 2, spread: .5, er: .84,
                    cash: 1, cap: 10000, start: '2017-11-01', ruin: 50, block: 20 };

function warmup(P) {
  switch (P.strat) { case 'sma': case 'smavt': case 'cross': return Math.max(P.n, P.fast || 0) + 1;
    case 'donch': return Math.max(P.n, P.fast) + 1; case 'mom': return P.n + 1; case 'rsi2': return Math.max(P.n, 5) + 1;
    case 'vt': return 22; default: return 1; }
}

function signals(M, P) {
  const n = M.n, c = M.c, e = new Float64Array(n), S = P.strat;
  if (S === 'bh') { e.fill(1); return e; }
  const vtLevel = (i, cur) => { const v = M.vol20[i]; if (!isFinite(v) || v <= 0) return cur; const t = Math.min(1, (P.tv / 100) / (P.lev * v));
    const r = Math.round(t * 20) / 20; return Math.abs(r - cur) >= .1 || (r === 1 && cur < 1 && cur > .85) ? r : cur; };
  if (S === 'sma' || S === 'smavt') {
    const s = U.sma(c, P.n), b = P.band / 100; let inn = false, lvl = 1;
    for (let i = 0; i < n; i++) {
      if (!isFinite(s[i])) { e[i] = 0; continue; }
      if (!inn && c[i] > s[i] * (1 + b)) inn = true; else if (inn && c[i] < s[i] * (1 - b)) inn = false;
      if (S === 'smavt') { lvl = vtLevel(i, inn ? lvl : 1); e[i] = inn ? lvl : 0; } else e[i] = inn ? 1 : 0;
    }
    return e;
  }
  if (S === 'cross') { const f = U.sma(c, P.fast), s = U.sma(c, P.n); for (let i = 0; i < n; i++) e[i] = isFinite(s[i]) && f[i] > s[i] ? 1 : 0; return e; }
  if (S === 'donch') {
    let inn = false; for (let i = 0; i < n; i++) {
      if (i < Math.max(P.n, P.fast)) continue;
      let hi = -Infinity, lo = Infinity; for (let j = i - P.n; j < i; j++) if (M.h[j] > hi) hi = M.h[j];
      for (let j = i - P.fast; j < i; j++) if (M.l[j] < lo) lo = M.l[j];
      if (!inn && c[i] > hi) inn = true; else if (inn && c[i] < lo) inn = false; e[i] = inn ? 1 : 0;
    } return e;
  }
  if (S === 'mom') {
    let inn = false; for (let i = 0; i < n; i++) {
      const eom = i === n - 1 || M.d[i].slice(0, 7) !== M.d[i + 1].slice(0, 7);
      if (eom && i > P.n) { const ret = M.tr[i] / M.tr[i - P.n] - 1; let rfc = 0; for (let j = i - P.n + 1; j <= i; j++) rfc += M.rf[j] / 100 / 252; inn = ret > rfc; }
      e[i] = inn ? 1 : 0;
    } return e;
  }
  if (S === 'rsi2') {
    const r2 = U.rsi(c, 2), s = U.sma(c, P.n), s5 = U.sma(c, 5); let inn = false, k = 0;
    for (let i = 0; i < n; i++) {
      if (!isFinite(s[i])) continue;
      if (!inn) { if (r2[i] < 10 && c[i] > s[i]) { inn = true; k = 0; } }
      else { k++; if (c[i] > s5[i] || k >= 10) inn = false; }
      e[i] = inn ? 1 : 0;
    } return e;
  }
  if (S === 'vt') { let cur = 0; for (let i = 0; i < n; i++) { cur = vtLevel(i, cur || 1); e[i] = isFinite(M.vol20[i]) ? cur : 0; } return e; }
  return e;
}

function runBacktest(M, P) {
  const t0 = performance.now(), n = M.n, c = M.c, o = M.o, L = +P.lev, cst = (+P.fee + +P.slip) / 1e4;
  const sig = signals(M, P);
  let s0 = M.d.findIndex(d => d >= P.start); if (s0 < 0) s0 = 0; s0 = Math.max(s0, warmup(P)); s0 = Math.min(s0, n - 30);
  const s1 = n - 1;
  const eq = new Float64Array(n).fill(NaN), bh = new Float64Array(n).fill(NaN), bh3 = new Float64Array(n).fill(NaN), ex = new Float64Array(n);
  eq[s0] = bh[s0] = bh3[s0] = +P.cap;
  let e = P.exec === 'open' ? 0 : sig[s0]; eq[s0] *= 1 - e * cst; ex[s0] = e;
  const trades = []; let open = e > 0 ? { i: s0, eq: eq[s0], px: c[s0] } : null; let nOrders = e > 0 ? 1 : 0;
  const book = (i, from, to, v, px) => {
    nOrders++;
    if (from === 0 && to > 0) open = { i, eq: v, px };
    else if (from > 0 && to === 0 && open) { trades.push({ i0: open.i, i1: i, ret: v / open.eq - 1, days: i - open.i, px0: open.px, px1: px }); open = null; }
  };
  for (let i = s0 + 1; i <= s1; i++) {
    const rf = M.rf[i] / 100, cashR = +P.cash ? rf / 252 : 0;
    const carry = ((L - 1) * (rf + P.spread / 100) + (L > 1 ? P.er / 100 : .002)) / 252;
    const carry3 = (2 * (rf + P.spread / 100) + P.er / 100) / 252;
    bh[i] = bh[i - 1] * (1 + M.r[i]); bh3[i] = bh3[i - 1] * (1 + 3 * M.r[i] - carry3);
    let v = eq[i - 1];
    if (P.exec === 'open') {
      const ron = o[i] / c[i - 1] - 1, rid = (c[i] + (M.div[i] || 0)) / o[i] - 1;
      v *= 1 + e * (L * ron - carry / 2) + (1 - e) * cashR / 2;
      const ne = sig[i - 1]; if (ne !== e) { v *= 1 - Math.abs(ne - e) * cst; book(i, e, ne, v, o[i]); e = ne; }
      v *= 1 + e * (L * rid - carry / 2) + (1 - e) * cashR / 2;
    } else {
      v *= 1 + e * (L * M.r[i] - carry) + (1 - e) * cashR;
      const ne = sig[i]; if (ne !== e) { v *= 1 - Math.abs(ne - e) * cst; book(i, e, ne, v, c[i]); e = ne; }
    }
    eq[i] = Math.max(v, 1e-9); ex[i] = e;
  }
  const st = stats(eq, s0, s1, M);
  const closed = trades.filter(t => isFinite(t.ret)); const wins = closed.filter(t => t.ret > 0), losses = closed.filter(t => t.ret <= 0);
  const avgW = wins.length ? U.mean(wins.map(t => t.ret)) : 0, avgL = losses.length ? U.mean(losses.map(t => t.ret)) : 0;
  st.trades = closed.length + (open ? 1 : 0); st.closed = closed.length; st.orders = nOrders;
  st.win = closed.length ? wins.length / closed.length : NaN;
  st.rr = avgL < 0 ? avgW / -avgL : (wins.length ? Infinity : NaN);
  st.pf = losses.length ? wins.reduce((a, t) => a + t.ret, 0) / -losses.reduce((a, t) => a + t.ret, 0) : Infinity;
  let expo = 0; for (let i = s0; i <= s1; i++) expo += ex[i] > 0 ? 1 : 0; st.expo = expo / (s1 - s0 + 1);
  st.lastDay = eq[s1] - eq[s1 - 1];
  const res = { P: { ...P }, sig, eq, bh, bh3, ex, s0, s1, trades, open: open ? { ...open, ret: eq[s1] / open.eq - 1, days: s1 - open.i } : null,
    st, stB: stats(bh, s0, s1, M), stB3: stats(bh3, s0, s1, M), ms: performance.now() - t0 };
  res.id = '0x' + U.hash(JSON.stringify(P)).slice(0, 2) + '…' + U.hash(JSON.stringify(P) + 'x').slice(-4) + '-' + Date.parse(M.d[s1] + 'T20:00:00Z');
  return res;
}

function stats(eq, s0, s1, M) {
  const N = s1 - s0, rets = new Float64Array(N), ex = new Float64Array(N);
  for (let k = 0; k < N; k++) { rets[k] = eq[s0 + k + 1] / eq[s0 + k] - 1; ex[k] = rets[k] - M.rf[s0 + k + 1] / 100 / 252; }
  const years = N / 252, total = eq[s1] / eq[s0] - 1, cagr = Math.pow(eq[s1] / eq[s0], 1 / years) - 1;
  const sd = U.std(rets), mex = U.mean(ex);
  let dsum = 0, dn = 0; for (const x of ex) { if (x < 0) { dsum += x * x; } dn++; }
  const dsd = Math.sqrt(dsum / Math.max(1, dn));
  let peak = eq[s0], mdd = 0, mddI = s0, curDur = 0, maxDur = 0;
  const dd = new Float64Array(eq.length).fill(NaN);
  for (let i = s0; i <= s1; i++) { if (eq[i] >= peak) { peak = eq[i]; curDur = 0; } else curDur++; maxDur = Math.max(maxDur, curDur); dd[i] = eq[i] / peak - 1; if (dd[i] < mdd) { mdd = dd[i]; mddI = i; } }
  const yearly = {}; let prevEnd = eq[s0];
  for (let i = s0 + 1; i <= s1; i++) { const y = M.d[i].slice(0, 4); const last = i === s1 || M.d[i + 1].slice(0, 4) !== y; if (last) { yearly[y] = eq[i] / prevEnd - 1; prevEnd = eq[i]; } }
  return { total, cagr, vol: sd * Math.sqrt(252), sharpe: sd > 0 ? mex / sd * Math.sqrt(252) : 0, sortino: dsd > 0 ? mex / dsd * Math.sqrt(252) : 0,
    mdd, mddI, maxDur, ddNow: dd[s1], dd, calmar: mdd < 0 ? cagr / -mdd : Infinity, yearly, rets, years, final: eq[s1] };
}

function leaderboard(M, P) {
  return Object.keys(STRATS).map(k => { const p = { ...P, ...STRATS[k].d, strat: k }; const r = runBacktest(M, p);
    return { k, name: STRATS[k].name, sharpe: r.st.sharpe, cagr: r.st.cagr, mdd: r.st.mdd, final: r.st.final, calmar: r.st.calmar, trades: r.st.trades }; })
    .sort((a, b) => b.sharpe - a.sharpe);
}

/* ---------------------------------------------------------------- drawdown survival (Kaplan-Meier) */
function ddEpisodes(eq, s0, s1, minDepth = .05) {
  const eps = []; let peak = eq[s0], pi = s0, depth = 0, inDD = false;
  for (let i = s0 + 1; i <= s1; i++) {
    if (eq[i] >= peak) { if (inDD && depth >= minDepth) eps.push({ s: pi, e: i, dur: i - pi, depth, cens: false }); inDD = false; peak = eq[i]; pi = i; depth = 0; }
    else { inDD = true; depth = Math.max(depth, 1 - eq[i] / peak); }
  }
  if (inDD && depth >= minDepth) eps.push({ s: pi, e: s1, dur: s1 - pi, depth, cens: true });
  return eps;
}
function kaplanMeier(eps) {
  const ts = [...new Set(eps.filter(e => !e.cens).map(e => e.dur))].sort((a, b) => a - b); let S = 1; const out = [{ t: 0, S: 1 }];
  for (const t of ts) { const atRisk = eps.filter(e => e.dur >= t).length, d = eps.filter(e => !e.cens && e.dur === t).length; if (atRisk) S *= 1 - d / atRisk; out.push({ t, S }); }
  return out;
}
function kmQuantile(curve, q) { for (const p of curve) if (p.S <= 1 - q) return p.t; return Infinity; }

/* ---------------------------------------------------------------- Monte Carlo (stationary block bootstrap) */
function monteCarlo(rets, { H = 252, N = 1000, block = 20, ruin = .5, seed = 7, keep = 240 } = {}) {
  const t0 = performance.now(), rng = U.rng(seed), L = rets.length, B = Math.max(1, Math.min(block, L - 1));
  const stride = 3, S = Math.floor(H / stride) + 1, grid = new Float32Array(N * S), term = new Float64Array(N), ruinF = new Uint8Array(N), paths = [];
  let ruined = 0;
  for (let p = 0; p < N; p++) {
    let v = 1, peak = 1, ru = 0, pos = 0; const path = p < keep ? new Float32Array(H + 1) : null; if (path) path[0] = 1; grid[p * S] = 1;
    for (let t = 0; t < H; t++) {
      if (t % B === 0) pos = Math.floor(rng() * (L - B));
      v *= 1 + rets[pos + (t % B)]; if (v > peak) peak = v; if (!ru && v / peak <= 1 - ruin) ru = 1;
      if (path) path[t + 1] = v; if ((t + 1) % stride === 0) grid[p * S + (t + 1) / stride] = v;
    }
    term[p] = v; ruinF[p] = ru; ruined += ru; if (path) paths.push(path);
  }
  const bands = []; const col = new Float64Array(N);
  for (let s = 0; s < S; s++) { for (let p = 0; p < N; p++) col[p] = grid[p * S + s]; const so = Array.from(col).sort((a, b) => a - b);
    bands.push({ t: s * stride, q05: U.q(so, .05), q25: U.q(so, .25), q50: U.q(so, .5), q75: U.q(so, .75), q95: U.q(so, .95) }); }
  const ts = Array.from(term).sort((a, b) => a - b);
  return { paths, ruinF, term, ts, pRuin: ruined / N, bands, H, N, ms: performance.now() - t0,
    med: U.q(ts, .5), p05: U.q(ts, .05), p95: U.q(ts, .95), pLoss: ts.filter(x => x < 1).length / N };
}

/* ---------------------------------------------------------------- Ehlers Hilbert phase + Kuramoto order parameter */
function ehlersPhase(lp) {
  const n = lp.length, ph = new Float64Array(n).fill(NaN); let st = 0; while (st < n && !isFinite(lp[st])) st++;
  const e1 = U.ema(lp, 10, st), e2 = U.ema(lp, 40, st), x = new Float64Array(n).fill(NaN);
  for (let i = st; i < n; i++) x[i] = e1[i] - e2[i];
  for (let i = st + 46; i < n; i++) { const Q = .0962 * x[i] + .5769 * x[i - 2] - .5769 * x[i - 4] - .0962 * x[i - 6], I = x[i - 3]; ph[i] = Math.atan2(Q, I); }
  return ph;
}
function kuramoto(M, MK) {
  const names = ['QQQ', ...Object.keys(MK)], n = M.n;
  const series = names.map(k => k === 'QQQ' ? Array.from(M.c, Math.log) : MK[k].map(v => v == null ? NaN : Math.log(v)));
  const phases = series.map(ehlersPhase);
  const R = new Float64Array(n).fill(NaN), PSI = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { let cs = 0, sn = 0, k = 0; for (const ph of phases) if (isFinite(ph[i])) { cs += Math.cos(ph[i]); sn += Math.sin(ph[i]); k++; }
    if (k >= 10) { R[i] = Math.hypot(cs, sn) / k; PSI[i] = Math.atan2(sn, cs); } }
  const last = n - 1, psi = PSI[last];
  const lr = series.map(s => { const o = []; for (let i = n - 60; i < n; i++) o.push(s[i] - s[i - 1]); return o; });
  let csum = 0, cn = 0;
  for (let a = 0; a < lr.length; a++) for (let b = a + 1; b < lr.length; b++) {
    const x = lr[a], y = lr[b]; if (x.some(v => !isFinite(v)) || y.some(v => !isFinite(v))) continue;
    const mx = U.mean(x), my = U.mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; }
    if (sx > 0 && sy > 0) { csum += sxy / Math.sqrt(sx * sy); cn++; } }
  const mk = names.map((k, j) => { const th = phases[j][last]; const s = series[j];
    return { k, th, align: isFinite(th) ? Math.cos(th - psi) : NaN, ret1: Math.exp(s[last] - s[last - 1]) - 1, ret5: Math.exp(s[last] - s[last - 5]) - 1 }; })
    .filter(m => isFinite(m.align));
  const locked = mk.filter(m => m.align > Math.SQRT1_2).length;
  const imp = mk.slice().sort((a, b) => Math.abs(b.ret1) - Math.abs(a.ret1))[0];
  return { R, PSI, r: R[last], psi, K: cn ? csum / cn : NaN, mk, locked, imp, hist: Array.from(R.slice(n - 30)) };
}

/* ---------------------------------------------------------------- analog matcher (z-normalised k-NN + DTW refine) */
function dtw(a, b, band) {
  const n = a.length, INF = 1e18; let prev = new Float64Array(n + 1).fill(INF), cur = new Float64Array(n + 1).fill(INF); prev[0] = 0;
  for (let i = 1; i <= n; i++) { cur.fill(INF); const lo = Math.max(1, i - band), hi = Math.min(n, i + band);
    for (let j = lo; j <= hi; j++) { const c = Math.abs(a[i - 1] - b[j - 1]); cur[j] = c + Math.min(prev[j], prev[j - 1], cur[j - 1]); } [prev, cur] = [cur, prev]; }
  return prev[n] / n;
}
function zn(a) { const m = U.mean(a); let s = 0; for (const v of a) s += (v - m) ** 2; s = Math.sqrt(s / a.length) || 1; return a.map(v => (v - m) / s); }
function analogMatch(M, MK, { W = 64, H = 26, K = 6, name = 'SELF' } = {}) {
  const t0 = performance.now(), n = M.n;
  const libs = [{ k: name, self: true, a: Array.from(M.c, Math.log) }, ...Object.keys(MK).map(k => ({ k, a: MK[k].map(v => v == null ? NaN : Math.log(v)) }))];
  const cur = libs[0].a.slice(n - W), zc = zn(cur), sdCur = Math.sqrt(U.mean(cur.map(v => (v - U.mean(cur)) ** 2)));
  const cand = []; let scanned = 0, thr = -1; const corrHist = new Uint32Array(40); const bar = [];
  for (const L of libs) {
    const a = L.a, len = a.length, P1 = new Float64Array(len + 1), P2 = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) { const v = isFinite(a[i]) ? a[i] : 0; P1[i + 1] = P1[i] + v; P2[i + 1] = P2[i] + v * v; }
    let first = 0; while (first < len && !isFinite(a[first])) first++;
    const lastEnd = L.self ? n - W - H - 1 : len - 1 - H;
    for (let e = first + W - 1; e <= lastEnd; e++) {
      const s = e - W + 1, m = (P1[e + 1] - P1[s]) / W, vr = (P2[e + 1] - P2[s]) / W - m * m; if (vr <= 1e-12) continue;
      let dot = 0; for (let k = 0; k < W; k++) dot += zc[k] * a[s + k];
      const corr = dot / (W * Math.sqrt(vr)); scanned++;
      corrHist[Math.min(39, Math.max(0, Math.floor((corr + 1) * 20)))]++;
      if (L.self) bar.push(corr);
      if (corr > thr) { cand.push({ k: L.k, e, corr, sd: Math.sqrt(vr), lib: L }); if (cand.length > 160) { cand.sort((x, y) => y.corr - x.corr); cand.length = 120; thr = cand[cand.length - 1].corr; } }
    }
  }
  cand.sort((x, y) => y.corr - x.corr);
  for (const c of cand) { c.z = zn(c.lib.a.slice(c.e - W + 1, c.e + 1)); c.dtw = dtw(zc, c.z, 6); }
  cand.sort((x, y) => x.dtw - y.dtw);
  const pick = [];
  for (const c of cand) { if (pick.some(p => p.k === c.k && Math.abs(p.e - c.e) < 20)) continue; pick.push(c); if (pick.length === K) break; }
  for (const p of pick) {
    const a = p.lib.a, sc = sdCur / p.sd;
    p.fwd = []; for (let j = 0; j <= H; j++) p.fwd.push(Math.exp((a[p.e + j] - a[p.e]) * sc) - 1);
    p.date = (p.k === 'QQQ' || true) ? M.d[p.e] : '';
    p.final = p.fwd[H]; delete p.lib;
  }
  const finals = pick.map(p => p.final).sort((a, b) => a - b);
  const up = finals.filter(x => x > 0).length;
  const curPct = cur.map(v => Math.exp(v - cur[W - 1]) - 1);
  const nb = 150, binned = []; for (let b = 0; b < nb; b++) { const lo = Math.floor(b * bar.length / nb), hi = Math.floor((b + 1) * bar.length / nb); let mx = -1; for (let i = lo; i < hi; i++) mx = Math.max(mx, bar[i]); binned.push(mx); }
  return { W, H, K, zc, curPct, sdCur, pick, up, down: pick.length - up, median: U.q(finals, .5), target: U.q(finals, .8), stop: U.q(finals, .2),
    match: Math.max(...pick.map(p => p.corr)), dtwBest: Math.min(...pick.map(p => p.dtw)), scanned, ms: performance.now() - t0, corrHist: Array.from(corrHist), barcode: binned };
}

/* ---------------------------------------------------------------- Bayesian update (tempered naive Bayes) */
function bayes(M, R, Hf = 21) {
  const n = M.n;
  const F = [
    { k: 'PRICE > SMA200', f: i => M.c[i] > M.sma200[i] },
    { k: 'SMA50 > SMA200', f: i => M.sma50[i] > M.sma200[i] },
    { k: 'MOMENTUM 3M > 0', f: i => M.mom63[i] > 0 },
    { k: 'VOL 20J < 20%', f: i => M.vol20[i] < .20 },
    { k: 'RSI14 > 70', f: i => M.rsi14[i] > 70 },
    { k: 'DD 52S > −5%', f: i => M.c[i] / M.hi252[i] - 1 > -.05 },
    { k: 'EFFICIENCY > 0.3', f: i => M.er20[i] > .3 }
  ];
  if (R) F.push({ k: 'SYNC R > 0.6', f: i => R[i] > .6 });
  const i0 = Math.min(260, Math.max(60, n - 400)), i1 = n - 1 - Hf, Y = [], X = [], fwd = [];
  for (let i = i0; i <= i1; i++) { const r = M.tr[i + Hf] / M.tr[i] - 1; fwd.push(r); Y.push(r > 0 ? 1 : 0); X.push(F.map(ft => ft.f(i) ? 1 : 0)); }
  const T = Y.length, up = Y.reduce((a, b) => a + b, 0), dn = T - up, p0 = up / T;
  const cnt = F.map((_, k) => { let u1 = 0, d1 = 0; for (let t = 0; t < T; t++) if (X[t][k]) { if (Y[t]) u1++; else d1++; } return { u1, d1, u0: up - u1, d0: dn - d1 }; });
  const llr = (k, v) => { const c = cnt[k]; return v ? Math.log(((c.u1 + 1) / (up + 2)) / ((c.d1 + 1) / (dn + 2))) : Math.log(((c.u0 + 1) / (up + 2)) / ((c.d0 + 1) / (dn + 2))); };
  const lo0 = Math.log(p0 / (1 - p0)), sig = z => 1 / (1 + Math.exp(-z));
  let bestL = 1, bestLoss = Infinity;
  for (let lam = 0; lam <= 1.0001; lam += .05) { let loss = 0; for (let t = 0; t < T; t++) { let z = lo0; for (let k = 0; k < F.length; k++) z += lam * llr(k, X[t][k]); const p = U.clamp(sig(z), 1e-6, 1 - 1e-6); loss -= Y[t] ? Math.log(p) : Math.log(1 - p); }
    if (loss < bestLoss) { bestLoss = loss; bestL = lam; } }
  const lam = bestL;
  const postAt = i => { let z = lo0; for (let k = 0; k < F.length; k++) z += lam * llr(k, F[k].f(i) ? 1 : 0); return sig(z); };
  const last = n - 1, cur = F.map(ft => ft.f(last) ? 1 : 0);
  const ev = F.map((ft, k) => ({ k: ft.k, v: cur[k], llr: lam * llr(k, cur[k]) }));
  const post = postAt(last);
  let nMatch = 0, uMatch = 0; for (let t = 0; t < T; t++) if (X[t].every((v, k) => v === cur[k])) { nMatch++; uMatch += Y[t]; }
  const ups = fwd.filter(r => r > 0), dns = fwd.filter(r => r <= 0), avgUp = U.mean(ups), avgDn = U.mean(dns);
  const EV = post * avgUp + (1 - post) * avgDn, b = avgUp / -avgDn, kelly = post - (1 - post) / b;
  const kap = 40, a0 = p0 * kap, b0 = (1 - p0) * kap, kp = kap + Math.min(400, nMatch), a1 = post * kp, b1 = (1 - post) * kp;
  const lik = nMatch >= 5 ? { a: uMatch + 1, b: nMatch - uMatch + 1 } : { a: a1, b: b1 };
  let kl = 0; const G = 600; for (let g = 1; g < G; g++) { const p = g / G, q1 = U.betaPdf(p, a1, b1), q0 = U.betaPdf(p, a0, b0); if (q1 > 1e-12 && q0 > 1e-12) kl += q1 * Math.log(q1 / q0) / G; }
  const hist = []; for (let i = n - 40; i < n; i++) hist.push(postAt(i));
  return { F, ev, p0, post, lam, T, nMatch, uMatch, avgUp, avgDn, EV, kelly, a0, b0, a1, b1, lik, kl, conf: nMatch / (nMatch + 50), hist, Hf };
}

/* ---------------------------------------------------------------- tape pressure (aurora) */
function tapePressure(M, N = 200) {
  const n = M.n, s = n - N, out = [];
  let cvd = 0; const vols = []; for (let i = n - N - 60; i < n; i++) vols.push(M.v[i]);
  for (let i = s; i < n; i++) {
    const rng = M.h[i] - M.l[i], clv = rng > 0 ? ((M.c[i] - M.l[i]) - (M.h[i] - M.c[i])) / rng : 0;
    const buy = M.v[i] * (1 + clv) / 2, sell = M.v[i] * (1 - clv) / 2; cvd += buy - sell;
    const win = []; for (let j = i - 60; j < i; j++) win.push(M.v[j]); const mu = U.mean(win), sd = U.std(win);
    out.push({ i, d: M.d[i], clv, buy, sell, cvd, vz: sd > 0 ? (M.v[i] - mu) / sd : 0, er: M.er20[i], dollar: M.v[i] * M.c[i] });
  }
  let c20 = 0; for (let k = out.length - 20; k < out.length; k++) c20 += out[k].buy - out[k].sell;
  return { rows: out, cvd20: c20, er: M.er20[n - 1] };
}

/* ---------------------------------------------------------------- momentum membrane */
const HORIZONS = [2, 3, 5, 8, 13, 21, 34, 55, 75, 100, 130, 160, 190, 220, 240, 252];
function membrane(M, T = 150) {
  const n = M.n; const lr = []; for (let i = n - 252; i < n; i++) lr.push(M.lr[i]); const sd = U.std(lr);
  const rows = HORIZONS.map(h => { const z = []; for (let i = n - T; i < n; i++) z.push(Math.log(M.tr[i] / M.tr[i - h]) / (sd * Math.sqrt(h))); return { h, z }; });
  const lastZ = rows.map(r => r.z[T - 1]); const pos = lastZ.filter(z => z > 0).length;
  const disp = U.std(lastZ), v20 = M.vol20[n - 1];
  const v60 = U.std(Array.from(M.lr.slice(n - 60))) * Math.sqrt(252);
  const state = v20 > .30 ? 'STRESSED' : pos / rows.length >= .8 ? 'TRENDING' : pos / rows.length <= .2 ? 'BEARISH' : disp > 1.2 ? 'TORN' : 'ELASTIC';
  const vb = []; for (let i = n - T; i < n; i++) vb.push(M.vol20[i]);
  return { rows, T, align: pos / rows.length, pos, disp, state, v20, v60, vb, drive: U.mean(lastZ) };
}

/* ---------------------------------------------------------------- permutation entropy (order 3) */
function permEntropy(x) { const cnt = {}; let N = 0; for (let i = 2; i < x.length; i++) { const t = [x[i - 2], x[i - 1], x[i]]; const k = [0, 1, 2].sort((a, b) => t[a] - t[b]).join(''); cnt[k] = (cnt[k] || 0) + 1; N++; }
  let h = 0; for (const k in cnt) { const p = cnt[k] / N; h -= p * Math.log(p); } return h / Math.log(6); }

/* ---------------------------------------------------------------- BRVM model */
function brvmModel(BR, REF) {
  const rows = BR.rows.map(r => {
    const f = REF.rows[r.t] || {}; const c = r.c;
    const fresh = f.divd && f.divd >= addMonths(BR.asof, -15);
    const yldRaw = f.div && f.divd && f.divd >= '2019-01-01' ? f.div / c * 100 : null;
    const yld = fresh ? yldRaw : (yldRaw != null ? yldRaw : null);
    const per = f.per && f.cref ? f.per * c / f.cref : null;
    const base = f.ytd != null && f.cref ? f.cref / (1 + f.ytd / 100) : null;
    const ytd = base ? (c / base - 1) * 100 : null;
    const vj = r.vj != null ? r.vj : (r.prev ? (c / r.prev - 1) * 100 : 0);
    return { ...r, vj, n: f.n || r.t, sec: f.sec || '—', cty: f.cty || '—', div: f.div, divd: f.divd, yld, fresh: !!fresh, per, ytd, val: c * r.vol, noTrade: r.vol === 0 };
  });
  const pct = (arr, v, inv) => { const s = arr.filter(x => x != null && isFinite(x)).sort((a, b) => a - b); if (v == null || !isFinite(v) || !s.length) return .5; let k = 0; while (k < s.length && s[k] <= v) k++; const p = k / s.length; return inv ? 1 - p : p; };
  const ylds = rows.map(r => r.fresh ? Math.min(r.yld, 15) : 0), pers = rows.map(r => r.per != null && r.per > 0 && r.per < 100 ? r.per : null),
        ytds = rows.map(r => r.ytd), liq = rows.map(r => r.val);
  rows.forEach((r, i) => {
    const sY = pct(ylds, ylds[i]), sV = pers[i] == null ? .15 : pct(pers, pers[i], true), sM = r.ytd == null ? .5 : pct(ytds, r.ytd), sL = pct(liq, r.val);
    r.sc = { y: sY, v: sV, m: sM, l: sL }; r.score = Math.round(100 * (.35 * sY + .30 * sV + .20 * sM + .15 * sL));
  });
  const rk = rows.slice().sort((a, b) => b.score - a.score); rk.forEach((r, i) => r.rank = i + 1);
  const upN = rows.filter(r => r.vj > 0).length, dnN = rows.filter(r => r.vj < 0).length;
  const idx = BR.idx.map(x => { const rf = REF.idx[x.k]; const base = rf ? rf.vref / (1 + rf.ytd / 100) : null; return { ...x, ytd: base ? (x.v / base - 1) * 100 : null }; });
  return { rows, upN, dnN, flat: rows.length - upN - dnN, idx, asof: BR.asof, session: BR.session, src: BR.src, capA: BR.capA, sectors: REF.sectors, sect: BR.sect };
}
function addMonths(d, m) { const [y, mo] = d.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + m, 1)); return t.toISOString().slice(0, 10); }
