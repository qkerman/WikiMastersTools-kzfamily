# WikiMastersTools-kzfamily

Extension Chromium (Manifest V3) pour afficher le **prix moyen de vente** des cartes sur la page **Collection** et sur les pages de détail du **Marketplace** de [WikiMasters](https://www.wiki-masters.com/).

## Fonctionnement

L'extension est chargée sur tout `wiki-masters.com` afin de rester active pendant les navigations internes de l'application Next.js. Elle fonctionne donc aussi lorsqu'on arrive sur `/collection` depuis une autre page via le menu, sans avoir besoin de faire F5.

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

Pendant qu'un prix absent du cache est en cours de récupération, la carte affiche immédiatement un petit badge **« Prix… »** avec un spinner. Le badge est remplacé automatiquement par la moyenne dès que le cache ou l'API répond.

## Cache et limitation des requêtes

Pour éviter de solliciter inutilement l'API WikiMasters :

- cache **individuel par `card_id`**
- durée : **24 heures**
- stockage principal : **`localStorage`** sur `wiki-masters.com`
- le cache survit à la fermeture de l'onglet et au redémarrage du navigateur
- maximum **3 requêtes de prix simultanées**
- les erreurs et réponses sans prix sont également mises en cache 24 h afin d'éviter les boucles de requêtes
- lorsqu'une carte est déjà en cache, aucun nouvel appel `sales?scope=summary` n'est effectué

Les tests effectués sur le frontend WikiMasters n'ont pas mis en évidence d'endpoint batch pour obtenir plusieurs moyennes en une seule requête ; l'API de ventes est actuellement appelée carte par carte.

## Navigation SPA

WikiMasters utilise une navigation côté client. Depuis la version **3.1.0**, le content script et le bridge réseau sont chargés dès l'ouverture de n'importe quelle page WikiMasters.

Cela permet d'intercepter `/api/my-collection` quand l'utilisateur clique ensuite sur **Collection** dans le menu, même si le navigateur n'effectue aucun rechargement complet de la page.

## Installation

1. Télécharger ou cloner ce dépôt.
2. Ouvrir Chromium/Chrome.
3. Aller sur `chrome://extensions/`.
4. Activer **Mode développeur**.
5. Cliquer sur **Charger l'extension non empaquetée**.
6. Sélectionner le dossier du dépôt, celui qui contient directement `manifest.json`.
7. Recharger une fois un onglet WikiMasters après installation ou mise à jour de l'extension.

## Mise à jour

Dans le dépôt local :

```bash
git pull
```

Puis dans `chrome://extensions/`, cliquer sur le bouton **Recharger** de l'extension. Enfin, recharger une fois l'onglet WikiMasters déjà ouvert afin que le nouveau content script soit injecté.

## Debug

Ouvrir les DevTools puis filtrer la console sur :

```text
WM Average
```

Les messages principaux sont :

```text
[WM Average] content script v3.4.2 chargé
[WM Average] bridge installé
[WM Average] navigation SPA détectée: /collection
[WM Average] N cartes détectées
```

## Fichiers

- `manifest.json` — manifeste Chromium Manifest V3
- `content.js` — cache, détection SPA, file de requêtes et injection des badges
- `page-bridge.js` — interception de `/api/my-collection` et appels à l'API de résumé des ventes
- `styles.css` — apparence du badge de prix moyen

## Version

Version actuelle : **3.4.2**


## Chargement complet et classement par prix

Depuis la version **3.3.0**, deux boutons sont ajoutés en haut de la page Collection :

- **Tout charger** : récupère toute la collection, page par page, puis charge les prix moyens absents ou expirés du cache.
- **Plus chères** : ouvre une liste de toute la collection triée du prix moyen le plus élevé au plus faible.

Pour limiter la charge sur WikiMasters :

- les pages de collection sont récupérées avec au maximum **2 requêtes simultanées** ;
- les résumés de ventes restent limités à **3 requêtes simultanées** ;
- les prix valides de moins de 24 h sont réutilisés ;
- si **Tout charger** a déjà été lancé il y a moins de 24 h, une confirmation est demandée avant de forcer un nouveau chargement complet des prix.

La liste complète des cartes est également conservée localement afin que le classement **Plus chères** puisse être rouvert sans recharger toute la collection.


## Robustesse après rechargement de l'extension

Depuis la version **3.3.1**, le cache principal utilise `localStorage` sur `wiki-masters.com` au lieu de dépendre directement de `chrome.storage.local`.

Cela évite l'erreur Chromium `Extension context invalidated` lorsqu'une extension est rechargée depuis `chrome://extensions/` alors qu'un onglet WikiMasters contenant un ancien content script est encore ouvert.

Au premier démarrage de la 3.3.1, l'extension tente également de migrer automatiquement les anciennes valeurs de `chrome.storage.local` vers `localStorage` quand le contexte Chromium est disponible.


## Injection sans dépendance au contexte d'extension

Depuis la version **3.3.2**, `page-bridge.js` est injecté directement par Manifest V3 dans le **MAIN world** de WikiMasters.

Le content script n'utilise plus `chrome.runtime.getURL` et la migration temporaire depuis `chrome.storage.local` a été supprimée. Après le démarrage de la page, le fonctionnement courant de l'extension ne dépend donc plus des API `chrome.*`.

Les anciennes erreurs affichées dans `chrome://extensions/` restent enregistrées par Chromium jusqu'à ce qu'elles soient effacées manuellement avec **Clear all / Tout effacer**. Après mise à jour vers 3.3.2, effacer les anciennes erreurs permet de vérifier uniquement les nouvelles occurrences.


## Pages Marketplace

Depuis la version **3.4.0**, l'extension intercepte aussi les réponses de détail :

```text
/api/marketplace/<AUCTION_ID>
```

Elle récupère `auction.card_id`, le titre et la rareté de la carte, puis réutilise le même endpoint de résumé des ventes et le même cache 24 h que sur la collection.

Un encart **Prix moyen** est ajouté directement dans la colonne d'informations de la page `/marketplace/<AUCTION_ID>`.

## Apparence et sponsor

Les boutons ajoutés par l'extension utilisent la couleur `#bf94ff`.

Sous les boutons de la Collection et sous l'encart de prix moyen des pages Marketplace, l'extension affiche :

```text
bouton sponsorisé par https://www.twitch.tv/botkz
```

Le lien Twitch est cliquable et s'ouvre dans un nouvel onglet.


## Content script dans le MAIN world

Depuis la version **3.4.1**, `content.js` est lui aussi injecté dans le **MAIN world** de WikiMasters.

L'objectif est d'éviter les erreurs `Extension context invalidated` qui peuvent survenir lorsqu'une extension en mode développeur est rechargée pendant qu'un ancien content script est encore actif dans un onglet. Un garde-fou `window.__wmAverageUiInstalled` empêche également une double initialisation sur la même page.


## Chargement progressif du classement

Depuis la version **3.4.2**, la fenêtre **Plus chères** ne crée plus toute la liste dans le DOM dès son ouverture.

- les **50 premières cartes** sont affichées immédiatement ;
- lorsque l'utilisateur approche du bas de la liste, **50 cartes supplémentaires** sont ajoutées ;
- le chargement continue par lots de 50 jusqu'à la fin du classement ;
- les images restent en `loading="lazy"`.

Le tri est toujours effectué sur toute la collection avant affichage : seul le rendu HTML est progressif.
