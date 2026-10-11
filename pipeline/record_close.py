#!/usr/bin/env python3
"""Archive propre des clôtures, pour ne dépendre d'aucun miroir tiers.

Après la séance (brvm.org indique « séance fermée »), on écrit la clôture du jour de chaque
titre et des indices BRVM-C, BRVM-30 et Prestige dans un CSV par code, sur la branche `prices`
du dépôt. build.py comble avec ces lignes toutes les dates absentes du miroir public : si le
miroir s'arrête, l'historique continue de s'allonger tout seul.

Usage : python record_close.py /tmp/live.json /tmp/prices
"""
import datetime as dt
import json
import os
import sys

HEADER = "Date;Clôture;Ouverture;+Haut;+Bas;Titres;FCFA\n"


def upsert(path, date, row):
    rows = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f.read().splitlines()[1:]:
                if line.strip():
                    rows[line.split(";")[0]] = line
    key = date.strftime("%d/%m/%Y")
    line = ";".join([key] + [str(x) for x in row])
    if rows.get(key) == line:
        return False
    rows[key] = line
    order = sorted(rows, key=lambda d: dt.datetime.strptime(d, "%d/%m/%Y"))
    with open(path, "w", encoding="utf-8") as f:
        f.write(HEADER + "\n".join(rows[d] for d in order) + "\n")
    return True


def main(live_path, root):
    try:
        lv = json.load(open(live_path, encoding="utf-8"))
    except Exception:
        print("Pas de relevé : rien à archiver")
        return
    m = lv.get("_meta", {})
    if not m.get("brvm_ok") or (m.get("seance") or "").lower() != "fermée" or not m.get("maj_brvm_date"):
        print("Séance non close ou relevé incomplet : rien à archiver")
        return
    date = dt.date.fromisoformat(m["maj_brvm_date"])
    os.makedirs(os.path.join(root, "titres"), exist_ok=True)
    os.makedirs(os.path.join(root, "indices"), exist_ok=True)
    n = 0
    for t, c in (lv.get("cours") or {}).items():
        last, vol = c.get("dernier"), int(c.get("volume") or 0)
        if not last or vol <= 0:
            continue  # pas d'échange ce jour-là : pas de ligne, comme dans le miroir
        o = c.get("ouverture") or last
        hi = max(x for x in (c.get("haut"), o, last) if x)
        lo = min(x for x in (c.get("bas"), o, last) if x)
        val = c.get("valeur") or round(vol * last)
        n += upsert(os.path.join(root, "titres", t + ".csv"), date, [f"{last:g}", f"{o:g}", f"{hi:g}", f"{lo:g}", vol, f"{val:.0f}"])
    for k, x in (lv.get("indices") or {}).items():
        v = x.get("valeur")
        if v:
            n += upsert(os.path.join(root, "indices", k + ".csv"), date, [f"{v:g}"] * 4 + [0, 0])
    print(f"Clôture du {date:%d/%m/%Y} archivée ({n} lignes nouvelles ou corrigées)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
