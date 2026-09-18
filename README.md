# WikiMastersTools-kzfamily

Extension Chromium (Manifest V3) pour afficher directement dans la page **Collection** de [WikiMasters](https://www.wiki-masters.com/) le **prix moyen de vente** de chaque carte.

## Fonctionnement

WikiMasters charge les cartes de la collection via :

```text
/api/my-collection?... 
```

Cette réponse contient notamment :

- `card_id`
- `card.wikipedia_title`
- la rareté de la carte

Pour chaque carte affichée, l'extension récupère ensuite uniquement le résumé des ventes via :

```text
/api/marketplace/cards/<CARD_ID>/sales?scope=summary
```

Exemple de réponse :

```json
{
  "wikipedia_title": "Charlotte (roman)",
  "summary": {
    "SR": {
      "average": 10
    }
  },
  "isPro": false
}
```

Le prix moyen correspondant à la rareté de la carte est ensuite affiché directement sur la carte dans la collection.

## Cache et limitation des requêtes

Pour éviter de solliciter inutilement l'API WikiMasters :

- cache **individuel par `card_id`**
- durée : **24 heures**
- stockage : **`chrome.storage.local`**
- le cache survit à la fermeture de l'onglet et au redémarrage du navigateur
- maximum **3 requêtes de prix simultanées**
- les erreurs et réponses sans prix sont également mises en cache 24 h afin d'éviter les boucles de requêtes
- lorsqu'une carte est déjà en cache, aucun nouvel appel `sales?scope=summary` n'est effectué

Les tests effectués sur le frontend WikiMasters n'ont pas mis en évidence d'endpoint batch pour obtenir plusieurs moyennes en une seule requête ; l'API de ventes est actuellement appelée carte par carte.

## Installation

1. Télécharger ou cloner ce dépôt.
2. Ouvrir Chromium/Chrome.
3. Aller sur `chrome://extensions/`.
4. Activer **Mode développeur**.
5. Cliquer sur **Charger l'extension non empaquetée**.
6. Sélectionner le dossier du dépôt, celui qui contient directement `manifest.json`.
7. Ouvrir ou recharger :
   `https://www.wiki-masters.com/collection`

## Debug

Ouvrir les DevTools puis filtrer la console sur :

```text
WM Average
```

Les messages principaux sont :

```text
[WM Average] content script v3 chargé
[WM Average] bridge installé
[WM Average] N cartes détectées
```

## Fichiers

- `manifest.json` — manifeste Chromium Manifest V3
- `content.js` — cache, file de requêtes et injection des badges
- `page-bridge.js` — interception de `/api/my-collection` et appels à l'API de résumé des ventes
- `styles.css` — apparence du badge de prix moyen

## Version

Version actuelle : **3.0.0**
