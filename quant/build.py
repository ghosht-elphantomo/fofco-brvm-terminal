"""Assemble the terminal page from web/.
  python3 quant/build.py               -> quant/index.html (static hosting: loads data/*.json next to it)
  python3 quant/build.py --artifact F  -> F (claude.ai artifact body, same app, TRIGGER_ID from env)
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
W = lambda p: open(os.path.join(HERE, "web", p), encoding="utf8").read()
HEAD = ('<title>FQT Terminal</title>\n'
        '<meta name="description" content="Terminal de marché : BRVM (48 actions, indices, dividendes, avis), actions US, macro et or, backtests et statistiques.">\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;600&display=swap">\n'
        '<style>\n' + W("style.css") + '\n</style>\n')
JS = "".join("<script>\n" + W(f) + "\n</script>\n" for f in ("engine.js", "chart.js", "pages1.js", "pages2.js", "core.js"))
BODY = W("body.html")
if "--artifact" in sys.argv:
    out = sys.argv[sys.argv.index("--artifact") + 1]
    trig = os.environ.get("TRIGGER_ID", "__TRIGGER_ID__")
    open(out, "w", encoding="utf8").write(HEAD + BODY + JS.replace("'__TRIGGER_ID__'", "'" + trig + "'"))
    print("artifact", out)
else:
    html = ('<!doctype html>\n<html lang="fr"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + HEAD + '</head><body>\n' + BODY + JS + '</body></html>\n')
    open(os.path.join(HERE, "index.html"), "w", encoding="utf8").write(html)
    print("index.html", len(html))
