#!/usr/bin/env python3
"""FOFCO BRVM Terminal - construction des fichiers de données.

Entrées
  --src   dossier du dépôt public harzat/brvm-data-public (historiques CSV + JSON)
  --live  relevé de séance (format seance.json) produit par scrape_live.py (facultatif)
  --out   dossier de sortie (data/)

Sorties
  data/core.json    univers, 300 dernières séances par titre, fondamentaux, dividendes, indices
  data/live.json    relevé de séance (petit fichier qui change toutes les 15 min)
  data/events.json  avis et publications BRVM (24 derniers mois + à venir)
  data/idx.json     historiques complets des indices
  data/h/<T>.json   historique complet d'un titre (chargé à la demande)
  data/status.json  fraîcheur de chaque source

Bibliothèque standard uniquement.
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import re
import subprocess

CORE_SESSIONS = 300
EPOCH = dt.date(1970, 1, 1)
PAYS = {"ci": "CI", "sn": "SN", "bf": "BF", "bj": "BJ", "ml": "ML", "ne": "NE", "tg": "TG"}


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).replace(" ", "").replace("\xa0", "").replace(" ", "").replace("%", "").replace(",", ".")
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def eday(d):
    return (d - EPOCH).days


def parse_date(s):
    s = s.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def parse_csv(path):
    """Les CSV du miroir sont dans l'ordre réel Date;Clôture;Ouverture;+Haut;+Bas;Titres;FCFA;Var
    (l'en-tête annonce un autre ordre ; vérifié sur 139 000 lignes : 233 incohérences contre 24 349)."""
    rows = {}
    with open(path, encoding="utf-8-sig") as f:
        lines = f.read().splitlines()
    for line in lines[1:]:
        p = line.split(";")
        if len(p) < 5:
            continue
        d = parse_date(p[0])
        if not d:
            continue
        c, o, h, l = (num(x) for x in p[1:5])
        if not c or c <= 0:
            continue
        v = num(p[5]) if len(p) > 5 else None
        val = num(p[6]) if len(p) > 6 else None
        o = o if o and o > 0 else c
        h = max(x for x in (h, o, c) if x)
        l = min(x for x in (l, o, c) if x and x > 0)
        rows[d] = (eday(d), o, h, l, c, v or 0, val if val is not None else (v or 0) * c)
    return [rows[k] for k in sorted(rows)]


def with_history(rows, hist_dir, code):
    """Ajoute devant la série du miroir les séances plus anciennes rattrapées chez SikaFinance."""
    path = os.path.join(hist_dir, code + ".csv") if hist_dir else None
    if not path or not os.path.exists(path):
        return rows
    old = parse_csv(path)
    first = rows[0][0] if rows else None
    return [r for r in old if first is None or r[0] < first] + rows


def columnar(rows):
    keys = ("d", "o", "h", "l", "c", "v", "val")
    out = {k: [] for k in keys}
    for r in rows:
        for k, x in zip(keys, r):
            if k in ("d", "v", "val"):
                out[k].append(int(round(x)))
            else:
                out[k].append(round(x, 2) if x % 1 else int(x))
    return out


def monthly_closes(rows, start=2007):
    m = {}
    for r in rows:
        d = EPOCH + dt.timedelta(days=r[0])
        if d.year >= start:
            m[d.year * 100 + d.month] = r[4]
    return [[k, m[k]] for k in sorted(m)]


def perf(rows, n):
    if len(rows) <= n:
        return None
    a, b = rows[-1 - n][4], rows[-1][4]
    return round((b / a - 1) * 100, 2) if a else None


def git_time(src):
    try:
        out = subprocess.run(["git", "-C", src, "log", "-1", "--format=%cI"], capture_output=True, text=True, timeout=20)
        return out.stdout.strip() or None
    except Exception:
        return None


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def readme_sync(src):
    try:
        txt = open(os.path.join(src, "README.md"), encoding="utf-8").read()
        m = re.search(r"synchronisation\s*:\s*([0-9-]+ [0-9:]+) UTC", txt)
        return m.group(1).replace(" ", "T") + "Z" if m else None
    except Exception:
        return None


def pick_live(src, live_path):
    """Retourne le relevé le plus récent entre celui du scraper et seance.json du miroir."""
    cands = []
    if live_path and os.path.exists(live_path):
        lv = load_json(live_path)
        if lv and lv.get("cours"):
            cands.append(lv)
    sj = load_json(os.path.join(src, "seance.json"))
    if sj and sj.get("cours"):
        sj.setdefault("_meta", {})["origine"] = "miroir harzat (seance.json)"
        cands.append(sj)
    if not cands:
        return None

    def key(x):
        m = x.get("_meta", {})
        return (m.get("maj_brvm") or m.get("maj_brvm_date") or "", m.get("releve_utc") or "")

    return max(cands, key=key)


def build(src, live_path, out, hist_dir=None):
    os.makedirs(os.path.join(out, "h"), exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    actions = load_json(os.path.join(src, "actions.json"), {}).get("actions", [])
    fund = load_json(os.path.join(src, "fundamentals.json"), {})
    divs = load_json(os.path.join(src, "dividendes.json"), {})
    tstat = load_json(os.path.join(src, "trading_status.json"), {})
    boc = load_json(os.path.join(src, "boc.json"), {})
    live = pick_live(src, live_path)
    live_meta = (live or {}).get("_meta", {})
    live_date = live_meta.get("maj_brvm_date")
    live_cours = (live or {}).get("cours", {})

    tickers = []
    for a in actions:
        t = a["ticker"]
        path = os.path.join(src, a["csv"] + ".csv")
        rows = parse_csv(path) if os.path.exists(path) else []
        rows = with_history(rows, hist_dir, t)
        prov = False
        lc = live_cours.get(t)
        if lc and live_date:
            ld = parse_date(live_date)
            last = num(lc.get("dernier"))
            vol = num(lc.get("volume")) or 0
            if ld and last and last > 0 and vol > 0:
                o = num(lc.get("ouverture")) or last
                hi = max(x for x in (num(lc.get("haut")), o, last) if x)
                lo = min(x for x in (num(lc.get("bas")), o, last) if x and x > 0)
                val = num(lc.get("valeur")) or vol * last
                row = (eday(ld), o, hi, lo, last, vol, val)
                if not rows or rows[-1][0] < row[0]:
                    rows.append(row)
                    prov = True
                elif rows[-1][0] == row[0]:
                    rows[-1] = row
        if not rows:
            # titre sans historique (introduction récente) : on garde la fiche sans cours
            pass
        susp = tstat.get(t) if isinstance(tstat.get(t), dict) else None
        f = fund.get(t) or {}
        meta = {
            "t": t,
            "n": a.get("nom"),
            "nf": a.get("nom_officiel") or f.get("nom"),
            "sec": a.get("secteur"),
            "bank": bool(a.get("banque")),
            "pays": PAYS.get((a.get("sika") or ".").split(".")[-1], ""),
            "sika": a.get("sika"),
            "nbt": f.get("nb_titres"),
            "flot": f.get("flottant"),
            "susp": susp,
            "prov": prov,
            "first": rows[0][0] if rows else None,
            "nsess": len(rows),
            "perf": {str(n): perf(rows, n) for n in (1, 5, 20, 60, 120, 252, 756, 1260)},
            "m": monthly_closes(rows),
        }
        meta.update(columnar(rows[-CORE_SESSIONS:]))
        tickers.append(meta)
        with open(os.path.join(out, "h", t + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"t": t, **columnar(rows)}, fh, separators=(",", ":"))

    # Fondamentaux : on garde latest + séries, sans la provenance
    fund_out = {}
    for t, f in fund.items():
        if t.startswith("_") or not isinstance(f, dict):
            continue
        fund_out[t] = {
            "secteur_sika": f.get("secteur"),
            "exercice": f.get("exercice"),
            "latest": f.get("latest") or {k: f.get(k) for k in ("ca", "resultat_net", "bnpa", "per", "dividende")},
            "series": f.get("series", {}),
            "statut": f.get("statut_donnee"),
            "url": f.get("source_url"),
            "date": f.get("date_source"),
        }

    div_out = {}
    for r in divs.get("all", []):
        t = r.get("ticker")
        if not t:
            continue
        div_out.setdefault(t, []).append({
            "ex": r.get("exercice"),
            "net": r.get("dividende_net") if r.get("dividende_net") is not None else r.get("dividende"),
            "brut": r.get("dividende_brut") or r.get("dividende_calendrier"),
            "taux": r.get("dividende_net_taux_pct"),
            "src": r.get("dividende_net_source"),
            "ann": r.get("date_annonce"),
            "det": r.get("date_detachement"),
            "pay": r.get("date_paiement"),
            "st": r.get("publication_status"),
            "url": r.get("document_url") or r.get("source_url"),
            "rem": r.get("dividende_remarque"),
        })
    for t in div_out:
        div_out[t].sort(key=lambda x: (x["ex"] or 0, x["det"] or ""))

    # Indices
    idx_full, idx_core = {}, {}
    rep = load_json(os.path.join(src, "indices", "indices_report.json"), {})
    names = {e.get("code"): (e.get("nom"), e.get("type"), e.get("gele")) for e in rep.get("entries", [])}
    idx_paths = {os.path.basename(p)[7:-4]: p for p in glob.glob(os.path.join(src, "indices", "Indice_*.csv"))}
    if hist_dir and os.path.exists(os.path.join(hist_dir, "BRVM10.csv")):
        idx_paths.setdefault("BRVM10", None)
        names.setdefault("BRVM10", ("BRVM 10 (ancien indice)", "marche", True))
    for code in sorted(idx_paths):
        p = idx_paths[code]
        rows = with_history(parse_csv(p) if p else [], hist_dir, code)
        if not rows:
            continue
        nm, typ, gele = names.get(code, (code, None, None))
        ser = {"n": nm, "type": typ, "gele": gele, "d": [r[0] for r in rows], "c": [r[4] for r in rows]}
        idx_full[code] = ser
        idx_core[code] = {"n": nm, "type": typ, "gele": gele, "d": ser["d"][-CORE_SESSIONS:], "c": ser["c"][-CORE_SESSIONS:]}

    # Avis et publications
    ev = load_json(os.path.join(src, "events.json"), {}).get("events", [])
    cutoff = (dt.date.today() - dt.timedelta(days=730)).isoformat()
    ev_out = []
    for e in ev:
        d = e.get("published_at") or e.get("event_at") or e.get("reference_at")
        if not d or (d < cutoff and (e.get("event_at") or "") < cutoff):
            continue
        ev_out.append({
            "t": e.get("ticker"),
            "pub": e.get("published_at"),
            "at": e.get("event_at"),
            "cat": e.get("category"),
            "lab": e.get("category_label"),
            "ti": e.get("title") or e.get("label"),
            "u": e.get("document_url") or e.get("source_page"),
        })
    ev_out.sort(key=lambda x: (x["pub"] or x["at"] or ""), reverse=True)

    status = {
        "generated_at": now,
        "miroir_commit": git_time(src),
        "miroir_sync": readme_sync(src),
        "seance": {
            "origine": live_meta.get("origine") or live_meta.get("source"),
            "releve_utc": live_meta.get("releve_utc"),
            "maj_brvm": live_meta.get("maj_brvm"),
            "date": live_date,
            "etat": live_meta.get("seance"),
            "delai_minutes": live_meta.get("delai_minutes", 15),
            "sika_ok": live_meta.get("sika_ok"),
            "brvm_ok": live_meta.get("brvm_ok"),
        },
        "fondamentaux": fund.get("_meta", {}).get("updated"),
        "dividendes": divs.get("_meta", {}).get("updated"),
        "boc": boc.get("_meta", {}).get("date"),
        "boc_url": boc.get("_meta", {}).get("url"),
        "suspensions": {k: v for k, v in tstat.items() if not k.startswith("_")},
    }
    evmeta = None
    try:
        with open(os.path.join(src, "events.json"), encoding="utf-8") as fh:
            head = fh.read(4000)
        m = re.search(r'"generated_at":\s*"([^"]+)"', head)
        evmeta = m.group(1) if m else None
    except Exception:
        pass
    status["avis"] = evmeta

    core = {
        "v": 1,
        "generated_at": now,
        "tickers": tickers,
        "fund": fund_out,
        "divs": div_out,
        "idx": idx_core,
    }
    live_out = {
        "generated_at": now,
        "_meta": live_meta,
        "marche": (live or {}).get("marche", {}),
        "indices": (live or {}).get("indices", {}),
        "cours": live_cours,
    }

    def dump(name, obj):
        with open(os.path.join(out, name), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))

    dump("core.json", core)
    dump("live.json", live_out)
    dump("events.json", {"generated_at": now, "events": ev_out})
    dump("idx.json", {"generated_at": now, "idx": idx_full})
    dump("status.json", status)
    print(f"{len(tickers)} titres, {len(ev_out)} avis, {len(idx_full)} indices, séance {live_date} ({status['seance']['origine']})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--live")
    ap.add_argument("--out", default="data")
    ap.add_argument("--hist", default="history", help="séances anciennes rattrapées (backfill_sika.py)")
    a = ap.parse_args()
    build(a.src, a.live, a.out, a.hist)
