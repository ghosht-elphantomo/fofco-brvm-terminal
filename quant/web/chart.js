/* ================= FQT — charts (canvas, no library) ================= */
'use strict';
const CL = {};
const PAGES = {};
function readCL() { const cs = getComputedStyle(document.documentElement);
  for (const k of ['bg', 'bg2', 'bg3', 'line', 'line2', 'amber', 'white', 'txt', 'dim', 'dim2', 'up', 'dn', 'navy', 'navy2', 'yel', 'cyan', 'violet', 'pink', 'teal']) CL[k] = cs.getPropertyValue('--' + k).trim(); }
function rgba(hex, a) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(x => x + x).join(''); const n = parseInt(hex, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
const FNUM = '500 10.5px "Roboto Mono", ui-monospace, Menlo, monospace';
const FUI = '500 11px "Roboto Condensed", "Arial Narrow", Arial, sans-serif';
function setupCanvas(host) {
  let cv = host.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); host.appendChild(cv); }
  const r = host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(30, r.width), h = Math.max(30, r.height);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h); return { x, w, h, cv };
}
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || Math.abs(hi) || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag; const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(+v.toPrecision(12));
  return out;
}
function logTicks(lo, hi) {
  const out = []; const e0 = Math.floor(Math.log10(lo)), e1 = Math.ceil(Math.log10(hi));
  for (let e = e0; e <= e1; e++) for (const m of (e1 - e0 > 3 ? [1] : e1 - e0 > 1 ? [1, 2, 5] : [1, 1.5, 2, 3, 5, 7])) { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); }
  return out.length >= 2 ? out : niceTicks(lo, hi);
}
const dLab = (d, span) => { const y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100;
  return span > 1500 ? String(y) : span > 200 ? String(m).padStart(2, '0') + '/' + String(y).slice(2) : String(dd).padStart(2, '0') + '/' + String(m).padStart(2, '0'); };

/* Time-series chart with stacked panes, zoom (wheel / pinch-less), drag-pan, crosshair and per-pane legends. */
class TSChart {
  constructor(host, opts = {}) {
    this.host = host; this.o = Object.assign({ panes: [{ h: 1 }], padR: 58, padB: 18, minBars: 20, xfmt: null, onHover: null }, opts);
    this.data = null; this.i0 = 0; this.i1 = 0; this.hover = null; this.drag = null;
    const cv = document.createElement('canvas'); host.appendChild(cv); this.cv = cv;
    cv.addEventListener('mousemove', e => this.onMove(e)); cv.addEventListener('mouseleave', () => { this.hover = null; this.drag = null; this.draw(); });
    cv.addEventListener('mousedown', e => { this.drag = { x: e.clientX, i0: this.i0, i1: this.i1 }; });
    window.addEventListener('mouseup', () => { this.drag = null; });
    cv.addEventListener('wheel', e => { if (!this.data) return; e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, this.idxAt(e)); }, { passive: false });
    cv.addEventListener('dblclick', () => { if (this.def) { [this.i0, this.i1] = this.def; this.draw(); } });
    let tx = null; cv.addEventListener('touchstart', e => { tx = { x: e.touches[0].clientX, i0: this.i0, i1: this.i1 }; }, { passive: true });
    cv.addEventListener('touchmove', e => { if (!tx) return; const w = this.cv.getBoundingClientRect().width - this.o.padR, n = tx.i1 - tx.i0, d = Math.round((tx.x - e.touches[0].clientX) / w * n); this.pan(tx, d); }, { passive: true });
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(host);
  }
  set(data, view) { this.data = data; const n = data.x.length; const v = view || [Math.max(0, n - 250), n - 1]; this.i0 = Math.max(0, v[0]); this.i1 = Math.min(n - 1, v[1]); this.def = [this.i0, this.i1]; this.draw(); }
  setView(i0, i1) { const n = this.data.x.length; this.i0 = Math.max(0, i0); this.i1 = Math.min(n - 1, i1); this.def = [this.i0, this.i1]; this.draw(); }
  idxAt(e) { const r = this.cv.getBoundingClientRect(), w = r.width - this.o.padR; const f = U.clamp((e.clientX - r.left) / w, 0, 1); return Math.round(this.i0 + f * (this.i1 - this.i0)); }
  zoom(f, at) { const n = this.data.x.length, span = this.i1 - this.i0; let ns = Math.round(U.clamp(span * f, this.o.minBars, n - 1)); const r = (at - this.i0) / (span || 1);
    let a = Math.round(at - r * ns); a = U.clamp(a, 0, n - 1 - ns); this.i0 = a; this.i1 = a + ns; this.draw(); }
  pan(st, d) { const n = this.data.x.length, span = st.i1 - st.i0; let a = U.clamp(st.i0 + d, 0, n - 1 - span); this.i0 = a; this.i1 = a + span; this.draw(); }
  onMove(e) { if (!this.data) return; if (this.drag) { const w = this.cv.getBoundingClientRect().width - this.o.padR, n = this.drag.i1 - this.drag.i0; this.pan(this.drag, Math.round((this.drag.x - e.clientX) / w * n)); return; }
    const r = this.cv.getBoundingClientRect(); this.hover = { i: this.idxAt(e), y: e.clientY - r.top }; this.draw(); if (this.o.onHover) this.o.onHover(this.hover.i); }
  draw() {
    if (!this.data) return; const host = this.host, { x, w, h } = setupCanvas(host); const D = this.data, P = this.o.panes, padR = this.o.padR, padB = this.o.padB;
    const W = w - padR, tot = P.reduce((a, p) => a + p.h, 0), gap = 6; let y0 = 4; const avail = h - padB - 4 - gap * (P.length - 1);
    const i0 = this.i0, i1 = this.i1, nv = i1 - i0 + 1, bw = W / nv, X = i => (i - i0 + .5) * bw;
    this.layout = [];
    P.forEach((p, pi) => {
      const ph = avail * p.h / tot, top = y0, bot = y0 + ph; y0 = bot + gap;
      const ss = D.series.filter(s => (s.pane || 0) === pi);
      let lo = Infinity, hi = -Infinity;
      for (const s of ss) { if (s.noScale || s.type === 'marks') continue; const arrs = s.type === 'candle' ? [s.h, s.l] : s.type === 'band' ? [s.y1, s.y2] : [s.y];
        for (const a of arrs) for (let i = i0; i <= i1; i++) { const v = a[i]; if (v == null || !isFinite(v) || (p.log && v <= 0)) continue; if (v < lo) lo = v; if (v > hi) hi = v; } }
      for (const r of (p.refs || [])) if (r.scale) { lo = Math.min(lo, r.v); hi = Math.max(hi, r.v); }
      if (p.min != null) lo = Math.min(lo, p.min); if (p.max != null) hi = Math.max(hi, p.max); if (p.fixed) { lo = p.fixed[0]; hi = p.fixed[1]; }
      if (!isFinite(lo)) { lo = 0; hi = 1; } if (lo === hi) { lo -= Math.abs(lo) * .05 || 1; hi += Math.abs(hi) * .05 || 1; }
      const lg = p.log && lo > 0; const pad = lg ? 0 : (hi - lo) * .06; if (!p.fixed) { lo -= p.zero && lo >= 0 ? 0 : pad; hi += pad; }
      const L = v => lg ? Math.log(v) : v, Y = v => bot - (L(v) - L(lo)) / (L(hi) - L(lo)) * (ph - 2) - 1;
      this.layout.push({ top, bot, lo, hi, Y, lg, p });
      x.strokeStyle = CL.line; x.lineWidth = 1; x.strokeRect(.5, top + .5, W, ph);
      const ticks = lg ? logTicks(lo, hi) : niceTicks(lo, hi, Math.max(2, Math.round(ph / 45)));
      x.font = FNUM; x.textBaseline = 'middle'; x.textAlign = 'left';
      for (const t of ticks) { const yy = Math.round(Y(t)) + .5; if (yy < top + 4 || yy > bot - 4) continue; x.strokeStyle = rgba(CL.dim2, .35); x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); x.fillStyle = CL.dim; x.fillText((p.fmt || fmtAxis)(t), W + 5, yy); }
      for (const r of (p.refs || [])) { const yy = Math.round(Y(r.v)) + .5; if (yy < top || yy > bot) continue; x.strokeStyle = r.color || CL.dim; x.setLineDash(r.dash || [3, 3]); x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); x.setLineDash([]);
        if (r.label) { x.fillStyle = r.color || CL.dim; x.font = FUI; x.textAlign = 'left'; x.fillText(r.label, 4, yy - 7); } }
      x.save(); x.beginPath(); x.rect(0, top, W, ph); x.clip();
      for (const s of ss) this.drawSeries(x, s, X, Y, bw, i0, i1, bot, lo);
      x.restore();
      if (p.title) { x.fillStyle = CL.amber; x.font = FUI; x.textAlign = 'right'; x.textBaseline = 'top'; x.fillText(p.title, W - 4, top + 3); }
    });
    const span = (D.x[i1] - D.x[i0]) / 10000 * 365 || nv; x.fillStyle = CL.dim; x.font = FNUM; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    const step = Math.max(1, Math.round(nv / Math.max(2, W / 80)));
    for (let i = i1; i >= i0; i -= step) { const px = X(i); if (px < 20) break; x.fillText((this.o.xfmt || dLab)(D.x[i], span), px, h - 4); }
    if (this.hover) {
      const i = U.clamp(this.hover.i, i0, i1), px = Math.round(X(i)) + .5; x.strokeStyle = rgba(CL.white, .35); x.setLineDash([2, 3]); x.beginPath(); x.moveTo(px, 4); x.lineTo(px, h - padB); x.stroke();
      const lay = this.layout.find(l => this.hover.y >= l.top && this.hover.y <= l.bot);
      if (lay) { const yy = Math.round(this.hover.y) + .5; x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); const v = lay.lg ? Math.exp(Math.log(lay.lo) + (lay.bot - this.hover.y) / (lay.bot - lay.top - 2) * (Math.log(lay.hi) - Math.log(lay.lo))) : lay.lo + (lay.bot - this.hover.y) / (lay.bot - lay.top - 2) * (lay.hi - lay.lo);
        x.setLineDash([]); x.fillStyle = CL.amber; x.fillRect(W + 1, yy - 8, padR - 2, 16); x.fillStyle = '#000'; x.font = FNUM; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText((lay.p.fmt || fmtAxis)(v), W + 4, yy); }
      x.setLineDash([]); const dl = (this.o.xfull || fmtD)(D.x[i]); x.font = FNUM; const tw = x.measureText(dl).width + 10; x.fillStyle = CL.amber; x.fillRect(U.clamp(px - tw / 2, 0, W - tw), h - padB + 1, tw, padB - 2); x.fillStyle = '#000'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(dl, U.clamp(px, tw / 2, W - tw / 2), h - padB / 2);
    }
    const li = this.hover ? U.clamp(this.hover.i, i0, i1) : i1;
    this.layout.forEach((lay, pi) => { const ss = D.series.filter(s => (s.pane || 0) === pi && s.label); let lx = 6; x.font = FUI; x.textBaseline = 'top'; x.textAlign = 'left';
      for (const s of ss) { const v = s.type === 'candle' ? s.c[li] : s.type === 'band' ? null : s.y[li]; const txt = s.label + (v != null && isFinite(v) ? ' ' + (s.fmt || lay.p.fmt || fmtAxis)(v) : '');
        const tw = x.measureText(txt).width; x.fillStyle = 'rgba(0,0,0,.65)'; x.fillRect(lx - 2, lay.top + 2, tw + 14, 14); x.fillStyle = s.color || CL.white; x.fillRect(lx, lay.top + 6, 7, 7); x.fillStyle = CL.txt; x.fillText(txt, lx + 10, lay.top + 3); lx += tw + 22; } });
    if (this.o.after) this.o.after(x, { X, layout: this.layout, i0, i1, W, h });
  }
  drawSeries(x, s, X, Y, bw, i0, i1, bot, lo) {
    const t = s.type || 'line';
    if (t === 'candle') { const cw = Math.max(1, bw * .7);
      for (let i = i0; i <= i1; i++) { const o = s.o[i], c = s.c[i], hh = s.h[i], ll = s.l[i]; if (c == null) continue; const up = c >= o, col = up ? CL.up : CL.dn, px = X(i);
        x.strokeStyle = col; x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(px) + .5, Y(hh)); x.lineTo(Math.round(px) + .5, Y(ll)); x.stroke();
        if (bw > 3) { const y1 = Y(o), y2 = Y(c); x.fillStyle = up ? '#000' : col; x.fillRect(px - cw / 2, Math.min(y1, y2), cw, Math.max(1, Math.abs(y2 - y1))); if (up) { x.strokeRect(Math.round(px - cw / 2) + .5, Math.round(Math.min(y1, y2)) + .5, Math.round(cw) - 1, Math.max(1, Math.round(Math.abs(y2 - y1)))); } } }
      return; }
    if (t === 'bar') { const cw = Math.max(1, bw * .8), base = s.base != null ? Y(s.base) : bot;
      for (let i = i0; i <= i1; i++) { const v = s.y[i]; if (v == null || !isFinite(v)) continue; x.fillStyle = s.colors ? s.colors[i] : s.colorFn ? s.colorFn(v, i) : (s.color || CL.dim); const yy = Y(v); x.fillRect(X(i) - cw / 2, Math.min(yy, base), cw, Math.max(1, Math.abs(base - yy))); }
      return; }
    if (t === 'band') { x.beginPath(); let st = false; for (let i = i0; i <= i1; i++) { const v = s.y1[i]; if (v == null || !isFinite(v)) continue; st ? x.lineTo(X(i), Y(v)) : (x.moveTo(X(i), Y(v)), st = true); }
      for (let i = i1; i >= i0; i--) { const v = s.y2[i]; if (v == null || !isFinite(v)) continue; x.lineTo(X(i), Y(v)); } x.closePath(); x.fillStyle = s.fill || rgba(CL.cyan, .08); x.fill(); return; }
    if (t === 'marks') { for (const m of s.m) { if (m.i < i0 || m.i > i1) continue; const px = X(m.i), py = Y(m.v); x.fillStyle = m.up ? CL.up : CL.dn; x.beginPath();
      if (m.up) { x.moveTo(px, py + 4); x.lineTo(px - 5, py + 12); x.lineTo(px + 5, py + 12); } else { x.moveTo(px, py - 4); x.lineTo(px - 5, py - 12); x.lineTo(px + 5, py - 12); } x.fill(); } return; }
    x.strokeStyle = s.color || CL.white; x.lineWidth = s.w || 1.3; x.setLineDash(s.dash || []); x.beginPath(); let st = false, first = null, last = null;
    for (let i = i0; i <= i1; i++) { const v = s.y[i]; if (v == null || !isFinite(v)) { if (!s.connect) st = false; continue; } const px = X(i), py = Y(v); if (!st) { x.moveTo(px, py); st = true; if (first == null) first = px; } else x.lineTo(px, py); last = px; }
    x.stroke(); x.setLineDash([]);
    if (t === 'area' && first != null) { x.lineTo(last, s.base != null ? Y(s.base) : bot); x.lineTo(first, s.base != null ? Y(s.base) : bot); x.closePath(); x.fillStyle = s.fill || rgba(s.color || CL.white, .12); x.fill(); }
  }
}
function fmtAxis(v) { const a = Math.abs(v); const t = a >= 1e12 ? (v / 1e12).toFixed(1) + 'T' : a >= 1e9 ? (v / 1e9).toFixed(1) + 'Md' : a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3); return t.replace('.', ','); }
const fmtPctAxis = v => ((v > 0 ? '+' : '') + (v * 100).toFixed(Math.abs(v) < .1 ? 1 : 0) + '%').replace('.', ',');
function fmtD(d) { return String(d % 100).padStart(2, '0') + '/' + String(Math.floor(d / 100) % 100).padStart(2, '0') + '/' + Math.floor(d / 10000); }

/* Simple category bar chart with optional reference lines and value labels. */
function barChart(host, o) {
  const { x, w, h } = setupCanvas(host); const L = o.labels, V = o.values, n = V.length; const padL = o.padL || 40, padB = o.padB || 18, padT = 8;
  let lo = Math.min(0, ...V.filter(isFinite), ...(o.refs || []).map(r => r.v)), hi = Math.max(0, ...V.filter(isFinite), ...(o.refs || []).map(r => r.v)); if (o.band) { lo = Math.min(lo, -o.band); hi = Math.max(hi, o.band); }
  if (lo === hi) hi = lo + 1; const pd = (hi - lo) * .08; lo -= lo < 0 ? pd : 0; hi += pd;
  const W = w - padL - 6, H = h - padT - padB, bw = W / n, Y = v => padT + (hi - v) / (hi - lo) * H, fmt = o.fmt || fmtAxis;
  x.font = FNUM; x.textAlign = 'right'; x.textBaseline = 'middle';
  for (const t of niceTicks(lo, hi, 4)) { const yy = Math.round(Y(t)) + .5; x.strokeStyle = rgba(CL.dim2, .35); x.beginPath(); x.moveTo(padL, yy); x.lineTo(w - 6, yy); x.stroke(); x.fillStyle = CL.dim; x.fillText((o.axisFmt || (Math.abs(hi) >= 1e4 ? fmtAxis : fmt))(t), padL - 4, yy); }
  if (o.band) { x.fillStyle = rgba(CL.white, .07); x.fillRect(padL, Y(o.band), W, Y(-o.band) - Y(o.band)); }
  const z = Y(0); x.strokeStyle = CL.dim2; x.beginPath(); x.moveTo(padL, z + .5); x.lineTo(w - 6, z + .5); x.stroke();
  for (let i = 0; i < n; i++) { const v = V[i]; if (!isFinite(v)) continue; const yy = Y(v); x.fillStyle = o.colors ? o.colors[i] : v >= 0 ? (o.pos || CL.up) : (o.neg || CL.dn); x.fillRect(padL + i * bw + bw * .15, Math.min(yy, z), bw * .7, Math.max(1, Math.abs(z - yy)));
    if (o.labelsOnBars && bw > 26) { x.fillStyle = CL.txt; x.textAlign = 'center'; x.textBaseline = v >= 0 ? 'bottom' : 'top'; x.font = '500 9.5px "Roboto Mono", monospace'; x.fillText(fmt(v), padL + (i + .5) * bw, v >= 0 ? yy - 1 : yy + 1); } }
  for (const r of (o.refs || [])) { const yy = Math.round(Y(r.v)) + .5; x.strokeStyle = r.color || CL.amber; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(padL, yy); x.lineTo(w - 6, yy); x.stroke(); x.setLineDash([]); if (r.label) { x.fillStyle = r.color || CL.amber; x.font = FUI; x.textAlign = 'left'; x.textBaseline = 'bottom'; x.fillText(r.label, padL + 4, yy - 2); } }
  x.fillStyle = CL.dim; x.font = FUI; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; const every = Math.max(1, Math.ceil(n / Math.max(1, W / 34)));
  for (let i = 0; i < n; i += every) x.fillText(L[i], padL + (i + .5) * bw, h - 5);
  host.onmousemove = e => { const r = host.getBoundingClientRect(), i = Math.floor((e.clientX - r.left - padL) / bw); if (i >= 0 && i < n) tip(e, `${L[i]} : <b>${fmt(V[i])}</b>${o.extra ? ' · ' + o.extra(i) : ''}`); else untip(); };
  host.onmouseleave = untip;
}

/* Scatter with optional fitted line. */
function scatter(host, o) {
  const { x, w, h } = setupCanvas(host); const P = o.pts.filter(p => isFinite(p[0]) && isFinite(p[1])); if (!P.length) return; const padL = 46, padB = 20, padT = 8, padR = 8;
  let xl = Math.min(...P.map(p => p[0])), xh = Math.max(...P.map(p => p[0])), yl = Math.min(...P.map(p => p[1])), yh = Math.max(...P.map(p => p[1]));
  if (o.square) { xl = yl = Math.min(xl, yl); xh = yh = Math.max(xh, yh); } const px = (xh - xl) * .05 || 1, py = (yh - yl) * .05 || 1; xl -= px; xh += px; yl -= py; yh += py;
  const W = w - padL - padR, H = h - padT - padB, X = v => padL + (v - xl) / (xh - xl) * W, Y = v => padT + (yh - v) / (yh - yl) * H; const fx = o.fx || fmtAxis, fy = o.fy || fmtAxis;
  x.font = FNUM; x.textAlign = 'right'; x.textBaseline = 'middle';
  for (const t of niceTicks(yl, yh, Math.max(2, Math.min(5, Math.floor(H / 40))))) { const yy = Math.round(Y(t)) + .5; x.strokeStyle = rgba(CL.dim2, .35); x.beginPath(); x.moveTo(padL, yy); x.lineTo(w - padR, yy); x.stroke(); x.fillStyle = CL.dim; x.fillText(fy(t), padL - 4, yy); }
  x.textAlign = 'center'; x.textBaseline = 'alphabetic'; for (const t of niceTicks(xl, xh, Math.max(2, Math.min(6, Math.floor(W / 70))))) { const xx = Math.round(X(t)) + .5; x.strokeStyle = rgba(CL.dim2, .35); x.beginPath(); x.moveTo(xx, padT); x.lineTo(xx, padT + H); x.stroke(); x.fillStyle = CL.dim; x.fillText(fx(t), xx, h - 5); }
  if (xl < 0 && xh > 0) { x.strokeStyle = CL.dim2; x.beginPath(); x.moveTo(X(0) + .5, padT); x.lineTo(X(0) + .5, padT + H); x.stroke(); } if (yl < 0 && yh > 0) { x.strokeStyle = CL.dim2; x.beginPath(); x.moveTo(padL, Y(0) + .5); x.lineTo(padL + W, Y(0) + .5); x.stroke(); }
  for (const p of P) { x.fillStyle = p[2] || o.color || rgba(CL.cyan, .55); x.fillRect(X(p[0]) - 1.5, Y(p[1]) - 1.5, 3, 3); }
  if (o.line) { const [a, b] = o.line; x.strokeStyle = o.lineColor || CL.amber; x.lineWidth = 1.5; x.beginPath(); x.moveTo(X(xl), Y(a + b * xl)); x.lineTo(X(xh), Y(a + b * xh)); x.stroke(); }
  if (o.diag) { x.strokeStyle = CL.amber; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(X(Math.max(xl, yl)), Y(Math.max(xl, yl))); x.lineTo(X(Math.min(xh, yh)), Y(Math.min(xh, yh))); x.stroke(); x.setLineDash([]); }
  if (o.xlab) { x.fillStyle = CL.amber; x.font = FUI; x.textAlign = 'right'; x.fillText(o.xlab, w - padR, padT + H - 4); } if (o.ylab) { x.fillStyle = CL.amber; x.font = FUI; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(o.ylab, padL + 4, padT + 2); }
}

/* Squarified treemap: items [{id, v, label, sub, color}] */
function treemap(el, items, H) {
  el.innerHTML = ''; el.style.height = H + 'px'; const W = el.getBoundingClientRect().width; const tot = items.reduce((a, b) => a + b.v, 0); if (!tot || !W) return;
  const sc = W * H / tot, rows = items.map(i => ({ ...i, a: i.v * sc })).sort((a, b) => b.a - a.a); const out = [];
  let rect = { x: 0, y: 0, w: W, h: H }, row = [];
  const worst = (r, side) => { const s = r.reduce((a, b) => a + b.a, 0); let mx = 0; for (const i of r) mx = Math.max(mx, Math.max(side * side * i.a / (s * s), s * s / (side * side * i.a))); return mx; };
  const lay = (r) => { const s = r.reduce((a, b) => a + b.a, 0); if (rect.w >= rect.h) { const cw = s / rect.h; let y = rect.y; for (const i of r) { const ch = i.a / cw; out.push({ ...i, x: rect.x, y, w: cw, h: ch }); y += ch; } rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h }; }
    else { const ch = s / rect.w; let x0 = rect.x; for (const i of r) { const cw = i.a / ch; out.push({ ...i, x: x0, y: rect.y, w: cw, h: ch }); x0 += cw; } rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch }; } };
  for (const it of rows) { const side = Math.min(rect.w, rect.h); if (!row.length || worst(row.concat(it), side) <= worst(row, side)) row.push(it); else { lay(row); row = [it]; } }
  if (row.length) lay(row);
  el.innerHTML = out.map(o => `<div data-sec="${o.id}" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;background:${o.color}" title="${esc(o.title || o.label)}">${o.w > 34 && o.h > 22 ? `<b>${o.label}</b>${o.h > 34 ? `<span>${o.sub}</span>` : ''}` : ''}</div>`).join('');
}
function sparkSVG(v, w = 72, h = 16) { const a = v.filter(x => x != null && isFinite(x)); if (a.length < 2) return ''; const lo = Math.min(...a), hi = Math.max(...a), r = hi - lo || 1;
  const pts = a.map((y, i) => `${(i / (a.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 1 - (y - lo) / r * (h - 2)).toFixed(1)}`).join(' ');
  return `<svg class="spk" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${a[a.length - 1] >= a[0] ? 'var(--up)' : 'var(--dn)'}" stroke-width="1.2" points="${pts}"/></svg>`; }
function heatBg(v, scale) { if (v == null || !isFinite(v)) return 'transparent'; const a = Math.min(1, Math.abs(v) / scale); return v >= 0 ? `rgba(52,210,110,${(a * .75).toFixed(3)})` : `rgba(255,75,66,${(a * .75).toFixed(3)})`; }
function tip(e, html) { const t = document.getElementById('tip'); t.innerHTML = html; t.hidden = false; const r = t.getBoundingClientRect(); t.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 14) + 'px'; t.style.top = Math.max(4, e.clientY - r.height - 10) + 'px'; }
function untip() { const t = document.getElementById('tip'); if (t) t.hidden = true; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
