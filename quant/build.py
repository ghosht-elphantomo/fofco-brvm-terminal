"""Rebuild index.html from src/ (the page loads data/*.json at runtime). Usage: python3 build.py"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
src = lambda p: open(os.path.join(HERE, "src", p), encoding="utf8").read()
html = ('<!doctype html>\n<html lang="fr"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<title>Claude × Quant</title>\n'
        '<meta name="description" content="Terminal quant : backtest QQQ/TQQQ, Monte Carlo, analogues k-NN, Kuramoto, Bayes et les 48 actions BRVM.">\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap">\n'
        '<style>\n' + src("style.css") + '\n</style>\n</head><body>\n' + src("body.html") +
        '<script>\n' + src("engine.js") + '\n</script>\n<script>\n' + src("ui.js") + '\n</script>\n</body></html>\n')
open(os.path.join(HERE, "index.html"), "w", encoding="utf8").write(html)
print("index.html", len(html), "bytes")
