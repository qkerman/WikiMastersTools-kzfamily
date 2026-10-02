# Page « Mes enchères » légère : design

Date : 2026-10-02
Branche : `worktree-feat-my-bids` (worktree local `.claude/worktrees/feat-my-bids`)

## Objectif

Ajouter à l'extension une entrée de menu « Mes enchères » qui ouvre une page
dédiée, beaucoup plus légère que l'onglet natif du Marché. Elle permet de :

1. voir rapidement les enchères où l'utilisateur a misé et qui sont en cours ;
2. surenchérir en un clic ;
3. être alerté par un son quand une de ces enchères passe sous 1 minute.

## Périmètre

- Inclus : enchères actives où j'ai misé (`bidding`), surenchère à incrément
  fixe en un clic, bip sous 60 s pour toutes ces enchères (en tête ou dépassé).
- Exclus (YAGNI) : mes ventes, enchères gagnées, historique, champ de montant
  libre, deux sons distincts, notifications système.

## Contexte technique

Extension MV3 injectée sur `https://www.wiki-masters.com/*`. Les scripts sont
chargés séquentiellement par `bootstrap.js` dans le monde de la page. Le côté
`bridge/*` appelle `fetch` avec les cookies du site, le côté `features/*` gère
l'UI. Le modèle d'une page ajoutée au menu est `features/theme-tracker.js`
(`#wm-theme-tracker-nav`, page « Familles »).

### Endpoints du site (vérifiés en lecture seule)

| Usage | Appel | Réponse utile |
| --- | --- | --- |
| Liste de mes enchères | `GET /api/marketplace?page=1&limit=1&mine=1` | `bidding[]` : `id`, `card`, `end_at`, `current_bid`, `effective_bid`, `current_bidder_id`, `status`, `seller` |
| Surenchère | `POST /api/marketplace/{id}/bid` corps `{"amount": n}` | `current_bid`, `bidder_balance`, ou `{error}` |
| Détail d'une enchère | `GET /api/marketplace/{id}` | déjà utilisé par `bridge/marketplace.js` |

Le site déduit « en tête » de `current_bidder_id === userId`. Il existe aussi
`/api/human-check` et `/api/marketplace/{id}/settle` (fin d'enchère) à
surveiller pendant l'implémentation.

## Architecture

- `bridge/my-bids.js` : `fetchMyBids()` (GET liste) et `placeBid(id, amount)`
  (POST). Utilise `originalFetch` comme `bridge/marketplace.js`, communique avec
  la couche features par `CustomEvent` (même convention que les autres bridges).
- `features/my-bids.js` : entrée de menu, page, polling, compteurs, son.
- `features/my-bids-logic.js` : fonctions pures sans DOM (tri, statut en tête ou
  dépassé, prochaine mise, détection du passage sous 60 s dédoublonnée). C'est
  la partie testée en Node.
- Branchement : `manifest.json` (web_accessible_resources), `bootstrap.js`
  (liste `paths`), `content.js` (`requiredFeatures` et instanciation),
  `features/app.js` (rendu, routage, `mutationIsExtensionOwned`),
  `features/settings.js` (interrupteur page et son), `styles.css`.

## Données et polling

- Polling de la liste toutes les 5 à 10 s page visible, plus lent en arrière-plan.
- Les compteurs sont recalculés chaque seconde localement à partir de `end_at`,
  sans requête.
- Id utilisateur : déduit des enchères où l'utilisateur est `current_bidder_id`
  et confirmé par la réponse du `POST /bid`. Fallback à valider à l'implémentation
  (par exemple lecture de la session ou de `/api/wikibidous`).

## Interface

- Liste compacte triée par fin imminente.
- Ligne : vignette, titre, rareté, mise actuelle, compte à rebours, badge
  « En tête » ou « Dépassé », bouton « +X ».
- Clic sur « +X » : `POST /bid` avec `current_bid + incrément`, puis mise à jour
  de la ligne avec `current_bid` et `bidder_balance`.
- L'incrément est réglable, avec le minimum du site par défaut.
- Erreurs (solde insuffisant, mise dépassée, enchère terminée) affichées sur la ligne.
- Bouton son activé ou coupé, qui sert aussi au déblocage audio par premier clic.

## Son

- Bip généré par Web Audio, sans fichier audio.
- Déclenché une seule fois par id d'enchère au passage sous 60 s, pour toutes
  les enchères de la liste.
- Fonctionne onglet en arrière-plan tant que la page « Mes enchères » reste ouverte
  (contexte audio déverrouillé par un geste utilisateur).

## Cas limites

- Enchère terminée : passe en « Terminée » ou disparaît, sans bip.
- Erreur réseau : on garde la dernière liste et on affiche un indicateur discret.
- Session expirée (401) : message clair.
- Liste vide : « Vous n'êtes en lice sur aucune enchère. »

## Tests

- Logique pure (`my-bids-logic.js`) testée en Node : tri, statut, incrément,
  déclenchement unique du bip.
- Vérification manuelle sur wiki-masters.com. Aucune mise réelle sans accord
  explicite de l'utilisateur.

## Questions ouvertes pour l'implémentation

- Incrément minimum exigé par le site et règle exacte de validation côté serveur.
- Rôle de `/api/human-check` dans le flux de mise.
- Source fiable de l'id utilisateur.
