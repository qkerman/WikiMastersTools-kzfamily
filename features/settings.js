(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.settings = {
    create(core) {
      const SETTINGS_KEY = 'wm_feature_settings_v1';

      const DEFAULTS = Object.freeze({
        premiumCards: true,
        wikipediaButtons: true,
        missingImages: true,
        collectionPrices: true,
        marketplacePrice: true,
        globalCollectionPrice: true,
        bulkPriceLoader: true,
        ranking: true,
        rankingSales: true,
        compactMode: true,
        packRecap: true,
        pullStats: true,
        openAll: true,
        autoOpen: true,
        tradeValues: true
      });

      const categories = [
        {
          title: 'Cartes',
          description: 'Apparence et enrichissement visuel des cartes.',
          items: [
            ['premiumCards', 'Design full-art / holographique', 'Remplace le rendu WikiMasters par le design amélioré avec ratio et couleurs adaptés.'],
            ['wikipediaButtons', 'Bouton Wikipédia', 'Ajoute le raccourci W sur les cartes.'],
            ['missingImages', 'Images manquantes via Wikimedia', 'Cherche une illustration Wikimedia Commons quand WikiMasters n’en fournit pas.']
          ]
        },
        {
          title: 'Prix & collection',
          description: 'Prix moyens, outils de collection et classement.',
          items: [
            ['collectionPrices', 'Prix moyens dans la collection', 'Affiche les badges de prix moyen directement sur les cartes de la collection.'],
            ['marketplacePrice', 'Prix moyen sur Marketplace', 'Affiche le prix moyen sur la fiche d’une annonce Marketplace.'],
            ['globalCollectionPrice', 'Prix dans la collection globale', 'Affiche le prix moyen quand une carte est inspectée dans la collection globale.'],
            ['bulkPriceLoader', 'Chargement massif des prix', 'Ajoute « Charger les prix » avec sélection des raretés.'],
            ['ranking', 'Classement « Plus chères »', 'Ajoute le classement des cartes connues par prix moyen.'],
            ['rankingSales', 'Mise en vente depuis le classement', 'Affiche les contrôles pour mettre directement une carte en vente depuis le classement.'],
            ['compactMode', 'Mode compact', 'Ajoute le bouton Compact dans les vues collection.']
          ]
        },
        {
          title: 'Paquets',
          description: 'Outils disponibles sur la page /pulls.',
          items: [
            ['packRecap', 'Récapitulatif des prix', 'Affiche le récap des cartes et de leurs prix après un paquet.'],
            ['pullStats', 'Statistiques de tirage', 'Compte les raretés obtenues et affiche leur répartition.'],
            ['openAll', 'Bouton « Tout ouvrir »', 'Permet d’ouvrir tous les paquets disponibles sans les animations.'],
            ['autoOpen', 'Ouverture automatique', 'Permet les cycles automatiques espacés aléatoirement de 20 à 100 minutes.']
          ]
        },
        {
          title: 'Échanges',
          description: 'Aides à l’estimation des trades.',
          items: [
            ['tradeValues', 'Valeur des échanges', 'Ajoute le prix de chaque carte et le total de chaque côté d’un échange.']
          ]
        }
      ];

      const { readLocalValue, writeLocalValue, isPullsPage, normalizeTitle } = core;

      function getSettings() {
        const saved = readLocalValue(SETTINGS_KEY);
        return {
          ...DEFAULTS,
          ...(saved && typeof saved === 'object' ? saved : {})
        };
      }

      function isEnabled(key) {
        return getSettings()[key] !== false;
      }

      function saveSettings(settings) {
        const clean = {};
        for (const key of Object.keys(DEFAULTS)) {
          clean[key] = settings?.[key] !== false;
        }
        writeLocalValue(SETTINGS_KEY, clean);
        return clean;
      }

      function openSettings() {
        document.getElementById('wm-settings-overlay')?.remove();

        let draft = getSettings();
        const overlay = document.createElement('div');
        overlay.id = 'wm-settings-overlay';
        overlay.className = 'wm-modal-overlay wm-settings-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-modal wm-settings-modal';

        const header = document.createElement('div');
        header.className = 'wm-settings-header';

        const headingWrap = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = 'Paramètres de l’extension';

        const subtitle = document.createElement('p');
        subtitle.textContent = 'Choisis uniquement les outils que tu veux utiliser.';
        headingWrap.append(title, subtitle);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'wm-settings-close';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Fermer les paramètres');
        header.append(headingWrap, closeButton);

        const body = document.createElement('div');
        body.className = 'wm-settings-body';

        const inputs = new Map();

        for (const category of categories) {
          const section = document.createElement('section');
          section.className = 'wm-settings-section';

          const sectionHead = document.createElement('div');
          sectionHead.className = 'wm-settings-section-head';

          const sectionTitle = document.createElement('h3');
          sectionTitle.textContent = category.title;

          const sectionDescription = document.createElement('p');
          sectionDescription.textContent = category.description;
          sectionHead.append(sectionTitle, sectionDescription);

          const list = document.createElement('div');
          list.className = 'wm-settings-list';

          for (const [key, labelText, descriptionText] of category.items) {
            const row = document.createElement('label');
            row.className = 'wm-settings-row';

            const copy = document.createElement('span');
            copy.className = 'wm-settings-copy';

            const label = document.createElement('strong');
            label.textContent = labelText;

            const description = document.createElement('span');
            description.textContent = descriptionText;
            copy.append(label, description);

            const toggle = document.createElement('span');
            toggle.className = 'wm-settings-toggle';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = draft[key] !== false;
            input.addEventListener('change', () => {
              draft[key] = input.checked;
              row.classList.toggle('is-enabled', input.checked);
            });
            inputs.set(key, input);

            const track = document.createElement('span');
            track.className = 'wm-settings-track';

            const knob = document.createElement('span');
            knob.className = 'wm-settings-knob';
            track.append(knob);

            toggle.append(input, track);
            row.classList.toggle('is-enabled', input.checked);
            row.append(copy, toggle);
            list.append(row);
          }

          section.append(sectionHead, list);
          body.append(section);
        }

        const footer = document.createElement('div');
        footer.className = 'wm-settings-footer';

        const note = document.createElement('span');
        note.className = 'wm-settings-note';
        note.textContent = 'Les changements sont appliqués après rechargement de la page.';

        const actions = document.createElement('div');
        actions.className = 'wm-settings-actions';

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'wm-tool-button wm-settings-reset';
        resetButton.textContent = 'Tout réactiver';
        resetButton.addEventListener('click', () => {
          draft = { ...DEFAULTS };
          for (const [key, input] of inputs) {
            input.checked = true;
            input.closest('.wm-settings-row')?.classList.add('is-enabled');
          }
        });

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'wm-tool-button wm-secondary-button';
        cancelButton.textContent = 'Annuler';

        const applyButton = document.createElement('button');
        applyButton.type = 'button';
        applyButton.className = 'wm-tool-button';
        applyButton.textContent = 'Appliquer';
        applyButton.addEventListener('click', () => {
          saveSettings(draft);
          location.reload();
        });

        actions.append(resetButton, cancelButton, applyButton);
        footer.append(note, actions);

        const close = () => {
          document.removeEventListener('keydown', onKeyDown);
          overlay.remove();
        };

        const onKeyDown = (event) => {
          if (event.key === 'Escape') close();
        };

        closeButton.addEventListener('click', close);
        cancelButton.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close();
        });
        document.addEventListener('keydown', onKeyDown);

        modal.append(header, body, footer);
        overlay.append(modal);
        document.body.append(overlay);
      }

      function ensureButton() {
        const existingSlot = document.getElementById('wm-settings-currency-slot');

        if (!isPullsPage()) {
          existingSlot?.remove();
          document.getElementById('wm-settings-button')?.remove();
          return;
        }

        const currencyButtons = [
          ...document.querySelectorAll(
            'button[aria-label="Ouvrir la boutique WikiBidous"], button[title*="wikibidous" i]'
          )
        ];

        // Sur desktop, le compteur WikiBidous vit dans le bloc fixe en haut à droite.
        // On privilégie explicitement ce bloc pour placer les paramètres juste dessous.
        const desktopCurrencyButton = currencyButtons.find((button) => {
          const parent = button.parentElement;
          return parent?.classList?.contains('fixed') &&
            parent.classList.contains('right-0') &&
            parent.classList.contains('md:block');
        });

        // Fallback si WikiMasters change légèrement son markup.
        const currencyButton = desktopCurrencyButton || currencyButtons.find((button) => (
          button.getClientRects().length > 0
        ));

        if (!currencyButton?.parentElement) return;

        const host = currencyButton.parentElement;
        let slot = existingSlot;

        if (!slot || slot.parentElement !== host) {
          slot?.remove();
          slot = document.createElement('div');
          slot.id = 'wm-settings-currency-slot';
          slot.className = 'wm-settings-currency-slot';
          currencyButton.insertAdjacentElement('afterend', slot);
        }

        let button = document.getElementById('wm-settings-button');
        if (!button) {
          button = document.createElement('button');
          button.id = 'wm-settings-button';
          button.type = 'button';
          button.className = 'wm-settings-launch';
          button.title = 'Paramètres de WikiMastersTools';
          button.setAttribute('aria-label', 'Ouvrir les paramètres de l’extension');

          const icon = document.createElement('span');
          icon.className = 'wm-settings-launch-icon';
          icon.textContent = '⚙';

          const text = document.createElement('span');
          text.textContent = 'Paramètres';

          button.append(icon, text);
          button.addEventListener('click', openSettings);
        }

        if (button.parentElement !== slot) {
          slot.append(button);
        }
      }

      return {
        SETTINGS_KEY,
        DEFAULTS,
        getSettings,
        isEnabled,
        saveSettings,
        ensureButton,
        openSettings
      };
    }
  };
})();
