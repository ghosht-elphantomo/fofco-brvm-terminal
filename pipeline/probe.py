#!/usr/bin/env python3
"""Outil de développement : télécharge des pages publiques brutes pour écrire les lecteurs.

Lit une URL par ligne dans le fichier donné (lignes vides et # ignorées), enregistre chaque
réponse dans le dossier de sortie avec un index (statut, taille, type). Ne sert pas au site.

Usage : python probe.py pipeline/probe_urls.txt /tmp/debug
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


def slug(url):
    s = re.sub(r"^https?://(www\.)?", "", url)
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:90]
    return s + "_" + hashlib.md5(url.encode()).hexdigest()[:6]


def main(listfile, out):
    os.makedirs(out, exist_ok=True)
    index = []
    for line in open(listfile, encoding="utf-8"):
        url = line.strip()
        if not url or url.startswith("#"):
            continue
        method, body = "GET", None
        if url.startswith("POST "):
            _, url, payload = url.split(" ", 2)
            method, body = "POST", payload.encode()
        name = slug(url + (body.decode() if body else ""))
        rec = {"url": url, "method": method, "file": None}
        try:
            req = urllib.request.Request(url, data=body, method=method, headers={
                "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9",
                **({"Content-Type": "application/json"} if body else {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                rec.update(status=r.status, type=r.headers.get("Content-Type"), size=len(data), final_url=r.geturl())
            ext = ".pdf" if data[:4] == b"%PDF" else ".json" if data[:1] in b"[{" else ".html"
            with open(os.path.join(out, name + ext), "wb") as f:
                f.write(data)
            rec["file"] = name + ext
        except Exception as e:
            rec.update(error=str(e)[:300], status=getattr(e, "code", None))
        index.append(rec)
        print(rec.get("status"), rec.get("size"), url)
        time.sleep(1.0)
    json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
