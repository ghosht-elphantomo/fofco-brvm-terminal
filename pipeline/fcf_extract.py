#!/usr/bin/env python3
"""Free cash flow à partir des états financiers publiés sur brvm.org.

Ni SikaFinance ni le miroir public ne donnent de tableau des flux de trésorerie. Les sociétés
non bancaires publient leurs états financiers SYSCOHADA en PDF sur brvm.org : on y lit le
tableau des flux de trésorerie (TFT) :
  - Flux de trésorerie provenant des activités opérationnelles (ZB)        -> cfo
  - Décaissements liés aux acquisitions d'immobilisations incorporelles (FF)
  - Décaissements liés aux acquisitions d'immobilisations corporelles (FG) -> capex = FF + FG
  - Free cash flow = cfo - capex
Montants convertis en millions de FCFA. Chaque PDF donne l'exercice N et N-1.
Les banques (autre plan comptable) sont ignorées. Le résultat est mis en cache dans
history/fcf.json : seuls les documents nouveaux sont téléchargés aux passages suivants.

Usage : python fcf_extract.py --src /tmp/src --out history/fcf.json [--since 2016]
Nécessite pdftotext (poppler-utils).
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import tempfile
import time
import unicodedata
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
PAUSE = 1.0
NUM = re.compile(r"^\(?[-–−]?\s*\d{1,3}(?:[ .  ]\d{3})*(?:,\d+)?\)?$|^\(?[-–−]?\s*\d+(?:,\d+)?\)?$")
def _p(words):
    return re.compile(r"\s+".join(words.split(" ")))


PATTERNS = {
    "cfo": _p("flux de tresorerie (?:provenant|provenants|issus?) des activites operationnelles"),
    "capex_i": _p("decaissements lies aux acquisitions d.immobilisations incorporelles(?!\\s+et)"),
    "capex_c": _p("decaissements lies aux acquisitions d.immobilisations corporelles"),
    "capex_ic": _p("decaissements lies aux acquisitions d.immobilisations incorporelles et corporelles"),
}


def norm(s):
    """Minuscules, sans accents, apostrophes droites ; garde la même longueur que le texte d'origine."""
    out = []
    for ch in s:
        if ch in "’`´":
            out.append("'")
            continue
        base = unicodedata.normalize("NFKD", ch).encode("ascii", "ignore").decode()
        out.append((base[:1] or " ").lower())
    return "".join(out)


def to_num(tok):
    t = tok.strip()
    neg = t.startswith("(") and t.endswith(")") or t[:1] in "-–−"
    t = re.sub(r"[()\-–−\s.  ]", "", t).replace(",", ".")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def numbers_in(segment):
    """Colonnes séparées par au moins 2 espaces (pdftotext -layout)."""
    out = []
    for f in re.split(r"\s{2,}", segment.strip()):
        f = f.strip()
        if f and NUM.match(f):
            v = to_num(f)
            if v is not None:
                out.append(v)
    return out


def parse_tft(text):
    lines = text.splitlines()
    found, unit_hint, last_unit = {}, None, None
    for i, raw in enumerate(lines):
        ln = norm(raw)
        if "millions" in ln:
            last_unit = 1.0
        elif "milliers" in ln:
            last_unit = 1e-3
        elif re.search(r"\ben (f\s?cfa|xof)\b", ln):
            last_unit = 1e-6
        if "cfo" not in found and PATTERNS["cfo"].search(ln):
            unit_hint = last_unit
        for key, pat in PATTERNS.items():
            if key in found:
                continue
            m = pat.search(ln)
            if not m:
                continue
            # Les montants sont après le libellé : on lit la fin de ligne, puis les 2 lignes suivantes si besoin.
            nums = numbers_in(raw[m.end():])
            k = 1
            while len(nums) < 1 and k <= 2 and i + k < len(lines):
                nums = numbers_in(lines[i + k])
                k += 1
            if nums:
                n = nums[-2:] if len(nums) >= 2 else nums
                found[key] = (n[0], n[1] if len(n) > 1 else None)
    return found, unit_hint


def pdf_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
    time.sleep(PAUSE)
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data)
        f.flush()
        res = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, timeout=120)
    return res.stdout.decode("utf-8", "replace")


def scale(found, unit_hint, ca):
    """Ramène en millions de FCFA. L'unité écrite dans le document est vérifiée face au chiffre d'affaires
    (flux opérationnels entre 0,05 % et 200 % du CA) ; à défaut, on prend l'échelle la plus plausible."""
    cfo = abs((found.get("cfo") or (0, 0))[0] or 0)
    if not cfo:
        return None
    cands = ([unit_hint] if unit_hint else []) + [1.0, 1e-3, 1e-6]
    if not ca:
        return unit_hint
    for div in cands:
        if 0.0005 <= cfo * div / ca <= 2:
            return div
    return None


def main(src, out, since):
    actions = json.load(open(os.path.join(src, "actions.json"), encoding="utf-8"))["actions"]
    banks = {a["ticker"] for a in actions if a.get("banque")}
    fund = json.load(open(os.path.join(src, "fundamentals.json"), encoding="utf-8"))
    events = json.load(open(os.path.join(src, "events.json"), encoding="utf-8"))["events"]
    cache = {"series": {}, "docs": {}}
    if os.path.exists(out):
        cache = json.load(open(out, encoding="utf-8"))
    docs = {}
    for e in events:
        t, fy, url = e.get("ticker"), e.get("fiscal_year"), e.get("document_url") or ""
        if not t or t in banks or not fy or fy < since or not url.lower().endswith(".pdf"):
            continue
        if e.get("category") not in ("financial_statements", "annual_report"):
            continue
        title = norm(e.get("title") or "")
        rank = (0 if "syscohada" in title else 1 if e["category"] == "financial_statements" else 2, 0 if ("approuv" in title or "definitif" in title or "annule et remplace" in title) else 1)
        docs.setdefault((t, fy), []).append((rank, e.get("published_at") or "", url))
    for (t, fy), cands in sorted(docs.items()):
        ser = cache["series"].setdefault(t, {})
        if str(fy) in ser and ser[str(fy)].get("fcf") is not None:
            continue
        ca = ((fund.get(t) or {}).get("series", {}).get("ca") or {}).get(str(fy))
        for rank, _, url in sorted(cands, key=lambda c: (c[0], c[1]), reverse=False):
            if url in cache["docs"]:
                continue
            try:
                found, hint = parse_tft(pdf_text(url))
            except Exception as ex:
                cache["docs"][url] = f"erreur : {ex}"[:120]
                continue
            div = scale(found, hint, ca) if "cfo" in found else None
            if div is None or "cfo" not in found or not ({"capex_c", "capex_ic"} & found.keys()):
                cache["docs"][url] = "tableau des flux introuvable ou illisible"
                continue
            cache["docs"][url] = "ok"
            for col, year in ((0, fy), (1, fy - 1)):
                cfo = found["cfo"][col]
                if cfo is None:
                    continue
                capex = sum(abs(found[k][col] or 0) for k in ("capex_i", "capex_c", "capex_ic") if k in found and found[k][col] is not None)
                rec = {"cfo": round(cfo * div, 1), "capex": round(capex * div, 1), "fcf": round((cfo - capex) * div, 1), "src": url}
                if col == 0 or str(year) not in ser:
                    ser[str(year)] = rec
            print(t, fy, "ok", ser.get(str(fy)))
            break
    cache["generated_at"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    n = sum(1 for s in cache["series"].values() for y in s.values() if y.get("fcf") is not None)
    print(f"{n} exercices avec free cash flow sur {len(cache['series'])} sociétés")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="history/fcf.json")
    ap.add_argument("--since", type=int, default=2016)
    a = ap.parse_args()
    main(a.src, a.out, a.since)
