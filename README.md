FIN DU DEV JAI LA FLEMME HESITEZ PAS A FORK ET POSTER SUR LE STORE ETC HF !!!!


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

## Tests de régression

Avec Node.js 22 ou plus récent, sans dépendance à installer :

```bash
node --test tests/*.test.js
```

Les tests couvrent les prix par rareté, les exemplaires en double, le cache et la file de
chargement, les délais réseau, les limitations du serveur, l'arrêt des paquets et les
ouvertures concurrentes entre onglets. Les réponses réseau sont simulées ; aucun
paquet réel n'est consommé par ces tests.

## Patch note

*Heure de Paris*

- **05/10/2026 — v4.29.1** — Interface des paquets simplifiée : suppression des boutons « Arrêter » et « Revoir le dernier récap » ; compteur discret « 3/5 ouverts » pendant l’ouverture, conservé pendant les attentes.
- **05/10/2026 — v4.29** — Correction des prix sur les exemplaires en double et des moyennes d'une autre rareté ; délais réseau et limitations de requêtes gérés ; ouvertures protégées entre onglets ; bouton « Arrêter » et récapitulatif récupérable après rechargement. L'arrêt de l'ouverture automatique interrompt le lot après le paquet en cours. Les vérifications du site doivent être validées manuellement. Les anciens prix en cache seront rechargés pour éliminer les moyennes incorrectes.
- **05/10/2026** — Ajout de la page « Mes enchères » avec suivi, surenchère en un clic et alerte sonore, désactivable dans les paramètres.
- **30/09/2026** — Ajout de la page « Familles ».
- **28/09/2026** — Nouveaux outils pour les cartes, les échanges et les notifications, avec davantage de réglages pour les paquets.
- **27/09/2026** — Mise à jour du style et des performances des cartes.
- **25/09/2026** — Ajout des paramètres et amélioration des cartes sans image.
- **24/09/2026** — Ajout de l’ouverture automatique et du récapitulatif des paquets.
- **23/09/2026** — Extension disponible sur Firefox, Brave et Opera.
- **21/09/2026** — Ajout des outils de vente, de classement et d’estimation des échanges.
- **18/09/2026** — Ajout des prix moyens dans la collection, les paquets et le Marketplace.
