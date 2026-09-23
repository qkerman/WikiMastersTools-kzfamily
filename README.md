PATCH NOTE EN BAS

[Chrome Web Store](https://chromewebstore.google.com/detail/wikimasters-prix-moyen-co/pkcnhclbagpfmlmolfcgedcmbccffgci)

Firefox arrive dans quelques jours (le temps que le store valide)
merci à rodrigorod pour le port

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

- **23/09/2026 — 13:25** — Compatibilité multi-navigateurs : support officiel de Firefox (Manifest V3 / gecko ID), Brave et Opera, avec runtime universel.
- **22/09/2026 — 17:37** — Ajout du prix moyen lors de l’inspection d’une carte dans la collection globale.
- **21/09/2026 — 08:35** — Ajout de la mise en vente directe depuis le classement des cartes les plus chères.
- **19/09/2026 — 17:45** — Ajout de l’estimation des échanges avec le prix de chaque carte et le total de chaque côté.
- **19/09/2026 — 12:01** — Ajout du bouton « Tout ouvrir » pour ouvrir tous les paquets et afficher les cartes obtenues triées par prix moyen.
- **19/09/2026 — 09:26** — Ajout de l’affichage du prix moyen à chaque paquet ouvert.
- **18/09/2026 — 19:58** — Ajout d’une option pour charger uniquement le prix des nouvelles cartes.
- **18/09/2026 — 19:07** — Ajout du choix des raretés à charger.
- **18/09/2026 — 19:00** — Ajout du prix moyen sur les annonces Marketplace.
- **18/09/2026 — 18:48** — Ajout du classement des cartes les plus chères.
- **18/09/2026 — 18:30** — Ajout de l’affichage du prix moyen dans la collection.
