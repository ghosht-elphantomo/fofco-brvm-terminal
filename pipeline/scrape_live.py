#!/usr/bin/env python3
"""Relevé de séance BRVM (cours différés de 15 min).

Source principale : https://www.brvm.org/fr/cours-actions/0 (cours officiels, indices, capitalisation)
Complément        : https://www.sikafinance.com/marches/aaz (plus haut, plus bas, valeur échangée)

Écrit un JSON au même format que seance.json du miroir public, pour que build.py
puisse utiliser l'un ou l'autre. Bibliothèque standard uniquement.

Usage : python scrape_live.py live.json
"""
import datetime as dt
import html
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
BRVM_URL = "https://www.brvm.org/fr/cours-actions/0"
SIKA_URL = "https://www.sikafinance.com/marches/aaz"
# L'horodatage « Dernière mise à jour » de brvm.org est affiché 7 h en avance sur l'heure d'Abidjan (GMT) :
# 22:45 affiché = 15:45 GMT (constat du 09/10/2026, cohérent avec le relevé du miroir public).
BRVM_PAGE_OFFSET_H = 7
MOIS = {m: i for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
                                     "septembre", "octobre", "novembre", "décembre"], 1)}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


class Tables(HTMLParser):
    """Collecte toutes les lignes de tableau : liste de (cellules texte, liens)."""

    def __init__(self):
        super().__init__()
        self.rows, self.cur, self.cell, self.links, self.in_cell = [], None, [], [], False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.cur, self.links = [], []
        elif tag in ("td", "th") and self.cur is not None:
            self.in_cell, self.cell = True, []
        elif tag == "a" and self.cur is not None:
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cur is not None and self.in_cell:
            self.cur.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.in_cell = False
        elif tag == "tr" and self.cur is not None:
            if self.cur:
                self.rows.append((self.cur, self.links))
            self.cur = None

    def handle_data(self, data):
        if self.in_cell:
            self.cell.append(data)


def num(s):
    if s is None:
        return None
    s = html.unescape(str(s)).replace(" ", "").replace("\xa0", "").replace(" ", "")
    s = s.replace("FCFA", "").replace("XOF", "").replace("%", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_brvm(page):
    p = Tables()
    p.feed(page)
    cours, indices, marche = {}, {}, {}
    for cells, _ in p.rows:
        if len(cells) >= 7 and re.fullmatch(r"[A-Z]{3,6}", cells[0] or ""):
            vol, veille, ouv, clo, var = (num(x) for x in cells[2:7])
            if clo is None:
                continue
            cours[cells[0]] = {"nom": cells[1], "volume": int(vol or 0), "veille": veille,
                               "ouverture": ouv, "dernier": clo, "variation": var}
            continue
        lab = (cells[0] or "").lower()
        if lab.startswith("valeur des transactions") and len(cells) > 1:
            marche["valeur_transactions"] = num(cells[1])
        elif lab.startswith("capitalisation actions") and len(cells) > 1:
            marche["capitalisation_actions"] = num(cells[1])
        elif lab.startswith("capitalisation des obligations") and len(cells) > 1:
            marche["capitalisation_obligations"] = num(cells[1])
        else:
            code = {"brvm-c": "BRVMC", "brvm-30": "BRVM30", "brvm-pres": "BRVMPR"}.get(lab)
            vals = [num(c) for c in cells[1:] if num(c) is not None]
            if code and vals:
                indices[code] = {"valeur": vals[0], "variation": vals[1] if len(vals) > 1 else None}
    text = re.sub(r"<[^>]+>", " ", page)
    text = html.unescape(re.sub(r"\s+", " ", text))
    maj = None
    m = re.search(r"Derni[eè]re mise [àa] jour\s*:\s*\w+,?\s*(\d{1,2})\s+(\w+),?\s*(\d{4})\s*-\s*(\d{1,2}):(\d{2})", text, re.I)
    if m:
        mois = MOIS.get(m.group(2).lower())
        if mois:
            maj = dt.datetime(int(m.group(3)), mois, int(m.group(1)), int(m.group(4)), int(m.group(5)))
            maj -= dt.timedelta(hours=BRVM_PAGE_OFFSET_H)
    etat = "Ouverte" if re.search(r"S[ée]ance ouverte", text, re.I) else ("Fermée" if re.search(r"S[ée]ance ferm[ée]e", text, re.I) else None)
    return cours, indices, marche, maj, etat


def parse_sika(page):
    p = Tables()
    p.feed(page)
    out = {}
    for cells, links in p.rows:
        tick = None
        for h in links:
            m = re.search(r"cotation_([A-Z]{3,6})\.[a-z]{2}", h)
            if m:
                tick = m.group(1)
                break
        if not tick or len(cells) < 8:
            continue
        o, hi, lo, vt, vx, last, var = (num(x) for x in cells[1:8])
        out[tick] = {"ouverture": o, "haut": hi, "bas": lo, "volume": int(vt or 0), "valeur": vx,
                     "dernier": last, "variation": var}
    return out


def main(dest):
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    meta = {"source": "BRVM, page Cours des actions", "url": BRVM_URL, "releve_utc": now.isoformat().replace("+00:00", "Z"),
            "delai_minutes": 15, "brvm_ok": False, "sika_ok": False, "origine": "scraper FOFCO (GitHub Actions)"}
    cours, indices, marche, maj, etat = {}, {}, {}, None, None
    try:
        cours, indices, marche, maj, etat = parse_brvm(fetch(BRVM_URL))
        meta["brvm_ok"] = len(cours) >= 30
    except Exception as e:
        meta["brvm_err"] = str(e)[:200]
    sika = {}
    try:
        sika = parse_sika(fetch(SIKA_URL))
        meta["sika_ok"] = len(sika) >= 30
    except Exception as e:
        meta["sika_err"] = str(e)[:200]
    if meta["brvm_ok"]:
        for t, c in cours.items():
            s = sika.get(t)
            if s and s.get("dernier") == c.get("dernier"):
                c.update({k: s[k] for k in ("haut", "bas", "valeur") if s.get(k)})
        if maj:
            meta["maj_brvm"] = maj.strftime("%Y-%m-%dT%H:%M")
            meta["maj_brvm_date"] = maj.strftime("%Y-%m-%d")
        meta["seance"] = etat
    elif meta["sika_ok"]:
        # Sans brvm.org, la date de séance n'est pas certaine : on affiche les cours sans créer de séance.
        meta["source"] = "SikaFinance, page Actions"
        meta["url"] = SIKA_URL
        for t, s in sika.items():
            last, var = s.get("dernier"), s.get("variation")
            veille = round(last / (1 + var / 100)) if last and var is not None and var > -100 else None
            cours[t] = {**s, "veille": veille}
    else:
        print("Aucune source joignable", meta.get("brvm_err"), meta.get("sika_err"))
        sys.exit(1)
    meta["nb_titres"] = len(cours)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump({"_meta": meta, "marche": marche, "indices": indices, "cours": cours}, f, ensure_ascii=False, indent=1)
    print(f"{len(cours)} titres · brvm={meta['brvm_ok']} sika={meta['sika_ok']} · maj={meta.get('maj_brvm')} · {etat}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "live.json")
