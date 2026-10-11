#!/usr/bin/env python3
"""Prépare la page pour un hébergement classique (Vercel).

index.html est écrit pour la page privée claude.ai, qui ajoute elle-même l'en-tête HTML
(doctype, viewport mobile, petite remise à zéro). Pour Vercel, on ajoute cet en-tête ici :
sans lui, un téléphone affiche la version ordinateur en tout petit.

Usage : python wrap_page.py index.html /tmp/out/index.html
"""
import sys

HEAD = (
    '<!doctype html><html lang="fr"><head>'
    '<meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-title" content="FOFCO BRVM">'
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
    'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
)

src, dest = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8") as f:
    page = f.read()
with open(dest, "w", encoding="utf-8") as f:
    f.write(HEAD + page)
