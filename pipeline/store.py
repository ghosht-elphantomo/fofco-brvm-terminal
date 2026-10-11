#!/usr/bin/env python3
"""Base de données propre du terminal, alimentée uniquement par les sources publiques primaires.

Plusieurs sources indépendantes sont interrogées et comparées ; une valeur n'est retenue que si
au moins deux sources concordent. Une source qui diverge de la majorité est écartée (et notée).

  live    toutes les 15 min : BRVM (cours + indices), SikaFinance, OuestBourse -> live.json ;
          après la clôture, la séance est archivée dans la base (vote des sources).
  eod     le soir : Bulletin officiel de la cote (BOC) ajouté au vote, détection des divisions
          de titres, contrôle African Markets, dividendes et avis du jour.
  weekly  le dimanche : comptes (SikaFinance, SikaFinance Pro, OuestBourse, états financiers
          BRVM pour le free cash flow), rapports des sociétés, contrôle de l'historique.
  seed    une seule fois : historique quotidien SikaFinance depuis 2006, tous les dividendes
          et tous les avis publiés sur brvm.org.

Organisation de la base (branche « store » du dépôt) :
  prices/<TICKER>.csv   date;close;open;high;low;volume;value;src
  indices/<CODE>.csv    date;close;src
  raw/<DATE>.json       relevés bruts de chaque source à la clôture (pour le vote du soir)
  dividends.json        dividendes par titre et exercice, avec les sources qui les confirment
  avis.json             avis et publications BRVM
  fundamentals/<T>.json comptes par source
  splits.json           divisions/regroupements de titres détectés
  reports/*.json        état des sources et divergences
Usage : python store.py <live|eod|weekly|seed-prices|seed-dividends|seed-avis> --store DIR [--live-out FILE]
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources as S  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REG = S.Registry(os.path.join(HERE, "registry.json"))
PRIORITY = ["boc", "brvm", "sika", "ouest", "afm"]
NOW = lambda: dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()  # noqa: E731
INDEX_SIKA = {"BRVMC": "BRVMC", "BRVM30": "BRVM30", "BRVMPR": "BRVMPR", "BRVMPA": "BRVMPA", "BRVM_CB": "BRVM-CB", "BRVM_CD": "BRVM-CD",
              "BRVM_EN": "BRVM-EN", "BRVM_IN": "BRVM-IN", "BRVM_SF": "BRVM-SF", "BRVM_SP": "BRVM-SP", "BRVM_TEL": "BRVM-TEL",
              "BRVMAG": "BRVMAG", "BRVMAS": "BRVMAS", "BRVMDI": "BRVMDI", "BRVMFI": "BRVMFI", "BRVMIN": "BRVMIN", "BRVMSP": "BRVMSP", "BRVMTR": "BRVMTR"}
INDEX_NAMES = {"BRVMC": "BRVM Composite", "BRVM30": "BRVM 30", "BRVMPR": "BRVM Prestige", "BRVMPA": "BRVM Principal",
               "BRVM_CB": "BRVM Consommation de base", "BRVM_CD": "BRVM Consommation discrétionnaire", "BRVM_EN": "BRVM Énergie",
               "BRVM_IN": "BRVM Industriels", "BRVM_SF": "BRVM Services financiers", "BRVM_SP": "BRVM Services publics", "BRVM_TEL": "BRVM Télécommunications",
               "BRVMAG": "BRVM Agriculture (ancien)", "BRVMAS": "BRVM Autres secteurs (ancien)", "BRVMDI": "BRVM Distribution (ancien)",
               "BRVMFI": "BRVM Finance (ancien)", "BRVMIN": "BRVM Industrie (ancien)", "BRVMSP": "BRVM Services publics (ancien)", "BRVMTR": "BRVM Transport (ancien)"}


# ----------------------------------------------------------------------------- fichiers
def jload(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def jsave(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


PCOLS = ["date", "close", "open", "high", "low", "volume", "value", "src"]
ICOLS = ["date", "close", "src"]


def read_csv(path, cols):
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as f:
        next(f, None)
        for line in f:
            p = line.rstrip("\n").split(";")
            if len(p) >= 2 and p[0]:
                out[p[0]] = dict(zip(cols, p))
    return out


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(";".join(cols) + "\n")
        for d in sorted(rows):
            r = rows[d]
            f.write(";".join(str(r.get(c, "")) for c in cols) + "\n")


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def fmt(x):
    if x is None:
        return ""
    return str(int(x)) if float(x).is_integer() else f"{x:.4f}".rstrip("0").rstrip(".")


# ----------------------------------------------------------------------------- vote
def vote(values, tol=0.0005):
    """values : {source: nombre}. Regroupe les valeurs égales (à 0,05 % près) ; garde le groupe le plus
    nombreux (à égalité : celui de la source la plus prioritaire). Renvoie (valeur, sources retenues, sources écartées)."""
    vals = {s: v for s, v in values.items() if v is not None and v > 0}
    if not vals:
        return None, [], []
    groups = []
    for s in sorted(vals, key=lambda s: PRIORITY.index(s) if s in PRIORITY else 9):
        v = vals[s]
        for g in groups:
            if abs(v - g["v"]) <= tol * max(abs(g["v"]), 1e-9):
                g["s"].append(s)
                break
        else:
            groups.append({"v": v, "s": [s]})
    best = max(groups, key=lambda g: (len(g["s"]), -min(PRIORITY.index(s) if s in PRIORITY else 9 for s in g["s"])))
    rejected = [s for g in groups if g is not best for s in g["s"]]
    return best["v"], best["s"], rejected


# ----------------------------------------------------------------------------- relevés
def collect_live():
    """Interroge les sources du jour. Renvoie {source: {...}} et l'état de chacune."""
    snap, status = {}, {}
    jobs = [("brvm", lambda: S.brvm_cours(S.fetch(S.BRVM + "/fr/cours-actions/0"))),
            ("brvm_idx", lambda: S.brvm_indices(S.fetch(S.BRVM + "/fr/indices"))),
            ("sika", lambda: S.sika_aaz(S.fetch(S.SIKA + "/marches/aaz"))),
            ("ouest", lambda: S.ouest_quotes(S.fetch(S.OUEST + "/fr/screener")))]
    for name, fn in jobs:
        try:
            snap[name] = fn()
            n = len(snap[name].get("cours", snap[name])) if isinstance(snap[name], dict) else 0
            status[name] = {"ok": n >= 10, "n": n, "at": NOW()}
        except Exception as e:
            status[name] = {"ok": False, "error": str(e)[:200], "at": NOW()}
    return snap, status


def session_date(snap):
    b = snap.get("brvm") or {}
    if b.get("date"):
        return b["date"], b.get("etat"), b.get("maj")
    o = (snap.get("ouest") or {}).get("session") or {}
    if o.get("sessionDate"):
        return o["sessionDate"], "Fermée" if o.get("status") == "closed" else "Ouverte", (o.get("sourceTime") or "")[:16]
    return None, None, None


def merge_quotes(snap, boc=None, afm=None):
    """Vote ticker par ticker. Renvoie {ticker: ligne} avec les sources retenues et écartées."""
    b = (snap.get("brvm") or {}).get("cours", {})
    k = (snap.get("sika") or {}).get("cours", {})
    o = (snap.get("ouest") or {}).get("cours", {})
    c = (boc or {}).get("cours", {})
    out = {}
    for t in sorted(set(b) | set(k) | set(o) | set(c)):
        closes = {"brvm": (b.get(t) or {}).get("dernier"), "sika": (k.get(t) or {}).get("dernier"),
                  "ouest": (o.get(t) or {}).get("dernier"), "boc": (c.get(t) or {}).get("dernier")}
        if afm and t in afm:
            closes["afm"] = afm[t]
        close, ok, rej = vote(closes)
        if close is None:
            continue
        volume, _, _ = vote({"boc": (c.get(t) or {}).get("volume"), "brvm": (b.get(t) or {}).get("volume"), "sika": (k.get(t) or {}).get("volume")}, tol=0)
        opn, _, _ = vote({"boc": (c.get(t) or {}).get("ouverture"), "brvm": (b.get(t) or {}).get("ouverture"), "sika": (k.get(t) or {}).get("ouverture")})
        value = (c.get(t) or {}).get("valeur") or (k.get(t) or {}).get("valeur")
        hi, lo = (k.get(t) or {}).get("haut"), (k.get(t) or {}).get("bas")
        opn = opn or close
        hi = max(x for x in (hi, opn, close) if x)
        lo = min(x for x in (lo, opn, close) if x)
        prev = (c.get(t) or {}).get("veille") or (b.get(t) or {}).get("veille")
        var, _, _ = vote({"boc": (c.get(t) or {}).get("variation"), "brvm": (b.get(t) or {}).get("variation"),
                          "sika": (k.get(t) or {}).get("variation"), "ouest": (o.get(t) or {}).get("variation")}, tol=0.02)
        out[t] = {"nom": (b.get(t) or {}).get("nom") or (REG.by_t.get(t) or {}).get("nom_officiel") or t, "dernier": close, "ouverture": opn,
                  "haut": hi, "bas": lo, "volume": int(volume or 0), "valeur": value or (volume or 0) * close, "veille": prev,
                  "variation": var, "sources": ok, "ecartees": rej}
    return out


def merge_indices(snap, boc=None):
    a = (snap.get("brvm_idx") or {})
    a2 = (snap.get("brvm") or {}).get("indices", {})
    k = (snap.get("sika") or {}).get("indices", {})
    c = (boc or {}).get("indices", {})
    out = {}
    for code in sorted(set(a) | set(a2) | set(k) | set(c)):
        v, ok, rej = vote({"brvm": (a.get(code) or a2.get(code) or {}).get("valeur"), "sika": (k.get(code) or {}).get("valeur"), "boc": (c.get(code) or {}).get("valeur")}, tol=0.0002)
        if v is None:
            continue
        var = (a.get(code) or a2.get(code) or {}).get("variation")
        if var is None:
            var = (k.get(code) or {}).get("variation")
        out[code] = {"valeur": v, "variation": var, "sources": ok, "ecartees": rej}
    return out


def archive_day(store, date, quotes, indices, final):
    """Écrit la séance dans la base. Une séance déjà finalisée par le BOC n'est plus modifiée par le relevé intraday."""
    n = 0
    for t, q in quotes.items():
        if not q.get("volume"):
            continue  # pas d'échange : pas de ligne (règle BRVM, cours inchangé)
        path = os.path.join(store, "prices", t + ".csv")
        rows = read_csv(path, PCOLS)
        old = rows.get(date)
        if old and "boc" in (old.get("src") or "") and not final:
            continue
        src = "+".join(q["sources"]) + ("" if final else "~")
        rows[date] = {"date": date, "close": fmt(q["dernier"]), "open": fmt(q["ouverture"]), "high": fmt(q["haut"]), "low": fmt(q["bas"]),
                      "volume": q["volume"], "value": fmt(round(q["valeur"])) if q.get("valeur") else "", "src": src}
        if rows.get(date) != old:
            write_csv(path, PCOLS, rows)
            n += 1
    for code, x in indices.items():
        path = os.path.join(store, "indices", code + ".csv")
        rows = read_csv(path, ICOLS)
        old = rows.get(date)
        if old and "boc" in (old.get("src") or "") and not final:
            continue
        rows[date] = {"date": date, "close": fmt(x["valeur"]), "src": "+".join(x["sources"]) + ("" if final else "~")}
        if rows.get(date) != old:
            write_csv(path, ICOLS, rows)
    return n


def live_json(snap, status, quotes, indices):
    date, etat, maj = session_date(snap)
    b = snap.get("brvm") or {}
    return {"_meta": {"source": "Vote BRVM + SikaFinance + OuestBourse", "releve_utc": NOW(), "maj_brvm": maj, "maj_brvm_date": date,
                      "seance": etat, "delai_minutes": 15, "sources": status, "brvm_ok": (status.get("brvm") or {}).get("ok"),
                      "sika_ok": (status.get("sika") or {}).get("ok"), "ouest_ok": (status.get("ouest") or {}).get("ok"),
                      "divergences": {t: q["ecartees"] for t, q in quotes.items() if q["ecartees"]}},
            "marche": b.get("marche", {}), "indices": {k: {"valeur": v["valeur"], "variation": v["variation"]} for k, v in indices.items()},
            "cours": quotes}


def job_live(store, live_out):
    snap, status = collect_live()
    quotes = merge_quotes(snap)
    indices = merge_indices(snap)
    lj = live_json(snap, status, quotes, indices)
    jsave(live_out, lj)
    date, etat, _ = session_date(snap)
    report = {"at": NOW(), "date": date, "etat": etat, "sources": status, "titres": len(quotes)}
    if date and etat == "Fermée" and len(quotes) >= 30:
        jsave(os.path.join(store, "raw", date + ".json"), {"at": NOW(), "snap": snap})
        report["archives"] = archive_day(store, date, quotes, indices, final=False)
    jsave(os.path.join(store, "reports", "live.json"), report)
    print(json.dumps(report, ensure_ascii=False)[:600])


# ----------------------------------------------------------------------------- soir : BOC
def pdf_text(url):
    data = S.fetch(url, binary=True, timeout=120)
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data)
        f.flush()
        r = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, timeout=180)
    return r.stdout.decode("utf-8", "replace")


def detect_split(store, t, date, boc_prev):
    """Le BOC donne le cours précédent ajusté. S'il diffère nettement de notre dernière clôture, le titre a été divisé
    (ou regroupé) : on ajuste tout l'historique antérieur du même facteur."""
    path = os.path.join(store, "prices", t + ".csv")
    rows = read_csv(path, PCOLS)
    before = [d for d in rows if d < date]
    if not before or not boc_prev:
        return None
    last = fnum(rows[max(before)]["close"])
    if not last:
        return None
    ratio = last / boc_prev
    if 0.8 <= ratio <= 1.25:
        return None
    for d in before:
        r = rows[d]
        for c in ("close", "open", "high", "low"):
            x = fnum(r.get(c))
            if x:
                r[c] = fmt(round(x / ratio, 4))
        v = fnum(r.get("volume"))
        if v:
            r["volume"] = int(round(v * ratio))
    write_csv(path, PCOLS, rows)
    splits = jload(os.path.join(store, "splits.json"), {"items": []})
    splits["items"].append({"t": t, "date": date, "facteur": round(ratio, 6), "detecte_le": NOW(), "source": "BOC (cours précédent ajusté)"})
    jsave(os.path.join(store, "splits.json"), splits)
    return ratio


def job_eod(store):
    state = jload(os.path.join(store, "state.json"), {})
    done = set(state.get("boc_done", []))
    report = {"at": NOW(), "boc": [], "dividendes": 0, "avis": 0}
    try:
        lst = [b for b in S.brvm_boc_list(S.fetch(S.BRVM + "/fr/bulletins-officiels-de-la-cote")) if not b["eng"]]
    except Exception as e:
        lst, report["boc_error"] = [], str(e)[:200]
    for b in sorted(lst, key=lambda x: x["date"])[-5:]:
        if b["date"] in done:
            continue
        try:
            boc = S.boc_parse(pdf_text(b["url"]))
        except Exception as e:
            report["boc"].append({"date": b["date"], "error": str(e)[:200]})
            continue
        date = boc.get("date") or b["date"]
        if len(boc["cours"]) < 30:
            report["boc"].append({"date": date, "error": "bulletin illisible"})
            continue
        raw = jload(os.path.join(store, "raw", date + ".json"), {}).get("snap", {})
        for t, c in boc["cours"].items():
            f = detect_split(store, t, date, c.get("veille"))
            if f:
                report.setdefault("divisions", []).append({"t": t, "date": date, "facteur": f})
        quotes = merge_quotes(raw, boc=boc)
        indices = merge_indices(raw, boc=boc)
        n = archive_day(store, date, quotes, indices, final=True)
        div = {t: q["ecartees"] for t, q in quotes.items() if q["ecartees"]}
        report["boc"].append({"date": date, "titres": len(quotes), "ecrits": n, "divergences": div})
        # dividende net du BOC (dernier payé) comme source de contrôle
        dv = jload(os.path.join(store, "dividends.json"), {"items": []})
        for t, c in boc["cours"].items():
            if c.get("div_net") and c.get("div_pay"):
                add_dividend(dv, {"t": t, "net": c["div_net"], "pay": c["div_pay"], "src": "boc"})
        jsave(os.path.join(store, "dividends.json"), dv)
        done.add(date)
    state["boc_done"] = sorted(done)[-30:]
    # African Markets (décalé de quelques séances) : contrôle des clôtures archivées
    try:
        afm = S.afm_quotes(S.fetch(S.AFM))
        chk = {"ok": 0, "diff": []}
        year = dt.date.today().year
        for t, a in afm.items():
            if not a.get("dernier") or not re.fullmatch(r"\d{2}/\d{2}", a.get("date_jm") or ""):
                continue
            d = f"{year}-{a['date_jm'][3:5]}-{a['date_jm'][:2]}"
            rows = read_csv(os.path.join(store, "prices", t + ".csv"), PCOLS)
            r = rows.get(d)
            if not r:
                continue
            if abs(fnum(r["close"]) - a["dernier"]) <= 0.0005 * a["dernier"]:
                chk["ok"] += 1
                if "afm" not in r["src"]:
                    r["src"] += "+afm"
                    write_csv(os.path.join(store, "prices", t + ".csv"), PCOLS, rows)
            else:
                chk["diff"].append({"t": t, "date": d, "base": r["close"], "afm": a["dernier"]})
        report["african_markets"] = chk
    except Exception as e:
        report["african_markets"] = {"error": str(e)[:200]}
    # dividendes et avis récents
    report["dividendes"] = crawl_dividends(store, pages=2)
    report["avis"] = crawl_avis(store, pages=1)
    try:
        report["sika_dividendes"] = merge_sika_dividends(store, S.sika_dividendes(S.fetch(S.SIKA + "/marches/dividendes"), REG))
    except Exception as e:
        report["sika_dividendes"] = str(e)[:200]
    jsave(os.path.join(store, "state.json"), state)
    jsave(os.path.join(store, "reports", "eod.json"), report)
    print(json.dumps(report, ensure_ascii=False)[:1500])


# ----------------------------------------------------------------------------- dividendes
def add_dividend(dv, rec):
    """Fusionne un dividende : même titre et même exercice, ou même date de paiement."""
    t = rec.get("t")
    if not t or not rec.get("net"):
        return False
    for x in dv["items"]:
        if x["t"] != t:
            continue
        same = (rec.get("ex") and x.get("ex") == rec.get("ex")) or (rec.get("pay") and x.get("pay") == rec.get("pay"))
        if same:
            vals = x.setdefault("valeurs", {})
            vals[rec["src"]] = rec["net"]
            for k in ("ex", "pay", "det", "url"):
                if rec.get(k) and not x.get(k):
                    x[k] = rec[k]
            v, ok, rej = vote(vals, tol=0.005)
            x.update(net=v, sources=ok, ecartees=rej)
            return True
    dv["items"].append({"t": t, "ex": rec.get("ex"), "pay": rec.get("pay"), "det": rec.get("det"), "url": rec.get("url"),
                        "valeurs": {rec["src"]: rec["net"]}, "net": rec["net"], "sources": [rec["src"]], "ecartees": []})
    return True


def crawl_dividends(store, pages=2, start=0):
    dv = jload(os.path.join(store, "dividends.json"), {"items": []})
    n = 0
    for p in range(start, start + pages):
        url = S.BRVM + "/fr/esv/paiement-de-dividendes" + (f"?page={p}" if p else "")
        try:
            items = S.brvm_dividends(S.fetch(url), REG)
        except Exception as e:
            print("dividendes", url, e)
            break
        if not items:
            break
        for it in items:
            if it["t"] and it["net"]:
                n += add_dividend(dv, {"t": it["t"], "ex": it["ex"], "pay": it["pay"], "det": it["det"], "net": it["net"], "url": it["url"], "src": "brvm"})
    dv["updated"] = NOW()
    jsave(os.path.join(store, "dividends.json"), dv)
    return n


def merge_sika_dividends(store, items):
    dv = jload(os.path.join(store, "dividends.json"), {"items": []})
    n = 0
    for it in items:
        if it.get("ex") and it.get("brut_ou_net"):
            n += add_dividend(dv, {"t": it["t"], "ex": it["ex"], "net": it["brut_ou_net"], "src": "sika"})
    jsave(os.path.join(store, "dividends.json"), dv)
    return n


# ----------------------------------------------------------------------------- avis
CATS = [("dividend_payment", "Paiement dividende", r"paiement (de|des) dividende|dividende"), ("ag_meeting", "Assemblée générale", r"assembl[ée]e g[ée]n[ée]rale|convocation"),
        ("resolution_project", "Projet de résolutions", r"projet(s)? de r[ée]solution"), ("financial_statements", "États financiers", r"[ée]tats financiers|bilan"),
        ("activity_report", "Rapport d'activité", r"rapport d.activit"), ("annual_report", "Rapport annuel", r"rapport annuel"),
        ("auditor_report", "Rapport des commissaires", r"commissaires? aux comptes"), ("financial_results", "Résultats", r"r[ée]sultats"),
        ("rating", "Notation", r"notation"), ("management_change", "Changement de dirigeant", r"nomination|d[ée]mission|changement de dirigeant|directeur g[ée]n[ée]ral"),
        ("trading_suspension", "Suspension", r"suspension"), ("trading_resumed", "Reprise de cotation", r"reprise de (la )?cotation"),
        ("stock_split", "Division du titre", r"fractionnement|division du nominal|regroupement"), ("capital_operation_notice", "Opération sur le capital", r"augmentation de capital|attribution|droits? pr[ée]f[ée]rentiel|offre publique"),
        ("first_listing", "Première cotation", r"premi[èe]re cotation|introduction"), ("index_composition", "Composition d'indice", r"composition de l.indice"),
        ("transaction_cancelled", "Annulation de transaction", r"annulation de transaction"), ("communique", "Communiqué", r"communiqu[ée]")]


def classify(title):
    t = (title or "").lower()
    for code, lab, pat in CATS:
        if re.search(pat, t):
            return code, lab
    return "company_notice", "Avis"


def add_avis(av, it, origin):
    url = it["url"]
    if url in av["by_url"]:
        return False
    cat, lab = classify(it["titre"])
    t = REG.find(it["titre"], url)
    av["by_url"][url] = {"t": t, "pub": it.get("date"), "cat": cat, "lab": lab, "ti": it["titre"], "u": url, "origine": origin}
    return True


def crawl_avis(store, pages=1, start=0, which=None):
    av = jload(os.path.join(store, "avis.json"), {"by_url": {}})
    lists = which or ["/fr/marche/avis-et-publications/avis", "/fr/emetteurs/type-annonces/convocations-assemblees-generales",
                      "/fr/emetteurs/type-annonces/communiques", "/fr/emetteurs/type-annonces/notations-financieres",
                      "/fr/emetteurs/type-annonces/projets-de-resolution", "/fr/emetteurs/type-annonces/changements-de-dirigeants"]
    n = 0
    for path in lists:
        for p in range(start, start + pages):
            try:
                items = S.brvm_listing(S.fetch(S.BRVM + path + (f"?page={p}" if p else "")))
            except Exception as e:
                print("avis", path, p, e)
                break
            new = sum(add_avis(av, it, path) for it in items)
            n += new
            if not items or (pages > 3 and new == 0 and p > start + 2):
                break
    av["updated"] = NOW()
    jsave(os.path.join(store, "avis.json"), av)
    return n


def crawl_reports(store):
    av = jload(os.path.join(store, "avis.json"), {"by_url": {}})
    n = 0
    for r in REG.items:
        slug = r.get("brvm_rapports")
        if not slug:
            continue
        try:
            items = S.brvm_listing(S.fetch(S.BRVM + "/fr/rapports-societe-cotes/" + slug))
        except Exception as e:
            print("rapports", slug, e)
            continue
        for it in items:
            if add_avis(av, it, "rapports"):
                av["by_url"][it["url"]]["t"] = av["by_url"][it["url"]]["t"] or r["t"]
                n += 1
    jsave(os.path.join(store, "avis.json"), av)
    return n


# ----------------------------------------------------------------------------- comptes
def job_weekly(store):
    report = {"at": NOW(), "comptes": {}, "rapports": 0}
    report["rapports"] = crawl_reports(store)
    for r in REG.items:
        t = r["t"]
        path = os.path.join(store, "fundamentals", t + ".json")
        fd = jload(path, {})
        got = []
        if r.get("sika"):
            try:
                so = S.sika_societe(S.fetch(f"{S.SIKA}/marches/societe/{r['sika']}"))
                if so["series"]:
                    fd["sika"], fd["info"] = so["series"], so["info"]
                    got.append("sika")
            except Exception as e:
                print(t, "sika", e)
            try:
                pro = S.sika_tables(S.fetch(f"{S.SIKA_PRO}/finance/{r['sika']}"))
                if pro:
                    fd["sika_pro"] = pro
                    got.append("sika_pro")
            except Exception as e:
                print(t, "sika_pro", e)
        if r.get("ouestbourse"):
            try:
                ob = S.ouest_stock(S.fetch(f"{S.OUEST}/fr/actions/{r['ouestbourse']}/finances"))
                if ob["series"]:
                    fd["ouest"] = ob["series"]
                    got.append("ouest")
                dv = jload(os.path.join(store, "dividends.json"), {"items": []})
                for d in ob["dividends"]:
                    add_dividend(dv, {"t": t, "ex": d["ex"], "net": d["net"], "pay": d["pay"], "det": d["det"], "url": d["url"], "src": "ouest"})
                jsave(os.path.join(store, "dividends.json"), dv)
            except Exception as e:
                print(t, "ouest", e)
        fd["updated"] = NOW()
        jsave(path, fd)
        report["comptes"][t] = got
    report["fcf"] = fcf_from_pdfs(store)
    jsave(os.path.join(store, "reports", "weekly.json"), report)
    print(json.dumps(report, ensure_ascii=False)[:1500])


def fcf_from_pdfs(store, since=2016):
    """Free cash flow lu dans les états financiers SYSCOHADA publiés par la BRVM (tableau des flux de trésorerie)."""
    import fcf_extract as F
    av = jload(os.path.join(store, "avis.json"), {"by_url": {}})
    cache = jload(os.path.join(store, "fcf.json"), {"series": {}, "docs": {}})
    n = 0
    docs = {}
    for u, a in av["by_url"].items():
        t = a.get("t")
        if not t or (REG.by_t.get(t) or {}).get("banque") or not u.lower().endswith(".pdf"):
            continue
        ti = S.norm(a.get("ti"))
        if "ETATS FINANCIERS" not in ti:
            continue
        m = re.search(r"(20\d\d)", a.get("ti") or "")
        fy = int(m.group(1)) if m else None
        if not fy or fy < since:
            continue
        rank = 0 if "SYSCOHADA" in ti else 1
        docs.setdefault((t, fy), []).append((rank, a.get("pub") or "", u))
    for (t, fy), cands in sorted(docs.items()):
        ser = cache["series"].setdefault(t, {})
        if str(fy) in ser:
            continue
        ca = ((jload(os.path.join(store, "fundamentals", t + ".json"), {}).get("sika") or {}).get("ca") or {}).get(str(fy))
        for _, _, u in sorted(cands):
            if u in cache["docs"]:
                continue
            try:
                found, hint = F.parse_tft(pdf_text(u))
            except Exception as e:
                cache["docs"][u] = f"erreur : {e}"[:100]
                continue
            div = F.scale(found, hint, ca) if "cfo" in found else None
            if div is None or not ({"capex_c", "capex_ic"} & found.keys()):
                cache["docs"][u] = "tableau des flux illisible"
                continue
            cache["docs"][u] = "ok"
            for col, year in ((0, fy), (1, fy - 1)):
                cfo = found["cfo"][col]
                if cfo is None:
                    continue
                capex = sum(abs(found[k][col] or 0) for k in ("capex_i", "capex_c", "capex_ic") if k in found and found[k][col] is not None)
                if col == 0 or str(year) not in ser:
                    ser[str(year)] = {"cfo": round(cfo * div, 1), "capex": round(capex * div, 1), "fcf": round((cfo - capex) * div, 1), "src": u}
            n += 1
            break
        jsave(os.path.join(store, "fcf.json"), cache)
    return n


# ----------------------------------------------------------------------------- amorçage
def seed_prices(store, since="2006-01-01", only=None):
    """Historique quotidien SikaFinance (fenêtres de 89 jours), sans écraser une séance déjà votée."""
    today = dt.date.today()
    targets = [(r["t"], r["sika"], "prices") for r in REG.items if r.get("sika")] + [(c, s, "indices") for c, s in INDEX_SIKA.items()]
    report = {}
    for code, sym, kind in targets:
        if only and code not in only:
            continue
        path = os.path.join(store, kind, code + ".csv")
        cols = PCOLS if kind == "prices" else ICOLS
        rows = read_csv(path, cols)
        try:
            years = S.sika_histos(sym, "1998-01-01", today.isoformat(), "365")
            first = min(p["d"] for p in years) if years else None
        except Exception as e:
            report[code] = {"error": str(e)[:100]}
            continue
        if not first:
            report[code] = {"error": "aucune donnée"}
            continue
        d0 = max(dt.date.fromisoformat(since), dt.date.fromisoformat(first[:4] + "-01-01"))
        added, errors = 0, 0
        while d0 <= today:
            d1 = min(today, d0 + dt.timedelta(days=89))
            try:
                pts = S.sika_histos(sym, d0.isoformat(), d1.isoformat())
            except Exception:
                pts, errors = [], errors + 1
            for p in pts:
                if p["d"] in rows:
                    continue
                if kind == "prices":
                    if not p["v"]:
                        continue
                    rows[p["d"]] = {"date": p["d"], "close": fmt(p["c"]), "open": fmt(p["o"]), "high": fmt(max(p["h"], p["o"], p["c"])),
                                    "low": fmt(min(p["l"], p["o"], p["c"])), "volume": p["v"], "value": "", "src": "sika"}
                else:
                    rows[p["d"]] = {"date": p["d"], "close": fmt(p["c"]), "src": "sika"}
                added += 1
            d0 = d1 + dt.timedelta(days=1)
        write_csv(path, cols, rows)
        report[code] = {"ajoutees": added, "total": len(rows), "premiere": min(rows) if rows else None, "erreurs": errors}
        print(code, report[code], flush=True)
    jsave(os.path.join(store, "reports", "seed_prices.json"), {"at": NOW(), "series": report})


def verify_against(store, mirror):
    """Contrôle ponctuel de l'historique avec un autre jeu de données public (ex. miroir CSV). Rapport seulement."""
    sys.path.insert(0, HERE)
    from build import parse_csv  # lecteur des CSV du miroir (ordre réel des colonnes)
    acts = {a["ticker"]: a["csv"] for a in jload(os.path.join(mirror, "actions.json"), {}).get("actions", [])}
    rep = {}
    for t, csv in acts.items():
        p = os.path.join(mirror, csv + ".csv")
        if not os.path.exists(p):
            continue
        other = {(dt.date(1970, 1, 1) + dt.timedelta(days=r[0])).isoformat(): r[4] for r in parse_csv(p)}
        mine = {d: fnum(r["close"]) for d, r in read_csv(os.path.join(store, "prices", t + ".csv"), PCOLS).items()}
        common = sorted(set(other) & set(mine))
        same = sum(1 for d in common if abs(other[d] - mine[d]) <= 0.0005 * other[d])
        ratios = {}
        for d in common:
            if mine[d]:
                ratios.setdefault(round(other[d] / mine[d], 3), []).append(d)
        rep[t] = {"communes": len(common), "identiques": same, "seulement_base": len(set(mine) - set(other)), "seulement_autre": len(set(other) - set(mine)),
                  "rapports": {str(k): [min(v), max(v), len(v)] for k, v in ratios.items() if len(v) >= 5 and k != 1.0}}
    jsave(os.path.join(store, "reports", "verification_historique.json"), {"at": NOW(), "series": rep})
    tot = sum(r["communes"] for r in rep.values())
    ok = sum(r["identiques"] for r in rep.values())
    print(f"Contrôle : {ok}/{tot} clôtures identiques ({ok / max(tot, 1):.1%})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job")
    ap.add_argument("--store", required=True)
    ap.add_argument("--live-out", default="live.json")
    ap.add_argument("--pages", type=int, default=0)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--only", default="")
    ap.add_argument("--mirror", default="")
    a = ap.parse_args()
    os.makedirs(a.store, exist_ok=True)
    if a.job == "live":
        job_live(a.store, a.live_out)
    elif a.job == "eod":
        job_eod(a.store)
    elif a.job == "weekly":
        job_weekly(a.store)
    elif a.job == "seed-prices":
        seed_prices(a.store, only=set(a.only.split(",")) if a.only else None)
    elif a.job == "seed-dividends":
        print(crawl_dividends(a.store, pages=a.pages or 60, start=a.start), "dividendes")
    elif a.job == "seed-avis":
        print(crawl_avis(a.store, pages=a.pages or 400, start=a.start), "avis")
        print(crawl_reports(a.store), "rapports")
    elif a.job == "verify":
        verify_against(a.store, a.mirror)
    else:
        sys.exit("tâche inconnue : " + a.job)


if __name__ == "__main__":
    main()
