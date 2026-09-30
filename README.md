PATCH NOTE EN BAS

[Chrome Web Store](https://chromewebstore.google.com/detail/wikimasters-prix-moyen-co/pkcnhclbagpfmlmolfcgedcmbccffgci)

[firefox addons](https://addons.mozilla.org/en-US/firefox/addon/wikimasters-tools-prix-moyen/)
merci à rodrigorod pour le port firefox

# WikiMastersTools-kzfamily

Add-on créé par la kzfamily.

**100% vibecodé**

## Installation (Chrome / Chromium / Opera / Brave)

1. Télécharger ou cloner le dépôt :

```bash
git clone https://github.com/qkerman/WikiMastersTools-kzfamily.git
```

Ou télécharger en haut à droite "code" > telecharger le zip

2. Ouvrir `chrome://extensions/` dans Chrome / Chromium.
3. Activer **Mode développeur**.
4. Cliquer sur **Charger l’extension non empaquetée**.
5. Sélectionner le dossier `WikiMastersTools-kzfamily` (dézippé) qui contient `manifest.json`.
6. Refresh WikiMasters.

## Installation (Firefox)

1. Ouvrir Firefox et aller sur `about:debugging#/runtime/this-firefox`.
2. Cliquer sur **Charger un module temporaire...** (Load Temporary Add-on...).
3. Sélectionner le fichier [manifest.json](manifest.json) situé dans le dossier de l'extension.
4. Rafraîchir WikiMasters (F5).

> Pour empaqueter l'extension pour Firefox (AMO ou distribution) :  
> `npx web-ext build` (le fichier zip sera généré dans `web-ext-artifacts/`).

## Mise à jour

```bash
cd ~/Downloads/WikiMastersTools-kzfamily
git pull
```

Ou retélécharger manuellement et remplacer le dossier.

Puis cliquer sur **Recharger** dans `chrome://extensions/` et faire un F5 sur WikiMasters.

## Patch note

*Heure de Paris*

- **30/09/2026** — « Familles » devient manuel : création d’une famille vide, recherche dans toutes les cartes WikiMasters, ajout/retrait carte par carte et bouton pour compléter automatiquement les cartes possédées. Les cartes utilisent désormais exactement la structure visuelle de la vraie page Collection, avec ou sans full-art.
- **30/09/2026** — « Familles » : vue normale épurée, cartes manquantes grisées, modifications regroupées dans un mode Édition et choix d’une carte de couverture pour la vignette de la famille.
- **28/09/2026** — Nouveaux outils pour les cartes, les échanges et les notifications, avec davantage de réglages pour les paquets.
- **27/09/2026** — Mise à jour du style et des performances des cartes.
- **25/09/2026** — Ajout des paramètres et amélioration des cartes sans image.
- **24/09/2026** — Ajout de l’ouverture automatique et du récapitulatif des paquets.
- **23/09/2026** — Extension disponible sur Firefox, Brave et Opera.
- **21/09/2026** — Ajout des outils de vente, de classement et d’estimation des échanges.
- **18/09/2026** — Ajout des prix moyens dans la collection, les paquets et le Marketplace.

- **30/09/2026** — « Familles » : import/export par code compact, avec compression automatique, carte de couverture conservée et possessions exclues du partage.

- **30/09/2026** — « Familles » : accueil simplifié, bouton « Charger mes cartes » mis en avant tant qu’une famille n’a jamais été synchronisée et texte d’explication enrichi.

- **30/09/2026** — « Familles » : passe UI/UX complète, hiérarchie visuelle simplifiée, édition plus claire, responsive amélioré et option dédiée pour masquer totalement la page du menu.

- **30/09/2026** — « Familles » : ajout d’un mode Marché qui recherche les annonces actives correspondant aux cartes manquantes et ouvre chaque enchère dans un nouvel onglet.

- **30/09/2026** — « Familles » : le Marché passe en recherche à la demande, carte par carte par titre exact, avec un bouton de recherche intelligente pour toutes les manquantes utilisant la même couverture par mots-clés que « Charger mes cartes ».

- **30/09/2026** — « Familles » : recherche Marché plus tolérante sur les titres Wikipédia (ex. « Runaway (chanson de Kanye West) » → « Runaway »), avec validation finale stricte par card_id.

- **30/09/2026** — « Familles » : l’ajout de cartes utilise désormais une pagination classique avec pages numérotées, précédent/suivant et skeleton de chargement à chaque changement de page.

- **30/09/2026** — « Familles » : le mode Marché affiche le logo WikiMasters pour les cartes sans image et « Rechercher toutes les manquantes » réessaie jusqu’à 3 fois à 5 secondes d’intervalle avant de passer à la suite.

- **30/09/2026** — « Familles » : les cartes manquantes restent grisées mais conservent désormais 100 % d’opacité et une luminosité suffisante pour garder titres et descriptions lisibles.

- **30/09/2026** — « Familles » : les cartes manquantes ne sont plus filtrées en bloc ; seuls les éléments visuels sont grisés et la zone texte garde un fond clair pour garantir la lisibilité, même sur les raretés sombres.

- **30/09/2026** — « Familles » : les annonces du mode Marché sont triées par fin d’enchère, de la plus proche à la plus lointaine.
