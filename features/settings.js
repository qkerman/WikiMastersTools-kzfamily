(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.settings = {
    create(core) {
      const SETTINGS_KEY = 'wm_feature_settings_v1';
      const SETTINGS_BUTTON_SEEN_KEY = 'wm_settings_button_seen_v1';

      const DEFAULTS = Object.freeze({
        premiumCards: true,
        wikipediaButtons: true,
        missingImages: true,
        copyCardImage: true,
        pullShareButton: true,
        hideCardStats: true,
        collectionPrices: true,
        marketplacePrice: true,
        globalCollectionPrice: true,
        bulkPriceLoader: true,
        ranking: true,
        rankingSales: true,
        themeTracker: true,
        compactMode: true,
        packRecap: true,
        pullStats: true,
        openAll: true,
        autoOpen: true,
        tradeValues: true,
        tradePreviews: true,
        notificationSound: true
      });

      const categories = [
        {
          title: 'Cartes',
          description: 'Apparence et enrichissement visuel des cartes.',
          items: [
            ['premiumCards', 'Design full-art / holographique', 'Remplace le rendu WikiMasters par le design amélioré avec ratio et couleurs adaptés.'],
            ['wikipediaButtons', 'Bouton Wikipédia', 'Ajoute le raccourci W sur les cartes.'],
            ['missingImages', 'Images manquantes via Wikimedia', 'Cherche une illustration Wikimedia Commons quand WikiMasters n’en fournit pas.'],
            ['copyCardImage', 'Copier la carte comme image', 'Ajoute dans la fiche d’une carte un bouton pour copier son rendu en PNG.'],
            ['hideCardStats', 'Masquer ATK / DEF', 'Masque indépendamment les valeurs d’attaque et de défense sur les cartes et dans leur fiche.']
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
          title: 'Familles',
          description: 'Collectionne et partage des groupes de cartes personnalisés.',
          items: [
            ['themeTracker', 'Afficher la page Familles', 'Ajoute Familles au menu latéral. Désactive cette option pour masquer entièrement la page et son entrée dans le menu.']
          ]
        },
        {
          title: 'Paquets',
          description: 'Outils disponibles sur la page /pulls.',
          items: [
            ['packRecap', 'Récapitulatif des prix', 'Affiche le récap des cartes et de leurs prix après un paquet.'],
            ['pullShareButton', 'Bouton « Partager » pendant l’ouverture', 'Affiche le bouton Partager sur /pull pour copier l’écran de la carte en cours d’ouverture.'],
            ['pullStats', 'Statistiques de tirage', 'Compte les raretés obtenues et affiche leur répartition.'],
            ['openAll', 'Bouton « Tout ouvrir »', 'Permet d’ouvrir tous les paquets disponibles sans les animations.'],
            ['autoOpen', 'Ouverture automatique', 'Permet les cycles automatiques avec un intervalle aléatoire personnalisable.']
          ]
        },
        {
          title: 'Échanges',
          description: 'Aides à l’estimation des trades.',
          items: [
            ['tradeValues', 'Valeur des échanges', 'Ajoute le prix de chaque carte et le total de chaque côté d’un échange.'],
            ['tradePreviews', 'Prévisualisation complète des cartes', 'Remplace les noms tronqués des offres par des mini-cartes avec image, rareté et titre complet.']
          ]
        },
        {
          title: 'Confort',
          description: 'Petites améliorations de navigation.',
          items: [
            ['notificationSound', 'Son de notification', 'Joue un petit son quand le compteur de notifications augmente.']
          ]
        }
      ];

      const {
        readLocalValue,
        writeLocalValue,
        normalizeTitle,
        AUTO_OPEN_NEXT_AT_KEY,
        AUTO_OPEN_MIN_MINUTES_KEY,
        AUTO_OPEN_MAX_MINUTES_KEY,
        AUTO_OPEN_DEFAULT_MIN_MINUTES,
        AUTO_OPEN_DEFAULT_MAX_MINUTES
      } = core;

      function normalizeAutoOpenInterval(minValue, maxValue) {
        const clampMinutes = (value, fallback) => {
          const numeric = Math.round(Number(value));
          if (!Number.isFinite(numeric)) return fallback;
          return Math.max(1, Math.min(10080, numeric));
        };

        const first = clampMinutes(minValue, AUTO_OPEN_DEFAULT_MIN_MINUTES);
        const second = clampMinutes(maxValue, AUTO_OPEN_DEFAULT_MAX_MINUTES);

        return {
          minMinutes: Math.min(first, second),
          maxMinutes: Math.max(first, second)
        };
      }

      function getAutoOpenInterval() {
        return normalizeAutoOpenInterval(
          readLocalValue(AUTO_OPEN_MIN_MINUTES_KEY),
          readLocalValue(AUTO_OPEN_MAX_MINUTES_KEY)
        );
      }

      function saveAutoOpenInterval(minValue, maxValue) {
        const interval = normalizeAutoOpenInterval(minValue, maxValue);
        const previous = getAutoOpenInterval();

        writeLocalValue(AUTO_OPEN_MIN_MINUTES_KEY, interval.minMinutes);
        writeLocalValue(AUTO_OPEN_MAX_MINUTES_KEY, interval.maxMinutes);

        if (
          interval.minMinutes !== previous.minMinutes ||
          interval.maxMinutes !== previous.maxMinutes
        ) {
          localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
        }

        return interval;
      }

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
        let draftAutoOpenInterval = getAutoOpenInterval();
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

          if (category.title === 'Paquets') {
            const intervalRow = document.createElement('div');
            intervalRow.className = 'wm-settings-row wm-settings-interval-row';

            const intervalCopy = document.createElement('span');
            intervalCopy.className = 'wm-settings-copy';

            const intervalLabel = document.createElement('strong');
            intervalLabel.textContent = 'Intervalle d’ouverture automatique';

            const intervalDescription = document.createElement('span');
            intervalDescription.textContent = 'Un délai aléatoire est choisi entre ces deux valeurs.';
            intervalCopy.append(intervalLabel, intervalDescription);

            const intervalFields = document.createElement('div');
            intervalFields.className = 'wm-settings-interval-fields';

            const createMinuteField = (labelText, value, onChange) => {
              const field = document.createElement('label');
              field.className = 'wm-settings-minute-field';

              const fieldLabel = document.createElement('span');
              fieldLabel.textContent = labelText;

              const input = document.createElement('input');
              input.type = 'number';
              input.min = '1';
              input.max = '10080';
              input.step = '1';
              input.inputMode = 'numeric';
              input.value = String(value);
              input.addEventListener('input', () => onChange(input.value));

              field.append(fieldLabel, input);
              return { field, input };
            };

            const minField = createMinuteField(
              'Min',
              draftAutoOpenInterval.minMinutes,
              (value) => {
                draftAutoOpenInterval = {
                  ...draftAutoOpenInterval,
                  minMinutes: value
                };
              }
            );

            const maxField = createMinuteField(
              'Max',
              draftAutoOpenInterval.maxMinutes,
              (value) => {
                draftAutoOpenInterval = {
                  ...draftAutoOpenInterval,
                  maxMinutes: value
                };
              }
            );

            intervalFields.append(minField.field, maxField.field);

            const unit = document.createElement('span');
            unit.className = 'wm-settings-interval-unit';
            unit.textContent = 'min';
            intervalFields.append(unit);

            intervalRow.append(intervalCopy, intervalFields);
            list.append(intervalRow);

            inputs.set('__autoOpenMin', minField.input);
            inputs.set('__autoOpenMax', maxField.input);
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
          draftAutoOpenInterval = {
            minMinutes: AUTO_OPEN_DEFAULT_MIN_MINUTES,
            maxMinutes: AUTO_OPEN_DEFAULT_MAX_MINUTES
          };

          for (const [key, input] of inputs) {
            if (key === '__autoOpenMin') {
              input.value = String(AUTO_OPEN_DEFAULT_MIN_MINUTES);
              continue;
            }

            if (key === '__autoOpenMax') {
              input.value = String(AUTO_OPEN_DEFAULT_MAX_MINUTES);
              continue;
            }

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

          const normalizedInterval = saveAutoOpenInterval(
            inputs.get('__autoOpenMin')?.value ?? draftAutoOpenInterval.minMinutes,
            inputs.get('__autoOpenMax')?.value ?? draftAutoOpenInterval.maxMinutes
          );

          const minInput = inputs.get('__autoOpenMin');
          const maxInput = inputs.get('__autoOpenMax');
          if (minInput) minInput.value = String(normalizedInterval.minMinutes);
          if (maxInput) maxInput.value = String(normalizedInterval.maxMinutes);

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

        const currencyButtons = [
          ...document.querySelectorAll('button[aria-label="Ouvrir la boutique WikiBidous"]')
        ];

        const desktopCurrencyButton = currencyButtons.find((button) => {
          const parent = button.parentElement;
          return parent?.classList?.contains('fixed') &&
            parent.classList.contains('right-0') &&
            parent.classList.contains('md:block');
        });

        const currencyButton = desktopCurrencyButton || currencyButtons.find(
          (button) => button.getClientRects().length > 0
        );

        if (!currencyButton?.parentElement) {
          existingSlot?.remove();
          document.getElementById('wm-settings-button')?.remove();
          return;
        }

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
          button.addEventListener('click', () => {
            writeLocalValue(SETTINGS_BUTTON_SEEN_KEY, true);
            button.classList.remove('wm-settings-launch-attention');
            openSettings();
          });
        }

        button.classList.toggle(
          'wm-settings-launch-attention',
          readLocalValue(SETTINGS_BUTTON_SEEN_KEY) !== true
        );

        if (button.parentElement !== slot) {
          slot.append(button);
        }
      }

      return {
        SETTINGS_KEY,
        SETTINGS_BUTTON_SEEN_KEY,
        DEFAULTS,
        getSettings,
        isEnabled,
        saveSettings,
        getAutoOpenInterval,
        saveAutoOpenInterval,
        ensureButton,
        openSettings
      };
    }
  };
})();
