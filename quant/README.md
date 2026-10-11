# CLAUDE × QUANT — terminal QQQ/TQQQ + BRVM

Terminal quant au look « Claude × Quant » : backtest de ta stratégie SMA200 → TQQQ (et 7 autres), suivi de QQQ en bougies 5 min / 1D / 1W, et les 48 actions de la BRVM. Indépendant du terminal FOFCO BRVM à la racine du dépôt.

## Comment les données circulent

1. **GitHub Actions** (`.github/workflows/quant.yml`) relève Yahoo Finance (QQQ + 21 marchés) et brvm.org (48 actions, indices) :
   toutes les 30 min de 09:00 à 12:30 UTC, toutes les 15 min de 13:00 à 20:45 UTC, puis un passage EOD à 22:35 UTC (historique quotidien complet). Du lundi au vendredi.
2. Chaque passage réécrit la branche **`quant-data`** : un site complet et autonome (`index.html` + `data/`). Le dépôt ne grossit pas.
3. **Page claude.ai** : une tâche planifiée recopie `data/feed_daily.json`, `live.json` et `brvm.json` de cette branche dans la base de la page, plusieurs fois par jour. Le bouton **⟳ SYNC** dans l'en-tête lance la copie tout de suite. La page se met à jour sans rechargement.
4. **Option GitHub Pages** (rafraîchi toutes les 15 min) : *Settings → Pages → Deploy from a branch → `quant-data` / root*. Sur un dépôt privé, Pages demande GitHub Pro.

Si une source tombe, le dernier état reste en place : rien ne se vide.

## Les panneaux

| Panneau | Ce qu'il calcule |
|---|---|
| PNL | Résultat du backtest actif : capital final, trades, win rate, R/R, Sharpe, risque de drawdown vs ton seuil |
| QQQ / USD | Bougies 5M / 1D / 1W, SMA200 + SMA50, entrées/sorties de la stratégie, niveaux clés (pivots, SMA, 52 sem.) |
| Resolution Grid | Les 48 actions BRVM : variation, YTD, rendement, PER, score quant ; fiche par titre + simulateur de dividende ; table triable |
| Fill Survival | Kaplan-Meier de la durée des drawdowns (stratégie vs QQQ vs 3×) |
| Order Flow Aurora | Pression acheteur/vendeur (CLV × volume), CVD, pics de volume, régime trend/chop |
| Book Membrane | Momentum sur 16 horizons (2 → 252 j) en nappe 3D |
| Phase Vortex | Synchronisation de Kuramoto sur 22 marchés (phase de Hilbert d'Ehlers) |
| Ruin Cone | Monte Carlo par blocs : P(drawdown ≥ seuil), distribution du capital à 1 an / 3 ans |
| Analog Matcher | k-NN + DTW sur ~50 000 fenêtres historiques : ce qui s'est passé ensuite |
| Bayesian Update | P(QQQ plus haut dans 21 séances), signaux en log-odds tempérés, EV et Kelly ½ |

Bouton **BACKTEST** : 8 stratégies, levier 1×/2×/3× simulé au quotidien (le 3× colle à TQQQ : 2022 −78,7 % simulé vs −79,1 % réel ; 2023 +200 % vs +198 %), exécution à la clôture ou à l'ouverture J+1, frais, slippage, financement, cash rémunéré.

## Fondamentaux BRVM

`seed/brvm_ref.json` : dernier dividende net et sa date, PER et cours de référence par titre (Bulletin Officiel de la Cote du 09/10/2026). Rendement et PER sont recalculés au cours du moment. La base YTD bascule toute seule au premier passage EOD de l'année.
Quand une société détache un nouveau dividende, mets à jour `div`, `divd`, `per` et `cref` du titre (ou demande à Claude de le faire depuis le dernier BOC).

## Fichiers

```
quant/index.html          page générée : python3 quant/build.py
quant/src/                style.css, body.html, engine.js (moteur quant), ui.js (interface)
quant/scripts/scrape.py   collecte Yahoo + brvm.org (bibliothèque standard Python)
quant/seed/               état initial (history.json, brvm.json) + brvm_ref.json
```

## En local

```bash
python3 quant/build.py
python3 quant/scripts/scrape.py --mode eod --state /tmp/qstate --out /tmp/qsite
python3 -m http.server -d /tmp/qsite 8000      # http://localhost:8000
```

Coût Actions : environ 40 passages d'une minute par jour ouvré (~900 min/mois), en plus du workflow FOFCO BRVM. Illimité si le dépôt est public.

Outil d'analyse, pas un conseil en investissement.
