# FQT — terminal de marché (BRVM, US, macro)

Terminal façon Bloomberg : ligne de commande, touches de fonction, tableaux denses, graphiques interactifs. Indépendant du terminal FOFCO BRVM à la racine du dépôt.

Tapez un ticker ou une fonction puis Entrée : `SNTS GP`, `QQQ BTST`, `NVDA QLAB`, `MACRO`, `EVTS`. Cliquer sur n'importe quel titre ouvre ses écrans.

## Fonctions

| Code | Contenu |
|---|---|
| MON | Tous les titres (US, Taïwan, indices BRVM, matières premières, taux, change), règle SMA 200 de QQQ, séance BRVM, carte des capitalisations, derniers avis |
| BRVM | 48 actions triables (cours, perfs, volatilité, bêta, capitalisation, PER, rendement, payout, RSI, liquidité), 17 indices, largeur du marché depuis 2008, secteurs |
| GP | Graphique : bougies, MM 20/50/200, Bollinger, volume, RSI, MACD, drawdown, échelle log, comparaison, 5 min pour QQQ ; zoom molette, déplacement à la souris |
| DES | Fiche : comptes sur 5 exercices, dividendes avec rendement au détachement, avis officiels (BRVM) ; perfs annuelles et pires drawdowns (tous) |
| BTST | Backtest de 8 stratégies sur le titre actif, levier simulé (US), rendements mensuels, journal des trades, Monte Carlo, durée des drawdowns |
| QLAB | Distribution et VaR/CVaR, QQ-plot, cône de volatilité, autocorrélation, exposant de Hurst, carte du momentum, analogues k-NN + DTW, probabilité bayésienne |
| CORR | Matrice de corrélation hebdomadaire, paire au choix (nuage, bêta, corrélation glissante), ACP et ratio d'absorption |
| SEAS | Rendements années × mois, effet jour de semaine, « Sell in May », effet tournant de mois |
| MACRO | Or depuis 1833 (nominal et réel), krachs du S&P 500 et comportement de l'or, S&P en onces d'or, CAPE, inflation et taux réel, or selon le régime d'inflation, pétrole, gaz, VIX |
| FX | USD/XOF et EUR/USD, effet de change sur QQQ et la BRVM, simulateur d'investissement en XOF |
| DVD | Prochains détachements, classement par rendement, dividendes distribués par exercice, historique complet |
| EVTS | Les avis officiels BRVM depuis 2000, filtrables par titre, catégorie et mot-clé |

## Données

| Source | Contenu | Mise à jour |
|---|---|---|
| [harzat/brvm-data-public](https://github.com/harzat/brvm-data-public) (BRVMetrics) | 48 titres BRVM depuis 2006, 17 indices, fondamentaux, dividendes, avis | chaque soir |
| brvm.org | séance du jour (cours, variations, indices, capitalisation) | toutes les 15 min en séance |
| [yennanliu/finance_data](https://github.com/yennanliu/finance_data) (Yahoo) | 33 actions et ETF US, 2 titres taïwanais, quotidien sur 10 ans | chaque soir |
| Yahoo Finance, sinon Nasdaq | QQQ en direct et bougies 5 min | toutes les 15 min en séance |
| [datasets](https://github.com/datasets) | or (1833), S&P 500 et CAPE (1871), CPI (1913), taux 10 ans, Brent, WTI, gaz, VIX, change | chaque soir |

Environ 112 séries, 320 000 lignes de cours, 7 200 avis, 328 dividendes.

## Circulation

1. `.github/workflows/quant.yml` relève les cours toutes les 30 min de 09:00 à 12:30 UTC et toutes les 15 min de 13:00 à 20:45 UTC, puis reconstruit toute la base à 22:35 UTC (lun-ven).
2. Chaque passage réécrit la branche **`quant-data`** : site complet et autonome (`index.html` + `data/`), donc le dépôt ne grossit pas. La séance BRVM est archivée chaque soir dans `seed/brvm_daily.csv`.
3. Page claude.ai : une tâche planifiée recopie `data/live.json` et `data/quotes.json` dans la base de la page ; le bouton **SYNC** lance la copie tout de suite.
4. Hébergement statique au choix : GitHub Pages sur la branche `quant-data` (dépôt public ou compte Pro), ou Vercel, qui déploie automatiquement la branche.

## Fichiers

```
quant/index.html                 page générée : python3 quant/build.py
quant/web/                       style.css, body.html, engine.js (moteur quant), chart.js, pages1.js, pages2.js, core.js
quant/scripts/scrape.py          relevé QQQ + séance BRVM (bibliothèque standard Python)
quant/scripts/build_terminal.py  construction de toute la base data/
quant/seed/                      séance BRVM de départ, archive brvm_daily.csv, CSV bruts US
```

## En local

```bash
git clone --depth 1 https://github.com/harzat/brvm-data-public.git /tmp/brvmsrc
python3 quant/scripts/scrape.py --mode live --state /tmp/qstate --out /tmp/qsite
python3 quant/scripts/build_terminal.py --brvm-src /tmp/brvmsrc --out /tmp/qsite/data --session /tmp/qstate/brvm.json
python3 quant/build.py && cp quant/index.html /tmp/qsite/
python3 -m http.server -d /tmp/qsite 8000      # http://localhost:8000
```

Coût Actions : environ 40 passages par jour ouvré (~900 min/mois), en plus du workflow FOFCO BRVM. Illimité si le dépôt est public.

Les données de marché restent la propriété de leurs sources. Outil d'analyse personnel, pas un conseil en investissement.
