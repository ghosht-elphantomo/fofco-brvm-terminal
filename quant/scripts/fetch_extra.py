#!/usr/bin/env python3
"""Sources complémentaires du terminal FQT, relevées depuis GitHub Actions (bibliothèque standard).

  FRED (Réserve fédérale de St. Louis)  taux, crédit, liquidité, emploi, inflation, activité, stress
  Nasdaq                               ETF (secteurs, facteurs, pays, obligations, matières), indices, Nasdaq-100
  CBOE                                 VIX, VIX9D, VIX3M, VVIX, SKEW
  CNN                                  Fear & Greed officiel et ses 7 composantes
  Coinbase                             BTC, ETH, SOL (quotidien)
  Banque mondiale                      indicateurs des 8 pays de l'UEMOA
  SEC EDGAR (XBRL companyfacts)        comptes trimestriels et annuels des actions US -> flux de trésorerie, ratios

Chaque source est indépendante : une panne n'empêche pas les autres. report.json liste les erreurs.
Le dossier --out (branche quant-raw restaurée) sert aussi de base : on ne relit que les dernières
semaines d'une série déjà présente, sauf si un ajustement (split) est détecté. Un échec laisse l'ancien fichier.

Usage : fetch_extra.py --out RAW_DIR [--only nasdaq,fred,cboe,cnn,crypto,wb,sec,analyst,boc,probe] [--news FILE]
"""
import argparse, csv, datetime as dt, gzip, io, json, math, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_terminal import US  # noqa: E402  (univers US déjà suivi)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
SEC_UA = os.environ.get("SEC_UA") or "FQT-Terminal research ghosht-elphantomo@users.noreply.github.com"
NQ_H = {"Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/", "Accept": "application/json, text/plain, */*"}
TODAY = dt.date.today()
REPORT = {}

# ---------------------------------------------------------------- univers
ETFS = [  # symbole, nom, groupe
    ("SPY", "SPDR S&P 500", "ETF actions US"), ("DIA", "SPDR Dow Jones Industrial", "ETF actions US"), ("IWM", "iShares Russell 2000", "ETF actions US"),
    ("MDY", "SPDR S&P MidCap 400", "ETF actions US"), ("RSP", "Invesco S&P 500 équipondéré", "ETF actions US"),
    ("MTUM", "iShares MSCI USA Momentum", "ETF facteurs"), ("QUAL", "iShares MSCI USA Quality", "ETF facteurs"), ("USMV", "iShares MSCI USA Min Vol", "ETF facteurs"),
    ("VLUE", "iShares MSCI USA Value", "ETF facteurs"), ("SIZE", "iShares MSCI USA Size", "ETF facteurs"), ("SPHB", "Invesco S&P 500 High Beta", "ETF facteurs"),
    ("SPLV", "Invesco S&P 500 Low Volatility", "ETF facteurs"), ("VIG", "Vanguard Dividend Appreciation", "ETF facteurs"),
    ("XLK", "Technologie (SPDR)", "ETF secteurs US"), ("XLF", "Finance (SPDR)", "ETF secteurs US"), ("XLE", "Énergie (SPDR)", "ETF secteurs US"),
    ("XLV", "Santé (SPDR)", "ETF secteurs US"), ("XLY", "Conso. discrétionnaire (SPDR)", "ETF secteurs US"), ("XLP", "Conso. de base (SPDR)", "ETF secteurs US"),
    ("XLI", "Industrie (SPDR)", "ETF secteurs US"), ("XLB", "Matériaux (SPDR)", "ETF secteurs US"), ("XLU", "Services publics (SPDR)", "ETF secteurs US"),
    ("XLRE", "Immobilier (SPDR)", "ETF secteurs US"), ("XLC", "Communication (SPDR)", "ETF secteurs US"),
    ("SMH", "VanEck Semi-conducteurs", "ETF thématiques"), ("IGV", "iShares Logiciel", "ETF thématiques"), ("XBI", "SPDR Biotech", "ETF thématiques"),
    ("ITA", "iShares Aéronautique & défense", "ETF thématiques"), ("ARKK", "ARK Innovation", "ETF thématiques"), ("KWEB", "KraneShares Internet chinois", "ETF thématiques"),
    ("TQQQ", "ProShares UltraPro QQQ (3x)", "ETF à levier"), ("SQQQ", "ProShares UltraPro Short QQQ (-3x)", "ETF à levier"),
    ("QLD", "ProShares Ultra QQQ (2x)", "ETF à levier"), ("SOXL", "Direxion Semi-conducteurs (3x)", "ETF à levier"), ("SSO", "ProShares Ultra S&P 500 (2x)", "ETF à levier"),
    ("EFA", "iShares MSCI EAFE (pays développés)", "ETF pays"), ("EEM", "iShares MSCI Émergents", "ETF pays"), ("EWJ", "iShares MSCI Japon", "ETF pays"),
    ("EWG", "iShares MSCI Allemagne", "ETF pays"), ("EWU", "iShares MSCI Royaume-Uni", "ETF pays"), ("EWQ", "iShares MSCI France", "ETF pays"),
    ("FXI", "iShares China Large-Cap", "ETF pays"), ("INDA", "iShares MSCI Inde", "ETF pays"), ("EWZ", "iShares MSCI Brésil", "ETF pays"),
    ("EWT", "iShares MSCI Taïwan", "ETF pays"), ("EZA", "iShares MSCI Afrique du Sud", "ETF pays"), ("AFK", "VanEck Afrique", "ETF pays"),
    ("NGE", "Global X MSCI Nigeria", "ETF pays"),
    ("SHY", "iShares Trésor US 1-3 ans", "ETF obligations"), ("IEF", "iShares Trésor US 7-10 ans", "ETF obligations"), ("TLT", "iShares Trésor US 20 ans+", "ETF obligations"),
    ("TIP", "iShares obligations indexées (TIPS)", "ETF obligations"), ("LQD", "iShares crédit catégorie investissement", "ETF obligations"),
    ("HYG", "iShares haut rendement", "ETF obligations"), ("EMB", "iShares dette émergente USD", "ETF obligations"), ("AGG", "iShares obligations US agrégées", "ETF obligations"),
    ("GLD", "SPDR Gold Shares (or)", "ETF matières"), ("SLV", "iShares Silver (argent)", "ETF matières"), ("GDX", "VanEck mines d'or", "ETF matières"),
    ("USO", "United States Oil Fund", "ETF matières"), ("UNG", "United States Natural Gas", "ETF matières"), ("DBC", "Invesco matières premières", "ETF matières"),
    ("DBA", "Invesco agriculture", "ETF matières"), ("CPER", "United States Copper", "ETF matières"),
    ("UUP", "Invesco dollar US haussier", "ETF devises"), ("FXE", "Invesco euro", "ETF devises"), ("FXY", "Invesco yen", "ETF devises"),
    ("VNQ", "Vanguard immobilier coté (REIT)", "ETF immobilier"), ("IBIT", "iShares Bitcoin Trust", "ETF crypto"),
]
INDICES = [("SPX", "SPX", "S&P 500"), ("NDX", "NDX", "Nasdaq-100"), ("COMP", "CCMP", "Nasdaq Composite"), ("RUT", "RTY", "Russell 2000")]
FRED = [  # id, nom, groupe, unité
    ("DGS1MO", "Trésor US 1 mois", "Taux", "%"), ("DGS3MO", "Trésor US 3 mois", "Taux", "%"), ("DGS6MO", "Trésor US 6 mois", "Taux", "%"),
    ("DGS1", "Trésor US 1 an", "Taux", "%"), ("DGS2", "Trésor US 2 ans", "Taux", "%"), ("DGS3", "Trésor US 3 ans", "Taux", "%"),
    ("DGS5", "Trésor US 5 ans", "Taux", "%"), ("DGS7", "Trésor US 7 ans", "Taux", "%"), ("DGS10", "Trésor US 10 ans", "Taux", "%"),
    ("DGS20", "Trésor US 20 ans", "Taux", "%"), ("DGS30", "Trésor US 30 ans", "Taux", "%"), ("DFF", "Taux des Fed funds effectif", "Taux", "%"),
    ("T10Y2Y", "Pente 10 ans - 2 ans", "Taux", "pts"), ("T10Y3M", "Pente 10 ans - 3 mois", "Taux", "pts"),
    ("DFII10", "Taux réel 10 ans (TIPS)", "Taux", "%"), ("T10YIE", "Inflation anticipée 10 ans (point mort)", "Inflation", "%"),
    ("T5YIFR", "Inflation anticipée 5 ans dans 5 ans", "Inflation", "%"), ("MORTGAGE30US", "Taux immobilier 30 ans", "Taux", "%"),
    ("BAMLH0A0HYM2", "Écart haut rendement (OAS)", "Crédit", "%"), ("BAMLC0A0CM", "Écart catégorie investissement (OAS)", "Crédit", "%"),
    ("BAMLH0A3HYC", "Écart CCC et moins (OAS)", "Crédit", "%"), ("BAA10Y", "Écart Moody's Baa - 10 ans", "Crédit", "%"), ("AAA10Y", "Écart Moody's Aaa - 10 ans", "Crédit", "%"),
    ("WALCL", "Bilan de la Fed", "Liquidité", "M$"), ("WTREGEN", "Compte du Trésor à la Fed (TGA)", "Liquidité", "Md$"),
    ("RRPONTSYD", "Prises en pension inversées (RRP)", "Liquidité", "Md$"), ("M2SL", "Masse monétaire M2", "Liquidité", "Md$"),
    ("STLFSI4", "Indice de stress financier (St. Louis)", "Stress", "idx"), ("NFCI", "Conditions financières (Chicago)", "Stress", "idx"),
    ("VIXCLS", "VIX", "Stress", "pts"), ("VXNCLS", "VXN (volatilité Nasdaq-100)", "Stress", "pts"), ("OVXCLS", "OVX (volatilité du pétrole)", "Stress", "pts"),
    ("GVZCLS", "GVZ (volatilité de l'or)", "Stress", "pts"), ("DTWEXBGS", "Dollar US pondéré (large)", "Change", "idx"),
    ("UNRATE", "Taux de chômage", "Emploi", "%"), ("ICSA", "Inscriptions hebdo. au chômage", "Emploi", "k"), ("PAYEMS", "Emplois non agricoles", "Emploi", "k"),
    ("SAHMREALTIME", "Règle de Sahm (temps réel)", "Emploi", "pts"), ("JTSJOL", "Offres d'emploi (JOLTS)", "Emploi", "k"),
    ("CPIAUCSL", "Prix à la consommation (CPI)", "Inflation", "idx"), ("CPILFESL", "CPI hors alimentation et énergie", "Inflation", "idx"),
    ("PCEPILFE", "PCE sous-jacent", "Inflation", "idx"), ("PPIACO", "Prix à la production", "Inflation", "idx"),
    ("GDPC1", "PIB réel", "Activité", "Md$"), ("INDPRO", "Production industrielle", "Activité", "idx"), ("RSAFS", "Ventes au détail", "Activité", "M$"),
    ("HOUST", "Mises en chantier", "Activité", "k"), ("UMCSENT", "Confiance des ménages (Michigan)", "Activité", "idx"),
    ("CSUSHPINSA", "Prix des logements Case-Shiller", "Activité", "idx"), ("USREC", "Récession (NBER)", "Activité", "0/1"),
    ("RECPROUSM156N", "Probabilité de récession (lissée)", "Activité", "%"),
    ("SP500", "S&P 500", "Marchés", "pts"), ("NASDAQCOM", "Nasdaq Composite (depuis 1971)", "Marchés", "pts"),
    ("DCOILWTICO", "Pétrole WTI", "Marchés", "$"), ("DEXUSEU", "Dollar par euro", "Change", "$"),
]
CBOE = ["VIX", "VIX9D", "VIX3M", "VVIX", "SKEW"]
CRYPTO = [("BTC", "BTC-USD", "2015-07-20"), ("ETH", "ETH-USD", "2016-05-18"), ("SOL", "SOL-USD", "2021-06-01")]
UEMOA = ["BEN", "BFA", "CIV", "GNB", "MLI", "NER", "SEN", "TGO", "SSF", "WLD"]
WB = [  # indicateur, nom, unité
    ("NY.GDP.MKTP.KD.ZG", "Croissance du PIB réel", "%"), ("FP.CPI.TOTL.ZG", "Inflation (prix à la consommation)", "%"),
    ("NY.GDP.MKTP.CD", "PIB (dollars courants)", "$"), ("NY.GDP.PCAP.CD", "PIB par habitant", "$"), ("NY.GDP.PCAP.PP.CD", "PIB par habitant (PPA)", "$"),
    ("SP.POP.TOTL", "Population", "hab."), ("SP.POP.GROW", "Croissance démographique", "%"), ("SP.URB.TOTL.IN.ZS", "Population urbaine", "%"),
    ("GC.DOD.TOTL.GD.ZS", "Dette de l'État central", "% PIB"), ("BN.CAB.XOKA.GD.ZS", "Solde courant", "% PIB"),
    ("BX.KLT.DINV.WD.GD.ZS", "Investissements directs étrangers (entrées)", "% PIB"), ("BX.TRF.PWKR.DT.GD.ZS", "Envois de fonds des migrants", "% PIB"),
    ("NE.EXP.GNFS.ZS", "Exportations", "% PIB"), ("NE.IMP.GNFS.ZS", "Importations", "% PIB"), ("NE.GDI.TOTL.ZS", "Investissement (FBCF + stocks)", "% PIB"),
    ("GC.REV.XGRT.GD.ZS", "Recettes publiques hors dons", "% PIB"), ("FS.AST.PRVT.GD.ZS", "Crédit au secteur privé", "% PIB"),
    ("FM.LBL.BMNY.ZG", "Croissance de la masse monétaire", "%"), ("FR.INR.LEND", "Taux débiteur", "%"),
    ("IT.CEL.SETS.P2", "Abonnements mobiles", "/100 hab."), ("IT.NET.USER.ZS", "Utilisateurs d'internet", "%"), ("EG.ELC.ACCS.ZS", "Accès à l'électricité", "%"),
    ("SL.UEM.TOTL.ZS", "Chômage (OIT)", "%"), ("SI.POV.DDAY", "Pauvreté (2,15 $/jour)", "%"), ("SP.DYN.LE00.IN", "Espérance de vie", "ans"),
    ("NV.AGR.TOTL.ZS", "Agriculture", "% PIB"), ("NV.IND.TOTL.ZS", "Industrie", "% PIB"), ("NV.SRV.TOTL.ZS", "Services", "% PIB"),
]


# ---------------------------------------------------------------- outils
def log(*a):
    print("[extra]", *a, flush=True)


def note(src, ok=True, err=None):
    r = REPORT.setdefault(src, {"ok": 0, "err": 0, "errors": []})
    if ok:
        r["ok"] += 1
    else:
        r["err"] += 1
        if len(r["errors"]) < 12:
            r["errors"].append(str(err)[:200])


def get(url, headers=None, tries=3, timeout=60, pause=2.0):
    err = None
    for k in range(tries):
        try:
            h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip"}
            h.update(headers or {})
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                b = r.read()
                if r.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b":
                    b = gzip.decompress(b)
                return b
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 403, 404):
                break
            time.sleep(pause * (1 + 2 * k))
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(pause * (1 + 2 * k))
    raise err


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


def i2d(i):
    return dt.date(i // 10000, i // 100 % 100, i % 100)


def d2i(d):
    return d.year * 10000 + d.month * 100 + d.day


def prev_series(prev, sid, sub="nasdaq"):
    if not prev:
        return None
    p = os.path.join(prev, sub, sid + ".json")
    try:
        with open(p, encoding="utf8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def find_rows(obj):
    """Premier tableau 'rows' trouvé dans une réponse JSON Nasdaq (la structure varie selon les points d'accès)."""
    if isinstance(obj, dict):
        if isinstance(obj.get("rows"), list):
            return obj["rows"]
        for v in obj.values():
            r = find_rows(v)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_rows(v)
            if r is not None:
                return r
    return None


def money(x):
    if x in (None, "", "N/A", "--"):
        return None
    try:
        return float(str(x).replace("$", "").replace(",", "").strip())
    except ValueError:
        return None


# ---------------------------------------------------------------- Nasdaq
def nasdaq_hist(sym, assetclass, start):
    url = (f"https://api.nasdaq.com/api/quote/{urllib.parse.quote(sym)}/historical?assetclass={assetclass}"
           f"&fromdate={start.isoformat()}&limit=9999&todate={TODAY.isoformat()}")
    j = json.loads(get(url, headers=NQ_H, timeout=60))
    rows = find_rows(j.get("data") or {}) or []
    out = {}
    for r in rows:
        try:
            m, d, y = r["date"].split("/")
            k = int(y) * 10000 + int(m) * 100 + int(d)
        except Exception:  # noqa: BLE001
            continue
        c = money(r.get("close"))
        if not c:
            continue
        o, h, l = money(r.get("open")) or c, money(r.get("high")) or c, money(r.get("low")) or c
        v = money(r.get("volume")) or 0
        out[k] = (k, o, max(h, o, c), min(l, o, c), c, int(v))
    return [out[k] for k in sorted(out)]


def nasdaq_series(sid, sym, assetclass, prev):
    """Historique quotidien : 10 ans au premier passage, puis les 3 dernières semaines recollées sur la série publiée."""
    old = prev_series(prev, sid)
    full_start = dt.date(TODAY.year - 11, 1, 1)
    rows = None
    if old and old.get("d") and (TODAY - i2d(old["d"][-1])).days < 40 and len(old["d"]) > 300:
        start = i2d(old["d"][-1]) - dt.timedelta(days=21)
        new = nasdaq_hist(sym, assetclass, start)
        if new:
            od = dict(zip(old["d"], old["c"]))
            overlap = [(od[r[0]], r[4]) for r in new if r[0] in od]
            if overlap and all(abs(n / o - 1) < 0.004 for o, n in overlap if o):
                first = new[0][0]
                keep = [i for i, d in enumerate(old["d"]) if d < first]
                g = lambda k: old.get(k) or old["c"]  # noqa: E731
                rows = [(old["d"][i], g("o")[i], g("h")[i], g("l")[i], old["c"][i], (old.get("v") or [0] * len(old["d"]))[i]) for i in keep] + new
            else:
                log(sid, "ajustement détecté, relecture complète")
    if rows is None:
        rows = nasdaq_hist(sym, assetclass, full_start)
    if len(rows) < 30:
        raise ValueError(f"{sym}: {len(rows)} lignes")
    return {"d": [r[0] for r in rows], "o": [r[1] for r in rows], "h": [r[2] for r in rows], "l": [r[3] for r in rows],
            "c": [r[4] for r in rows], "v": [r[5] for r in rows]}


def run_nasdaq(out, prev):
    meta = {"etf": [], "idx": [], "ndx": [], "screener": {}}
    # Composition du Nasdaq-100 et secteurs (screener complet)
    ndx = []
    try:
        j = json.loads(get("https://api.nasdaq.com/api/quote/list-type/nasdaq100", headers=NQ_H))
        for r in find_rows(j.get("data") or {}) or []:
            s = (r.get("symbol") or "").strip().upper()
            if s:
                ndx.append({"s": s, "n": r.get("companyName") or r.get("name"), "mcap": money(r.get("marketCap"))})
        note("nasdaq-ndx", ok=bool(ndx), err=None if ndx else "liste vide")
    except Exception as e:  # noqa: BLE001
        note("nasdaq-ndx", False, e)
    try:
        j = json.loads(get("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true", headers=NQ_H, timeout=90))
        want = {x["s"] for x in ndx} | {s for s, *_ in US}
        for r in find_rows(j.get("data") or {}) or []:
            s = (r.get("symbol") or "").strip().upper()
            if s in want:
                meta["screener"][s] = {"n": r.get("name"), "sector": r.get("sector"), "ind": r.get("industry"), "cty": r.get("country"),
                                       "mcap": money(r.get("marketCap")), "ipo": r.get("ipoyear")}
        note("nasdaq-screener", ok=bool(meta["screener"]), err=None if meta["screener"] else "vide")
    except Exception as e:  # noqa: BLE001
        note("nasdaq-screener", False, e)
    if not ndx and prev and os.path.exists(os.path.join(prev, "nasdaq_meta.json")):
        ndx = json.load(open(os.path.join(prev, "nasdaq_meta.json"), encoding="utf8")).get("ndx", [])
        log("composition Nasdaq-100 reprise du site précédent", len(ndx))
    meta["ndx"] = ndx
    if not meta["screener"] and prev and os.path.exists(os.path.join(prev, "nasdaq_meta.json")):
        meta["screener"] = json.load(open(os.path.join(prev, "nasdaq_meta.json"), encoding="utf8")).get("screener", {})
    already = {s for s, *_ in US}
    jobs = [(s, s, "etf", "etf", n, g) for s, n, g in ETFS if s not in already]
    jobs += [(sid, sym, "index", "idx", n, "Indices US") for sym, sid, n in INDICES]
    jobs += [(x["s"], x["s"], "stocks", "ndx", x["n"], None) for x in ndx if x["s"] not in already]

    def one(job):
        sid, sym, ac, kind, name, grp = job
        try:
            ser = nasdaq_series(sid, sym, ac, prev)
            save(os.path.join(out, "nasdaq", sid + ".json"), ser)
            note("nasdaq-" + kind)
            return kind, {"id": sid, "sym": sym, "n": name, "g": grp, "rows": len(ser["d"])}
        except Exception as e:  # noqa: BLE001
            note("nasdaq-" + kind, False, f"{sym}: {e}")
            return kind, None
        finally:
            time.sleep(0.25)
    with ThreadPoolExecutor(4) as ex:
        for kind, r in ex.map(one, jobs):
            if r and kind in ("etf", "idx"):
                meta[kind].append(r)
    save(os.path.join(out, "nasdaq_meta.json"), meta)


# ---------------------------------------------------------------- FRED, CBOE, CNN, crypto, Banque mondiale
def run_fred(out):
    def one(x):
        sid = x[0]
        try:
            b = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}", timeout=60)
            txt = b.decode("utf8", "replace")
            if "," not in txt.splitlines()[0]:
                raise ValueError("réponse inattendue")
            os.makedirs(os.path.join(out, "fred"), exist_ok=True)
            open(os.path.join(out, "fred", sid + ".csv"), "w", encoding="utf8").write(txt)
            note("fred")
        except Exception as e:  # noqa: BLE001
            note("fred", False, f"{sid}: {e}")
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, FRED))
    save(os.path.join(out, "fred_meta.json"), [{"id": a, "n": b, "g": c, "u": d} for a, b, c, d in FRED])


def run_cboe(out):
    for s in CBOE:
        try:
            txt = get(f"https://cdn.cboe.com/api/global/us_indices/daily_prices/{s}_History.csv").decode("utf8", "replace")
            os.makedirs(os.path.join(out, "cboe"), exist_ok=True)
            open(os.path.join(out, "cboe", s + ".csv"), "w", encoding="utf8").write(txt)
            note("cboe")
        except Exception as e:  # noqa: BLE001
            note("cboe", False, f"{s}: {e}")


def run_cnn(out):
    h = {"Accept": "application/json, text/plain, */*", "Referer": "https://edition.cnn.com/", "Origin": "https://edition.cnn.com"}
    for start in ("2020-07-15", "2021-01-01", "2023-01-01", None):
        url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata" + (f"/{start}" if start else "")
        try:
            j = json.loads(get(url, headers=h, tries=2))
            if j.get("fear_and_greed"):
                save(os.path.join(out, "cnn_fg.json"), j)
                note("cnn")
                return
        except Exception as e:  # noqa: BLE001
            note("cnn", False, f"{start}: {e}")


def run_crypto(out, prev):
    for sid, prod, first in CRYPTO:
        try:
            old = prev_series(prev, sid, "crypto")
            rows = {}
            start = dt.date.fromisoformat(first)
            if old and old.get("d") and len(old["d"]) > 300:
                for i, d in enumerate(old["d"]):
                    rows[d] = (d, old["o"][i], old["h"][i], old["l"][i], old["c"][i], (old.get("v") or [0] * len(old["d"]))[i])
                start = i2d(old["d"][-1]) - dt.timedelta(days=5)
            while start < TODAY:
                end = min(start + dt.timedelta(days=299), TODAY)
                url = (f"https://api.exchange.coinbase.com/products/{prod}/candles?granularity=86400"
                       f"&start={start.isoformat()}T00:00:00Z&end={end.isoformat()}T00:00:00Z")
                for t, lo, hi, op, cl, vol in json.loads(get(url, headers={"Accept": "application/json"})):
                    d = d2i(dt.datetime.fromtimestamp(t, dt.timezone.utc).date())
                    if d2i(TODAY) > d:  # jour en cours exclu (bougie incomplète)
                        rows[d] = (d, op, hi, lo, cl, int(vol))
                start = end + dt.timedelta(days=1)
                time.sleep(0.35)
            r = [rows[k] for k in sorted(rows)]
            save(os.path.join(out, "crypto", sid + ".json"), {"d": [x[0] for x in r], "o": [x[1] for x in r], "h": [x[2] for x in r],
                                                              "l": [x[3] for x in r], "c": [x[4] for x in r], "v": [x[5] for x in r]})
            note("coinbase")
        except Exception as e:  # noqa: BLE001
            note("coinbase", False, f"{sid}: {e}")


def run_wb(out):
    res = {"countries": {}, "ind": {}}
    cs = ";".join(UEMOA)
    for code, name, unit in WB:
        try:
            j = json.loads(get(f"https://api.worldbank.org/v2/country/{cs}/indicator/{code}?format=json&per_page=2000&date=1990:{TODAY.year}"))
            vals = {}
            for r in (j[1] if len(j) > 1 and j[1] else []):
                c = r.get("countryiso3code") or r["country"]["id"]
                res["countries"][c] = r["country"]["value"]
                if r.get("value") is not None:
                    vals.setdefault(c, {})[r["date"]] = r["value"]
            res["ind"][code] = {"n": name, "u": unit, "v": vals}
            note("worldbank")
        except Exception as e:  # noqa: BLE001
            note("worldbank", False, f"{code}: {e}")
        time.sleep(0.3)
    if res["ind"]:
        save(os.path.join(out, "worldbank.json"), res)


# ---------------------------------------------------------------- SEC XBRL
FLOW = {  # clé : (concepts us-gaap, concepts ifrs-full) par ordre de préférence
    "rev": (["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax",
             "SalesRevenueNet", "SalesRevenueGoodsNet", "SalesRevenueServicesNet", "RevenuesNetOfInterestExpense"], ["Revenue", "RevenueFromContractsWithCustomers"]),
    "cogs": (["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"], ["CostOfSales"]),
    "gp": (["GrossProfit"], ["GrossProfit"]),
    "opi": (["OperatingIncomeLoss"], ["ProfitLossFromOperatingActivities"]),
    "ni": (["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"], ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"]),
    "pti": (["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
             "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
             "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"], ["ProfitLossBeforeTax"]),
    "tax": (["IncomeTaxExpenseBenefit"], ["IncomeTaxExpenseContinuingOperations"]),
    "int": (["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"], ["FinanceCosts", "InterestExpense"]),
    "rnd": (["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"], ["ResearchAndDevelopmentExpense"]),
    "da": (["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization",
            "DepreciationAmortizationAndOther", "Depreciation"], ["DepreciationAndAmortisationExpense",
                                                                   "AdjustmentsForDepreciationAndAmortisationExpense"]),
    "sbc": (["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], ["AdjustmentsForSharebasedPayments"]),
    "ocf": (["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
            ["CashFlowsFromUsedInOperatingActivities"]),
    "capex": (["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements",
               "PaymentsToAcquireOtherPropertyPlantAndEquipment"], ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
                                                                     "PurchaseOfPropertyPlantAndEquipment"]),
    "capi": (["PaymentsToAcquireIntangibleAssets"], ["PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities"]),
    "acq": (["PaymentsToAcquireBusinessesNetOfCashAcquired"], ["CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities"]),
    "div": (["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], ["DividendsPaidClassifiedAsFinancingActivities"]),
    "buy": (["PaymentsForRepurchaseOfCommonStock"], ["PaymentsToAcquireOrRedeemEntitysShares"]),
}
INST = {
    "assets": (["Assets"], ["Assets"]),
    "ca": (["AssetsCurrent"], ["CurrentAssets"]),
    "cl": (["LiabilitiesCurrent"], ["CurrentLiabilities"]),
    "liab": (["Liabilities"], ["Liabilities"]),
    "eq": (["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], ["EquityAttributableToOwnersOfParent", "Equity"]),
    "cash": (["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"], ["CashAndCashEquivalents"]),
    "sti": (["MarketableSecuritiesCurrent", "ShortTermInvestments", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"], ["CurrentInvestments"]),
    "ltd": (["LongTermDebt", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities", "DebtInstrumentCarryingAmount"], []),
    "ltdnc": (["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable", "ConvertibleNotesPayable"],
              ["NoncurrentPortionOfNoncurrentBorrowings", "LongtermBorrowings", "NoncurrentBorrowings"]),
    "dcur": (["DebtCurrent", "LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"], ["CurrentBorrowings", "CurrentPortionOfNoncurrentBorrowings"]),
    "cp": (["CommercialPaper"], []),
    "stb": (["ShortTermBorrowings"], ["ShorttermBorrowings"]),
    "re": (["RetainedEarningsAccumulatedDeficit"], ["RetainedEarnings"]),
    "inv": (["InventoryNet"], ["Inventories"]),
    "ar": (["AccountsReceivableNetCurrent"], ["TradeAndOtherCurrentReceivables"]),
    "gw": (["Goodwill"], ["Goodwill"]),
}
SHARES = (["WeightedAverageNumberOfDilutedSharesOutstanding"], ["WeightedAverageNumberOfSharesOutstandingDiluted", "AdjustedWeightedAverageShares"])
SHARES_OUT = ["EntityCommonStockSharesOutstanding"]


def days(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def sec_pick(facts, tax, names, unit_kind):
    """Faits d'une liste de concepts : [(rang, start, end, val, filed)] dans l'unité monétaire dominante."""
    rows, unit = [], None
    node = facts.get(tax) or {}
    for rank, nm in enumerate(names):
        c = node.get(nm)
        if not c:
            continue
        units = c.get("units") or {}
        if unit_kind == "shares":
            u = "shares" if "shares" in units else None
        else:
            cands = [k for k in units if re.fullmatch(r"[A-Z]{3}", k)]
            u = "USD" if "USD" in cands else (max(cands, key=lambda k: len(units[k])) if cands else None)
        if not u:
            continue
        unit = unit or u
        if u != unit:
            continue
        for f in units[u]:
            if f.get("val") is None or not f.get("end"):
                continue
            rows.append((rank, f.get("start"), f["end"], float(f["val"]), f.get("filed", "")))
    return rows, unit


def by_period(rows):
    best = {}
    for rank, s, e, v, filed in rows:
        k = (s, e)
        if k not in best or (rank, -int(filed.replace("-", "") or 0)) < (best[k][0], -int(best[k][2].replace("-", "") or 0)):
            best[k] = (rank, v, filed)
    return {k: v[1] for k, v in best.items()}


def quarterize(per):
    """Valeurs trimestrielles discrètes : trimestres publiés directement, sinon différences des cumuls depuis le début d'exercice."""
    q, annual = {}, {}
    for (s, e), v in per.items():
        if not s:
            continue
        n = days(s, e)
        if 75 <= n <= 105:
            q[e] = v
        if 350 <= n <= 380:
            annual[e] = v
    by_s = {}
    for (s, e), v in per.items():
        if not s:
            continue
        n = days(s, e)
        b = round(n / 91.3)
        if b in (1, 2, 3, 4) and abs(n - b * 91.3) <= 22:
            by_s.setdefault(s, {})[b] = (e, v)
    for s, cum in by_s.items():
        for b in (2, 3, 4):
            if b in cum and b - 1 in cum and cum[b][0] not in q:
                q[cum[b][0]] = cum[b][1] - cum[b - 1][1]
    return q, annual


def ttm(q):
    ends = sorted(q)
    out = {}
    for i in range(3, len(ends)):
        if 250 <= days(ends[i - 3], ends[i]) <= 300:
            out[ends[i]] = q[ends[i - 3]] + q[ends[i - 2]] + q[ends[i - 1]] + q[ends[i]]
    return out


def sec_company(cik, t, facts_json):
    facts = facts_json.get("facts") or {}
    tax = "us-gaap" if "us-gaap" in facts else ("ifrs-full" if "ifrs-full" in facts else None)
    if not tax:
        return None
    ti = 0 if tax == "us-gaap" else 1
    ccy = None
    flows_q, flows_a = {}, {}
    for k, names in FLOW.items():
        rows, u = sec_pick(facts, tax, names[ti], "money")
        if not rows:
            continue
        if k in ("rev", "ni", "ocf"):
            ccy = ccy or u
        q, a = quarterize(by_period(rows))
        flows_q[k], flows_a[k] = q, a
    inst = {}
    for k, names in INST.items():
        rows, _ = sec_pick(facts, tax, names[ti], "money")
        if rows:
            per = by_period(rows)
            inst[k] = {e: v for (s, e), v in per.items()}
    rows, _ = sec_pick(facts, tax, SHARES[ti], "shares")
    shd = {}
    if rows:
        best = {}
        for rank, s, e, v, filed in rows:  # durée la plus courte = trimestre
            n = days(s, e) if s else 999
            key = (rank, n, -int(filed.replace("-", "") or 0))
            if e not in best or key < best[e][0]:
                best[e] = (key, v)
        shd = {e: x[1] for e, x in best.items()}
    rows, _ = sec_pick(facts, "dei", SHARES_OUT, "shares")
    sho = by_period(rows) if rows else {}
    sho_last = None
    if sho:
        e = max(e for (_, e) in sho)
        sho_last = (e, sum(v for (s, ee), v in sho.items() if ee == e))
    ttms = {k: ttm(q) for k, q in flows_q.items()}
    ends = sorted(set(ttms.get("rev", {})) | set(ttms.get("ni", {})) | set(ttms.get("ocf", {})))
    annual_mode = len(ends) < 4
    if annual_mode:  # émetteurs étrangers (20-F) : exercices annuels seulement
        ends = sorted(set(flows_a.get("rev", {})) | set(flows_a.get("ni", {})))
        ttms = flows_a
    ends = ends[-48:]

    def near(m, e, tol=12):
        if e in m:
            return m[e]
        best = None
        for k, v in m.items():
            dd = abs(days(k, e))
            if dd <= tol and (best is None or dd < best[0]):
                best = (dd, v)
        return best[1] if best else None
    res = {"t": t, "cik": cik, "name": facts_json.get("entityName"), "tax": tax, "ccy": ccy or "USD", "annual_only": annual_mode, "q": ends,
           "ttm": {k: [near(m, e, 5) for e in ends] for k, m in ttms.items() if m},
           "bs": {k: [near(m, e) for e in ends] for k, m in inst.items() if m},
           "shd": [near(shd, e, 15) for e in ends] if shd else None, "sho": sho_last}
    ya = sorted(set(flows_a.get("rev", {})) | set(flows_a.get("ni", {})) | set(flows_a.get("ocf", {})))[-16:]
    res["y"] = ya
    res["a"] = {k: [near(m, e, 5) for e in ya] for k, m in flows_a.items() if m}
    res["abs"] = {k: [near(m, e) for e in ya] for k, m in inst.items() if m}
    for blk in ("ttm", "bs", "a", "abs"):
        res[blk] = {k: [None if v is None else round(v) for v in arr] for k, arr in res[blk].items() if any(v is not None for v in arr)}
    if res["shd"]:
        res["shd"] = [None if v is None else round(v) for v in res["shd"]]
    return res


def run_sec(out, prev, max_age_days):
    cache = None
    if os.path.exists(os.path.join(out, "secfacts.json")):
        try:
            cache = json.load(open(os.path.join(out, "secfacts.json"), encoding="utf8"))
        except Exception:  # noqa: BLE001
            cache = None
    nd = os.path.join(out, "nasdaq_meta.json")
    ndx = [x["s"] for x in json.load(open(nd, encoding="utf8")).get("ndx", [])] if os.path.exists(nd) else []
    wanted = sorted({s for s, _, typ, _ in US if typ == "Equity"} | set(ndx))
    if cache and (time.time() - cache.get("ts", 0)) < max_age_days * 86400 and set(wanted) <= set(cache.get("co", {})) | set(cache.get("missing", [])):
        save(os.path.join(out, "secfacts.json"), cache)
        log("SEC : cache récent conservé", len(cache.get("co", {})))
        note("sec-cache")
        return
    h = {"User-Agent": SEC_UA, "Accept-Encoding": "gzip", "Accept": "application/json"}
    try:
        tick = json.loads(get("https://www.sec.gov/files/company_tickers.json", headers=h))
    except Exception as e:  # noqa: BLE001
        note("sec", False, f"company_tickers: {e}")
        if cache:
            save(os.path.join(out, "secfacts.json"), cache)
        return
    cikmap = {}
    for v in tick.values():
        cikmap.setdefault(v["ticker"].upper(), v["cik_str"])
    res = {"ts": int(time.time()), "co": {}, "missing": []}

    def one(t):
        cik = cikmap.get(t) or cikmap.get(t.replace(".", "-"))
        if not cik:
            return t, None, "CIK introuvable"
        try:
            j = json.loads(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json", headers=h, timeout=90))
            time.sleep(0.25)
            return t, sec_company(cik, t, j), None
        except Exception as e:  # noqa: BLE001
            return t, None, str(e)
    with ThreadPoolExecutor(3) as ex:
        for t, r, err in ex.map(one, wanted):
            if r:
                res["co"][t] = r
                note("sec")
            else:
                res["missing"].append(t)
                note("sec", False, f"{t}: {err}")
                if cache and t in cache.get("co", {}):
                    res["co"][t] = cache["co"][t]
    save(os.path.join(out, "secfacts.json"), res)


# ---------------------------------------------------------------- consensus des analystes (Nasdaq)
def us_equities(out):
    nd = os.path.join(out, "nasdaq_meta.json")
    ndx = [x["s"] for x in json.load(open(nd, encoding="utf8")).get("ndx", [])] if os.path.exists(nd) else []
    return sorted({s for s, _, typ, _ in US if typ == "Equity"} | set(ndx))


def run_analyst(out):
    """Résumé (PER prévisionnel, objectif de cours), prévisions de BPA (révisions), surprises, date des résultats.
    Les surprises et les instantanés du consensus s'accumulent d'un jour à l'autre (historique des révisions)."""
    path = os.path.join(out, "analyst.json")
    old = json.load(open(path, encoding="utf8")) if os.path.exists(path) else {}
    today = TODAY.isoformat()

    def one(sym):
        rec = {"ts": today}
        for key, url in (("sum", f"https://api.nasdaq.com/api/quote/{sym}/summary?assetclass=stocks"),
                         ("fc", f"https://api.nasdaq.com/api/analyst/{sym}/earnings-forecast"),
                         ("sur", f"https://api.nasdaq.com/api/company/{sym}/earnings-surprise"),
                         ("ed", f"https://api.nasdaq.com/api/analyst/{sym}/earnings-date"),
                         ("tp", f"https://api.nasdaq.com/api/analyst/{sym}/targetprice")):
            try:
                j = json.loads(get(url, headers=NQ_H, tries=2, timeout=30))
                rec[key] = j.get("data")
            except Exception as e:  # noqa: BLE001
                rec[key] = None
                note("nasdaq-analyst", False, f"{sym} {key}: {e}")
            time.sleep(0.15)
        return sym, rec
    res = {}
    with ThreadPoolExecutor(4) as ex:
        for sym, rec in ex.map(one, us_equities(out)):
            prev = old.get(sym) or {}
            # surprises : on garde tous les trimestres déjà vus
            hist = {r["q"]: r for r in prev.get("surh", [])}
            for r in (find_rows((rec.get("sur") or {}).get("earningsSurpriseTable") or {}) or []):
                q = r.get("fiscalQtrEnd")
                if q:
                    hist[q] = {"q": q, "d": r.get("dateReported"), "eps": money(r.get("eps")), "cons": money(r.get("consensusForecast")),
                               "pct": money(r.get("percentageSurprise"))}
            rec["surh"] = sorted(hist.values(), key=lambda r: r.get("d") or "")
            # instantané quotidien du consensus annuel (pour suivre les révisions)
            snaps = [x for x in prev.get("snap", []) if x[0] != today][-400:]
            yrows = find_rows(((rec.get("fc") or {}).get("yearlyForecast")) or {}) or []
            if yrows:
                snaps.append([today] + [[r.get("fiscalEnd"), money(r.get("consensusEPSForecast")), money(r.get("noOfEstimates"))] for r in yrows[:3]])
            rec["snap"] = snaps
            ok = any(rec.get(k) for k in ("sum", "fc", "sur"))
            if not ok and prev:
                rec = {**prev, "stale": True}
            res[sym] = rec
            note("nasdaq-analyst", ok, None if ok else f"{sym}: vide")
    save(path, res)


# ---------------------------------------------------------------- BRVM : bulletin officiel de la cote (PER du marché)
def pdftext(b):
    import subprocess, tempfile
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(b)
        f.flush()
        r = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, timeout=120)
    return r.stdout.decode("utf8", "replace")


def frnum(tok):
    t = tok.replace("\xa0", " ").replace(" ", " ").strip()
    t = re.sub(r"(?<=\d)[ .](?=\d{3}\b)", "", t).replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


NUMTOK = re.compile(r"-?\d{1,3}(?:[  \xa0.]\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?")


def boc_parse(txt):
    out = {}
    pats = {"per": r"PER moyen du march", "rdt": r"Taux de rendement moyen du march", "rent": r"Taux de rentabilit[ée] moyen du march",
            "prime": r"Prime de risque du march", "cap": r"Capitalisation boursi[èe]re \(FCFA\)\s*\(Actions"}
    lines = txt.splitlines()
    for k, pat in pats.items():
        for i, ln in enumerate(lines):
            m = re.search(pat, ln, re.I)
            if not m:
                continue
            rest = re.sub(r"\(\*+\)", " ", ln[m.end():])
            rest = re.sub(r"\([^)]*\)", " ", rest)
            nums = [frnum(x) for x in NUMTOK.findall(rest)]
            nums = [x for x in nums if x is not None]
            if not nums and i + 1 < len(lines):
                nums = [x for x in (frnum(y) for y in NUMTOK.findall(lines[i + 1])) if x is not None]
            if nums:
                out[k] = nums[0]
                break
    for k, lo, hi in (("per", 2, 80), ("rdt", 0.1, 30), ("rent", 0.1, 40), ("prime", -20, 30)):
        if k in out and not (lo <= out[k] <= hi):
            out.pop(k)
    return out


def run_boc(out):
    import calendar
    path = os.path.join(out, "boc.json")
    db = json.load(open(path, encoding="utf8")) if os.path.exists(path) else {"d": {}, "miss": []}
    miss = set(db.get("miss", []))

    def try_day(d):
        k = d.strftime("%Y%m%d")
        for url in (f"https://bfin.brvm.org/boc/BOC_JOUR/BOC_{k}.pdf", f"https://www.brvm.org/sites/default/files/boc_{k}_2.pdf",
                    f"https://www.brvm.org/sites/default/files/boc_{k}.pdf"):
            try:
                b = get(url, tries=1, timeout=40)
                if b[:4] != b"%PDF":
                    continue
                txt = pdftext(b)
                rec = boc_parse(txt)
                if rec:
                    rec["u"] = url
                    return k, rec, txt
            except Exception:  # noqa: BLE001
                continue
        return k, None, None
    # derniers jours ouvrés
    latest_txt = None
    for back in range(0, 8):
        d = TODAY - dt.timedelta(days=back)
        if d.weekday() >= 5 or d.strftime("%Y%m%d") in db["d"]:
            continue
        k, rec, txt = try_day(d)
        if rec:
            db["d"][k] = rec
            latest_txt = latest_txt or txt
            note("boc")
    # rattrapage : un bulletin par mois (premiers jours ouvrés) depuis 2012, 30 mois par passage
    have_m = {k[:6] for k in db["d"]}
    todo = []
    y, m = 2012, 1
    while (y, m) <= (TODAY.year, TODAY.month):
        km = f"{y}{m:02d}"
        if km not in have_m and km not in miss:
            todo.append((y, m))
        m += 1
        if m > 12:
            y, m = y + 1, 1
    todo = todo[::-1][:30]

    def month(ym):
        y, m = ym
        for day in range(1, min(10, calendar.monthrange(y, m)[1]) + 1):
            d = dt.date(y, m, day)
            if d.weekday() >= 5 or d > TODAY:
                continue
            k, rec, txt = try_day(d)
            if rec:
                return ym, k, rec, txt
        return ym, None, None, None
    with ThreadPoolExecutor(3) as ex:
        for (y, m), k, rec, txt in ex.map(month, todo):
            if rec:
                db["d"][k] = rec
                latest_txt = latest_txt or txt
                note("boc-hist")
            elif (y, m) < (TODAY.year, TODAY.month):
                miss.add(f"{y}{m:02d}")
                note("boc-hist", False, f"{y}-{m:02d}: aucun bulletin lisible")
    db["miss"] = sorted(miss)
    db["d"] = dict(sorted(db["d"].items()))
    save(path, db)
    if latest_txt:
        os.makedirs(os.path.join(out, "debug"), exist_ok=True)
        open(os.path.join(out, "debug", "boc_sample.txt"), "w", encoding="utf8").write(latest_txt[:20000])


# ---------------------------------------------------------------- sondes (PER prévisionnel, archives SikaFinance)
def run_probe(out):
    """Pages brutes enregistrées dans debug/ pour écrire les analyseurs (sources de PER prévisionnel, archives)."""
    dd = os.path.join(out, "debug")
    os.makedirs(dd, exist_ok=True)
    pages = {
        "ms_search_sonatel": "https://www.marketscreener.com/search/?q=sonatel",
        "ms_sonatel": "https://www.marketscreener.com/quote/stock/SONATEL-SA-6500147/",
        "ms_sonatel_fin": "https://www.marketscreener.com/quote/stock/SONATEL-SA-6500147/finances/",
        "valora_home": "https://www.valora-intelligence.com/",
        "afm_brvm": "https://www.african-markets.com/fr/bourse/brvm",
        "afm_brvm_cos": "https://www.african-markets.com/fr/bourse/brvm/listed-companies",
        "richbourse": "https://www.richbourse.com/common/apprendre/details/per",
        "sika_snts": "https://www.sikafinance.com/marches/societe/SNTS.sn",
        "sika_pro_snts": "https://pro.sikafinance.com/finance/SNTS.sn",
    }
    for k, url in pages.items():
        try:
            b = get(url, tries=2, timeout=40, headers={"Accept": "text/html,application/xhtml+xml"})
            open(os.path.join(dd, k + ".html"), "wb").write(b[:1_500_000])
            note("probe")
        except Exception as e:  # noqa: BLE001
            note("probe", False, f"{k}: {e}")
    cdx = {}
    for t in ("SNTS", "SGBC", "ORAC", "SIBC"):
        for pat in (f"sikafinance.com/marches/societe/{t}*", f"sikafinance.com/marches/cotation_{t}*", f"pro.sikafinance.com/finance/{t}*"):
            try:
                url = ("http://web.archive.org/cdx/search/cdx?url=" + urllib.parse.quote(pat, safe="*/") +
                       "&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=timestamp:6&limit=200")
                cdx[pat] = json.loads(get(url, tries=2, timeout=60) or b"[]")
                note("probe-wayback")
            except Exception as e:  # noqa: BLE001
                note("probe-wayback", False, f"{pat}: {e}")
            time.sleep(1)
    save(os.path.join(dd, "wayback_cdx.json"), cdx)
    # un instantané ancien de chaque motif trouvé
    for pat, rows in cdx.items():
        rows = [r for r in rows[1:] if r and r[0][:4] in ("2016", "2017", "2018", "2019", "2020")] if rows else []
        if not rows:
            continue
        ts, orig = rows[len(rows) // 2][0], rows[len(rows) // 2][1]
        try:
            b = get(f"http://web.archive.org/web/{ts}id_/{orig}", tries=2, timeout=60)
            open(os.path.join(dd, "wb_" + re.sub(r"\W", "_", pat)[:40] + f"_{ts}.html"), "wb").write(b[:1_500_000])
        except Exception as e:  # noqa: BLE001
            note("probe-wayback", False, f"snapshot {pat}: {e}")
        time.sleep(1)


# ---------------------------------------------------------------- actualités (RSS)
NEWS = [  # id, libellé, url, catégorie
    ("gn-brvm", "Google Actualités", "https://news.google.com/rss/search?q=BRVM&hl=fr&gl=FR&ceid=FR:fr", "BRVM"),
    ("gn-bourse-abidjan", "Google Actualités", "https://news.google.com/rss/search?q=%22Bourse+r%C3%A9gionale%22+OR+%22bourse+d%27Abidjan%22+OR+Sonatel+OR+%22Orange+C%C3%B4te+d%27Ivoire%22+OR+SGBCI+OR+%22Ecobank+Transnational%22&hl=fr&gl=FR&ceid=FR:fr", "BRVM"),
    ("gn-uemoa", "Google Actualités", "https://news.google.com/rss/search?q=BCEAO+OR+UEMOA+OR+%22UMOA-Titres%22&hl=fr&gl=FR&ceid=FR:fr", "UEMOA"),
    ("financialafrik", "Financial Afrik", "https://www.financialafrik.com/feed/", "Afrique"),
    ("allafrica-eco", "allAfrica", "https://fr.allafrica.com/tools/headlines/rdf/business/headlines.rdf", "Afrique"),
    ("ecofin", "Agence Ecofin", "https://www.agenceecofin.com/finance?format=feed&type=rss", "Afrique"),
    ("gn-marches", "Google Actualités", "https://news.google.com/rss/search?q=%22march%C3%A9s+financiers%22+OR+%22Wall+Street%22+OR+%22CAC+40%22&hl=fr&gl=FR&ceid=FR:fr", "Marchés"),
    ("lesechos", "Les Echos", "https://syndication.lesechos.fr/rss/rss_finance-marches.xml", "Marchés"),
    ("investing-fr", "Investing.com", "https://fr.investing.com/rss/news.rss", "Marchés"),
    ("cnbc-markets", "CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", "Marchés"),
    ("cnbc-top", "CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", "Marchés"),
    ("marketwatch", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "Marchés"),
    ("yahoo", "Yahoo Finance", "https://finance.yahoo.com/news/rssindex", "Marchés"),
    ("gn-tech", "Google Actualités", "https://news.google.com/rss/search?q=Nasdaq+OR+Nvidia+OR+semiconductors+stocks&hl=en-US&gl=US&ceid=US:en", "Tech US"),
    ("fed", "Réserve fédérale", "https://www.federalreserve.gov/feeds/press_all.xml", "Banques centrales"),
    ("ecb", "BCE", "https://www.ecb.europa.eu/rss/press.html", "Banques centrales"),
    ("gn-bceao", "Google Actualités", "https://news.google.com/rss/search?q=BCEAO+taux+directeur+OR+%22politique+mon%C3%A9taire%22+BCEAO&hl=fr&gl=FR&ceid=FR:fr", "Banques centrales"),
    ("gn-matieres", "Google Actualités", "https://news.google.com/rss/search?q=cacao+OR+%22prix+du+p%C3%A9trole%22+OR+%22cours+de+l%27or%22&hl=fr&gl=FR&ceid=FR:fr", "Matières premières"),
]


def parse_feed(b):
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    b = re.sub(rb"^\s+", b"", b)
    root = ET.fromstring(b)
    items = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        g = {}
        for ch in it:
            ct = ch.tag.split("}")[-1]
            if ct == "link" and ch.get("href"):
                g.setdefault("link", ch.get("href"))
            elif ct in ("title", "link", "pubDate", "published", "updated", "date", "description", "summary", "source"):
                g.setdefault(ct, (ch.text or "").strip())
        t = None
        for k in ("pubDate", "published", "updated", "date"):
            if g.get(k):
                try:
                    t = parsedate_to_datetime(g[k])
                except Exception:  # noqa: BLE001
                    try:
                        t = dt.datetime.fromisoformat(g[k].replace("Z", "+00:00"))
                    except Exception:  # noqa: BLE001
                        t = None
                if t:
                    break
        if not g.get("title") or not t:
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        title = re.sub(r"\s+", " ", g["title"])
        src = g.get("source") or ""
        if "news.google" in (g.get("link") or "") and " - " in title:
            head, tail = title.rsplit(" - ", 1)
            if not src or tail.strip() == src.strip():
                title, src = head, src or tail
        desc = re.sub(r"<[^>]+>", " ", g.get("description") or g.get("summary") or "")
        desc = re.sub(r"\s+", " ", desc).strip()[:280]
        items.append({"t": int(t.timestamp()), "ti": title[:300], "u": g.get("link"), "s": src[:60], "x": desc if desc and desc[:60] not in title else ""})
    return items


def run_news(path):
    old = []
    if os.path.exists(path):
        try:
            old = json.load(open(path, encoding="utf8")).get("items", [])
        except Exception:  # noqa: BLE001
            old = []
    seen, items = set(), []

    def one(f):
        fid, label, url, cat = f
        try:
            its = parse_feed(get(url, tries=2, timeout=25, headers={"Accept": "application/rss+xml, application/xml, text/xml, */*"}))
            for x in its:
                x["c"] = cat
                x["f"] = fid
                x["s"] = x["s"] or label
            note("news")
            return its
        except Exception as e:  # noqa: BLE001
            note("news", False, f"{fid}: {e}")
            return []
    with ThreadPoolExecutor(6) as ex:
        fresh = [x for lst in ex.map(one, NEWS) for x in lst]
    cutoff = time.time() - 45 * 86400
    for x in sorted(fresh + old, key=lambda x: -x["t"]):
        k = re.sub(r"[^a-z0-9]", "", x["ti"].lower())[:90]
        if k in seen or x["t"] < cutoff or x["t"] > time.time() + 3600:
            continue
        seen.add(k)
        items.append(x)
    save(path, {"ts": int(time.time()), "items": items[:900], "feeds": {f[0]: f[1] for f in NEWS}})


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="dossier brut (branche quant-raw), lu et réécrit sur place")
    ap.add_argument("--only", default="nasdaq,fred,cboe,cnn,crypto,wb,sec,analyst,boc,probe")
    ap.add_argument("--news", default=None, help="fichier news.json à mettre à jour (mode séance)")
    ap.add_argument("--sec-max-age-days", type=float, default=6)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    only = set(a.only.split(",")) if a.only else set()
    t0 = time.time()
    steps = [("nasdaq", lambda: run_nasdaq(a.out, a.out)), ("fred", lambda: run_fred(a.out)), ("cboe", lambda: run_cboe(a.out)),
             ("cnn", lambda: run_cnn(a.out)), ("crypto", lambda: run_crypto(a.out, a.out)), ("wb", lambda: run_wb(a.out)),
             ("sec", lambda: run_sec(a.out, a.out, a.sec_max_age_days)), ("analyst", lambda: run_analyst(a.out)),
             ("boc", lambda: run_boc(a.out)), ("probe", lambda: run_probe(a.out))]
    if a.news:
        steps.insert(0, ("news", lambda: run_news(a.news)))
        only.add("news")
    for name, fn in steps:
        if name not in only:
            continue
        t = time.time()
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            note(name, False, f"étape interrompue : {e}")
        log(f"{name}: {time.time() - t:.0f} s", json.dumps({k: (v['ok'], v['err']) for k, v in REPORT.items()}))
    REPORT["_"] = {"ts": int(time.time()), "secs": round(time.time() - t0)}
    rp = os.path.join(a.out, "report_news.json" if only == {"news"} else "report.json")
    save(rp, REPORT)
    log(f"terminé en {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
