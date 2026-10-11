#!/usr/bin/env python3
"""Rattrapage de l'historique le plus ancien disponible chez SikaFinance.

Le miroir public commence fin 2006. SikaFinance (POST /api/general/GetHistos) remonte
parfois un peu plus loin (ex. Sonatel : 18/09/2006) et garde l'ancien indice BRVM 10.
Ce script récupère, pour chaque titre et indice, les séances antérieures au début du
miroir, sans jamais inventer de cours. Il ne tourne qu'à la demande (workflow backfill).

Sorties : history/<CODE>.csv (Date;Clôture;Ouverture;+Haut;+Bas;Titres) et history/report.json

Usage : python backfill_sika.py --src /tmp/src --out history
"""
import argparse
import datetime as dt
import glob
import json
import os
import time
import urllib.request

URL = "https://www.sikafinance.com/api/general/GetHistos"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
START = dt.date(1998, 9, 16)   # première séance de la BRVM
CHUNK = 89                     # au-delà, l'API répond « toolong » en journalier
PAUSE = 0.35
INDICES = ["BRVMC", "BRVM10", "BRVM30", "BRVMPR", "BRVMPA", "BRVMAG", "BRVMAS", "BRVMDI", "BRVMFI", "BRVMIN", "BRVMSP", "BRVMTR"]


def histos(ticker, d0, d1, xperiod="0"):
    body = json.dumps({"ticker": ticker, "datedeb": d0.isoformat(), "datefin": d1.isoformat(), "xperiod": xperiod}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json",
        "Origin": "https://www.sikafinance.com", "Referer": "https://www.sikafinance.com/marches/historiques/" + ticker})
    with urllib.request.urlopen(req, timeout=40) as r:
        js = json.loads(r.read().decode("utf-8", "replace"))
    time.sleep(PAUSE)
    if isinstance(js, dict) and js.get("error"):
        raise RuntimeError(js["error"])
    out = []
    for p in (js.get("lst") or []) if isinstance(js, dict) else []:
        try:
            d = dt.datetime.strptime(p["Date"].strip(), "%d/%m/%Y").date()
            c = float(p["Close"])
        except Exception:
            continue
        if c > 0:
            out.append((d, c, float(p.get("Open") or c), float(p.get("High") or c), float(p.get("Low") or c), float(p.get("Volume") or 0)))
    return out


def first_mirror_date(path):
    try:
        with open(path, encoding="utf-8-sig") as f:
            next(f)
            for line in f:
                part = line.split(";")[0].strip()
                if part:
                    return dt.datetime.strptime(part, "%d/%m/%Y").date()
    except Exception:
        return None
    return None


def main(src, out):
    os.makedirs(out, exist_ok=True)
    actions = json.load(open(os.path.join(src, "actions.json"), encoding="utf-8"))["actions"]
    jobs = [(a["ticker"], a.get("sika") or a["ticker"], os.path.join(src, a["csv"] + ".csv")) for a in actions]
    jobs += [(k, k, os.path.join(src, "indices", f"Indice_{k}.csv")) for k in INDICES]
    today = dt.date.today()
    report = {"generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(), "source": URL, "series": {}}
    for code, sym, csv_path in jobs:
        mirror_first = first_mirror_date(csv_path)
        end = (mirror_first - dt.timedelta(days=1)) if mirror_first else today
        info = {"sika": sym, "mirror_first": mirror_first.isoformat() if mirror_first else None, "added": 0}
        # 1. Annuel : première année réellement disponible
        try:
            years = histos(sym, START, today, "365")
            first = min(r[0] for r in years) if years else None
        except Exception as e:
            info["error"] = f"annuel : {e}"[:200]
            first = None
        info["sika_first_year"] = first.year if first else None
        start = max(START, dt.date(first.year, 1, 1)) if first else None
        rows = {}
        if start and start <= end:
            d0 = start
            while d0 <= end:
                d1 = min(end, d0 + dt.timedelta(days=CHUNK))
                try:
                    for r in histos(sym, d0, d1):
                        if r[0] <= end:
                            rows[r[0]] = r
                except Exception as e:
                    info.setdefault("chunk_errors", []).append(f"{d0}: {e}"[:120])
                d0 = d1 + dt.timedelta(days=1)
        if rows:
            with open(os.path.join(out, code + ".csv"), "w", encoding="utf-8") as f:
                f.write("Date;Clôture;Ouverture;+Haut;+Bas;Titres\n")
                for d in sorted(rows):
                    _, c, o, h, lo, v = rows[d]
                    f.write(f"{d.strftime('%d/%m/%Y')};{c:g};{o:g};{h:g};{lo:g};{int(v)}\n")
            info["added"] = len(rows)
            info["first"] = min(rows).isoformat()
        report["series"][code] = info
        print(code, sym, "miroir", info["mirror_first"], "sika", info.get("sika_first_year"), "+", info["added"], info.get("error", ""))
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="history")
    a = ap.parse_args()
    main(a.src, a.out)
