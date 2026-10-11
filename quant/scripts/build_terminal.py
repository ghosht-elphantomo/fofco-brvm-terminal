#!/usr/bin/env python3
"""Build the terminal's static data set (data/*.json) from public sources. Standard library only.

Sources
  US / Taiwan equities & ETFs : github.com/yennanliu/finance_data (Yahoo Finance daily, refreshed nightly)
  BRVM (48 stocks, 18 indices, fundamentals, dividends, official notices) : github.com/harzat/brvm-data-public
  Macro (gold, S&P 500, CPI, US 10Y, Brent, WTI, natural gas, VIX, FX) : github.com/datasets/*
  Same-day BRVM session (optional --session) : brvm.json written by scrape.py from brvm.org

Usage: build_terminal.py --brvm-src DIR --out DIR [--session brvm.json] [--cache DIR]
"""
import argparse, csv, datetime as dt, io, json, math, os, re, sys, time, urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
YN = "https://raw.githubusercontent.com/yennanliu/finance_data/main/data/prices/{}.csv"
DS = "https://raw.githubusercontent.com/datasets/{}"
XOF_PER_EUR = 655.957

US = [  # ticker, name, type, group
    ("QQQ", "Invesco QQQ Trust", "ETF", "Indice"), ("VTI", "Vanguard Total Stock Market", "ETF", "Indice"),
    ("SOXX", "iShares Semiconductor", "ETF", "Semi-conducteurs"), ("SOXQ", "Invesco PHLX Semiconductor", "ETF", "Semi-conducteurs"),
    ("ROBO", "ROBO Global Robotics & Automation", "ETF", "Thématique"),
    ("NVDA", "NVIDIA", "Equity", "Semi-conducteurs"), ("AVGO", "Broadcom", "Equity", "Semi-conducteurs"),
    ("AMD", "Advanced Micro Devices", "Equity", "Semi-conducteurs"), ("TSM", "Taiwan Semiconductor ADR", "Equity", "Semi-conducteurs"),
    ("MU", "Micron Technology", "Equity", "Semi-conducteurs"), ("MRVL", "Marvell Technology", "Equity", "Semi-conducteurs"),
    ("INTC", "Intel", "Equity", "Semi-conducteurs"), ("WDC", "Western Digital", "Equity", "Matériel"), ("SNDK", "Sandisk", "Equity", "Matériel"),
    ("MSFT", "Microsoft", "Equity", "Logiciel"), ("ORCL", "Oracle", "Equity", "Logiciel"), ("PLTR", "Palantir Technologies", "Equity", "Logiciel"),
    ("GOOG", "Alphabet (C)", "Equity", "Communication"), ("META", "Meta Platforms", "Equity", "Communication"),
    ("AMZN", "Amazon.com", "Equity", "Conso. discrétionnaire"), ("TSLA", "Tesla", "Equity", "Automobile"),
    ("UBER", "Uber Technologies", "Equity", "Transport"), ("GRAB", "Grab Holdings", "Equity", "Transport"),
    ("SOFI", "SoFi Technologies", "Equity", "Finance"), ("NU", "Nu Holdings", "Equity", "Finance"),
    ("VST", "Vistra", "Equity", "Énergie"), ("IONQ", "IonQ", "Equity", "Quantique"), ("RKLB", "Rocket Lab", "Equity", "Spatial & défense"),
    ("PL", "Planet Labs", "Equity", "Spatial & défense"), ("KTOS", "Kratos Defense", "Equity", "Spatial & défense"),
    ("AVAV", "AeroVironment", "Equity", "Spatial & défense"), ("ONDS", "Ondas Holdings", "Equity", "Spatial & défense"),
    ("NBIS", "Nebius Group", "Equity", "Logiciel"),
]
TW = [("0050", "0050", "Yuanta Taiwan Top 50", "ETF", "Indice"), ("2330.tw", "2330", "TSMC (Taïwan)", "Equity", "Semi-conducteurs")]
CTY = {"B": "BJ", "BF": "BF", "C": "CI", "M": "ML", "N": "NE", "S": "SN", "T": "TG"}
CTY_NAME = {"CI": "Côte d'Ivoire", "SN": "Sénégal", "BF": "Burkina Faso", "BJ": "Bénin", "ML": "Mali", "NE": "Niger", "TG": "Togo"}


def log(*a):
    print("[build]", *a, flush=True)


def fetch(url, cache=None, tries=3):
    path = os.path.join(cache, re.sub(r"[^A-Za-z0-9._-]", "_", url)[-120:]) if cache else None
    if path and os.path.exists(path) and time.time() - os.path.getmtime(path) < 6 * 3600:
        return open(path, "rb").read()
    err = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                b = r.read()
            if path:
                os.makedirs(cache, exist_ok=True)
                open(path, "wb").write(b)
            return b
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 + 3 * k)
    raise err


def di(s):  # 'YYYY-MM-DD' or 'DD/MM/YYYY' or 'YYYY-MM' -> int YYYYMMDD
    s = s.strip().lstrip("﻿")
    if "/" in s:
        d, m, y = s.split("/")
        return int(y) * 10000 + int(m) * 100 + int(d)
    p = s.split("-")
    return int(p[0]) * 10000 + int(p[1]) * 100 + (int(p[2]) if len(p) > 2 else 1)


def fnum(x):
    x = (x or "").replace("\xa0", "").replace(" ", "").replace(" ", "").replace("%", "").replace(",", ".").strip()
    if x in ("", "-", "nan", "null"):
        return None
    try:
        return float(x)
    except ValueError:
        return None


def rnd(v, nd):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(v, nd)


# ------------------------------------------------------------------ loaders
def load_yn(sym, cache):
    rows = []
    for r in csv.DictReader(io.StringIO(fetch(YN.format(sym), cache).decode("utf8"))):
        c = fnum(r.get("close"))
        if not c:
            continue
        rows.append((di(r["date"]), fnum(r["open"]) or c, fnum(r["high"]) or c, fnum(r["low"]) or c, c, int(fnum(r["volume"]) or 0), fnum(r.get("div")) or 0))
    return rows


def load_brvm_csv(path):
    """harzat CSVs: real column order is Date;Close;Open;High;Low;Shares;Value;Var (header says otherwise)."""
    rows = {}
    with open(path, encoding="utf-8-sig") as f:
        next(f, None)
        for line in f:
            p = line.rstrip("\n").split(";")
            if len(p) < 5:
                continue
            try:
                d = di(p[0])
            except Exception:  # noqa: BLE001
                continue
            c, o, h, l = fnum(p[1]), fnum(p[2]), fnum(p[3]), fnum(p[4])
            if not c or c <= 0:
                continue
            vals = [x for x in (c, o, h, l) if x]
            o = o or c
            rows[d] = (d, o, max(vals), min(vals), c, int(fnum(p[5]) or 0) if len(p) > 5 else 0, int(fnum(p[6]) or 0) if len(p) > 6 else 0)
    return [rows[k] for k in sorted(rows)]


def series_from_csv(text, date_col, val_col, filt=None):
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        if filt and not filt(r):
            continue
        v = fnum(r.get(val_col))
        if v is None or v <= 0:
            continue
        out[di(r[date_col])] = v
    return sorted(out.items())


# ------------------------------------------------------------------ metrics
def stats_block(d, c, freq="D", h=None, l=None, v=None, val=None):
    n = len(c)
    per_year = 252 if freq == "D" else 12
    last, prev = c[-1], c[-2] if n > 1 else c[-1]

    def back(k):
        return c[-1 - k] if n > k else None

    def ret(k):
        b = back(k)
        return (last / b - 1) if b else None
    wk, mo, q, yr, y3 = (5, 21, 63, 252, 756) if freq == "D" else (None, 1, 3, 12, 36)
    ly = d[-1] // 10000 - 1
    base = None
    for i in range(n - 1, -1, -1):
        if d[i] // 10000 <= ly:
            base = c[i]
            break
    lr = [math.log(c[i] / c[i - 1]) for i in range(max(1, n - per_year), n) if c[i - 1] > 0]
    mu = sum(lr) / len(lr) if lr else 0
    sd = math.sqrt(sum((x - mu) ** 2 for x in lr) / max(1, len(lr) - 1)) if len(lr) > 2 else 0
    win = c[-per_year:]
    hi = max((h or c)[-per_year:])
    lo = min((l or c)[-per_year:])
    sma = lambda k: sum(c[-k:]) / k if n >= k else None  # noqa: E731
    gains = losses = 0.0
    rsi = None
    if n > 15:
        for i in range(n - 14, n):
            ch = c[i] - c[i - 1]
            gains += max(ch, 0)
            losses += max(-ch, 0)
        rsi = 100 if losses == 0 else 100 - 100 / (1 + gains / losses)
    peak = max(c)
    return {"last": rnd(last, 4), "prev": rnd(prev, 4), "pct": rnd(last / prev - 1 if prev else 0, 6), "dt": d[-1], "first": d[0], "nobs": n,
            "r1w": rnd(ret(wk), 5) if wk else None, "r1m": rnd(ret(mo), 5), "r3m": rnd(ret(q), 5), "r1y": rnd(ret(yr), 5), "r3y": rnd(ret(y3), 5),
            "ytd": rnd(last / base - 1, 5) if base else None, "vol": rnd(sd * math.sqrt(per_year), 5), "hi52": rnd(hi, 4), "lo52": rnd(lo, 4),
            "sma50": rnd(sma(50), 4) if freq == "D" else None, "sma200": rnd(sma(200), 4) if freq == "D" else None, "rsi": rnd(rsi, 2),
            "ath": rnd(peak, 4), "dd": rnd(last / peak - 1, 5), "spark": [rnd(x, 4) for x in c[-60:]],
            "liq": rnd(sum(val[-63:]) / len(val[-63:]), 0) if val and any(val[-63:]) else (rnd(sum(a * b for a, b in zip(v[-63:], c[-63:])) / len(v[-63:]), 0) if v and any(v[-63:]) else None),
            "vday": (val[-1] if val else None) or (rnd(v[-1] * c[-1], 0) if v else None), "shd": v[-1] if v else None}


def weekly(d, c):
    """Friday (week-ending) closes keyed by ISO week end date."""
    out = {}
    for di_, ci in zip(d, c):
        t = dt.date(di_ // 10000, di_ // 100 % 100, di_ % 100)
        fri = t + dt.timedelta(days=(4 - t.weekday()) % 7)
        out[fri.year * 10000 + fri.month * 100 + fri.day] = ci
    return out


def beta_corr(x, y):
    n = len(x)
    if n < 20:
        return None, None
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    if sxx <= 0 or syy <= 0:
        return None, None
    return sxy / syy, sxy / math.sqrt(sxx * syy)  # beta of x on y, correlation


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brvm-src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--session", default=None, help="brvm.json from scrape.py (same-day official BRVM values)")
    ap.add_argument("--cache", default=None)
    a = ap.parse_args()
    out, sdir = a.out, os.path.join(a.out, "s")
    os.makedirs(sdir, exist_ok=True)
    secs, files = [], {}

    def add(meta, d, c, o=None, h=None, l=None, v=None, val=None, div=None, freq="D", nd=2):
        sid = meta["id"]
        body = {"id": sid, "f": freq, "d": d, "c": [rnd(x, nd) for x in c]}
        if o:
            body.update(o=[rnd(x, nd) for x in o], h=[rnd(x, nd) for x in h], l=[rnd(x, nd) for x in l])
        if v and any(v):
            body["v"] = v
        if val and any(val):
            body["val"] = val
        if div and any(div):
            body["div"] = [rnd(x, 4) for x in div]
        files[sid] = body
        st = stats_block(d, c, freq, h, l, v, val)
        secs.append({**meta, "f": freq, **st})

    # US & Taiwan -----------------------------------------------------------
    for sym, name, typ, grp in US:
        try:
            r = load_yn(sym.lower(), a.cache)
        except Exception as e:  # noqa: BLE001
            log("skip", sym, e)
            continue
        add({"id": sym, "tk": f"{sym} US", "n": name, "cls": "Equity", "typ": typ, "mkt": "US", "grp": grp, "ccy": "USD", "bench": "QQQ"},
            [x[0] for x in r], [x[4] for x in r], [x[1] for x in r], [x[2] for x in r], [x[3] for x in r], [x[5] for x in r], div=[x[6] for x in r])
    for f, sym, name, typ, grp in TW:
        try:
            r = load_yn(f, a.cache)
        except Exception as e:  # noqa: BLE001
            log("skip", sym, e)
            continue
        add({"id": sym, "tk": f"{sym} TT", "n": name, "cls": "Equity", "typ": typ, "mkt": "TW", "grp": grp, "ccy": "TWD", "bench": "0050"},
            [x[0] for x in r], [x[4] for x in r], [x[1] for x in r], [x[2] for x in r], [x[3] for x in r], [x[5] for x in r], div=[x[6] for x in r])

    # BRVM ------------------------------------------------------------------
    src = a.brvm_src
    acts = json.load(open(os.path.join(src, "actions.json"), encoding="utf8"))["actions"]
    fund = json.load(open(os.path.join(src, "fundamentals.json"), encoding="utf8"))
    divs = json.load(open(os.path.join(src, "dividendes.json"), encoding="utf8"))["all"]
    status = json.load(open(os.path.join(src, "trading_status.json"), encoding="utf8"))
    session = json.load(open(a.session, encoding="utf8")) if a.session and os.path.exists(a.session) else None
    sess_rows = {r["t"]: r for r in (session or {}).get("rows", [])}
    sess_d = di(session["asof"]) if session else None
    last_div = {}
    for x in divs:
        t = x.get("ticker")
        if not t or not x.get("dividende"):
            continue
        k = (x.get("exercice") or 0, x.get("date_paiement") or "")
        if t not in last_div or k > last_div[t][0]:
            last_div[t] = (k, x)
    for act in acts:
        t = act["ticker"]
        p = os.path.join(src, act["csv"] + ".csv")
        if not os.path.exists(p):
            log("missing csv", t)
            continue
        rows = load_brvm_csv(p)
        if t in sess_rows and sess_d and rows and sess_d >= rows[-1][0]:
            s = sess_rows[t]
            bar = (sess_d, s.get("o") or s["c"], max(s["c"], s.get("o") or s["c"]), min(s["c"], s.get("o") or s["c"]), s["c"], s.get("vol", 0), int((s.get("vol") or 0) * s["c"]))
            rows = [r for r in rows if r[0] != sess_d] + [bar]
        if len(rows) < 3:
            continue
        cty = "BF" if t.endswith("BF") else CTY.get(t[-1], "CI")
        f = fund.get(t, {})
        shares = f.get("nb_titres")
        ld = last_div.get(t, (None, {}))[1]
        last = rows[-1][4]
        meta = {"id": t, "tk": f"{t} BC", "n": act.get("nom_officiel") or act.get("nom"), "short": act.get("nom"), "cls": "Equity", "typ": "Equity",
                "mkt": "BRVM", "grp": act.get("secteur"), "ccy": "XOF", "bench": "BRVMC", "cty": cty, "bank": bool(act.get("banque")),
                "shares": shares, "float": f.get("flottant"), "mcap": rnd(shares * last, 0) if shares else None,
                "bnpa": f.get("bnpa"), "dps": ld.get("dividende") or f.get("dividende"), "dps_ex": ld.get("exercice"), "dps_pay": ld.get("date_paiement"),
                "per": rnd(last / f["bnpa"], 2) if f.get("bnpa") and f["bnpa"] > 0 else None,
                "yld": rnd((ld.get("dividende") or 0) / last, 5) if ld.get("dividende") else None,
                "susp": (status.get(t) or {}).get("statut") == "suspendue"}
        add(meta, [r[0] for r in rows], [r[4] for r in rows], [r[1] for r in rows], [r[2] for r in rows], [r[3] for r in rows],
            [r[5] for r in rows], [r[6] for r in rows], nd=2)
    rep = json.load(open(os.path.join(src, "indices", "indices_report.json"), encoding="utf8"))
    imap = {"BRVM-C": "BRVMC", "BRVM-30": "BRVM30", "BRVM-PRES": "BRVMPR", "BRVM-PRIN": "BRVMPA", "TL": "BRVM-TEL", "CD": "BRVM-CD",
            "SF": "BRVM-SF", "CB": "BRVM-CB", "IN": "BRVM-IN", "EN": "BRVM-EN", "SP": "BRVM-SP"}
    sess_idx = {imap[x["k"]]: x for x in (session or {}).get("idx", []) + (session or {}).get("sect", []) if x.get("k") in imap}
    for e in rep["entries"]:
        p = os.path.join(src, "indices", e["fichier"])
        if not os.path.exists(p):
            continue
        rows = load_brvm_csv(p)
        code = e["code"]
        if code in sess_idx and sess_d and rows and sess_d >= rows[-1][0]:
            v = sess_idx[code]["v"]
            rows = [r for r in rows if r[0] != sess_d] + [(sess_d, v, v, v, v, 0, rows[-1][6])]
        if len(rows) < 30:
            continue
        add({"id": code, "tk": f"{code} Index", "n": e["nom"], "cls": "Index", "typ": "Index", "mkt": "BRVM", "grp": "Indice " + e.get("type", ""), "ccy": "XOF", "bench": "BRVMC"},
            [r[0] for r in rows], [r[4] for r in rows], nd=2, val=[r[6] for r in rows])

    # Macro -----------------------------------------------------------------
    def macro(sid, tk, name, grp, path, dcol, vcol, freq, nd=2, filt=None, ccy="USD", cls="Comdty"):
        try:
            s = series_from_csv(fetch(DS.format(path), a.cache).decode("utf8"), dcol, vcol, filt)
        except Exception as e:  # noqa: BLE001
            log("skip", sid, e)
            return []
        add({"id": sid, "tk": tk, "n": name, "cls": cls, "typ": cls, "mkt": "MACRO", "grp": grp, "ccy": ccy}, [x[0] for x in s], [x[1] for x in s], freq=freq, nd=nd)
        return s
    macro("XAU", "XAU Curncy", "Or (USD/once, mensuel)", "Métaux", "gold-prices/main/data/monthly.csv", "Date", "Price", "M")
    macro("SPX", "SPX Index", "S&P 500 (mensuel)", "Actions", "s-and-p-500/main/data/data.csv", "Date", "SP500", "M", cls="Index")
    macro("CAPE", "CAPE Index", "S&P 500 PER de Shiller (CAPE)", "Valorisation", "s-and-p-500/main/data/data.csv", "Date", "PE10", "M", cls="Index")
    macro("CPI", "CPI INDX", "Indice des prix US (CPI-U)", "Inflation", "cpi-us/main/data/cpiai.csv", "Date", "Index", "M", cls="Index")
    macro("US10Y", "USGG10YR Index", "Taux US 10 ans (%)", "Taux", "bond-yields-us-10y/main/data/monthly.csv", "Date", "Rate", "M", cls="Rate", ccy="%")
    macro("BRENT", "CO1 Comdty", "Pétrole Brent (USD/baril)", "Énergie", "oil-prices/main/data/brent-daily.csv", "Date", "Price", "D")
    macro("WTI", "CL1 Comdty", "Pétrole WTI (USD/baril)", "Énergie", "oil-prices/main/data/wti-daily.csv", "Date", "Price", "D")
    macro("NATGAS", "NG1 Comdty", "Gaz naturel Henry Hub (USD/MMBtu)", "Énergie", "natural-gas/main/data/daily.csv", "Date", "Price", "D", nd=3)
    macro("VIX", "VIX Index", "Volatilité implicite S&P 500", "Volatilité", "finance-vix/main/data/vix-daily.csv", "DATE", "CLOSE", "D", cls="Index", ccy="pts")
    try:
        fx = fetch(DS.format("exchange-rates/main/data/daily.csv"), a.cache).decode("utf8")
        eur = series_from_csv(fx, "Date", "Exchange rate", lambda r: r.get("Country") == "Euro")
        twd = series_from_csv(fx, "Date", "Exchange rate", lambda r: r.get("Country") == "Taiwan")
        add({"id": "EURUSD", "tk": "EURUSD Curncy", "n": "Euro / Dollar US", "cls": "Curncy", "typ": "Curncy", "mkt": "MACRO", "grp": "Change", "ccy": "USD"},
            [x[0] for x in eur], [1 / x[1] for x in eur], nd=5)
        add({"id": "USDXOF", "tk": "USDXOF Curncy", "n": "Dollar US / Franc CFA (BCEAO)", "cls": "Curncy", "typ": "Curncy", "mkt": "MACRO", "grp": "Change", "ccy": "XOF"},
            [x[0] for x in eur], [x[1] * XOF_PER_EUR for x in eur], nd=3)
        add({"id": "USDTWD", "tk": "USDTWD Curncy", "n": "Dollar US / Dollar taïwanais", "cls": "Curncy", "typ": "Curncy", "mkt": "MACRO", "grp": "Change", "ccy": "TWD"},
            [x[0] for x in twd], [x[1] for x in twd], nd=4)
    except Exception as e:  # noqa: BLE001
        log("skip FX", e)

    # Betas / correlations on weekly returns (2 years) ----------------------
    wk = {sid: weekly(b["d"], b["c"]) for sid, b in files.items() if b["f"] == "D"}
    for s in secs:
        bm = s.get("bench")
        if s["f"] != "D" or not bm or bm == s["id"] or bm not in wk:
            continue
        a_, b_ = wk[s["id"]], wk[bm]
        keys = sorted(set(a_) & set(b_))[-105:]
        x = [math.log(a_[keys[i]] / a_[keys[i - 1]]) for i in range(1, len(keys))]
        y = [math.log(b_[keys[i]] / b_[keys[i - 1]]) for i in range(1, len(keys))]
        s["beta"], s["corr"] = (rnd(v, 3) for v in beta_corr(x, y))
    # weekly matrix (10 years) for CORR / PCA
    allw = sorted({k for v in wk.values() for k in v})
    allw = [k for k in allw if k >= allw[-1] - 100000][-530:]
    wm = {"w": allw, "s": {}}
    for sid, ser in wk.items():
        last = None
        col = []
        for k in allw:
            if k in ser:
                last = ser[k]
            col.append(rnd(last, 4) if last is not None else None)
        if sum(1 for v in col if v is not None) > 52:
            wm["s"][sid] = col

    # BRVM breadth (since 2008) -------------------------------------------
    stocks = [s["id"] for s in secs if s["mkt"] == "BRVM" and s["cls"] == "Equity"]
    days = sorted({d for sid in stocks for d in files[sid]["d"] if d >= 20080101})
    above200, above50, adv, dec, nh, nl = ({} for _ in range(6))
    for sid in stocks:
        b = files[sid]
        d, c = b["d"], b["c"]
        s50 = s200 = 0.0
        for i in range(len(c)):
            s50 += c[i]
            s200 += c[i]
            if i >= 50:
                s50 -= c[i - 50]
            if i >= 200:
                s200 -= c[i - 200]
            if d[i] < 20080101 or i < 1:
                continue
            day = d[i]
            if i >= 199:
                above200.setdefault(day, [0, 0])
                above200[day][1] += 1
                above200[day][0] += c[i] > s200 / 200
            if i >= 49:
                above50.setdefault(day, [0, 0])
                above50[day][1] += 1
                above50[day][0] += c[i] > s50 / 50
            if c[i] > c[i - 1]:
                adv[day] = adv.get(day, 0) + 1
            elif c[i] < c[i - 1]:
                dec[day] = dec.get(day, 0) + 1
            if i >= 251:
                w = c[i - 251:i]
                if c[i] > max(w):
                    nh[day] = nh.get(day, 0) + 1
                elif c[i] < min(w):
                    nl[day] = nl.get(day, 0) + 1
    adl, run = [], 0
    for day in days:
        run += adv.get(day, 0) - dec.get(day, 0)
        adl.append(run)
    breadth = {"d": days, "a200": [rnd(above200[x][0] / above200[x][1], 4) if x in above200 and above200[x][1] >= 10 else None for x in days],
               "a50": [rnd(above50[x][0] / above50[x][1], 4) if x in above50 and above50[x][1] >= 10 else None for x in days],
               "adv": [adv.get(x, 0) for x in days], "dec": [dec.get(x, 0) for x in days], "adl": adl,
               "nh": [nh.get(x, 0) for x in days], "nl": [nl.get(x, 0) for x in days]}

    # BRVM meta: fundamentals, dividends, notices ---------------------------
    keep = ["ca", "resultat_net", "bnpa", "dividende", "per", "capitaux_propres", "roe", "roa", "marge_nette", "marge_exploitation",
            "croissance_ca", "croissance_resultat_net", "total_bilan", "depots_clientele", "credits_clientele", "coefficient_d_exploitation",
            "cout_du_risque", "ratio_endettement_net", "dette_nette", "tresorerie", "ebitda", "ebit"]
    fmeta = {k: {"nom": v.get("nom"), "secteur": v.get("secteur"), "shares": v.get("nb_titres"), "float": v.get("flottant"), "ex": v.get("exercice"),
                 "series": {s: v["series"][s] for s in keep if v.get("series", {}).get(s)}}
             for k, v in fund.items() if k != "_meta"}
    dmeta = [{"t": x.get("ticker"), "ex": x.get("exercice"), "dps": x.get("dividende"), "ann": x.get("date_annonce"), "det": x.get("date_detachement"),
              "pay": x.get("date_paiement"), "src": x.get("source")} for x in divs if x.get("ticker")]
    ev = json.load(open(os.path.join(src, "events.json"), encoding="utf8"))["events"]
    emeta = [{"d": x.get("published_at") or x.get("event_at"), "e": x.get("event_at"), "t": x.get("ticker"), "c": x.get("category_label"),
              "ti": x.get("title"), "u": x.get("document_url")} for x in ev if (x.get("published_at") or x.get("event_at"))]
    emeta.sort(key=lambda x: x["d"] or "", reverse=True)

    # write ------------------------------------------------------------------
    for sid, body in files.items():
        with open(os.path.join(sdir, sid.replace(".", "_") + ".json"), "w", encoding="utf8") as fh:
            json.dump(body, fh, separators=(",", ":"))
    asof = max(s["dt"] for s in secs if s["mkt"] in ("US", "BRVM"))
    summ = {"asof": asof, "built": int(time.time()), "secs": secs, "sectors": sorted({s["grp"] for s in secs if s["mkt"] == "BRVM" and s["cls"] == "Equity"}),
            "session": {"asof": session.get("asof"), "label": session.get("session"), "capA": session.get("capA")} if session else None, "cty": CTY_NAME}
    for name, obj in (("summary", summ), ("weekly", wm), ("breadth", breadth), ("fundamentals", fmeta), ("dividends", dmeta), ("events", emeta),
                      ("events_recent", emeta[:80])):
        with open(os.path.join(out, name + ".json"), "w", encoding="utf8") as fh:
            json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False)
    tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    log(f"{len(secs)} securities, {sum(len(b['d']) for b in files.values())} rows, {tot / 1e6:.1f} MB -> {out}")


if __name__ == "__main__":
    sys.exit(main())
