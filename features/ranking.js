(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.ranking = {
    create(runtime) {
      const {
        ALL_COLLECTION_KEY, cardMetaById, cacheMemory, cacheKey,
        storageGet, storageSet
      } = runtime.core;
      const { formatAverage, chooseAverage } = runtime.priceUi;
      const pendingMarketplaceListings = new Map();

      function humanElapsed(timestamp) {
        const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const remaining = minutes % 60;
        return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
      }

      async function openRankingModal() {
        const storedCollection = storageGet(ALL_COLLECTION_KEY);
        const collectionEntry = storedCollection[ALL_COLLECTION_KEY];
        const storedCards = Array.isArray(collectionEntry?.cards) ? collectionEntry.cards : [];

        // Merge persisted metadata with cards already discovered during this page session.
        // This lets the ranking work even before a full bulk collection load.
        const knownCards = new Map();

        for (const card of storedCards) {
          if (card?.id && card?.title) knownCards.set(card.id, { ...card });
        }

        for (const card of cardMetaById.values()) {
          if (!card?.id || !card?.title) continue;
          const previous = knownCards.get(card.id);
          knownCards.set(card.id, previous ? { ...previous, ...card } : { ...card });
        }

        const candidates = [...knownCards.values()];

        if (!candidates.length) {
          runtime.modalUi.showInfoModal(
            'Aucun prix chargé',
            'Aucune carte avec métadonnées n’est encore disponible. Parcourez votre collection ou utilisez « Charger les prix », puis réessayez.'
          );
          return;
        }

        const priceKeys = candidates.map((card) => cacheKey(card.id));
        const prices = storageGet(priceKeys);

        const rows = candidates
          .map((card) => {
            const entry = prices[cacheKey(card.id)];

            // Errors are not useful in a "most expensive" ranking.
            if (!entry || entry.ok === false) return null;

            const average = chooseAverage(entry, null, card.rarity || null);

            return {
              ...card,
              average,
              fetchedAt: Number(entry?.fetchedAt) || 0
            };
          })
          .filter(Boolean)
          .sort((a, b) => {
            const aPrice = Number.isFinite(a.average) ? a.average : -Infinity;
            const bPrice = Number.isFinite(b.average) ? b.average : -Infinity;
            if (bPrice !== aPrice) return bPrice - aPrice;
            return a.title.localeCompare(b.title, 'fr');
          });

        if (!rows.length) {
          runtime.modalUi.showInfoModal(
            'Aucun prix chargé',
            'Aucun prix n’est encore présent dans le cache. Parcourez votre collection ou utilisez « Charger les prix », puis réessayez.'
          );
          return;
        }

        const isComplete =
          collectionEntry?.complete === true &&
          rows.length >= candidates.length;

        renderRankingModal(
          rows,
          collectionEntry?.fetchedAt || 0,
          {
            incomplete: !isComplete,
            knownCards: candidates.length,
            cachedCards: rows.length
          }
        );
      }

      function renderRankingModal(rows, collectionFetchedAt, status = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'wm-modal-overlay wm-ranking-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-modal wm-ranking-modal wm-ranking-sales-enabled';

        const header = document.createElement('div');
        header.className = 'wm-ranking-header';

        const headingWrap = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = 'Cartes les plus chères';

        const subtitle = document.createElement('p');
        const pricedCount = rows.filter((row) => Number.isFinite(row.average)).length;
        subtitle.textContent = `${rows.length} cartes du cache • ${pricedCount} avec un prix moyen${collectionFetchedAt ? ` • données collection il y a ${humanElapsed(collectionFetchedAt)}` : ''}`;

        headingWrap.append(title, subtitle);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'wm-ranking-close';
        closeButton.setAttribute('aria-label', 'Fermer');
        closeButton.textContent = '×';

        header.append(headingWrap, closeButton);

        let cacheNotice = null;
        if (status.incomplete) {
          cacheNotice = document.createElement('div');
          cacheNotice.className = 'wm-ranking-cache-notice';

          const noticeTitle = document.createElement('strong');
          noticeTitle.textContent = 'Classement partiel';

          const noticeText = document.createElement('span');
          noticeText.textContent =
            'Vous n’avez pas chargé tous les prix : seules les cartes actuellement disponibles dans votre cache sont affichées ici.';

          cacheNotice.append(noticeTitle, noticeText);
        }

        const saleControls = document.createElement('div');
        saleControls.className = 'wm-ranking-sale-controls';

        const priceField = document.createElement('label');
        priceField.className = 'wm-ranking-sale-field';

        const priceLabel = document.createElement('span');
        priceLabel.textContent = 'Prix de mise en vente';

        const priceInput = document.createElement('input');
        priceInput.type = 'number';
        priceInput.min = '1';
        priceInput.step = '1';
        priceInput.value = '10';
        priceInput.inputMode = 'decimal';

        priceField.append(priceLabel, priceInput);

        const durationField = document.createElement('label');
        durationField.className = 'wm-ranking-sale-field';

        const durationLabel = document.createElement('span');
        durationLabel.textContent = 'Durée';

        const durationInput = document.createElement('select');

        const durationOptions = [
          [10, '10 min'],
          [30, '30 min'],
          [60, '1 h'],
          [180, '3 h'],
          [360, '6 h'],
          [720, '12 h'],
          [1440, '24 h']
        ];

        for (const [value, label] of durationOptions) {
          const option = document.createElement('option');
          option.value = String(value);
          option.textContent = label;
          durationInput.append(option);
        }

        durationInput.value = '10';

        durationField.append(durationLabel, durationInput);

        const hint = document.createElement('div');
        hint.className = 'wm-ranking-sale-hint';
        hint.textContent = 'Chaque bouton utilise ces deux valeurs.';

        saleControls.append(priceField, durationField, hint);

        const list = document.createElement('div');
        list.className = 'wm-ranking-list';

        const PAGE_SIZE = 50;
        let renderedCount = 0;

        const saleInputsAreValid = () => {
          const amount = Number(priceInput.value);
          const duration = Number(durationInput.value);
          return Number.isFinite(amount) && amount > 0 && Number.isFinite(duration) && duration > 0;
        };

        const refreshSaleButtons = () => {
          const valid = saleInputsAreValid();

          for (const button of list.querySelectorAll('.wm-ranking-sell-button')) {
            if (button.dataset.state === 'pending' || button.dataset.state === 'success') continue;
            button.disabled = !valid;
          }
        };

        const createRankingRow = (row, index) => {
          const item = document.createElement('div');
          item.className = 'wm-ranking-row';

          const rank = document.createElement('div');
          rank.className = 'wm-ranking-rank';
          rank.textContent = String(index + 1);

          const thumb = document.createElement('div');
          thumb.className = 'wm-ranking-thumb';
          if (row.imageUrl) {
            const img = document.createElement('img');
            img.src = row.imageUrl;
            img.alt = '';
            img.loading = 'lazy';
            thumb.append(img);
          }

          const info = document.createElement('div');
          info.className = 'wm-ranking-info';

          const name = document.createElement('div');
          name.className = 'wm-ranking-title';
          name.textContent = row.title;

          const meta = document.createElement('div');
          meta.className = 'wm-ranking-meta';
          const countText = row.count > 1 ? ` • ×${row.count}` : '';
          meta.textContent = `${row.rarity || '—'}${countText}`;

          info.append(name, meta);

          const price = document.createElement('div');
          price.className = 'wm-ranking-price';
          if (Number.isFinite(row.average)) {
            price.textContent = `${formatAverage(row.average)} W`;
          } else {
            price.textContent = '—';
            price.classList.add('wm-ranking-price-empty');
          }

          const sellButton = document.createElement('button');
          sellButton.type = 'button';
          sellButton.className = 'wm-tool-button wm-ranking-sell-button';
          sellButton.textContent = 'Mettre en vente';
          sellButton.dataset.cardId = row.id;
          sellButton.disabled = !saleInputsAreValid();

          sellButton.addEventListener('click', () => {
            const amount = Number(priceInput.value);
            const duration = Number(durationInput.value);

            if (!Number.isFinite(amount) || amount <= 0) {
              priceInput.focus();
              return;
            }

            if (!Number.isFinite(duration) || duration <= 0) {
              durationInput.focus();
              return;
            }

            const ownedCardId = row.ownedCardId || row.ownedCardIds?.[0] || null;
            const requestId = `listing:${row.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

            sellButton.disabled = true;
            sellButton.dataset.state = 'pending';
            sellButton.textContent = ownedCardId ? 'Mise en vente…' : 'Recherche ID…';

            pendingMarketplaceListings.set(requestId, {
              button: sellButton,
              row,
              amount,
              duration
            });

            window.dispatchEvent(new CustomEvent('wm-average-create-listing', {
              detail: {
                requestId,
                ownedCardId,
                catalogueCardId: row.id,
                title: row.title,
                baseAmount: amount,
                durationMinutes: duration
              }
            }));
          });

          item.append(rank, thumb, info, price, sellButton);
          return item;
        };

        const sentinel = document.createElement('div');
        sentinel.className = 'wm-ranking-sentinel';

        const renderNextChunk = () => {
          if (renderedCount >= rows.length) {
            sentinel.remove();
            return;
          }

          const fragment = document.createDocumentFragment();
          const end = Math.min(renderedCount + PAGE_SIZE, rows.length);

          for (let index = renderedCount; index < end; index += 1) {
            fragment.append(createRankingRow(rows[index], index));
          }

          renderedCount = end;
          sentinel.remove();
          list.append(fragment);

          if (renderedCount < rows.length) {
            list.append(sentinel);
          }

          refreshSaleButtons();
        };

        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            renderNextChunk();
          }
        }, {
          root: list,
          rootMargin: '250px 0px',
          threshold: 0
        });

        priceInput.addEventListener('input', refreshSaleButtons);
        durationInput.addEventListener('change', refreshSaleButtons);

        renderNextChunk();
        if (renderedCount < rows.length) {
          observer.observe(sentinel);
        }

        const close = () => {
          observer.disconnect();
          overlay.remove();
        };

        closeButton.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close();
        });

        modal.append(header);
        if (cacheNotice) modal.append(cacheNotice);
        modal.append(saleControls, list);
        overlay.append(modal);
        document.body.append(overlay);
      }


      window.addEventListener('wm-average-create-listing-progress', (event) => {
        const detail = event.detail || {};
        const pending = pendingMarketplaceListings.get(detail.requestId);
        if (!pending?.button?.isConnected) return;

        if (detail.state === 'refreshing-id') {
          pending.button.textContent = 'ID expiré • recherche…';
        } else if (detail.state === 'resolving-id') {
          pending.button.textContent = 'Recherche ID…';
        }
      });

      window.addEventListener('wm-average-create-listing-result', (event) => {
        const detail = event.detail || {};
        const pending = pendingMarketplaceListings.get(detail.requestId);
        if (!pending) return;

        pendingMarketplaceListings.delete(detail.requestId);

        const { button, row, amount, duration } = pending;
        if (!button?.isConnected) return;

        if (detail.ok) {
          if (detail.ownedCardId) {
            const staleId = detail.staleOwnedCardId || null;

            row.ownedCardId = detail.ownedCardId;
            row.ownedCardIds = [
              ...new Set([
                ...(Array.isArray(row.ownedCardIds) ? row.ownedCardIds : [])
                  .filter((id) => id && id !== staleId),
                detail.ownedCardId
              ])
            ];

            const stored = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];
            if (Array.isArray(stored?.cards)) {
              const target = stored.cards.find((card) => card?.id === row.id);
              if (target) {
                target.ownedCardId = detail.ownedCardId;
                target.ownedCardIds = [
                  ...new Set([
                    ...(Array.isArray(target.ownedCardIds) ? target.ownedCardIds : [])
                      .filter((id) => id && id !== staleId),
                    detail.ownedCardId
                  ])
                ];
                storageSet({ [ALL_COLLECTION_KEY]: stored });
              }
            }
          }

          button.dataset.state = 'success';
          button.disabled = true;
          button.textContent = 'En vente ✓';
          button.title = `${formatAverage(amount)} W pendant ${formatAverage(duration)} min`;
          return;
        }

        if (detail.notOwned) {
          const stored = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];

          if (Array.isArray(stored?.cards)) {
            stored.cards = stored.cards.filter((card) => card?.id !== row.id);
            storageSet({ [ALL_COLLECTION_KEY]: stored });
          }

          row.ownedCardId = null;
          row.ownedCardIds = [];

          const rankingRow = button.closest('.wm-ranking-row');
          rankingRow?.classList.add('wm-ranking-row-unowned');

          button.dataset.state = 'success';
          button.disabled = true;
          button.textContent = 'Plus possédée';
          button.title = 'Cette carte n’est plus dans ta collection.';
          return;
        }

        if (detail.alreadyListed) {
          button.dataset.state = 'success';
          button.disabled = true;
          button.textContent = 'Déjà en vente';
          button.title = detail.error || 'Toutes tes copies disponibles sont déjà en vente.';
          return;
        }

        const staleId = detail.staleOwnedCardId || (detail.ownershipError ? detail.ownedCardId : null);

        if (staleId) {
          if (row.ownedCardId === staleId) {
            row.ownedCardId = null;
          }
          row.ownedCardIds = (Array.isArray(row.ownedCardIds) ? row.ownedCardIds : [])
            .filter((id) => id && id !== staleId);

          const stored = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];
          if (Array.isArray(stored?.cards)) {
            const target = stored.cards.find((card) => card?.id === row.id);
            if (target) {
              if (target.ownedCardId === staleId) {
                target.ownedCardId = null;
              }
              target.ownedCardIds = (Array.isArray(target.ownedCardIds) ? target.ownedCardIds : [])
                .filter((id) => id && id !== staleId);
              storageSet({ [ALL_COLLECTION_KEY]: stored });
            }
          }
        }

        button.dataset.state = 'error';
        button.disabled = false;
        button.textContent = detail.ownershipError
          ? 'ID invalide — réessayer'
          : 'Erreur — réessayer';
        button.title = detail.error || 'Impossible de mettre cette carte en vente.';
      });


      return { openRankingModal };
    }
  };
})();
