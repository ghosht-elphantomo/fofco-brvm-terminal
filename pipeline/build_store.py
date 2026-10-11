#!/usr/bin/env python3
"""Construit les fichiers du terminal (data/) à partir de la base propre (branche store).

Aucune autre dépendance : la base est alimentée par store.py depuis les sources publiques
(BRVM, SikaFinance, OuestBourse, African Markets), avec vote entre sources.

Usage : python build_store.py --store /tmp/store --live live.json --out data
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import CORE_SESSIONS, columnar, eday, monthly_closes, perf  # noqa: E402
from store import ICOLS, INDEX_NAMES, PCOLS, fnum, jload, read_csv  # noqa: E402

PAYS = {"CI": "CI", "SN": "SN", "BF": "BF", "BJ": "BJ", "ML": "ML", "NE": "NE", "TG": "TG"}
IRVM = {"SN": 10, "CI": 12}


def series_rows(path):
    out = []
    for d, r in sorted(read_csv(path, PCOLS).items()):
        c = fnum(r.get("close"))
        if not c:
            continue
        day = eday(dt.date.fromisoformat(d))
        o = fnum(r.get("open")) or c
        h = max(x for x in (fnum(r.get("high")), o, c) if x)
        lo = min(x for x in (fnum(r.get("low")), o, c) if x)
        v = fnum(r.get("volume")) or 0
        val = fnum(r.get("value")) or v * c
        out.append((day, o, h, lo, c, v, val))
    return out


def consensus(fd, field, year):
    """Valeur retenue pour un champ et une année : SikaFinance et OuestBourse comparés ;
    concordants à 1 % près = confirmé, sinon SikaFinance est gardé et la divergence notée."""
    vals = {}
    for src in ("sika_pro", "sika", "ouest"):
        v = ((fd.get(src) or {}).get(field) or {}).get(year)
        if v is not None:
            vals["sika" if src.startswith("sika") else src] = vals.get("sika" if src.startswith("sika") else src, v)
    if not vals:
        return None, None
    if len(vals) == 1:
        return next(iter(vals.values())), list(vals)
    a, b = vals.get("sika"), vals.get("ouest")
    if a is not None and b is not None and abs(a - b) <= 0.01 * max(abs(a), abs(b), 1e-9):
        return a, ["sika", "ouest"]
    return (a if a is not None else b), ["divergence"]


FIELDS = ["ca", "croissance_ca", "resultat_net", "croissance_resultat_net", "bnpa", "per", "dividende", "ebit", "ebitda", "charges_exploitation",
          "capitaux_propres", "dette_nette", "tresorerie", "total_bilan", "marge_nette", "marge_exploitation", "roe", "roa", "levier_financier",
          "autonomie_financiere", "ratio_endettement_net", "depots_clientele", "credits_clientele", "coefficient_d_exploitation",
          "ratio_de_solvabilite", "cout_du_risque", "ratio_tier_i", "credits_depots"]


def build_fund(t, reg, store, fcf_cache):
    fd = jload(os.path.join(store, "fundamentals", t + ".json"), {})
    if not fd:
        return None
    years = sorted({y for src in ("sika", "sika_pro", "ouest") for f in (fd.get(src) or {}).values() if isinstance(f, dict) for y in f if re.fullmatch(r"\d{4}", y)})
    series, div = {}, []
    for f in FIELDS:
        for y in years:
            v, how = consensus(fd, f, y)
            if v is not None:
                series.setdefault(f, {})[y] = v
                if how == ["divergence"]:
                    div.append(f"{f} {y}")
    # Free cash flow : OuestBourse (comptes structurés) et états financiers BRVM (PDF) comparés
    ob = (fd.get("ouest") or {})
    pdf = (fcf_cache.get("series") or {}).get(t, {})
    for y in sorted(set((ob.get("fcf") or {}).keys()) | set(pdf.keys())):
        a = (ob.get("fcf") or {}).get(y)
        b = (pdf.get(y) or {}).get("fcf")
        if a is not None:
            series.setdefault("fcf", {})[y] = a
            series.setdefault("cfo", {})[y] = (ob.get("cfo") or {}).get(y)
            series.setdefault("capex", {})[y] = (ob.get("capex") or {}).get(y)
            if b is not None and abs(a - b) > 0.02 * max(abs(a), abs(b), 1):
                div.append(f"fcf {y}")
        elif b is not None:
            series.setdefault("fcf", {})[y] = b
            series.setdefault("cfo", {})[y] = pdf[y].get("cfo")
            series.setdefault("capex", {})[y] = pdf[y].get("capex")
    nbt = (fd.get("info") or {}).get("nb_titres")
    for y, f in list((series.get("fcf") or {}).items()):
        ca = (series.get("ca") or {}).get(y)
        rn = (series.get("resultat_net") or {}).get(y)
        if ca:
            series.setdefault("marge_fcf", {})[y] = round(f / ca * 100, 2)
        if rn and rn > 0:
            series.setdefault("conversion_fcf", {})[y] = round(f / rn * 100, 1)
        if nbt:
            series.setdefault("fcf_par_action", {})[y] = round(f * 1e6 / nbt, 1)
    if not series:
        return None
    ly = max((y for y in years if (series.get("ca") or {}).get(y) is not None or (series.get("resultat_net") or {}).get(y) is not None), default=None)
    latest = {f: (series.get(f) or {}).get(ly) for f in FIELDS} if ly else {}
    out = {"exercice": int(ly) if ly else None, "latest": latest, "series": series, "divergences": div,
           "sources": [s for s in ("sika", "sika_pro", "ouest") if fd.get(s)], "date": (fd.get("updated") or "")[:10],
           "url": f"https://www.sikafinance.com/marches/societe/{reg.get('sika')}" if reg.get("sika") else None}
    if series.get("fcf"):
        fy = max(series["fcf"], key=int)
        out["fcf_last"] = {"exercice": int(fy), "fcf": series["fcf"][fy]}
    return out


def suspension(t, avis):
    ev = sorted([a for a in avis if a.get("t") == t and a.get("cat") in ("trading_suspension", "trading_resumed")], key=lambda a: a.get("pub") or "")
    if ev and ev[-1]["cat"] == "trading_suspension" and (ev[-1].get("pub") or "") >= (dt.date.today() - dt.timedelta(days=400)).isoformat():
        return {"statut": "suspendue", "date": ev[-1].get("pub"), "avis": ev[-1].get("ti"), "source": "Avis de la BRVM"}
    return None


def build(store, live_path, out):
    os.makedirs(os.path.join(out, "h"), exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    reg = json.load(open(os.path.join(HERE, "registry.json"), encoding="utf-8"))["titres"]
    live = jload(live_path, {}) if live_path else {}
    lmeta = live.get("_meta", {})
    ldate, lcours = lmeta.get("maj_brvm_date"), live.get("cours", {})
    avis = list((jload(os.path.join(store, "avis.json"), {"by_url": {}}).get("by_url") or {}).values())
    fcf_cache = jload(os.path.join(store, "fcf.json"), {})
    dvs = jload(os.path.join(store, "dividends.json"), {"items": []})["items"]
    tickers, fund_out, div_out = [], {}, {}
    for r in reg:
        t = r["t"]
        rows = series_rows(os.path.join(store, "prices", t + ".csv"))
        prov = False
        lc = lcours.get(t)
        if lc and ldate and lc.get("volume") and lc.get("dernier"):
            day = eday(dt.date.fromisoformat(ldate))
            row = (day, lc.get("ouverture") or lc["dernier"], lc.get("haut") or lc["dernier"], lc.get("bas") or lc["dernier"], lc["dernier"], lc["volume"], lc.get("valeur") or lc["volume"] * lc["dernier"])
            if not rows or rows[-1][0] < day:
                rows.append(row)
                prov = True
        fd = build_fund(t, r, store, fcf_cache)
        info = jload(os.path.join(store, "fundamentals", t + ".json"), {}).get("info") or {}
        if fd:
            fund_out[t] = fd
        meta = {"t": t, "n": r.get("nom"), "nf": r.get("nom_officiel"), "sec": r.get("secteur"), "bank": bool(r.get("banque")),
                "pays": PAYS.get(r.get("pays"), r.get("pays")), "sika": r.get("sika"), "nbt": info.get("nb_titres"), "flot": info.get("flottant"),
                "susp": suspension(t, avis), "prov": prov, "first": rows[0][0] if rows else None, "nsess": len(rows),
                "perf": {str(n): perf(rows, n) for n in (1, 5, 20, 60, 120, 252, 756, 1260)}, "m": monthly_closes(rows)}
        meta.update(columnar(rows[-CORE_SESSIONS:]))
        tickers.append(meta)
        with open(os.path.join(out, "h", t + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"t": t, **columnar(rows)}, fh, separators=(",", ":"))
        items = sorted([d for d in dvs if d.get("t") == t and d.get("net")], key=lambda d: (d.get("ex") or 0, d.get("pay") or ""))
        if items:
            div_out[t] = [{"ex": d.get("ex"), "net": d["net"], "brut": None, "taux": IRVM.get(r.get("pays")),
                           "src": "+".join(d.get("sources") or []), "ann": None, "det": d.get("det"), "pay": d.get("pay"),
                           "st": "confirmé" if len(d.get("sources") or []) >= 2 else "source unique", "url": d.get("url"),
                           "rem": ("sources écartées : " + ", ".join(d["ecartees"])) if d.get("ecartees") else None} for d in items]
    # Indices
    idx_full, idx_core = {}, {}
    idx_dir = os.path.join(store, "indices")
    for f in sorted(os.listdir(idx_dir)) if os.path.isdir(idx_dir) else []:
        code = f[:-4]
        rows = []
        for d, r in sorted(read_csv(os.path.join(idx_dir, f), ICOLS).items()):
            c = fnum(r.get("close"))
            if c:
                rows.append((eday(dt.date.fromisoformat(d)), c))
        li = (live.get("indices") or {}).get(code)
        if li and ldate and li.get("valeur"):
            day = eday(dt.date.fromisoformat(ldate))
            if not rows or rows[-1][0] < day:
                rows.append((day, li["valeur"]))
        if not rows:
            continue
        gele = (dt.date.today() - dt.date(1970, 1, 1)).days - rows[-1][0] > 30
        idx_full[code] = {"n": INDEX_NAMES.get(code, code), "type": "marche", "gele": gele, "d": [x[0] for x in rows], "c": [x[1] for x in rows]}
        idx_core[code] = {"n": INDEX_NAMES.get(code, code), "type": "marche", "gele": gele, "d": [x[0] for x in rows][-CORE_SESSIONS:], "c": [x[1] for x in rows][-CORE_SESSIONS:]}
    cutoff = (dt.date.today() - dt.timedelta(days=730)).isoformat()
    ev_out = sorted([{"t": a.get("t"), "pub": a.get("pub"), "at": a.get("at"), "cat": a.get("cat"), "lab": a.get("lab"), "ti": a.get("ti"), "u": a.get("u")}
                     for a in avis if (a.get("pub") or "") >= cutoff], key=lambda x: x["pub"] or "", reverse=True)
    rep = {k: jload(os.path.join(store, "reports", k + ".json"), {}) for k in ("live", "eod", "weekly", "seed_prices")}
    status = {"generated_at": now, "base": "propre (sources publiques recoupées)",
              "seance": {"origine": lmeta.get("source"), "releve_utc": lmeta.get("releve_utc"), "maj_brvm": lmeta.get("maj_brvm"),
                         "date": ldate, "etat": lmeta.get("seance"), "delai_minutes": 15, "sources": lmeta.get("sources"),
                         "divergences": lmeta.get("divergences")},
              "eod": {k: rep["eod"].get(k) for k in ("at", "boc", "african_markets")} if rep["eod"] else None,
              "comptes": rep["weekly"].get("at"), "dividendes": jload(os.path.join(store, "dividends.json"), {}).get("updated"),
              "avis": jload(os.path.join(store, "avis.json"), {}).get("updated"),
              "suspensions": {t["t"]: t["susp"] for t in tickers if t["susp"]}, "divisions": jload(os.path.join(store, "splits.json"), {"items": []})["items"]}
    core = {"v": 2, "generated_at": now, "tickers": tickers, "fund": fund_out, "divs": div_out, "idx": idx_core}
    live_out = {"generated_at": now, "_meta": lmeta, "marche": live.get("marche", {}), "indices": live.get("indices", {}), "cours": lcours}

    def dump(name, obj):
        with open(os.path.join(out, name), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))

    dump("core.json", core)
    dump("live.json", live_out)
    dump("events.json", {"generated_at": now, "events": ev_out})
    dump("idx.json", {"generated_at": now, "idx": idx_full})
    dump("status.json", status)
    print(f"{len(tickers)} titres, {sum(1 for t in tickers if t['nsess'])} avec cours, {len(fund_out)} comptes, {len(div_out)} avec dividendes, "
          f"{len(ev_out)} avis, {len(idx_full)} indices, séance {ldate}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True)
    ap.add_argument("--live")
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    build(a.store, a.live, a.out)
