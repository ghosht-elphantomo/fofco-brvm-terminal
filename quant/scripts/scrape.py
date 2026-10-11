#!/usr/bin/env python3
"""Data feed for the CLAUDE × QUANT terminal (standard library only, runs on GitHub Actions).

  --mode live : QQQ quote + 5-minute bars (Yahoo), 48 BRVM stocks + indices (brvm.org).
                Refreshes the daily history too if it is behind the last completed session.
  --mode eod  : same, and always rebuilds history.json (QQQ OHLCV+dividends, 21 markets).

--state : folder holding the previous history.json / brvm.json (the workflow restores it from the
          quant-data branch; quant/seed/ is the initial seed). Updated in place.
--out   : the deployable site (index.html + data/*.json + data/feed_daily.json for the claude.ai sync).
Any source that fails keeps the last good snapshot, so the site never goes blank.
"""
import argparse, datetime as dt, json, os, re, shutil, sys, time, urllib.parse, urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "seed")
MARKETS = ["VTI", "SOXX", "NVDA", "MSFT", "AMZN", "GOOG", "META", "TSLA", "AVGO", "AMD", "ORCL",
           "INTC", "MU", "MRVL", "TSM", "PLTR", "UBER", "SOFI", "WDC", "ROBO", "0050"]
YSYM = {"0050": "0050.TW"}
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
FR_MONTHS = {m: i + 1 for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
                                            "août", "septembre", "octobre", "novembre", "décembre"])}
FR_DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]


ERRORS = {}


def log(*a):
    print("[scrape]", *a, flush=True)


def fail(key, e):
    ERRORS[key] = f"{type(e).__name__}: {e}"[:300]
    log(key, "failed:", ERRORS[key])


def get(url, tries=3, timeout=30, headers=None):
    err = None
    for k in range(tries):
        try:
            h = {"User-Agent": UA, "Accept": "application/json,text/html,*/*;q=0.8",
                 "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"}
            h.update(headers or {})
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 + 4 * k)
    raise err


def load(name, default=None, folder=None):
    try:
        with open(os.path.join(folder or DATA, name), encoding="utf8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def dump(obj, *paths):
    s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    for p in paths:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf8") as f:
            f.write(s)


# ------------------------------------------------------------------ Yahoo
def chart(sym, rng, interval, events=""):
    err = None
    for host in ("query1", "query2"):
        url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
               f"?range={rng}&interval={interval}&includePrePost=false" + (f"&events={events}" if events else ""))
        try:
            j = json.loads(get(url, headers={"Referer": "https://finance.yahoo.com/", "Origin": "https://finance.yahoo.com"}))
            res = j["chart"]["result"][0]
            if not res.get("timestamp"):
                raise ValueError("no bars")
            return res
        except Exception as e:  # noqa: BLE001
            err = e
    raise err


def day_of(ts, off):
    return dt.datetime.fromtimestamp(ts + off, dt.timezone.utc).date().isoformat()


def session_open(meta, now):
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    return bool(reg) and reg.get("start", 0) <= now < reg.get("end", 0)


def daily(sym):
    res = chart(YSYM.get(sym, sym), "10y", "1d", "div|split")
    meta, off = res["meta"], res["meta"].get("gmtoffset", 0)
    q = res["indicators"]["quote"][0]
    divs = {}
    for v in ((res.get("events") or {}).get("dividends") or {}).values():
        d = day_of(v["date"], off)
        divs[d] = divs.get(d, 0) + float(v["amount"])
    rows = []
    for i, t in enumerate(res["timestamp"]):
        c = q["close"][i]
        if c is None:
            continue
        o, h, l = q["open"][i] or c, q["high"][i] or c, q["low"][i] or c
        rows.append([day_of(t, off), round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(q["volume"][i] or 0),
                     round(divs.get(day_of(t, off), 0), 4)])
    if rows and session_open(meta, time.time()):
        rows = rows[:-1]  # the session in progress is not a finished daily bar
    return rows


def build_history(prev):
    qqq = daily("QQQ")
    if len(qqq) < 1500:
        raise ValueError(f"QQQ history too short ({len(qqq)})")
    H = {"asof": qqq[-1][0], "src": "Yahoo Finance daily", "d": [], "o": [], "h": [], "l": [], "c": [], "v": [],
         "div": [], "mk": {}}
    for r in qqq:
        for k, v in zip(("d", "o", "h", "l", "c", "v", "div"), r):
            H[k].append(v)
    old = {}
    if prev:
        for t, arr in (prev.get("mk") or {}).items():
            old[t] = dict(zip(prev["d"], arr))
    for t in MARKETS:
        try:
            rows = daily(t)
            m = {r[0]: r[4] for r in rows}
            first = rows[0][0]
        except Exception as e:  # noqa: BLE001
            log("market failed, keeping previous:", t, e)
            m, first = {d: v for d, v in old.get(t, {}).items() if v is not None}, None
            first = min(m) if m else "9999"
        out, last = [], None
        for d in H["d"]:
            if d in m:
                last = m[d]
            out.append(None if (d < first or last is None) else round(last, 2))
        H["mk"][t] = out
        time.sleep(0.4)
    return H


def live_quote():
    res = chart("QQQ", "5d", "5m")
    meta, off, now = res["meta"], res["meta"].get("gmtoffset", 0), time.time()
    q = res["indicators"]["quote"][0]
    bars = [(t, q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i] or 0)
            for i, t in enumerate(res["timestamp"]) if q["close"][i] is not None and q["open"][i] is not None]
    if not bars:
        raise ValueError("no intraday bars")
    tp = meta.get("currentTradingPeriod") or {}
    within = lambda p: bool(p) and p.get("start", 0) <= now < p.get("end", 0)  # noqa: E731
    state = ("REGULAR" if within(tp.get("regular")) else "PRE" if within(tp.get("pre"))
             else "POST" if within(tp.get("post")) else "CLOSED")
    price = float(meta.get("regularMarketPrice") or bars[-1][4])
    day = day_of(meta.get("regularMarketTime") or bars[-1][0], off)
    today = [b for b in bars if day_of(b[0], off) == day]
    before = [b for b in bars if day_of(b[0], off) < day]
    prev = before[-1][4] if before else float(meta.get("chartPreviousClose") or price)
    r2 = lambda v: round(float(v), 2)  # noqa: E731
    return {
        "price": r2(price), "prev": r2(prev), "chg": round(price / prev - 1, 6), "day": day, "state": state,
        "open": r2(today[0][1]) if today else r2(price),
        "dayHigh": r2(max(b[2] for b in today)) if today else r2(price),
        "dayLow": r2(min(b[3] for b in today)) if today else r2(price),
        "vol": int(sum(b[5] for b in today)), "time": int(meta.get("regularMarketTime") or bars[-1][0]),
    }, {"t": [b[0] for b in bars], "o": [r2(b[1]) for b in bars], "h": [r2(b[2]) for b in bars],
        "l": [r2(b[3]) for b in bars], "c": [r2(b[4]) for b in bars], "v": [int(b[5]) for b in bars]}


# ------------------------------------------------------------------ Nasdaq fallbacks (no dividends)
NQ_H = {"Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}


def money(x):
    return num(str(x).replace("$", "")) if x not in (None, "", "N/A") else None


def nasdaq_live():
    j = json.loads(get("https://api.nasdaq.com/api/quote/QQQ/chart?assetclass=etf", headers=NQ_H))
    d = j["data"]
    pts = [(int(p["x"]) // 1000, float(p["y"])) for p in d.get("chart") or [] if p.get("y") is not None]
    if not pts:
        raise ValueError("no chart points")
    price = money(d.get("lastSalePrice")) or pts[-1][1]
    prev = money(d.get("previousClose")) or pts[0][1]
    bars, cur = [], None
    for t, y in pts:
        b = t - t % 300
        if cur and cur[0] == b:
            cur[2], cur[3], cur[4] = max(cur[2], y), min(cur[3], y), y
        else:
            cur = [b, y, y, y, y, 0]
            bars.append(cur)
    day = dt.datetime.fromtimestamp(pts[-1][0] - 4 * 3600, dt.timezone.utc).date().isoformat()
    mstat = str(d.get("marketStatus") or "").upper()
    state = "REGULAR" if "OPEN" in mstat and "PRE" not in mstat and "AFTER" not in mstat else "PRE" if "PRE" in mstat else "POST" if "AFTER" in mstat else "CLOSED"
    r2 = lambda v: round(float(v), 2)  # noqa: E731
    return {"price": r2(price), "prev": r2(prev), "chg": round(price / prev - 1, 6), "day": day, "state": state,
            "open": r2(bars[0][1]), "dayHigh": r2(max(b[2] for b in bars)), "dayLow": r2(min(b[3] for b in bars)),
            "vol": 0, "time": pts[-1][0], "src": "nasdaq"}, \
        {"t": [b[0] for b in bars], "o": [r2(b[1]) for b in bars], "h": [r2(b[2]) for b in bars],
         "l": [r2(b[3]) for b in bars], "c": [r2(b[4]) for b in bars], "v": [0 for _ in bars]}


def nasdaq_daily_append(hist):
    """Append missing QQQ sessions from Nasdaq when Yahoo is unavailable (markets carried forward)."""
    frm = hist["d"][-1]
    j = json.loads(get(f"https://api.nasdaq.com/api/quote/QQQ/historical?assetclass=etf&fromdate={frm}&limit=60", headers=NQ_H))
    rows = (((j.get("data") or {}).get("tradesTable") or {}).get("rows")) or []
    new = []
    for r in rows:
        m, d_, y = r["date"].split("/")
        d = f"{y}-{m}-{d_}"
        c = money(r.get("close"))
        if d > hist["d"][-1] and c:
            new.append((d, money(r.get("open")) or c, money(r.get("high")) or c, money(r.get("low")) or c, c,
                        int(num(str(r.get("volume", "0")).replace(",", "")) or 0)))
    for d, o, h, l, c, v in sorted(new):
        for k, val in zip(("d", "o", "h", "l", "c", "v", "div"), (d, o, h, l, c, v, 0)):
            hist[k].append(val)
        for t in hist["mk"]:
            hist["mk"][t].append(hist["mk"][t][-1])
    if new:
        hist["asof"] = hist["d"][-1]
    return len(new)


# ------------------------------------------------------------------ BRVM
class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.row, self.cell, self.text = [], None, None, []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        self.text.append(data)
        if self.cell is not None:
            self.cell.append(data)


def parse(html):
    p = Tables()
    p.feed(html)
    return p.rows, " ".join(" ".join(p.text).split())


def num(x):
    x = (x or "").replace("\xa0", "").replace(" ", "").replace(" ", "").replace("%", "").replace(",", ".").strip()
    try:
        return float(x)
    except ValueError:
        return None


def fr_dates(text):
    out = []
    pat = r"(%s),?\s+(\d{1,2})\s+([a-zéû]+),?\s+(\d{4})" % "|".join(FR_DAYS)
    for m in re.finditer(pat, text, flags=re.I):
        mo = FR_MONTHS.get(m.group(3).lower())
        if mo:
            try:
                out.append(dt.date(int(m.group(4)), mo, int(m.group(2))))
            except ValueError:
                pass
    return out


def scrape_brvm(prev):
    html = get("https://www.brvm.org/fr/cours-actions/0").decode("utf8", "replace")
    rows, text = parse(html)
    out = []
    for r in rows:
        if len(r) >= 7 and re.fullmatch(r"[A-Z]{3,6}", r[0].strip()):
            t, vol, pv, op, cl, var = r[0].strip(), num(r[2]), num(r[3]), num(r[4]), num(r[5]), num(r[6])
            if cl is None or cl <= 0:
                continue
            # After the session brvm.org already shows the new reference price as "cours veille":
            # the published variation is the reliable field, the previous close is derived from it.
            if var is None or abs(var) > 15:  # BRVM daily band is ±7.5 %: anything wider is a parse error
                var = round((cl / pv - 1) * 100, 2) if pv else 0.0
            pv = round(cl / (1 + var / 100), 2) if var > -100 else pv
            out.append({"t": t, "vol": int(vol or 0), "prev": pv, "o": op if op else None, "c": cl, "vj": var})
    if len(out) < 40:
        raise ValueError(f"only {len(out)} BRVM rows parsed")
    today = dt.date.today()
    ds = [d for d in fr_dates(text) if today - dt.timedelta(days=10) <= d <= today]
    sess = min(ds) if ds else today
    capA, capO = (prev or {}).get("capA"), (prev or {}).get("capO")
    m = re.search(r"Actions?\s*:?\s*([\d][\d\s  \.]{9,})\s*FCFA", text)
    if m:
        capA = num(m.group(1).replace(".", "")) or capA
    m = re.search(r"Obligations?\s*:?\s*([\d][\d\s  \.]{9,})\s*FCFA", text)
    if m:
        capO = num(m.group(1).replace(".", "")) or capO
    idx, sect = (prev or {}).get("idx", []), (prev or {}).get("sect", [])
    try:
        idx, sect = scrape_indices(idx, sect)
    except Exception as e:  # noqa: BLE001
        fail("brvm_indices", e)
    label = f"{FR_DAYS[sess.weekday()]} {sess.day} {[k for k, v in FR_MONTHS.items() if v == sess.month][0]} {sess.year}"
    return {"asof": sess.isoformat(), "session": label, "src": "brvm.org (cours du jour)", "rows": out,
            "idx": idx, "sect": sect, "capA": capA, "capO": capO, "ts": int(time.time())}


IDX_MAP = [("TOTAL RETURN", "BRVM-CTR", "BRVM Composite TR"), ("COMPOSITE", "BRVM-C", "BRVM Composite"),
           ("BRVM-30", "BRVM-30", "BRVM 30"), ("BRVM 30", "BRVM-30", "BRVM 30"), ("PRESTIGE", "BRVM-PRES", "BRVM Prestige"),
           ("PRINCIPAL", "BRVM-PRIN", "BRVM Principal")]
SECT_MAP = [("CONSOMMATION DE BASE", "CB"), ("DISCRETIONNAIRE", "CD"), ("DISCRÉTIONNAIRE", "CD"), ("ENERGIE", "EN"),
            ("ÉNERGIE", "EN"), ("INDUSTRIELS", "IN"), ("SERVICES FINANCIERS", "SF"), ("SERVICES PUBLICS", "SP"),
            ("TELECOMMUNICATIONS", "TL"), ("TÉLÉCOMMUNICATIONS", "TL")]


def scrape_indices(idx_prev, sect_prev):
    rows, _ = parse(get("https://www.brvm.org/fr/indices").decode("utf8", "replace"))
    idx, sect, score = {}, {}, {}
    for r in rows:
        if not r or "BRVM" not in r[0].upper():
            continue
        name = r[0].upper()
        nums = [v for v in (num(c) for c in r[1:]) if v is not None]
        if len(nums) >= 3 and nums[0] > 0 and abs((nums[1] / nums[0] - 1) * 100 - nums[2]) < 0.15:
            close, var, q = nums[1], nums[2], 2          # prev | close | var% (| YTD)
        elif len(nums) >= 2 and nums[0] > 1 and abs(nums[1]) < 25:
            close, var, q = nums[0], nums[1], 1          # close | var%
        else:
            continue
        key = None
        for k, sc in SECT_MAP:
            if k in name:
                key, rec = "s:" + sc, {"k": sc, "v": close, "vj": var}
                break
        else:
            for k, code, label in IDX_MAP:
                if k in name:
                    key, rec = "i:" + code, {"k": code, "n": label, "v": close, "vj": var}
                    break
        if key and q >= score.get(key, 0):
            score[key] = q
            (sect if key[0] == "s" else idx)[key[2:]] = rec
    order = ["BRVM-C", "BRVM-30", "BRVM-PRES", "BRVM-PRIN", "BRVM-CTR"]
    if "BRVM-C" not in idx:
        raise ValueError("composite not found")
    prev = {x["k"]: x for x in idx_prev}
    idx_out = [idx.get(k) or prev.get(k) for k in order if idx.get(k) or prev.get(k)]
    sp = {x["k"]: x for x in sect_prev}
    sect_out = [sect.get(k) or sp.get(k) for k in ["TL", "CD", "SF", "CB", "IN", "EN", "SP"] if sect.get(k) or sp.get(k)]
    return idx_out, sect_out


def archive_brvm(b):
    """Append the session to seed/brvm_daily.csv (one line per stock per session)."""
    path = os.path.join(DATA, "brvm_daily.csv")
    have = set()
    if os.path.exists(path):
        with open(path, encoding="utf8") as f:
            have = {line.split(",", 1)[0] for line in f}
    if b["asof"] in have:
        return
    new = not os.path.exists(path)
    with open(path, "a", encoding="utf8") as f:
        if new:
            f.write("date,ticker,close,var_pct,volume,prev\n")
        for r in b["rows"]:
            f.write(f'{b["asof"]},{r["t"]},{r["c"]},{r["vj"]},{r["vol"]},{r["prev"]}\n')
    log("archived BRVM session", b["asof"])


def roll_year(last):
    """First EOD run of a new year: the last committed session becomes the YTD base."""
    ref = load("brvm_ref.json")
    if not ref:
        return
    closes = {r["t"]: r["c"] for r in last["rows"]}
    for t, f in ref["rows"].items():
        c = closes.get(t)
        if not c:
            continue
        if f.get("per") and f.get("cref"):
            f["per"] = round(f["per"] * c / f["cref"], 2)
        f["cref"], f["ytd"] = c, 0.0
    for x in last.get("idx", []):
        ref["idx"][x["k"]] = {"vref": x["v"], "ytd": 0.0}
    for x in last.get("sect", []):
        ref["sect"][x["k"]] = {"vref": x["v"], "ytd": 0.0}
    ref["ref"] = last["asof"]
    dump(ref, os.path.join(DATA, "brvm_ref.json"))
    log("YTD base rolled to", last["asof"])


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["live", "eod"], default="live")
    ap.add_argument("--out", default=os.path.join(ROOT, "_site"))
    ap.add_argument("--state", default=DATA)
    a = ap.parse_args()
    st = a.state
    os.makedirs(st, exist_ok=True)
    out_data = os.path.join(a.out, "data")
    os.makedirs(out_data, exist_ok=True)

    hist = load("history.json", folder=st) or load("history.json")
    live, intraday = None, None
    try:
        live, intraday = live_quote()
        log("QQQ", live["price"], live["state"], live["day"])
    except Exception as e:  # noqa: BLE001
        fail("yahoo_live", e)
        try:
            live, intraday = nasdaq_live()
            log("QQQ (nasdaq)", live["price"], live["state"], live["day"])
        except Exception as e2:  # noqa: BLE001
            fail("nasdaq_live", e2)

    behind = bool(hist and live and live["day"] > hist["asof"] and live["state"] != "REGULAR")
    if a.mode == "eod" or not hist or behind:
        try:
            new = build_history(hist)
            if not hist or new["d"][-1] >= hist["d"][-1]:
                hist = new
                dump(hist, os.path.join(st, "history.json"))
                log("history rebuilt", hist["asof"], len(hist["d"]))
        except Exception as e:  # noqa: BLE001
            fail("yahoo_history", e)
            if hist:
                try:
                    n = nasdaq_daily_append(hist)
                    if n:
                        dump(hist, os.path.join(st, "history.json"))
                        log("history +", n, "sessions (nasdaq)")
                except Exception as e2:  # noqa: BLE001
                    fail("nasdaq_history", e2)

    brvm = load("brvm.json", folder=st) or load("brvm.json")
    try:
        fresh = scrape_brvm(brvm)
        log("BRVM", len(fresh["rows"]), "rows", fresh["asof"])
        if brvm and fresh["asof"][:4] > brvm["asof"][:4]:
            roll_year(brvm)
        dump(fresh, os.path.join(st, "brvm.json"))
        brvm = fresh
        if a.mode == "eod":
            archive_brvm(fresh)
    except Exception as e:  # noqa: BLE001
        fail("brvm", e)

    dump(hist, os.path.join(out_data, "history.json"))
    dump(brvm, os.path.join(out_data, "brvm.json"))
    shutil.copy(os.path.join(DATA, "brvm_ref.json"), os.path.join(out_data, "brvm_ref.json"))
    dump({"ts": int(time.time()), "qqq": live, "intraday": intraday, "errors": ERRORS}, os.path.join(out_data, "live.json"))
    rows = []
    for i in range(max(0, len(hist["d"]) - 40), len(hist["d"])):
        rows.append({"d": hist["d"][i], "o": hist["o"][i], "h": hist["h"][i], "l": hist["l"][i], "c": hist["c"][i],
                     "v": hist["v"][i], "div": hist["div"][i], "mk": {k: v[i] for k, v in hist["mk"].items()}})
    dump({"asof": hist["asof"], "ts": int(time.time()), "rows": rows}, os.path.join(out_data, "feed_daily.json"))
    shutil.copy(os.path.join(ROOT, "index.html"), os.path.join(a.out, "index.html"))
    open(os.path.join(a.out, ".nojekyll"), "w").close()
    log("site written to", a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
