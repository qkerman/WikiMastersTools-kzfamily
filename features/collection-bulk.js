(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.collectionBulk = {
    create(runtime) {
      const {
        CACHE_TTL, BULK_RARITY_LAST_LOAD_KEY, ALL_COLLECTION_KEY, RARITIES,
        DEFAULT_RARE_RARITIES, isCollectionPage, normalizeTitle, cacheKey,
        storageGet, storageSet, reportError, createSponsorNote, isContextInvalidatedError
      } = runtime.core;

      let bulkActive = false;
      let bulkRequestId = null;
      let bulkSelectedRarities = new Set(DEFAULT_RARE_RARITIES);
      let bulkForceRarities = new Set();
      let bulkOnlyUnloaded = false;
      let bulkButton = null;
      let rankingButton = null;

      function ensurePriceLegend(toolbar = document.getElementById('wm-tools-bar')) {
        if (!isCollectionPage() || !toolbar || document.getElementById('wm-price-legend')) return;

        const legend = document.createElement('div');
        legend.id = 'wm-price-legend';
        legend.className = 'wm-price-legend';

        const heading = document.createElement('strong');
        heading.className = 'wm-price-legend-title';
        heading.textContent = 'Légende des prix';

        const items = document.createElement('div');
        items.className = 'wm-price-legend-items';

        const definitions = [
          {
            badge: 'Moy. 12 W',
            className: 'wm-price-legend-badge',
            text: 'prix moyen des ventes'
          },
          {
            badge: 'Moy. —',
            className: 'wm-price-legend-badge is-empty',
            text: 'aucune moyenne disponible'
          },
          {
            badge: 'Prix indispo.',
            className: 'wm-price-legend-badge is-error',
            text: 'erreur temporaire, nouvel essai automatique'
          },
          {
            badge: 'Prix…',
            className: 'wm-price-legend-badge is-loading',
            text: 'prix en cours de chargement'
          }
        ];

        for (const definition of definitions) {
          const item = document.createElement('span');
          item.className = 'wm-price-legend-item';

          const badge = document.createElement('span');
          badge.className = definition.className;
          badge.textContent = definition.badge;

          const text = document.createElement('span');
          text.className = 'wm-price-legend-text';
          text.textContent = definition.text;

          item.append(badge, text);
          items.append(item);
        }

        legend.append(heading, items);
        toolbar.insertAdjacentElement('afterend', legend);
      }

      function ensureToolbar() {
        if (!isCollectionPage() || document.getElementById('wm-tools-bar')) return;

        const h1 = [...document.querySelectorAll('h1')].find((el) => normalizeTitle(el.textContent) === 'Collection');
        if (!h1) return;

        const header = h1.parentElement;
        if (!header?.parentElement) return;

        const bar = document.createElement('div');
        bar.id = 'wm-tools-bar';
        bar.className = 'wm-tools-bar';

        bulkButton = document.createElement('button');
        bulkButton.type = 'button';
        bulkButton.className = 'wm-tool-button';
        bulkButton.textContent = 'Charger les prix';
        bulkButton.title = 'Choisir les raretés dont tu veux charger ou actualiser les prix';
        bulkButton.addEventListener('click', () => {
          handleBulkClick().catch((error) => reportError('chargement', error));
        });

        rankingButton = document.createElement('button');
        rankingButton.type = 'button';
        rankingButton.className = 'wm-tool-button';
        rankingButton.textContent = 'Plus chères';
        rankingButton.title = 'Affiche toute la collection triée par prix moyen décroissant';
        rankingButton.addEventListener('click', () => {
          runtime.ranking.openRankingModal().catch((error) => {
            reportError('classement', error);
            runtime.modalUi.showInfoModal(
              'Classement impossible',
              String(error?.message || error || 'Impossible de charger la collection.')
            );
          });
        });

        bar.append(bulkButton, rankingButton, createSponsorNote());
        header.insertAdjacentElement('afterend', bar);
        ensurePriceLegend(bar);
      }

      async function handleBulkClick() {
        if (bulkActive) return;

        const lastLoadsData = storageGet(BULK_RARITY_LAST_LOAD_KEY);
        const lastLoads = lastLoadsData[BULK_RARITY_LAST_LOAD_KEY] || {};

        const selection = await showRaritySelectionModal(lastLoads);
        if (!selection?.rarities?.length) return;

        const selected = selection.rarities;
        const onlyUnloaded = Boolean(selection.onlyUnloaded);
        const now = Date.now();

        const forceRarities = new Set();
        if (!onlyUnloaded) {
          const recentRarities = selected.filter((rarity) => {
            const timestamp = Number(lastLoads[rarity]) || 0;
            return timestamp > 0 && now - timestamp < CACHE_TTL;
          });

          if (recentRarities.length > 0) {
            const confirmed = await showReloadConfirmation(recentRarities, lastLoads);
            if (!confirmed) return;
            recentRarities.forEach((rarity) => forceRarities.add(rarity));
          }
        }

        bulkActive = true;
        bulkSelectedRarities = new Set(selected);
        bulkForceRarities = forceRarities;
        bulkOnlyUnloaded = onlyUnloaded;
        bulkRequestId = `bulk:${now}:${Math.random().toString(36).slice(2)}`;

        setBulkButtonState('Collection…', true);

        window.dispatchEvent(new CustomEvent('wm-average-load-all-collection', {
          detail: {
            requestId: bulkRequestId,
            selectedRarities: [...bulkSelectedRarities]
          }
        }));
      }

      function showRaritySelectionModal(lastLoads = {}) {
        return new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.className = 'wm-modal-overlay';

          const modal = document.createElement('div');
          modal.className = 'wm-modal wm-confirm-modal wm-rarity-modal';

          const title = document.createElement('h2');
          title.textContent = 'Quels prix mettre à jour ?';

          const text = document.createElement('p');
          text.className = 'wm-rarity-explanation';
          text.textContent = 'Sélectionne seulement les raretés qui t’intéressent. Le gros avantage, c’est de ne pas perdre du temps à charger les prix de toutes les cartes communes.';

          const tip = document.createElement('p');
          tip.className = 'wm-rarity-tip';
          tip.textContent = 'Exemple : L / UR / SR / R tous les jours, puis PC / C seulement une fois par semaine.';

          const presets = document.createElement('div');
          presets.className = 'wm-rarity-presets';

          const grid = document.createElement('div');
          grid.className = 'wm-rarity-grid';

          const selected = new Set(DEFAULT_RARE_RARITIES);
          const checkboxByRarity = new Map();

          const updateChecks = () => {
            for (const [rarity, input] of checkboxByRarity) {
              input.checked = selected.has(rarity);
              input.closest('.wm-rarity-option')?.classList.toggle('is-selected', input.checked);
            }
          };

          let onlyUnloaded = false;

          const makePreset = (label, rarities) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wm-tool-button wm-rarity-preset';
            button.textContent = label;
            button.addEventListener('click', () => {
              selected.clear();
              rarities.forEach((rarity) => selected.add(rarity));
              updateChecks();
            });
            return button;
          };

          const missingOption = document.createElement('label');
          missingOption.className = 'wm-missing-option';

          const missingInput = document.createElement('input');
          missingInput.type = 'checkbox';

          const missingText = document.createElement('span');
          missingText.className = 'wm-missing-text';

          const missingTitle = document.createElement('strong');
          missingTitle.textContent = 'Uniquement les cartes non chargées';

          const missingDescription = document.createElement('span');
          missingDescription.textContent = 'Idéal après avoir ajouté de nouvelles cartes : seules celles qui n’ont encore aucun prix en cache seront chargées.';

          missingText.append(missingTitle, missingDescription);
          missingOption.append(missingInput, missingText);

          const updateMissingState = () => {
            onlyUnloaded = missingInput.checked;
            missingOption.classList.toggle('is-selected', onlyUnloaded);
          };

          missingInput.addEventListener('change', updateMissingState);

          const missingPreset = document.createElement('button');
          missingPreset.type = 'button';
          missingPreset.className = 'wm-tool-button wm-rarity-preset';
          missingPreset.textContent = 'Non chargées';
          missingPreset.addEventListener('click', () => {
            selected.clear();
            RARITIES.forEach((rarity) => selected.add(rarity));
            updateChecks();
            missingInput.checked = true;
            updateMissingState();
          });

          presets.append(
            makePreset('Rares', ['L', 'UR', 'SR', 'R']),
            makePreset('Courantes', ['PC', 'C']),
            makePreset('Toutes', RARITIES),
            missingPreset
          );

          for (const rarity of RARITIES) {
            const label = document.createElement('label');
            label.className = 'wm-rarity-option';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = rarity;
            input.checked = selected.has(rarity);
            checkboxByRarity.set(rarity, input);

            const main = document.createElement('span');
            main.className = 'wm-rarity-option-main';
            main.textContent = rarity;

            const last = document.createElement('span');
            last.className = 'wm-rarity-last';
            const timestamp = Number(lastLoads[rarity]) || 0;
            last.textContent = timestamp ? `dernier chargement : il y a ${humanElapsed(timestamp)}` : 'jamais chargé en masse';

            input.addEventListener('change', () => {
              if (input.checked) selected.add(rarity);
              else selected.delete(rarity);
              label.classList.toggle('is-selected', input.checked);
            });

            label.classList.toggle('is-selected', input.checked);
            label.append(input, main, last);
            grid.append(label);
          }

          const actions = document.createElement('div');
          actions.className = 'wm-modal-actions';

          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'wm-tool-button wm-secondary-button';
          cancel.textContent = 'Annuler';

          const confirm = document.createElement('button');
          confirm.type = 'button';
          confirm.className = 'wm-tool-button';
          confirm.textContent = 'Charger ces raretés';

          const close = (value) => {
            overlay.remove();
            resolve(value);
          };

          cancel.addEventListener('click', () => close(null));
          confirm.addEventListener('click', () => {
            const values = RARITIES.filter((rarity) => selected.has(rarity));
            if (!values.length) {
              confirm.textContent = 'Choisis au moins une rareté';
              return;
            }
            close({ rarities: values, onlyUnloaded });
          });
          overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(null);
          });

          actions.append(cancel, confirm);
          modal.append(title, text, tip, presets, missingOption, grid, actions);
          overlay.append(modal);
          document.body.append(overlay);
        });
      }

      function setBulkButtonState(label, disabled) {
        ensureToolbar();
        if (!bulkButton) return;
        bulkButton.textContent = label;
        bulkButton.disabled = Boolean(disabled);
      }

      function updateBulkProgress(total, pendingCount) {
        if (!bulkActive || !total) return;
        const completed = Math.max(0, total - pendingCount);
        const label = bulkOnlyUnloaded ? 'Nouvelles' : 'Prix';
        setBulkButtonState(`${label} ${completed}/${total}`, true);
      }

      function finishBulkLoad(doneLabel = 'Chargé ✓') {
        if (!bulkActive) return;

        if (!bulkOnlyUnloaded) {
          const selectedRarities = [...bulkSelectedRarities];
          const data = storageGet(BULK_RARITY_LAST_LOAD_KEY);
          const lastLoads = { ...(data[BULK_RARITY_LAST_LOAD_KEY] || {}) };
          const now = Date.now();
          selectedRarities.forEach((rarity) => {
            lastLoads[rarity] = now;
          });
          storageSet({ [BULK_RARITY_LAST_LOAD_KEY]: lastLoads });
        }

        bulkActive = false;
        bulkRequestId = null;
        bulkForceRarities.clear();
        bulkOnlyUnloaded = false;
        setBulkButtonState(doneLabel, false);
        setTimeout(() => {
          if (!bulkActive) setBulkButtonState('Charger les prix', false);
        }, 2200);
      }

      function failBulkLoad(message) {
        bulkActive = false;
        bulkRequestId = null;
        bulkOnlyUnloaded = false;
        setBulkButtonState('Erreur', false);
        runtime.modalUi.showInfoModal('Chargement impossible', message || 'Impossible de charger toute la collection pour le moment.');
        setTimeout(() => {
          if (!bulkActive) setBulkButtonState('Charger les prix', false);
        }, 2200);
      }

      function humanElapsed(timestamp) {
        const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const remaining = minutes % 60;
        return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
      }

      function showReloadConfirmation(recentRarities, lastLoads) {
        return new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.className = 'wm-modal-overlay';

          const modal = document.createElement('div');
          modal.className = 'wm-modal wm-confirm-modal';

          const title = document.createElement('h2');
          title.textContent = 'Recharger des prix déjà récents ?';

          const text = document.createElement('p');
          const details = recentRarities
            .map((rarity) => `${rarity} (il y a ${humanElapsed(Number(lastLoads[rarity]) || Date.now())})`)
            .join(', ');
          text.textContent = `Ces raretés ont déjà été chargées il y a moins de 24 h : ${details}. Les relancer force de nouvelles requêtes pour leurs cartes. Par prudence, évite de le faire trop souvent si ce n’est pas nécessaire. Recharger quand même ces raretés ?`;

          const actions = document.createElement('div');
          actions.className = 'wm-modal-actions';

          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'wm-tool-button wm-secondary-button';
          cancel.textContent = 'Garder le cache';

          const confirm = document.createElement('button');
          confirm.type = 'button';
          confirm.className = 'wm-tool-button wm-danger-button';
          confirm.textContent = 'Recharger quand même';

          const close = (value) => {
            overlay.remove();
            resolve(value);
          };

          cancel.addEventListener('click', () => close(false));
          confirm.addEventListener('click', () => close(true));
          overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(false);
          });

          actions.append(cancel, confirm);
          modal.append(title, text, actions);
          overlay.append(modal);
          document.body.append(overlay);
        });
      }


      window.addEventListener('wm-average-all-collection-progress', (event) => {
        if (!bulkActive || event.detail?.requestId !== bulkRequestId) return;
        const loadedPages = Number(event.detail.loadedPages) || 0;
        const totalPages = Number(event.detail.totalPages) || 0;
        if (totalPages > 0) {
          setBulkButtonState(`Collection ${loadedPages}/${totalPages}`, true);
        }
      });

      window.addEventListener('wm-average-all-collection', (event) => {
        const detail = event.detail || {};
        if (!bulkActive || detail.requestId !== bulkRequestId) return;

        if (!detail.ok) {
          failBulkLoad(detail.error || 'Erreur réseau');
          return;
        }

        const cards = Array.isArray(detail.cards) ? detail.cards : [];
        const fetchedAt = Date.now();

        if (detail.complete) {
          storageSet({
            [ALL_COLLECTION_KEY]: { fetchedAt, cards, complete: true }
          });
        } else {
          // Keep every piece of collection metadata we have already seen.
          // A partial load is enough for « Plus chères » to rank the cached prices.
          const existingEntry = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];
          const existingCards = Array.isArray(existingEntry?.cards) ? existingEntry.cards : [];
          const merged = new Map(existingCards.map((card) => [card.id, { ...card }]));

          for (const card of cards) {
            const previous = merged.get(card.id);
            merged.set(card.id, previous ? { ...previous, ...card } : { ...card });
          }

          storageSet({
            [ALL_COLLECTION_KEY]: {
              fetchedAt,
              cards: [...merged.values()],
              complete: existingEntry?.complete === true
            }
          });
        }

        if (!cards.length) {
          finishBulkLoad();
          return;
        }

        let selectedCards = cards.filter((card) => bulkSelectedRarities.has(card.rarity));

        if (bulkOnlyUnloaded && selectedCards.length) {
          const cached = storageGet(selectedCards.map((card) => cacheKey(card.id)));
          selectedCards = selectedCards.filter((card) => cached[cacheKey(card.id)] === undefined);
        }

        if (!selectedCards.length) {
          finishBulkLoad(bulkOnlyUnloaded ? 'Aucune nouvelle ✓' : 'Chargé ✓');
          return;
        }

        setBulkButtonState(
          bulkOnlyUnloaded
            ? `Nouvelles (${selectedCards.length})…`
            : `Préparation (${selectedCards.length})…`,
          true
        );

        try {
          runtime.priceLoader.loadCacheForCards(selectedCards, {
            forceRarities: bulkOnlyUnloaded ? null : bulkForceRarities,
            markBulk: true
          });
        } catch (error) {
          if (!isContextInvalidatedError(error)) {
            failBulkLoad(String(error?.message || error));
          }
        }
      });


      return {
        ensurePriceLegend, ensureToolbar, updateBulkProgress,
        finishBulkLoad, failBulkLoad
      };
    }
  };
})();
