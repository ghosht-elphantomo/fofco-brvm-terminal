/* ================= FQT — pages: MON, BRVM, GP, DES, HELP ================= */
'use strict';
const pn = (title, code, body, o = {}) => `<div class="pn" ${o.id ? `id="${o.id}"` : ''} ${o.style ? `style="${o.style}"` : ''}><div class="pt">${title}${o.sel ? `<span class="sel">${o.sel}</span>` : ''}<span class="code">${code || ''}</span></div>${o.tools ? `<div class="tools">${o.tools}</div>` : ''}<div class="pb ${o.np ? 'np' : ''}">${body}</div>${o.lect ? `<div class="lect">${o.lect}</div>` : ''}</div>`;
const cvb = (id, h) => `<div class="cv" id="${id}" style="height:${h}px"></div>`;
const rangeBar = s => { if (!(s.hi52 > s.lo52)) return ''; const f = U.clamp((s.last - s.lo52) / (s.hi52 - s.lo52), 0, 1); return `<span class="rng" title="${px(s, s.lo52)} – ${px(s, s.hi52)}"><i style="left:${(f * 68).toFixed(0)}px"></i></span>`; };
const freqLab = s => s.f === 'M' ? 'mens.' : '';
const legacy = s => /ancien/i.test(s.n);
function sortRows(rows, sort) { const { k, dir } = sort; return rows.slice().sort((a, b) => { const A = a[k], B = b[k]; if (A == null && B == null) return 0; if (A == null) return 1; if (B == null) return -1; return (typeof A === 'string' ? A.localeCompare(B) : A - B) * dir; }); }
function thSort(cols, sort) { return cols.map(([k, l, left]) => `<th data-k="${k}" class="${left ? 'l' : ''} ${sort.k === k ? 'on' : ''}">${l}${sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join(''); }
function lastCross(c, s) { const n = c.length; const above = c[n - 1] > s[n - 1]; let k = n - 1; while (k > 0 && isFinite(s[k - 1]) && (c[k - 1] > s[k - 1]) === above) k--; return { above, k }; }

/* ------------------------------------------------------------------ MON */
PAGES.MON = async (m, alive) => {
  const G = [['Indices & ETF · États-Unis', s => s.mkt === 'US' && s.typ === 'ETF'], ['Actions · États-Unis', s => s.mkt === 'US' && s.typ !== 'ETF'], ['Taïwan', s => s.mkt === 'TW'],
    ['Indices BRVM', s => s.mkt === 'BRVM' && s.cls === 'Index' && !legacy(s)], ['Matières premières', s => s.cls === 'Comdty'], ['Taux · volatilité · macro', s => s.mkt === 'MACRO' && (s.cls === 'Index' || s.cls === 'Rate')], ['Change', s => s.cls === 'Curncy']];
  const row = s => `<tr data-sec="${s.id}"><td class="l tk">${s.tk}</td><td class="l nm ns">${esc(s.short || s.n)}</td><td class="wh">${px(s, s.last)}</td><td>${sgn(s.last - s.prev, pxd(s), '', 1)}</td><td>${pc(s.pct)}</td>
    <td>${s.f === 'D' ? pc(s.r1w, 1) : '<span class="fl">—</span>'}</td><td>${pc(s.r1m, 1)}</td><td>${pc(s.ytd, 1)}</td><td>${pc(s.r1y, 1)}</td><td>${num(s.vol * 100, 1)}</td><td>${rangeBar(s)}</td><td>${sparkSVG(s.spark)}</td><td class="dm">${s.f === 'M' ? fd(s.dt).slice(3) : fd(s.dt).slice(0, 5)}</td></tr>`;
  const body = G.map(([t, f]) => { const ss = secsWhere(f); return ss.length ? `<tr class="sec"><td class="l" colspan="13">${t} · ${ss.length}</td></tr>` + ss.map(row).join('') : ''; }).join('');
  const br = secsWhere(s => s.mkt === 'BRVM' && s.cls === 'Equity');
  const up = br.slice().sort((a, b) => b.pct - a.pct).slice(0, 7), dn = br.slice().sort((a, b) => a.pct - b.pct).slice(0, 7), vo = br.slice().sort((a, b) => (b.vday || 0) - (a.vday || 0)).slice(0, 7);
  const mini = (rs, v) => `<table class="t"><tbody>${rs.map(s => `<tr data-sec="${s.id}"><td class="l tk">${s.id}</td><td class="wh">${px(s, s.last)}</td><td>${v(s)}</td></tr>`).join('')}</tbody></table>`;
  const nUp = br.filter(s => s.pct > 0).length, nDn = br.filter(s => s.pct < 0).length;
  m.innerHTML = `<div class="grid c2">
    ${pn('Marchés · vue d’ensemble', 'MON', `<div class="tw" style="max-height:calc(100vh - 128px)"><table class="t"><thead><tr><th class="l">Titre</th><th class="l ns">Nom</th><th>Dernier</th><th>Var.</th><th>Var.%</th><th>1 sem.</th><th>1 mois</th><th>YTD</th><th>1 an</th><th>Vol. 1A %</th><th>Plage 52 sem.</th><th>60 dernières</th><th>Date</th></tr></thead><tbody>${body}</tbody></table></div>`, { np: true, sel: `${Q.sum.secs.filter(s => !legacy(s)).length} titres · cliquer une ligne pour ouvrir le graphique` })}
    <div class="grid" style="align-content:start">
      ${pn('QQQ · règle SMA 200 → TQQQ', 'QQQ GP', `<div class="grid c2b" style="gap:8px"><div class="kv2" id="sigKv"></div>${cvb('sigCv', 150)}</div>`, { lect: '<span id="sigLect">…</span>' })}
      ${pn('BRVM · séance', 'BRVM', `<div class="grid c3" style="gap:6px"><div><div class="am" style="font-size:11px;margin-bottom:2px">Plus fortes hausses</div>${mini(up, s => pc(s.pct))}</div><div><div class="am" style="font-size:11px;margin-bottom:2px">Plus fortes baisses</div>${mini(dn, s => pc(s.pct))}</div><div><div class="am" style="font-size:11px;margin-bottom:2px">Plus gros échanges</div>${mini(vo, s => big(s.vday))}</div></div>`,
        { sel: Q.sum.session ? Q.sum.session.label : fd(Q.sum.asof), lect: `<b>Largeur</b> : <strong>${nUp}</strong> hausses, <strong>${nDn}</strong> baisses, ${br.length - nUp - nDn} stables sur ${br.length} titres. Montants échangés en XOF.` })}
      ${pn('Avis officiels BRVM · derniers publiés', 'EVTS', '<div id="monEv" style="max-height:260px;overflow:auto">…</div>')}
    </div></div>
    ${pn('BRVM · carte des capitalisations', 'BRVM', '<div class="tmap" id="tmap"></div>', { sel: 'taille = capitalisation boursière · couleur = variation du jour', lect: 'Chaque rectangle est une société cotée, proportionnel à sa capitalisation (cours × nombre de titres). <b>Vert</b> = hausse du jour, <b>rouge</b> = baisse ; l’intensité suit l’ampleur (saturée à ±4 %). Cliquer ouvre le graphique.' })}`;
  const tm = br.filter(s => s.mcap).map(s => ({ id: s.id, v: s.mcap, label: s.id, sub: (s.pct > 0 ? '+' : '') + num(s.pct * 100, 2) + '%', color: s.pct === 0 || !isFinite(s.pct) ? '#1f1f1f' : heatBg(s.pct, .04).replace(/,(0\.\d+|0)\)$/, (m0, a) => ',' + Math.max(.22, +a).toFixed(2) + ')'), title: `${s.n} · capi ${big(s.mcap)} XOF` }));
  treemap($('tmap'), tm, 250);
  getJSON('events_recent.json').then(ev => { if (!alive()) return; $('monEv').innerHTML = ev.slice(0, 40).map(e => `<div class="ev"><span class="d">${fds(e.d)}</span><span class="tk" data-sec="${e.t}" data-to="DES">${e.t || ''}</span><span><span class="c">${esc(e.c || '')}</span><a href="${esc(e.u)}" target="_blank" rel="noopener">${esc(e.ti || '')}</a></span></div>`).join(''); }).catch(() => { $('monEv').textContent = 'Avis indisponibles.'; });
  const M = await market('QQQ'); if (!alive()) return; const S = await series('QQQ');
  const n = M.n, last = M.c[n - 1], s200 = M.sma200[n - 1], { above, k } = lastCross(M.c, M.sma200), L = Q.live && Q.live.qqq;
  const lp = L && L.price ? L.price : last;
  $('sigKv').innerHTML = `<span>Clôture ${fds(M.d[n - 1])}</span><b>${num(last, 2)}</b><span>SMA 200</span><b>${num(s200, 2)}</b><span>Écart</span><b>${pc(last / s200 - 1)}</b>
    <span>Régime</span><b class="${above ? 'up' : 'dn'}">${above ? 'LONG TQQQ' : 'CASH'}</b><span>Depuis</span><b>${fds(M.d[k])} · ${n - 1 - k} s.</b><span>Vol. 20 j</span><b>${num(M.vol20[n - 1] * 100, 1)}%</b><span>RSI 14</span><b>${num(M.rsi14[n - 1], 1)}</b>
    ${L ? `<span>Dernier (flux)</span><b>${num(L.price, 2)} ${pc(L.chg)}</b>` : ''}`;
  $('sigLect').innerHTML = above ? `QQQ clôture <strong>${num((last / s200 - 1) * 100, 1)} %</strong> au-dessus de sa moyenne 200 jours depuis le ${fds(M.d[k])} : la règle reste investie. Il faudrait une baisse de <strong>${num((1 - s200 / lp) * 100, 1)} %</strong> pour passer sous la SMA 200 (signal de sortie à la clôture).`
    : `QQQ est <strong>${num((1 - last / s200) * 100, 1)} %</strong> sous sa SMA 200 depuis le ${fds(M.d[k])} : la règle est en cash. Retour au-dessus à partir de <strong>${num(s200, 2)}</strong>.`;
  const ch = new TSChart($('sigCv'), { panes: [{ h: 1 }], padR: 46 });
  ch.set({ x: S.x, series: [{ y: M.c, color: CL.white, label: 'QQQ' }, { y: Array.from(M.sma200), color: CL.amber, label: 'SMA200' }] }, [n - 252, n - 1]);
};

/* ------------------------------------------------------------------ BRVM */
PAGES.BRVM = async (m, alive) => {
  const all = secsWhere(s => s.mkt === 'BRVM' && s.cls === 'Equity'), sectors = [...new Set(all.map(s => s.grp))].sort();
  const idx = secsWhere(s => s.mkt === 'BRVM' && s.cls === 'Index').sort((a, b) => legacy(a) - legacy(b));
  const st = ST.brvm, rows0 = st.sector === 'ALL' ? all : all.filter(s => s.grp === st.sector);
  const rows = sortRows(rows0.map(s => ({ ...s, d200: s.sma200 ? s.last / s.sma200 - 1 : null, payout: s.dps && s.bnpa ? s.dps / s.bnpa : null })), st.sort);
  const cols = [['id', 'Titre', 1], ['short', 'Société', 1], ['grp', 'Secteur', 1], ['cty', 'Pays', 1], ['last', 'Cours'], ['pct', 'Var.%'], ['r1w', '1 sem.'], ['r1m', '1 mois'], ['ytd', 'YTD'], ['r1y', '1 an'], ['r3y', '3 ans'],
    ['vol', 'Vol. 1A'], ['beta', 'Bêta'], ['mcap', 'Capi (Md)'], ['per', 'PER'], ['yld', 'Rdt %'], ['payout', 'Payout'], ['rsi', 'RSI'], ['d200', '/SMA200'], ['liq', 'Échanges 3M/j'], ['dd', 'Depuis + haut']];
  const tr = s => `<tr data-sec="${s.id}"><td class="l tk">${s.id}</td><td class="l nm">${esc(s.short || s.n)}${s.susp ? ' <span class="dn">SUSP.</span>' : ''}</td><td class="l dm">${esc(s.grp || '')}</td><td class="l dm">${s.cty || ''}</td>
    <td class="wh">${px(s, s.last)}</td><td>${pc(s.pct)}</td><td>${pc(s.r1w, 1)}</td><td>${pc(s.r1m, 1)}</td><td>${pc(s.ytd, 1)}</td><td>${pc(s.r1y, 1)}</td><td>${pc(s.r3y, 0)}</td><td>${num(s.vol * 100, 1)}</td><td>${num(s.beta, 2)}</td>
    <td>${s.mcap ? num(s.mcap / 1e9, 0) : '—'}</td><td>${s.per ? num(s.per, 1) : '—'}</td><td>${s.yld ? num(s.yld * 100, 2) : '—'}</td><td>${s.payout ? num(s.payout * 100, 0) + '%' : '—'}</td><td>${num(s.rsi, 0)}</td><td>${pc(s.d200, 1)}</td><td>${big(s.liq)}</td><td>${pc(s.dd, 0)}</td></tr>`;
  const secAgg = sectors.map(g => { const ss = all.filter(s => s.grp === g), cap = ss.reduce((a, s) => a + (s.mcap || 0), 0), w = s => (s.mcap || 0) / (cap || 1);
    const med = a => { const v = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
    return { g, n: ss.length, cap, pct: ss.reduce((a, s) => a + w(s) * s.pct, 0), ytd: ss.reduce((a, s) => a + w(s) * (s.ytd || 0), 0), r1y: ss.reduce((a, s) => a + w(s) * (s.r1y || 0), 0), per: med(ss.map(s => s.per)), yld: med(ss.map(s => s.yld)) }; }).sort((a, b) => b.cap - a.cap);
  const capTot = all.reduce((a, s) => a + (s.mcap || 0), 0);
  m.innerHTML = `
    ${pn('BRVM · indices', 'BRVM', `<div class="tw"><table class="t"><thead><tr><th class="l">Indice</th><th class="l">Nom</th><th>Niveau</th><th>Var.%</th><th>1 mois</th><th>YTD</th><th>1 an</th><th>3 ans</th><th>Vol. 1A</th><th>Depuis</th><th>60 séances</th></tr></thead><tbody>
      ${idx.map(s => `<tr data-sec="${s.id}"><td class="l tk">${s.id}</td><td class="l nm">${esc(s.n)}</td><td class="wh">${num(s.last, 2)}</td><td>${pc(s.pct)}</td><td>${pc(s.r1m, 1)}</td><td>${pc(s.ytd, 1)}</td><td>${pc(s.r1y, 1)}</td><td>${pc(s.r3y, 0)}</td><td>${num(s.vol * 100, 1)}</td><td class="dm">${fd(s.first)}</td><td>${sparkSVG(s.spark)}</td></tr>`).join('')}</tbody></table></div>`, { np: true, sel: 'indices sectoriels « ancien » arrêtés fin 2025' })}
    ${pn('BRVM · 48 actions', 'BRVM', `<div class="tw" style="max-height:62vh"><table class="t" id="brT"><thead><tr>${thSort(cols, st.sort)}</tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`,
      { np: true, sel: `capitalisation totale ${big(capTot)} XOF · tri : cliquer un en-tête`, tools: `<span class="tlab">Secteur</span>${['ALL', ...sectors].map(g => `<button class="tb alt ${st.sector === g ? 'on' : ''}" data-sector="${esc(g)}">${g === 'ALL' ? 'Tous' : esc(g)}</button>`).join('')}`,
        lect: '<b>Rdt</b> = dernier dividende net ÷ cours. <b>Payout</b> = dividende ÷ BNPA du dernier exercice. <b>Bêta</b> = sensibilité hebdomadaire au BRVM Composite sur 2 ans. <b>Échanges 3M/j</b> = montant moyen échangé par séance sur 3 mois (liquidité). <b>/SMA200</b> = écart du cours à sa moyenne 200 séances.' })}
    <div class="grid c2">
      ${pn('BRVM · largeur du marché depuis 2008', 'BRVM', cvb('brB', 380), { lect: '<b>Haut</b> : BRVM Composite (échelle log). <b>Milieu</b> : part des actions au-dessus de leur moyenne 200 séances (ambre) et 50 séances (cyan) — au-delà de 70 %, la hausse est généralisée ; sous 30 %, le marché est en repli large. <b>Bas</b> : nouveaux plus hauts 52 semaines moins nouveaux plus bas, par séance.' })}
      ${pn('BRVM · secteurs', 'BRVM', `<table class="t"><thead><tr><th class="l">Secteur</th><th>Titres</th><th>Capi (Md)</th><th>Poids</th><th>Var.%</th><th>YTD</th><th>1 an</th><th>PER méd.</th><th>Rdt méd.</th></tr></thead><tbody>
        ${secAgg.map(a => `<tr><td class="l nm">${esc(a.g)}</td><td>${a.n}</td><td>${num(a.cap / 1e9, 0)}</td><td>${num(a.cap / capTot * 100, 1)}%</td><td>${pc(a.pct)}</td><td>${pc(a.ytd, 1)}</td><td>${pc(a.r1y, 1)}</td><td>${num(a.per, 1)}</td><td>${a.yld ? num(a.yld * 100, 2) + '%' : '—'}</td></tr>`).join('')}</tbody></table>`,
        { np: true, lect: 'Variations pondérées par la capitalisation. PER et rendement : médianes des sociétés du secteur.' })}
    </div>`;
  m.querySelectorAll('[data-sector]').forEach(b => b.onclick = () => { st.sector = b.dataset.sector; render(); });
  m.querySelectorAll('#brT th[data-k]').forEach(th => th.onclick = () => { const k = th.dataset.k; st.sort = { k, dir: st.sort.k === k ? -st.sort.dir : (['id', 'short', 'grp', 'cty', 'per'].includes(k) ? 1 : -1) }; render(); });
  const [B, C] = await Promise.all([getJSON('breadth.json'), series('BRVMC')]); if (!alive()) return;
  const map = new Map(C.x.map((d, i) => [d, C.c[i]])); let lastv = null; const cy = B.d.map(d => { if (map.has(d)) lastv = map.get(d); return lastv; });
  const hl = B.nh.map((v, i) => v - B.nl[i]);
  const ch = new TSChart($('brB'), { panes: [{ h: 1.4, log: true, title: 'BRVM COMPOSITE' }, { h: 1, fixed: [0, 1], fmt: fmtPctAxis, refs: [{ v: .7, color: CL.up }, { v: .3, color: CL.dn }], title: '% > SMA200 / SMA50' }, { h: .7, title: 'NOUV. PLUS HAUTS − PLUS BAS' }] });
  ch.set({ x: B.d, series: [{ y: cy, color: CL.white, label: 'BRVMC' }, { pane: 1, y: B.a200, color: CL.amber, label: '>SMA200', fmt: fmtPctAxis }, { pane: 1, y: B.a50, color: CL.cyan, label: '>SMA50', w: 1, fmt: fmtPctAxis }, { pane: 2, type: 'bar', y: hl, colorFn: v => v >= 0 ? CL.up : CL.dn, label: 'H−B', fmt: v => num(v, 0) }] }, [B.d.length - 1260, B.d.length - 1]);
};

/* ------------------------------------------------------------------ GP */
PAGES.GP = async (m, alive) => {
  const s = sec(ST.sec), g = ST.gp; const S = await series(ST.sec); if (!alive()) return;
  const M = S.f === 'D' && S.c.length > 30 ? await market(ST.sec) : null; if (!alive()) return;
  const intra = ST.sec === 'QQQ' && Q.live && Q.live.intraday && Q.live.intraday.t && Q.live.intraday.t.length > 10;
  const ranges = S.f === 'M' ? ['5A', '10A', '20A', '50A', 'MAX'] : ['1M', '3M', '6M', 'YTD', '1A', '3A', '5A', '10A', 'MAX'];
  if (!ranges.includes(g.range) && !(intra && g.range === '1J')) g.range = S.f === 'M' ? '20A' : '1A';
  if (g.range === '1J' && !intra) g.range = '1A';
  const tb = (k, l, on, i) => `<button class="tb ${on ? 'on' : ''}" data-gp="${k}">${i ? `<em>${i})</em>` : ''}${l}</button>`;
  const tools = `${(intra ? ['1J'] : []).concat(ranges).map((r, i) => tb('r:' + r, r === '1J' ? '1J · 5 MIN' : r, g.range === r, i + 1)).join('')}<span class="tsep"></span>
    ${S.f === 'D' && s.cls !== 'Curncy' ? [['candle', 'Bougies'], ['line', 'Ligne'], ['area', 'Aire']].map(([k, l]) => `<button class="tb alt ${g.type === k ? 'on' : ''}" data-gp="t:${k}">${l}</button>`).join('') : ''}<span class="tsep"></span>
    ${[['sma20', 'MM20'], ['sma50', 'MM50'], ['sma200', 'MM200'], ['boll', 'Bollinger']].map(([k, l]) => `<button class="tb alt ${g.ov[k] ? 'on' : ''}" data-gp="o:${k}">${l}</button>`).join('')}<span class="tsep"></span>
    ${[['vol', 'Volume'], ['rsi', 'RSI'], ['macd', 'MACD'], ['dd', 'Drawdown']].map(([k, l]) => `<button class="tb alt ${g.st[k] ? 'on' : ''}" data-gp="s:${k}">${l}</button>`).join('')}
    <button class="tb alt ${g.log ? 'on' : ''}" data-gp="log">Log</button><span class="tlab">Comparer</span><input id="cmpIn" placeholder="NVDA, XAU…" list="cmpList">${g.cmp.map(c => `<button class="tb alt on" data-gp="x:${c}">${c} ✕</button>`).join('')}`;
  m.innerHTML = `<div class="grid side">
    ${pn(`${s.tk} · graphique`, 'GP', `<div class="cv" id="gpCv" style="height:max(440px, calc(100vh - 205px))"></div>`, { np: true, tools, sel: S.f === 'M' ? 'série mensuelle' : g.cmp.length ? 'performance relative depuis le début de la période' : '' })}
    <div class="grid" style="align-content:start">${pn('Statistiques', 'GP', '<div class="kv2" id="gpKv"></div>')}<div id="gpSide"></div></div></div>`;
  const inp = $('cmpIn'); inp.onkeydown = e => { if (e.key === 'Enter') { const r = searchSecs(inp.value)[0]; if (r && r.id !== ST.sec && !g.cmp.includes(r.id)) { g.cmp.push(r.id); render(); } } };
  m.querySelectorAll('[data-gp]').forEach(b => b.onclick = () => { const [k, v] = b.dataset.gp.split(':');
    if (k === 'r') { g.range = v; if (v === '1J' || chart.intra || g.cmp.length) render(); else chart.setView(...rangeView(v)); m.querySelectorAll('[data-gp^="r:"]').forEach(x => x.classList.toggle('on', x === b)); return; }
    if (k === 't') g.type = v; if (k === 'o') g.ov[v] = !g.ov[v]; if (k === 's') g.st[v] = !g.st[v]; if (k === 'log') g.log = !g.log; if (k === 'x') g.cmp = g.cmp.filter(c => c !== v); render(); });
  const rangeView = r => { const n = S.x.length, last = S.x[n - 1], y = Math.floor(last / 10000); const back = { '1M': 100, '3M': 300, '6M': 600, '1A': 10000, '3A': 30000, '5A': 50000, '10A': 100000, '20A': 200000, '50A': 500000 }[r];
    let from = r === 'YTD' ? y * 10000 + 101 : r === 'MAX' ? 0 : last - back; let i0 = S.x.findIndex(d => d >= from); if (i0 < 0) i0 = 0; return [Math.min(i0, n - 20), n - 1]; };
  const panes = [{ h: 3, log: g.log && !g.cmp.length, fmt: g.cmp.length ? fmtPctAxis : null }]; const ser = []; let pi = 0;
  let chart;
  if (g.range === '1J' && intra) {
    const I = Q.live.intraday, tt = I.t.map(t => { const d = new Date(t * 1000); return d.getUTCFullYear() * 1e8 + (d.getUTCMonth() + 1) * 1e6 + d.getUTCDate() * 1e4 + d.getUTCHours() * 100 + d.getUTCMinutes(); });
    const ny = t => new Date(t * 1000).toLocaleTimeString('fr-FR', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
    chart = new TSChart($('gpCv'), { panes: [{ h: 3 }, { h: .8 }], xfmt: (v) => { const i = tt.indexOf(v); return i >= 0 ? ny(I.t[i]) : ''; } }); chart.intra = true;
    chart.set({ x: tt, series: [{ type: 'candle', o: I.o, h: I.h, l: I.l, c: I.c, label: 'QQQ 5 min (heure NY)' }, { pane: 1, type: 'bar', y: I.v, colorFn: (v, i) => I.c[i] >= I.o[i] ? rgba(CL.up, .6) : rgba(CL.dn, .6), label: 'Vol' }] }, [0, tt.length - 1]);
  } else {
    if (g.cmp.length) {
      const [i0] = rangeView(g.range), base = S.c[i0]; ser.push({ y: S.c.map((v, i) => i < i0 ? null : v / base - 1), color: CL.white, w: 1.6, label: s.id, fmt: fmtPctAxis });
      const colors = [CL.amber, CL.cyan, CL.violet, CL.pink, CL.teal];
      for (const [k, cid] of g.cmp.entries()) { const C = await series(cid); if (!alive()) return; const mp = new Map(C.x.map((d, i) => [d, C.c[i]])); let lv = null; const al = S.x.map(d => { if (mp.has(d)) lv = mp.get(d); else if (C.f === 'M') { const mk = Math.floor(d / 100) * 100 + 1; if (mp.has(mk)) lv = mp.get(mk); } return lv; });
        const b = al[i0] || al.find((v, i) => i >= i0 && v != null); ser.push({ y: al.map((v, i) => i < i0 || v == null || !b ? null : v / b - 1), color: colors[k % colors.length], label: cid, fmt: fmtPctAxis }); }
    } else {
      if (g.type === 'candle' && S.f === 'D' && s.cls !== 'Curncy') ser.push({ type: 'candle', o: S.o, h: S.h, l: S.l, c: S.c, label: s.id, fmt: v => px(s, v) });
      else ser.push({ type: g.type === 'area' ? 'area' : 'line', y: S.c, color: CL.white, label: s.id, fmt: v => px(s, v), fill: rgba(CL.white, .07) });
      if (M) { if (g.ov.sma20) ser.push({ y: Array.from(M.sma20), color: CL.violet, w: 1, label: 'MM20' }); if (g.ov.sma50) ser.push({ y: Array.from(M.sma50), color: CL.cyan, w: 1.1, label: 'MM50' }); if (g.ov.sma200) ser.push({ y: Array.from(M.sma200), color: CL.amber, w: 1.4, label: 'MM200' });
        if (g.ov.boll) { const sd = U.rollStd(S.c, 20), up = [], dn = []; for (let i = 0; i < S.c.length; i++) { const mm = M.sma20[i], v = sd[i]; up.push(isFinite(mm) && isFinite(v) ? mm + 2 * v : null); dn.push(isFinite(mm) && isFinite(v) ? mm - 2 * v : null); } ser.push({ type: 'band', y1: up, y2: dn, fill: rgba(CL.violet, .08), noScale: true }, { y: up, color: rgba(CL.violet, .6), w: 1, noScale: true }, { y: dn, color: rgba(CL.violet, .6), w: 1, noScale: true }); } }
    }
    if (g.st.vol && S.v.some(v => v > 0)) { pi++; panes.push({ h: .7, title: 'VOLUME', zero: true }); ser.push({ pane: pi, type: 'bar', y: S.v, colorFn: (v, i) => S.c[i] >= S.o[i] ? rgba(CL.up, .55) : rgba(CL.dn, .55), label: 'Vol', fmt: v => big(v) }); }
    if (g.st.rsi && M) { pi++; panes.push({ h: .8, fixed: [0, 100], refs: [{ v: 70, color: CL.dn }, { v: 30, color: CL.up }], title: 'RSI 14' }); ser.push({ pane: pi, y: Array.from(M.rsi14), color: CL.amber, label: 'RSI', fmt: v => num(v, 1) }); }
    if (g.st.macd && M) { pi++; const e12 = U.ema(S.c, 12), e26 = U.ema(S.c, 26), mac = S.c.map((_, i) => e12[i] - e26[i]), sig = U.ema(mac, 9); panes.push({ h: .8, title: 'MACD 12-26-9', refs: [{ v: 0, color: CL.dim2, dash: [] }] });
      ser.push({ pane: pi, type: 'bar', y: mac.map((v, i) => v - sig[i]), colorFn: v => v >= 0 ? rgba(CL.up, .6) : rgba(CL.dn, .6), label: 'Hist' }, { pane: pi, y: mac, color: CL.cyan, w: 1, label: 'MACD' }, { pane: pi, y: Array.from(sig), color: CL.amber, w: 1, label: 'Signal' }); }
    if (g.st.dd) { pi++; let pk = -Infinity; const dd = S.c.map(v => { pk = Math.max(pk, v); return v / pk - 1; }); panes.push({ h: .8, fmt: fmtPctAxis, title: 'DRAWDOWN DEPUIS LE PLUS HAUT', max: 0 }); ser.push({ pane: pi, type: 'area', y: dd, color: CL.dn, fill: rgba(CL.dn, .2), label: 'DD', fmt: fmtPctAxis, base: 0 }); }
    chart = new TSChart($('gpCv'), { panes });
    chart.set({ x: S.x, series: ser }, rangeView(g.range));
  }
  // stats
  const n = S.c.length, c = S.c, lr = []; for (let i = Math.max(1, n - 252); i < n; i++) lr.push(Math.log(c[i] / c[i - 1]));
  const best = Math.max(...lr), worst = Math.min(...lr), upd = lr.filter(x => x > 0).length / lr.length;
  let atr = null; if (S.f === 'D' && n > 20) { let a = 0; for (let i = n - 14; i < n; i++) a += Math.max(S.h[i] - S.l[i], Math.abs(S.h[i] - c[i - 1]), Math.abs(S.l[i] - c[i - 1])); atr = a / 14 / c[n - 1]; }
  const v3 = S.v.slice(-63).reduce((a, b) => a + b, 0) / 63;
  $('gpKv').innerHTML = `<span>Dernier</span><b>${px(s, c[n - 1])} ${s.ccy}</b><span>Variation</span><b>${pc(s.pct)}</b>
    ${S.f === 'D' ? `<span>Ouverture / + haut / + bas</span><b>${px(s, S.o[n - 1])} / ${px(s, S.h[n - 1])} / ${px(s, S.l[n - 1])}</b>` : ''}
    <span class="h">Performances</span>${S.f === 'D' ? `<span>1 semaine</span><b>${pc(s.r1w, 2)}</b>` : ''}<span>1 mois</span><b>${pc(s.r1m, 2)}</b><span>3 mois</span><b>${pc(s.r3m, 2)}</b><span>Depuis le 1er janvier</span><b>${pc(s.ytd, 2)}</b><span>1 an</span><b>${pc(s.r1y, 2)}</b><span>3 ans</span><b>${pc(s.r3y, 1)}</b>
    <span class="h">Risque (1 an)</span><span>Volatilité annualisée</span><b>${num(s.vol * 100, 1)}%</b>${atr ? `<span>ATR 14 / cours</span><b>${num(atr * 100, 2)}%</b>` : ''}<span>Meilleure / pire ${S.f === 'D' ? 'séance' : 'mois'}</span><b>${sgn(Math.exp(best) - 1, 1)} / ${sgn(Math.exp(worst) - 1, 1)}</b>
    <span>${S.f === 'D' ? 'Séances' : 'Mois'} en hausse</span><b>${num(upd * 100, 0)}%</b><span>Écart au plus haut historique</span><b>${pc(s.dd, 1)}</b>${s.beta != null ? `<span>Bêta / corr. vs ${s.bench}</span><b>${num(s.beta, 2)} / ${num(s.corr, 2)}</b>` : ''}
    ${M ? `<span class="h">Technique</span><span>MM50 / écart</span><b>${px(s, M.sma50[n - 1])} · ${pc(c[n - 1] / M.sma50[n - 1] - 1, 1)}</b><span>MM200 / écart</span><b>${px(s, M.sma200[n - 1])} · ${pc(c[n - 1] / M.sma200[n - 1] - 1, 1)}</b><span>RSI 14</span><b>${num(M.rsi14[n - 1], 1)}</b>` : ''}
    <span>Plage 52 semaines</span><b>${px(s, s.lo52)} – ${px(s, s.hi52)}</b>${v3 > 0 ? `<span>Volume moyen 3 mois</span><b>${big(v3)}</b>` : ''}${s.liq ? `<span>Montant moyen échangé</span><b>${big(s.liq)} ${s.ccy}</b>` : ''}
    <span class="h">Historique</span><span>Première donnée</span><b>${fd(S.x[0])}</b><span>Observations</span><b>${num(n, 0)}</b>`;
  const side = $('gpSide');
  if (s.mkt === 'BRVM' && s.cls === 'Equity') {
    const [dv, ev] = await Promise.all([getJSON('dividends.json'), getJSON('events.json')]); if (!alive()) return;
    const d1 = dv.filter(x => x.t === s.id).sort((a, b) => (b.ex || 0) - (a.ex || 0)).slice(0, 6), e1 = ev.filter(x => x.t === s.id).slice(0, 8);
    side.innerHTML = pn('Dividendes', 'DVD', `<table class="t"><thead><tr><th class="l">Exercice</th><th>Net</th><th>Paiement</th></tr></thead><tbody>${d1.map(x => `<tr><td class="l">${x.ex || '—'}</td><td class="wh">${num(x.dps, 2)}</td><td>${fds(x.pay)}</td></tr>`).join('') || '<tr><td class="l dm" colspan="3">Aucun</td></tr>'}</tbody></table>`, { np: true })
      + pn('Avis récents', 'EVTS', e1.map(e => `<div class="ev" style="grid-template-columns:72px 1fr"><span class="d">${fds(e.d)}</span><span><span class="c">${esc(e.c || '')}</span><a href="${esc(e.u)}" target="_blank" rel="noopener">${esc(e.ti || '')}</a></span></div>`).join('') || '<div class="dm">Aucun avis.</div>');
  }
};

/* ------------------------------------------------------------------ DES */
PAGES.DES = async (m, alive) => {
  const s = sec(ST.sec); const S = await series(ST.sec); if (!alive()) return;
  const n = S.c.length, yrs = {}; for (let i = 1; i < n; i++) { const y = Math.floor(S.x[i] / 10000); (yrs[y] = yrs[y] || []).push(i); }
  const yearRows = Object.entries(yrs).map(([y, ix]) => { const i0 = ix[0] - 1, i1 = ix[ix.length - 1]; let pk = S.c[i0], mdd = 0; const lr = [];
    for (const i of ix) { pk = Math.max(pk, S.c[i]); mdd = Math.min(mdd, S.c[i] / pk - 1); lr.push(Math.log(S.c[i] / S.c[i - 1])); }
    return { y: +y, ret: S.c[i1] / S.c[i0] - 1, mdd, vol: U.std(lr) * Math.sqrt(S.f === 'D' ? 252 : 12), best: Math.exp(Math.max(...lr)) - 1, worst: Math.exp(Math.min(...lr)) - 1, nobs: ix.length, last: S.c[i1] }; }).reverse();
  const eps = []; { let pk = S.c[0], pi = 0, tr = 0, ti = 0, inDD = false;
    for (let i = 1; i < n; i++) { if (S.c[i] >= pk) { if (inDD && 1 - tr / pk >= .05) eps.push({ p: pi, t: ti, r: i, depth: tr / pk - 1 }); pk = S.c[i]; pi = i; tr = pk; inDD = false; } else { inDD = true; if (S.c[i] < tr || !tr) { tr = S.c[i]; ti = i; } } }
    if (inDD && 1 - tr / pk >= .05) eps.push({ p: pi, t: ti, r: null, depth: tr / pk - 1 }); }
  const topDD = eps.sort((a, b) => a.depth - b.depth).slice(0, 10);
  const unit = S.f === 'D' ? 'séances' : 'mois';
  const perfPanel = pn('Performances annuelles', 'DES', `<div class="tw" style="max-height:420px"><table class="t"><thead><tr><th class="l">Année</th><th>Clôture</th><th>Perf.</th><th>Max DD</th><th>Vol.</th><th>Meilleure</th><th>Pire</th><th>Obs.</th></tr></thead><tbody>
    ${yearRows.map(r => `<tr><td class="l am">${r.y}</td><td class="wh">${px(s, r.last)}</td><td>${pc(r.ret, 1)}</td><td>${pc(r.mdd, 1)}</td><td>${num(r.vol * 100, 1)}%</td><td>${pc(r.best, 1)}</td><td>${pc(r.worst, 1)}</td><td>${r.nobs}</td></tr>`).join('')}</tbody></table></div>`, { np: true });
  const ddPanel = pn('Drawdowns majeurs (≥ 5 %)', 'DES', `<table class="t"><thead><tr><th class="l">Sommet</th><th class="l">Creux</th><th>Baisse</th><th>Durée baisse</th><th class="l">Retour au sommet</th><th>Durée totale</th></tr></thead><tbody>
    ${topDD.map(e => `<tr><td class="l">${fd(S.x[e.p])}</td><td class="l">${fd(S.x[e.t])}</td><td>${pc(e.depth, 1)}</td><td>${e.t - e.p} ${unit}</td><td class="l">${e.r ? fd(S.x[e.r]) : '<span class="am">en cours</span>'}</td><td>${(e.r || n - 1) - e.p} ${unit}</td></tr>`).join('')}</tbody></table>`, { np: true, lect: 'Baisses du sommet au creux, classées par profondeur. La durée totale va du sommet au retour à ce niveau.' });
  const retChart = pn('Rendement par année', 'DES', cvb('desYr', 190));
  if (s.mkt === 'BRVM' && s.cls === 'Equity') {
    const [F, DV, EV] = await Promise.all([getJSON('fundamentals.json'), getJSON('dividends.json'), getJSON('events.json')]); if (!alive()) return;
    const f = F[s.id] || { series: {} }, se = f.series || {}, years = [...new Set(Object.values(se).flatMap(o => Object.keys(o)))].sort();
    const LBL = [['ca', 'Chiffre d’affaires / PNB (M)', 0], ['croissance_ca', 'Croissance CA %', 1], ['resultat_net', 'Résultat net (M)', 0], ['croissance_resultat_net', 'Croissance RN %', 1], ['bnpa', 'BNPA (XOF)', 2], ['dividende', 'Dividende net (XOF)', 2],
      ['per', 'PER', 1], ['roe', 'ROE %', 1], ['roa', 'ROA %', 2], ['marge_nette', 'Marge nette %', 1], ['marge_exploitation', 'Marge d’exploitation %', 1], ['capitaux_propres', 'Capitaux propres (M)', 0], ['total_bilan', 'Total bilan (M)', 0],
      ['depots_clientele', 'Dépôts clientèle (M)', 0], ['credits_clientele', 'Crédits clientèle (M)', 0], ['coefficient_d_exploitation', 'Coef. d’exploitation %', 1], ['cout_du_risque', 'Coût du risque (M)', 0], ['dette_nette', 'Dette nette (M)', 0], ['tresorerie', 'Trésorerie (M)', 0], ['ebitda', 'EBITDA (M)', 0]];
    const lastY = years[years.length - 1], eq = se.capitaux_propres && se.capitaux_propres[lastY], bvps = eq && f.shares ? eq * 1e6 / f.shares : null;
    const myDiv = DV.filter(x => x.t === s.id).sort((a, b) => (b.ex || 0) - (a.ex || 0) || (b.pay || '').localeCompare(a.pay || ''));
    const pxAt = ds => { if (!ds) return null; const d = s2i(ds); let k = S.x.findIndex(x => x >= d); if (k < 0) k = n - 1; return S.c[k]; };
    const ev = EV.filter(x => x.t === s.id);
    m.innerHTML = `<div class="grid c2">
      ${pn('Profil · ' + esc(s.short || s.n), 'DES', `<div class="grid c2b" style="gap:12px"><div class="kv2">
          <span>Raison sociale</span><b style="font-family:var(--ui)">${esc(s.n)}</b><span>Ticker</span><b>${s.tk}</b><span>Secteur</span><b style="font-family:var(--ui)">${esc(s.grp)}${s.bank ? ' · banque' : ''}</b><span>Pays</span><b style="font-family:var(--ui)">${esc(Q.sum.cty[s.cty] || s.cty)}</b>
          <span>Nombre de titres</span><b>${num(f.shares, 0)}</b><span>Flottant</span><b>${f.float != null ? num(f.float, 1) + '%' : '—'}</b><span>Capitalisation</span><b>${big(s.mcap)} XOF</b><span>Statut</span><b>${s.susp ? '<span class="dn">Cotation suspendue</span>' : 'Coté'}</b></div>
        <div class="kv2"><span>Cours</span><b>${px(s, s.last)} XOF</b><span>BNPA ${f.ex || ''}</span><b>${num(s.bnpa, 2)}</b><span>PER</span><b>${num(s.per, 1)}</b><span>Actif net / titre</span><b>${num(bvps, 0)}</b><span>Cours / actif net</span><b>${bvps ? num(s.last / bvps, 2) : '—'}</b>
          <span>Dernier dividende net</span><b>${num(s.dps, 2)}${s.dps_ex ? ' (ex. ' + s.dps_ex + ')' : ''}</b><span>Rendement</span><b>${s.yld ? num(s.yld * 100, 2) + '%' : '—'}</b><span>Payout</span><b>${s.dps && s.bnpa ? num(s.dps / s.bnpa * 100, 0) + '%' : '—'}</b><span>Paiement</span><b>${fds(s.dps_pay)}</b></div></div>`,
        { lect: '<b>PER</b> = cours ÷ BNPA du dernier exercice publié. <b>Cours / actif net</b> = capitalisation ÷ capitaux propres. Fondamentaux : SikaFinance (via BRVMetrics), en millions de XOF.' })}
      ${pn('Comptes · ' + years.length + ' exercices', 'FA', `<div class="tw"><table class="t"><thead><tr><th class="l">Rubrique</th>${years.map(y => `<th>${y}</th>`).join('')}</tr></thead><tbody>
        ${LBL.filter(([k]) => se[k] && Object.keys(se[k]).length).map(([k, l, d]) => `<tr><td class="l am">${l}</td>${years.map(y => { const v = se[k][y]; return `<td class="${/croissance/.test(k) ? cls(v) : 'wh'}">${v == null ? '—' : num(v, d)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`, { np: true })}
    </div>
    <div class="grid c4">${pn('Chiffre d’affaires (M XOF)', 'FA', cvb('fa1', 150))}${pn('Résultat net (M XOF)', 'FA', cvb('fa2', 150))}${pn('BNPA (XOF)', 'FA', cvb('fa3', 150))}${pn('Dividende net (XOF)', 'FA', cvb('fa4', 150))}</div>
    <div class="grid c2">
      ${pn('Historique des dividendes', 'DVD', `<div class="tw" style="max-height:330px"><table class="t"><thead><tr><th class="l">Exercice</th><th>Net / titre</th><th>Variation</th><th class="l">Annonce</th><th class="l">Détachement</th><th class="l">Paiement</th><th>Cours au détach.</th><th>Rdt au détach.</th></tr></thead><tbody>
        ${myDiv.map((x, i) => { const p = pxAt(x.det || x.pay), prv = myDiv[i + 1]; return `<tr><td class="l am">${x.ex || '—'}</td><td class="wh">${num(x.dps, 2)}</td><td>${prv && prv.dps ? pc(x.dps / prv.dps - 1, 1) : '—'}</td><td class="l">${fds(x.ann)}</td><td class="l">${fds(x.det)}</td><td class="l">${fds(x.pay)}</td><td>${p ? num(p, 0) : '—'}</td><td>${p ? num(x.dps / p * 100, 2) + '%' : '—'}</td></tr>`; }).join('') || '<tr><td class="l dm" colspan="8">Aucun dividende recensé</td></tr>'}</tbody></table></div>`, { np: true })}
      ${pn('Avis officiels · ' + ev.length, 'EVTS', `<div style="max-height:330px;overflow:auto">${ev.slice(0, 120).map(e => `<div class="ev" style="grid-template-columns:72px 1fr"><span class="d">${fds(e.d)}</span><span><span class="c">${esc(e.c || '')}</span><a href="${esc(e.u)}" target="_blank" rel="noopener">${esc(e.ti || '')}</a></span></div>`).join('') || '<div class="dm">Aucun avis.</div>'}</div>`)}
    </div><div class="grid c2">${perfPanel}<div class="grid" style="align-content:start">${retChart}${ddPanel}</div></div>`;
    const bc = (id, k, d) => { const o = se[k] || {}; const ys = Object.keys(o).sort(); if (!ys.length) { $(id).innerHTML = '<div class="empty">—</div>'; return; } barChart($(id), { labels: ys, values: ys.map(y => o[y]), fmt: v => num(v, d), labelsOnBars: true, pos: k === 'dividende' ? CL.amber : CL.up }); };
    bc('fa1', 'ca', 0); bc('fa2', 'resultat_net', 0); bc('fa3', 'bnpa', 0); bc('fa4', 'dividende', 0);
  } else {
    m.innerHTML = `<div class="grid c2">${pn('Profil · ' + esc(s.n), 'DES', `<div class="kv2"><span>Ticker</span><b>${s.tk}</b><span>Nom</span><b style="font-family:var(--ui)">${esc(s.n)}</b><span>Classe</span><b style="font-family:var(--ui)">${s.cls} · ${esc(s.grp || '')}</b><span>Devise / unité</span><b>${s.ccy}</b><span>Fréquence</span><b style="font-family:var(--ui)">${S.f === 'D' ? 'quotidienne' : 'mensuelle'}</b><span>Historique</span><b>${fd(S.x[0])} → ${fd(S.x[n - 1])}</b><span>Observations</span><b>${num(n, 0)}</b>
        <span>Plus haut historique</span><b>${px(s, s.ath)}</b><span>Écart au plus haut</span><b>${pc(s.dd, 1)}</b>${s.beta != null ? `<span>Bêta vs ${s.bench} (hebdo, 2 ans)</span><b>${num(s.beta, 2)}</b>` : ''}</div>`)}
      <div class="grid" style="align-content:start">${retChart}${ddPanel}</div></div>${perfPanel}`;
  }
  const yr = yearRows.slice().reverse(); barChart($('desYr'), { labels: yr.map(r => String(r.y).slice(2)), values: yr.map(r => r.ret * 100), fmt: v => num(v, 0) + '%', extra: i => 'max DD ' + num(yr[i].mdd * 100, 1) + '%' });
};

/* ------------------------------------------------------------------ HELP */
PAGES.HELP = async m => {
  const rows = [['MON', 'Marchés : tous les titres, signal SMA200 de QQQ, séance BRVM, carte des capitalisations', 'MON'], ['BRVM', '48 actions triables (PER, rendement, bêta, liquidité…), indices, largeur du marché, secteurs', 'BRVM'],
    ['GP', 'Graphique interactif : bougies, MM, Bollinger, RSI, MACD, drawdown, comparaison, échelle log, 5 min pour QQQ', 'SNTS GP · QQQ GP'], ['DES', 'Fiche : comptes sur plusieurs exercices, dividendes, avis (BRVM) ; perfs annuelles et drawdowns (tous)', 'SNTS DES'],
    ['BTST', 'Backtest de 8 stratégies sur le titre actif, levier simulé (US), Monte Carlo, durée des drawdowns', 'QQQ BTST'], ['QLAB', 'Statistiques : distribution, VaR, QQ-plot, cône de volatilité, autocorrélation, Hurst, analogues, probabilité bayésienne', 'NVDA QLAB'],
    ['CORR', 'Matrice de corrélation (hebdo), ACP et ratio d’absorption, paire au choix', 'CORR'], ['SEAS', 'Saisonnalité : années × mois, effet jour de semaine, « Sell in May »', 'BRVMC SEAS'],
    ['MACRO', 'Or depuis 1833, S&P 500 depuis 1871, CAPE, inflation, taux 10 ans, pétrole, gaz, VIX ; l’or pendant les krachs', 'MACRO'], ['FX', 'Franc CFA : USD/XOF, effet change sur QQQ et la BRVM', 'FX'],
    ['DVD', 'Dividendes BRVM : prochains paiements, rendements, historique complet', 'DVD'], ['EVTS', 'Les avis officiels BRVM (AG, dividendes, états financiers…) filtrables', 'EVTS']];
  m.innerHTML = pn('Aide · fonctions', 'HELP', `<table class="t"><thead><tr><th class="l">Code</th><th class="l">Ce que fait la fonction</th><th class="l">Exemple à taper</th></tr></thead><tbody>${rows.map(r => `<tr data-fn="${r[0]}" style="cursor:pointer"><td class="l tk">${r[0]}</td><td class="l nm">${r[1]}</td><td class="l am">${r[2]} &lt;GO&gt;</td></tr>`).join('')}</tbody></table>`,
    { np: true, lect: 'Tapez n’importe où pour écrire dans la ligne de commande. Un ticker seul ouvre son graphique (ou la fonction en cours). <b>Échap</b> revient à MON. Sur les graphiques : molette = zoom, glisser = déplacer, double-clic = vue initiale.' });
};
