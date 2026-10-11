# FOFCO BRVM Terminal

Terminal d'analyse personnel des 48 actions de la BRVM : marché, screener, fiches (indicateurs techniques, comptes, dividendes, avis, saisonnalité), simulation de stratégies, indices, classements et univers FOFCO.

## Fonctionnement

| Élément | Rôle |
|---|---|
| `index.html` | Le terminal (une seule page, sans serveur). Lit les fichiers du dossier `data/`. |
| `pipeline/scrape_live.py` | Relève la séance sur brvm.org (cours officiels, indices, capitalisation) et SikaFinance (plus haut, plus bas, valeur). |
| `pipeline/build.py` | Fusionne le relevé avec le miroir public [harzat/brvm-data-public](https://github.com/harzat/brvm-data-public) (historiques depuis 2006, comptes, dividendes, avis) et produit `data/`. |
| `.github/workflows/update.yml` | Tourne toutes les 15 minutes pendant la séance BRVM (lundi–vendredi, 8 h–16 h 45 GMT), puis le soir, et publie le résultat sur la branche **`data`**. |

La branche `data` contient toujours la dernière version complète et autonome (`index.html` + `data/`). Elle est réécrite à chaque passage, donc le dépôt ne grossit pas.

## Lancer en local

```bash
git clone --depth 1 https://github.com/harzat/brvm-data-public.git /tmp/src
python pipeline/scrape_live.py /tmp/live.json
python pipeline/build.py --src /tmp/src --live /tmp/live.json --out data
python -m http.server 8000   # puis ouvrir http://localhost:8000
```

## Notes

- Les CSV du miroir public sont dans l'ordre réel `Date;Clôture;Ouverture;+Haut;+Bas;Titres;FCFA;Variation`, différent de leur en-tête ; `build.py` en tient compte.
- Les cours BRVM sont différés de 15 minutes à la source.
- Données de marché : propriété de la BRVM, de SikaFinance et de RicheBourse. Usage personnel, sans garantie d'exactitude. Pas un conseil en investissement.
