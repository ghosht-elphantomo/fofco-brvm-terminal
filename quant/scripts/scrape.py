#!/usr/bin/env python3
"""Live feed for the FQT terminal (standard library only, runs on GitHub Actions every 15 minutes).

Writes into --out/data :
  live.json    QQQ quote + 5-minute bars (Yahoo, falls back to Nasdaq), and any source errors
  quotes.json  latest quotes keyed by terminal id: QQQ, the 48 BRVM stocks and the BRVM indices
  session.json the BRVM session as published on brvm.org (also kept in --state for the next run)
In eod mode the session is appended to seed/brvm_daily.csv (one line per stock per session).
The full history (data/s/*.json, summary.json…) is rebuilt separately by build_terminal.py.
Any source that fails keeps the last good values, so the site never goes blank.
"""
import argparse, csv, datetime as dt, io, json, os, re, shutil, sys, time, urllib.parse, urllib.request
from zoneinfo import ZoneInfo
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "seed")
MARKETS = ["VTI", "SOXX", "NVDA", "MSFT", "AMZN", "GOOG", "META", "TSLA", "AVGO", "AMD", "ORCL",
           "INTC", "MU", "MRVL", "TSM", "PLTR", "UBER", "SOFI", "WDC", "ROBO", "0050"]
YSYM = {"0050": "0050.TW"}
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
FR_MONTHS = {m: i + 1 for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
                                            "août", "septembre", "octobre", "novembre", "décembre"])}
NY = ZoneInfo("America/New_York")
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
    def regular(t):
        lt = dt.datetime.fromtimestamp(t, NY)
        return (9, 30) <= (lt.hour, lt.minute) < (16, 0)
    pts = [(int(p["x"]) // 1000, float(p["y"])) for p in d.get("chart") or [] if p.get("y") is not None]
    pts = [p for p in pts if regular(p[0])] or pts
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
    day = dt.datetime.fromtimestamp(pts[-1][0], NY).date().isoformat()
    mstat = str(d.get("marketStatus") or "").upper()
    state = "REGULAR" if "OPEN" in mstat and "PRE" not in mstat and "AFTER" not in mstat else "PRE" if "PRE" in mstat else "POST" if "AFTER" in mstat else "CLOSED"
    r2 = lambda v: round(float(v), 2)  # noqa: E731
    return {"price": r2(price), "prev": r2(prev), "chg": round(price / prev - 1, 6), "day": day, "state": state,
            "open": r2(bars[0][1]), "dayHigh": r2(max(b[2] for b in bars)), "dayLow": r2(min(b[3] for b in bars)),
            "vol": 0, "time": pts[-1][0], "src": "nasdaq"}, \
        {"t": [b[0] for b in bars], "o": [r2(b[1]) for b in bars], "h": [r2(b[2]) for b in bars],
         "l": [r2(b[3]) for b in bars], "c": [r2(b[4]) for b in bars], "v": [0 for _ in bars]}


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


# ------------------------------------------------------------------ main
IDX_CODE = {"BRVM-C": "BRVMC", "BRVM-30": "BRVM30", "BRVM-PRES": "BRVMPR", "BRVM-PRIN": "BRVMPA", "TL": "BRVM-TEL", "CD": "BRVM-CD",
            "SF": "BRVM-SF", "CB": "BRVM-CB", "IN": "BRVM-IN", "EN": "BRVM-EN", "SP": "BRVM-SP"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["live", "eod"], default="live")
    ap.add_argument("--out", default=os.path.join(ROOT, "_site"))
    ap.add_argument("--state", default=DATA)
    a = ap.parse_args()
    st, out_data = a.state, os.path.join(a.out, "data")
    os.makedirs(st, exist_ok=True)
    os.makedirs(out_data, exist_ok=True)

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

    brvm = load("brvm.json", folder=st) or load("brvm.json")
    try:
        fresh = scrape_brvm(brvm)
        log("BRVM", len(fresh["rows"]), "rows", fresh["asof"])
        brvm = fresh
        dump(brvm, os.path.join(st, "brvm.json"))
        if a.mode == "eod":
            archive_brvm(brvm)
            dump(brvm, os.path.join(DATA, "brvm.json"))
    except Exception as e:  # noqa: BLE001
        fail("brvm", e)

    q = {}
    if live:
        q["QQQ"] = {"last": live["price"], "pct": live["chg"], "d": live["day"], "o": live["open"], "h": live["dayHigh"], "l": live["dayLow"], "vol": live["vol"] or None}
    if brvm:
        for r in brvm.get("rows", []):
            q[r["t"]] = {"last": r["c"], "pct": round(r["vj"] / 100, 6), "d": brvm["asof"], "o": r.get("o"), "vol": r.get("vol"), "val": int((r.get("vol") or 0) * r["c"])}
        for x in brvm.get("idx", []) + brvm.get("sect", []):
            code = IDX_CODE.get(x.get("k"))
            if code and x.get("v"):
                q[code] = {"last": x["v"], "pct": round((x.get("vj") or 0) / 100, 6), "d": brvm["asof"]}
    now = int(time.time())
    dump({"ts": now, "qqq": live, "intraday": intraday, "errors": ERRORS}, os.path.join(out_data, "live.json"))
    dump({"ts": now, "asof": brvm.get("asof") if brvm else None, "q": q}, os.path.join(out_data, "quotes.json"))
    if brvm:
        dump(brvm, os.path.join(out_data, "session.json"))
    log("feed written:", len(q), "quotes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
