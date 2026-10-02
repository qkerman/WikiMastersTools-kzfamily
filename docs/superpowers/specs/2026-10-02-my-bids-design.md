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

- Pas de module `bridge/` : les scripts `features/*` tournent dans le monde de la
  page et appellent déjà `fetch('/api/marketplace…')` directement avec les
  cookies (cf. `features/theme-tracker.js`). Un bridge n'apporterait rien.
- `features/my-bids.js` : entrée de menu, page, polling, compteurs, son, appels
  `GET` liste et `POST /bid`.
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
- Id utilisateur : lu dans le cookie Supabase `sb-<ref>-auth-token` (éventuellement
  découpé en `.0`, `.1`), JSON encodé en base64 préfixé `base64-`, champ `user.id`.
  Vérifié : cet id correspond bien aux enchères où l'on est `current_bidder_id`.
  Seul `user.id` est lu, jamais les jetons. Si le cookie est illisible, le statut
  est « inconnu » (pas de badge), le reste fonctionne.
- Solde : `GET /api/wikibidous` renvoie `{"balance": n}`. Lu au chargement, puis
  au plus une fois par minute, et mis à jour par `bidder_balance` après une mise.

## Interface

- Liste compacte triée par fin imminente.
- Ligne : vignette, titre, rareté, mise actuelle, compte à rebours, badge
  « En tête » ou « Dépassé », bouton « Miser N ».
- Un clic mise le minimum accepté par le site : première mise au montant de départ,
  puis la mise courante plus 10 % arrondie au supérieur. Si le serveur répond avec
  un minimum, le bouton l'adopte. Puis mise à jour de la ligne avec `current_bid`
  et `bidder_balance`.
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

- Règle du minimum, mesurée sur 21 paires de mises réelles : première mise égale au
  montant de départ, puis minimum égal à `ceil(mise courante x 1,1)` (1000 donne 1100,
  111 donne 123, 5 donne 6). Calcul en entiers pour éviter les erreurs de flottants.
- Rôle de `/api/human-check` dans le flux de mise : le message d'erreur du serveur
  est affiché tel quel.
- Onglet en arrière-plan plus de 5 minutes : Chrome peut limiter les minuteries à
  une exécution par minute, ce qui retarderait le bip. À mesurer en conditions
  réelles ; si c'est le cas, déplacer le métronome dans un Web Worker.
