#!/usr/bin/env python3
"""Lecteurs des sources publiques de la BRVM. Bibliothèque standard uniquement.

Chaque lecteur renvoie des données normalisées (montants en FCFA, dates ISO) :
  BRVM (brvm.org)      cours du jour, indices, avis, dividendes, rapports, bulletin officiel (BOC)
  SikaFinance          cours et indices du jour, historique quotidien, comptes, dividendes
  OuestBourse          cours du jour, comptes récents (dont flux de trésorerie), dividendes
  African Markets      cours (avec un décalage de quelques séances, sert de contrôle)
RicheBourse bloque les robots par un captcha : elle n'est pas interrogée.

Règles de politesse : identifiant navigateur, une requête à la fois, pause entre deux requêtes
(10 s pour brvm.org comme demandé par son robots.txt), aucune page interdite par robots.txt.
"""
import datetime as dt
import html
import json
import re
import time
import unicodedata
import urllib.request
from html.parser import HTMLParser

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
BRVM = "https://www.brvm.org"
SIKA = "https://www.sikafinance.com"
SIKA_PRO = "https://pro.sikafinance.com"
OUEST = "https://ouestbourse.com"
AFM = "https://www.african-markets.com/en/stock-markets/brvm/listed-companies"
PAUSE = {"www.brvm.org": 10.0, "www.sikafinance.com": 1.0, "pro.sikafinance.com": 1.5, "ouestbourse.com": 1.5, "www.african-markets.com": 2.0}
_last = {}
MOIS = {m: i for i, m in enumerate(["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre",
                                     "octobre", "novembre", "decembre"], 1)}
MOIS_COURT = {"janv": 1, "fevr": 2, "mars": 3, "avr": 4, "mai": 5, "juin": 6, "juil": 7, "aout": 8, "sept": 9, "oct": 10, "nov": 11, "dec": 12}


# ----------------------------------------------------------------------------- outils
def fetch(url, data=None, timeout=60, binary=False):
    host = re.sub(r"^https?://([^/]+).*$", r"\1", url)
    wait = PAUSE.get(host, 1.0) - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    headers = {"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"}
    if data is not None:
        headers.update({"Content-Type": "application/json", "Accept": "application/json", "Origin": SIKA})
        data = json.dumps(data).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    finally:
        _last[host] = time.time()
    return raw if binary else raw.decode("utf-8", "replace")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper()
    s = s.replace("&", " ET ").replace("'", " ").replace("’", " ")
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = html.unescape(str(s))
    s = re.sub(r"[\s  ]", "", s).replace("FCFA", "").replace("XOF", "").replace("%", "").replace("x", "")
    if s in ("", "-", "--", "NC", "n.d."):
        return None
    if s.count(",") == 1 and s.count(".") == 0:
        s = s.replace(",", ".")
    elif s.count(",") >= 1 and s.count(".") >= 1:
        s = s.replace(".", "").replace(",", ".")
    if s.startswith(","):
        s = "0" + s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def date_fr(s):
    """'27 octobre 2026', '26-mai-26', '09/10/2026' -> 'YYYY-MM-DD'."""
    if not s:
        return None
    t = norm(s).lower()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s.strip())
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    m = re.match(r"(\d{1,2})(?:er)? ([a-z]+) (\d{4})", t)
    if m and m.group(2) in MOIS:
        return f"{m.group(3)}-{MOIS[m.group(2)]:02d}-{int(m.group(1)):02d}"
    m = re.match(r"(\d{1,2}) ([a-z]+) (\d{2})$", t)
    if m:
        mo = next((v for k, v in MOIS_COURT.items() if m.group(2).startswith(k)), None)
        if mo:
            return f"20{m.group(3)}-{mo:02d}-{int(m.group(1)):02d}"
    return None


class _Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cur, self.cell, self.links, self.in_cell = [], None, [], [], False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "tr":
            self.cur, self.links = [], []
        elif tag in ("td", "th") and self.cur is not None:
            self.in_cell, self.cell = True, []
        elif tag == "a" and self.cur is not None and a.get("href"):
            self.links.append(a["href"])

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cur is not None and self.in_cell:
            self.cur.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.in_cell = False
        elif tag == "tr" and self.cur is not None:
            if self.cur:
                self.rows.append((self.cur, self.links))
            self.cur = None

    def handle_data(self, d):
        if self.in_cell:
            self.cell.append(d)


def rows(page):
    p = _Rows()
    p.feed(page)
    return p.rows


def text(page):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page)))


class Registry:
    """Reconnaît un titre à partir d'un nom, d'un code SikaFinance ou d'un lien."""

    def __init__(self, path):
        self.items = json.load(open(path, encoding="utf-8"))["titres"]
        self.by_t = {r["t"]: r for r in self.items}
        self.alias = {}
        for r in self.items:
            for a in r.get("aliases", []) + [norm(r["nom"]), norm(r.get("nom_officiel") or "")]:
                if a:
                    self.alias.setdefault(a, r["t"])

    def find(self, name="", url=""):
        n = re.sub(r" (S ?A|SA|PLC)$", "", norm(name))
        if n in self.alias:
            return self.alias[n]
        head = norm(re.split(r"\s[:–-]\s", name or "")[0])  # « SONATEL SN : Etats financiers… »
        if head in self.alias:
            return self.alias[head]
        if url:  # nom de fichier de l'avis : « ..._-_coris_bank_burkina_faso.pdf »
            u = " " + norm(re.sub(r".*/", "", url).rsplit(".", 1)[0].replace("_", " ").replace("-", " ")) + " "
            best = None
            for a, t in self.alias.items():
                if len(a) >= 5 and (" " + a + " ") in u and (best is None or len(a) > len(best[0])):
                    best = (a, t)
            if best:
                return best[1]
            for tok in re.findall(r"[a-z0-9]+", re.sub(r".*/", "", url).lower()):  # code du titre dans le nom du fichier
                tok = re.sub(r"\d+$", "", tok).upper()
                if tok in self.by_t and len(tok) >= 4:
                    return tok
        return None


# ----------------------------------------------------------------------------- BRVM
INDEX_NAMES = {"BRVM-C": "BRVMC", "BRVM - COMPOSITE": "BRVMC", "BRVM-30": "BRVM30", "BRVM 30": "BRVM30", "BRVM-PRES": "BRVMPR",
               "BRVM - PRESTIGE": "BRVMPR", "BRVM - PRINCIPAL": "BRVMPA", "BRVM - CONSOMMATION DE BASE": "BRVM_CB",
               "BRVM - CONSOMMATION DISCRETIONNAIRE": "BRVM_CD", "BRVM - ENERGIE": "BRVM_EN", "BRVM - INDUSTRIELS": "BRVM_IN",
               "BRVM - SERVICES FINANCIERS": "BRVM_SF", "BRVM - SERVICES PUBLICS": "BRVM_SP", "BRVM - TELECOMMUNICATIONS": "BRVM_TEL"}
# l'horodatage de brvm.org est affiché 7 h en avance sur l'heure d'Abidjan (GMT)
BRVM_PAGE_OFFSET_H = 7


def brvm_cours(page):
    cours, marche, indices = {}, {}, {}
    for cells, _ in rows(page):
        if len(cells) >= 7 and re.fullmatch(r"[A-Z]{3,6}", cells[0] or ""):
            vol, veille, ouv, clo, var = (num(x) for x in cells[2:7])
            if clo:
                cours[cells[0]] = {"nom": cells[1], "volume": int(vol or 0), "veille": veille, "ouverture": ouv or None, "dernier": clo, "variation": var}
            continue
        lab = (cells[0] or "").lower()
        if lab.startswith("valeur des transactions") and len(cells) > 1:
            marche["valeur_transactions"] = num(cells[1])
        elif lab.startswith("capitalisation actions") and len(cells) > 1:
            marche["capitalisation_actions"] = num(cells[1])
        elif cells[0] in INDEX_NAMES and len(cells) >= 2 and num(cells[1]) is not None and len(cells) <= 4:
            indices.setdefault(INDEX_NAMES[cells[0]], {"valeur": num(cells[1]), "variation": num(cells[2]) if len(cells) > 2 else None})
    t = text(page)
    maj = None
    m = re.search(r"Derni[eè]re mise [àa] jour\s*:\s*\w+,?\s*(\d{1,2})\s+(\w+),?\s*(\d{4})\s*-\s*(\d{1,2}):(\d{2})", t, re.I)
    if m:
        mo = MOIS.get(norm(m.group(2)).lower())
        if mo:
            maj = dt.datetime(int(m.group(3)), mo, int(m.group(1)), int(m.group(4)), int(m.group(5))) - dt.timedelta(hours=BRVM_PAGE_OFFSET_H)
    etat = "Ouverte" if re.search(r"S[ée]ance ouverte", t, re.I) else "Fermée" if re.search(r"S[ée]ance ferm[ée]e", t, re.I) else None
    return {"cours": cours, "marche": marche, "indices": indices, "maj": maj.strftime("%Y-%m-%dT%H:%M") if maj else None,
            "date": maj.strftime("%Y-%m-%d") if maj else None, "etat": etat}


def brvm_indices(page):
    out = {}
    for cells, _ in rows(page):
        if len(cells) >= 4 and cells[0] in INDEX_NAMES and num(cells[2]) is not None:
            out[INDEX_NAMES[cells[0]]] = {"precedent": num(cells[1]), "valeur": num(cells[2]), "variation": num(cells[3]),
                                          "ytd": num(cells[4]) if len(cells) > 4 else None}
    return out


def brvm_dividends(page, reg):
    out = []
    for cells, links in rows(page):
        if len(cells) >= 7 and re.fullmatch(r"\d{4}", cells[3] or "") and links:
            url = next((l for l in links if l.lower().endswith(".pdf")), links[0])
            t = reg.find(cells[0] or cells[2] or "", url)
            out.append({"t": t, "emetteur": cells[0], "ex": int(cells[3]), "pay": date_fr(cells[4]), "det": date_fr(cells[5]),
                        "net": num(cells[6]), "url": url if url.startswith("http") else BRVM + url, "src": "brvm"})
    return out


def brvm_listing(page):
    """Listes d'avis (« Titre | Date | Télécharger ») et de rapports (« Titre | Télécharger »)."""
    out = []
    for cells, links in rows(page):
        pdf = next((l for l in links if ".pdf" in l.lower()), None)
        if not pdf or not cells or not cells[0]:
            continue
        d = date_fr(cells[1]) if len(cells) > 1 else None
        if not d:
            m = re.search(r"/(\d{4})(\d{2})(\d{2})", pdf)
            d = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None
        out.append({"titre": cells[0], "date": d, "url": pdf if pdf.startswith("http") else BRVM + pdf})
    return out


def brvm_last_page(page):
    pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", page)]
    return max(pages) if pages else 0


def brvm_boc_list(page):
    out = []
    for cells, links in rows(page):
        pdf = next((l for l in links if "boc" in l.lower() and l.lower().endswith(".pdf")), None)
        if pdf:
            m = re.search(r"boc_(?:eng_)?(\d{8})", pdf)
            if m:
                d = m.group(1)
                out.append({"date": f"{d[:4]}-{d[4:6]}-{d[6:]}", "url": pdf if pdf.startswith("http") else BRVM + pdf, "eng": "_eng_" in pdf})
    return out


def boc_parse(txt):
    """Texte de pdftotext -layout du Bulletin officiel de la cote.
    Ligne d'action : Symbole | Titre | Précédent | Ouverture | Clôture | Var. jour | Volume | Valeur | Cours de réf. | Var. annuelle | Dividende net | Date de paiement | Rendement | PER"""
    cours, indices = {}, {}
    m = re.search(r"(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+([a-zéû]+)\s+(\d{4})", txt, re.I)
    date = date_fr(f"{m.group(2)} {m.group(3)} {m.group(4)}") if m else None
    lines = txt.splitlines()
    for i, ln in enumerate(lines):
        f = [x for x in re.split(r"\s{2,}", ln.strip()) if x]
        if len(f) < 9 or not re.fullmatch(r"[A-Z]{3,6}", f[0]) or not re.fullmatch(r"-?[\d,]+\s*%", f[5]):
            continue
        prev, ouv, clo, var, vol, val = num(f[2]), num(f[3]), num(f[4]), num(f[5]), num(f[6]), num(f[7])
        if clo is None or vol is None:
            continue
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        tail_num = re.search(r"(\d{1,3})$", nxt)
        if val is not None and tail_num and vol and clo:  # valeur coupée sur la ligne suivante
            cand = val * 1000 + num(tail_num.group(1))
            if abs(cand - vol * clo) < abs(val - vol * clo):
                val = cand
        rec = {"veille": prev, "ouverture": ouv or None, "dernier": clo, "variation": var, "volume": int(vol), "valeur": val}
        rest = f[8:]
        if len(rest) >= 2:
            rec["ref"] = num(rest[0])
        for j, x in enumerate(rest):
            d = date_fr(x.replace("-", " ").replace(".", ""))
            if d and j >= 1:
                rec.update(div_net=num(rest[j - 1]), div_pay=d)
                if j + 1 < len(rest):
                    rec["rendement"] = num(rest[j + 1])
                if j + 2 < len(rest):
                    rec["per"] = num(rest[j + 2])
                break
        cours[f[0]] = rec
    for code, pat in (("BRVMC", r"BRVM COMPOSITE\s+([\d\s]*\d,\d+)"), ("BRVM30", r"BRVM 30\s+([\d\s]*\d,\d+)"), ("BRVMPR", r"BRVM PRESTIGE\s+([\d\s]*\d,\d+)")):
        mm = re.search(pat, txt)
        if mm:
            indices[code] = {"valeur": num(mm.group(1))}
    return {"date": date, "cours": cours, "indices": indices}


# ----------------------------------------------------------------------------- SikaFinance
SIKA_INDEX = {"BRVMC": "BRVMC", "BRVM30": "BRVM30", "BRVMPR": "BRVMPR", "BRVMPA": "BRVMPA", "BRVM-CB": "BRVM_CB", "BRVM-CD": "BRVM_CD",
              "BRVM-EN": "BRVM_EN", "BRVM-IN": "BRVM_IN", "BRVM-SF": "BRVM_SF", "BRVM-SP": "BRVM_SP", "BRVM-TEL": "BRVM_TEL",
              "BRVMAG": "BRVMAG", "BRVMAS": "BRVMAS", "BRVMDI": "BRVMDI", "BRVMFI": "BRVMFI", "BRVMIN": "BRVMIN", "BRVMSP": "BRVMSP", "BRVMTR": "BRVMTR"}


def sika_aaz(page):
    cours, indices = {}, {}
    for cells, links in rows(page):
        for h in links:
            m = re.search(r"cotation_([A-Z0-9-]+?)(?:\.([a-z]{2}))?$", h)
            if not m:
                continue
            code = m.group(1)
            if m.group(2) and len(cells) >= 8:
                o, hi, lo, vt, vx, last, var = (num(x) for x in cells[1:8])
                cours[code] = {"ouverture": o, "haut": hi, "bas": lo, "volume": int(vt or 0), "valeur": vx, "dernier": last, "variation": var}
            elif code in SIKA_INDEX and len(cells) >= 6:
                indices[SIKA_INDEX[code]] = {"valeur": num(cells[4]), "variation": num(cells[5])}
            break
    return {"cours": cours, "indices": indices}


def sika_histos(symbol, d0, d1, xperiod="0"):
    js = json.loads(fetch(f"{SIKA}/api/general/GetHistos", {"ticker": symbol, "datedeb": d0, "datefin": d1, "xperiod": xperiod}))
    if js.get("error"):
        raise RuntimeError(js["error"])
    out = []
    for p in js.get("lst") or []:
        try:
            d = dt.datetime.strptime(p["Date"], "%d/%m/%Y").date().isoformat()
            c = float(p["Close"])
        except Exception:
            continue
        if c > 0:
            out.append({"d": d, "o": float(p.get("Open") or c), "h": float(p.get("High") or c), "l": float(p.get("Low") or c), "c": c, "v": int(p.get("Volume") or 0)})
    return out


SIKA_FIELDS = {"chiffre d affaires": "ca", "croissance ca": "croissance_ca", "resultat net": "resultat_net", "croissance rn": "croissance_resultat_net",
               "bnpa": "bnpa", "per": "per", "dividende": "dividende", "ebit": "ebit", "ebitda": "ebitda", "charges d exploitation": "charges_exploitation",
               "capitaux propres": "capitaux_propres", "dette nette": "dette_nette", "tresorerie": "tresorerie", "total bilan": "total_bilan",
               "marge nette": "marge_nette", "marge d exploitation": "marge_exploitation", "return on equity": "roe", "return on assets": "roa",
               "levier financier": "levier_financier", "autonomie financiere": "autonomie_financiere", "ratio endettement net": "ratio_endettement_net",
               "produit net bancaire": "ca", "pnb": "ca", "depots clientele": "depots_clientele", "credits clientele": "credits_clientele",
               "coefficient d exploitation": "coefficient_d_exploitation", "ratio de solvabilite": "ratio_de_solvabilite", "cout du risque": "cout_du_risque",
               "ratio tier i": "ratio_tier_i", "credits depots": "credits_depots"}


def sika_tables(page):
    """Tableaux annuels des pages société et finance : {champ: {année: valeur}}."""
    series, years = {}, None
    for cells, _ in rows(page):
        if len(cells) >= 3 and cells[0] == "" and all(re.fullmatch(r"\d{4}", c or "") for c in cells[1:]):
            years = cells[1:]
            continue
        if years and cells and len(cells) == len(years) + 1:
            key = SIKA_FIELDS.get(norm(cells[0]).lower())
            if key:
                for y, v in zip(years, cells[1:]):
                    x = num(v)
                    if x is not None:
                        series.setdefault(key, {})[y] = x
        elif cells and len(cells) != (len(years) + 1 if years else 0):
            years = years if cells and cells[0] == "" else years
    return series


def sika_societe(page):
    t = text(page)
    info = {}
    m = re.search(r"Nombre de titres\s*:\s*([\d\s]+)", t)
    if m:
        info["nb_titres"] = num(m.group(1))
    m = re.search(r"Flottant\s*:\s*([\d,]+)\s*%", t)
    if m:
        info["flottant"] = num(m.group(1))
    m = re.search(r"Principaux actionnaires\s+(.+?)(?:Dirigeants|Nombre d|$)", t)
    if m:
        info["actionnaires"] = [{"nom": a.split("*")[0].strip(), "part": num(a.split("*")[1].split()[0])} for a in m.group(1).split(";") if "*" in a and len(a) < 120][:12]
    return {"info": info, "series": sika_tables(page)}


def sika_dividendes(page, reg):
    out, years = [], None
    for cells, links in rows(page):
        code = next((re.search(r"cotation_([A-Z0-9]+)\.", h).group(1) for h in links if re.search(r"cotation_([A-Z0-9]+)\.", h)), None)
        if cells and cells[0] == "" and any(c.startswith("Div. ") for c in cells):
            years = [int(c[5:]) if c.startswith("Div. ") else None for c in cells]
            continue
        if code and years and len(cells) == len(years):
            for i, y in enumerate(years):
                if y and num(cells[i]) is not None:
                    out.append({"t": code, "ex": y - 0, "brut_ou_net": num(cells[i]), "src": "sika"})
        elif code and len(cells) >= 3 and (date_fr(cells[0]) or norm(cells[0]) == "A PRECISER"):
            out.append({"t": code, "det": date_fr(cells[0]), "montant": num(cells[2]), "src": "sika", "a_venir": True})
    return out


# ----------------------------------------------------------------------------- OuestBourse
def _flight(page):
    return "".join(json.loads('"' + m.group(1) + '"') for m in re.finditer(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', page))


def _grab(s, key):
    res = []
    for m in re.finditer('"' + re.escape(key) + '":', s):
        i = m.end()
        if i >= len(s) or s[i] not in "[{":
            continue
        depth, j, instr, esc = 0, i, False, False
        while j < len(s):
            ch = s[j]
            if instr:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    instr = False
            elif ch == '"':
                instr = True
            elif ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        try:
            res.append(json.loads(s[i:j + 1]))
        except Exception:
            pass
    return res


def ouest_quotes(page):
    f = _flight(page)
    comps = next((c for c in _grab(f, "companies") if isinstance(c, list) and c and "current_price" in c[0]), [])
    sess = next(iter(_grab(f, "marketSession")), {})
    return {"cours": {c["symbol"]: {"dernier": c.get("current_price"), "variation": c.get("daily_change")} for c in comps if c.get("symbol")},
            "session": sess}


OUEST_FIELDS = {"revenue": "ca", "net_income": "resultat_net", "total_equity": "capitaux_propres", "total_assets": "total_bilan",
                "operating_income": "ebit", "ebitda": "ebitda", "operating_cash_flow": "cfo", "capital_expenditure": "capex",
                "cash_and_equivalents": "tresorerie", "total_debt": "dette_brute", "net_banking_income": "pnb", "eps": "bnpa",
                "customer_deposits": "depots_clientele", "net_loans": "credits_clientele", "cost_of_risk": "cout_du_risque"}


def ouest_stock(page):
    f = _flight(page)
    annual = next(iter(_grab(f, "annual")), [])
    divs = next(iter(_grab(f, "dividends")), [])
    series = {}
    for a in annual if isinstance(annual, list) else []:
        y = str(a.get("year"))
        for k, v in OUEST_FIELDS.items():
            x = a.get(k)
            if x is None:
                continue
            series.setdefault(v, {})[y] = x / 1e6 if k not in ("eps",) else x  # en millions de FCFA
        if a.get("operating_cash_flow") is not None and a.get("capital_expenditure") is not None:
            series.setdefault("fcf", {})[y] = (a["operating_cash_flow"] - abs(a["capital_expenditure"])) / 1e6
        if a.get("source"):
            series.setdefault("_doc", {})[y] = a["source"]
    dv = [{"ex": d.get("exercise_year"), "net": d.get("amount_net"), "det": d.get("ex_date"), "pay": d.get("payment_date"),
           "url": d.get("notice_url"), "src": "ouestbourse"} for d in (divs if isinstance(divs, list) else []) if d.get("amount_net")]
    return {"series": series, "dividends": dv}


# ----------------------------------------------------------------------------- African Markets
def afm_quotes(page):
    out = {}
    for cells, links in rows(page):
        code = next((re.search(r"code=([A-Z0-9]+)", h).group(1) for h in links if re.search(r"code=([A-Z0-9]+)", h)), None)
        if code and len(cells) >= 7:
            dd = cells[6]
            out[code] = {"dernier": num(cells[2].replace(",", " ")), "date_jm": dd}
    return out
