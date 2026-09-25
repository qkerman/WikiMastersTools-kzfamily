(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.priceUi = {
    create(runtime) {
      const {
        isCollectionPage, isMarketplaceDetailPage, isGlobalCollectionPage,
        normalizeTitle, cacheKey, storageGet, isCacheEntryValid, reportError,
        registerCards, createSponsorNote, cardMetaById, idByTitle, cacheMemory
      } = runtime.core;

      let collectionPriceObserver = null;
      let marketplaceCardId = null;
      let globalCollectionCardId = null;
      let globalCollectionInitializedId = null;

      function getRarityFromCard(cardEl) {
        if (!cardEl) return null;
        const candidates = cardEl.querySelectorAll('div, span');
        for (const el of candidates) {
          const text = (el.textContent || '').trim();
          if (/^(L|UR|SR|R|PC|C)$/.test(text)) return text;
        }
        return null;
      }

      function formatAverage(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '—';
        return new Intl.NumberFormat('fr-FR', {
          maximumFractionDigits: Number.isInteger(n) ? 0 : 2
        }).format(n);
      }

      function findCardByTitle(title) {
        if (!isCollectionPage()) return null;

        const target = normalizeTitle(title);
        for (const h3 of document.querySelectorAll('h3')) {
          if (normalizeTitle(h3.textContent) !== target) continue;
          const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
          if (card) return card;
        }
        return null;
      }

      function getOrCreateBadge(card) {
        let badge = card.querySelector('.wm-average-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'wm-average-badge';
        }

        const title = card.querySelector('h3');
        const textArea = title?.parentElement;

        if (title && textArea) {
          if (badge.parentElement !== textArea || title.nextElementSibling !== badge) {
            title.insertAdjacentElement('afterend', badge);
          }
        } else if (!badge.parentElement) {
          card.appendChild(badge);
        }

        return badge;
      }

      function renderLoadingBadge(badge) {
        if (
          badge.classList.contains('wm-average-loading') &&
          normalizeTitle(badge.textContent) === 'Prix…'
        ) {
          return;
        }

        badge.className = 'wm-average-badge wm-average-loading';
        badge.title = 'Chargement du prix moyen…';
        badge.replaceChildren();

        const spinner = document.createElement('span');
        spinner.className = 'wm-average-spinner';
        spinner.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.textContent = 'Prix…';

        badge.append(spinner, label);
      }

      function chooseAverage(cacheEntry, cardEl, explicitRarity = null) {
        const rarity = explicitRarity || getRarityFromCard(cardEl);
        const averages = cacheEntry?.averages || {};
        if (rarity && Number.isFinite(Number(averages[rarity]))) {
          return Number(averages[rarity]);
        }

        const values = Object.values(averages)
          .map(Number)
          .filter(Number.isFinite);
        return values.length === 1 ? values[0] : null;
      }

      function renderCollectionCard(id, card, { force = false } = {}) {
        if (!force && !runtime.settings.isEnabled('collectionPrices')) {
          card?.querySelector('.wm-average-badge')?.remove();
          return;
        }
        const badge = getOrCreateBadge(card);
        const cacheEntry = cacheMemory.get(id);

        if (!cacheEntry) {
          renderLoadingBadge(badge);
          return;
        }

        if (cacheEntry.ok === false) {
          if (badge.className !== 'wm-average-badge wm-average-empty') {
            badge.className = 'wm-average-badge wm-average-empty';
          }
          badge.title = 'Erreur temporaire lors du chargement du prix';
          if (badge.textContent !== 'Prix indispo.') badge.textContent = 'Prix indispo.';
          return;
        }

        badge.title = 'Prix moyen des ventes (cache 24 h)';
        const average = chooseAverage(cacheEntry, card, cardMetaById.get(id)?.rarity || null);

        if (average == null) {
          if (badge.className !== 'wm-average-badge wm-average-empty') {
            badge.className = 'wm-average-badge wm-average-empty';
          }
          if (badge.textContent !== 'Moy. —') badge.textContent = 'Moy. —';
        } else {
          if (badge.className !== 'wm-average-badge') {
            badge.className = 'wm-average-badge';
          }
          const text = `Moy. ${formatAverage(average)} W`;
          if (badge.textContent !== text) badge.textContent = text;
        }
      }

      function ensureCollectionPriceObserver() {
        if (collectionPriceObserver) return collectionPriceObserver;

        collectionPriceObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;

            const cardEl = entry.target;
            const id = cardEl.dataset.wmCardId;
            if (!id) {
              collectionPriceObserver.unobserve(cardEl);
              continue;
            }

            const meta = cardMetaById.get(id);
            if (meta) {
              try {
                runtime.priceLoader.loadCacheForCards([meta]);
              } catch (error) {
                reportError('prix visible', error);
              }
            }

            collectionPriceObserver.unobserve(cardEl);
          }
        }, {
          root: null,
          rootMargin: '320px 0px',
          threshold: 0
        });

        return collectionPriceObserver;
      }

      function hydrateCacheForCards(cards) {
        const now = Date.now();
        const stored = storageGet(cards.map((card) => cacheKey(card.id)));

        for (const card of cards) {
          const entry = stored[cacheKey(card.id)];

          if (isCacheEntryValid(entry, now)) {
            cacheMemory.set(card.id, entry);
          } else {
            cacheMemory.delete(card.id);
          }
        }
      }

      function bindCollectionCardElement(id, h3, card) {
        if (!id || !card) return;

        card.dataset.wmCardId = id;
        if (h3) h3.dataset.wmCardBound = '1';

        renderCollectionCard(id, card);

        if (!isCacheEntryValid(cacheMemory.get(id))) {
          ensureCollectionPriceObserver().observe(card);
        }
      }

      function renderOne(id) {
        if (!isCollectionPage()) return;

        const direct = document.querySelector(`[data-wm-card-id="${CSS.escape(id)}"]`);
        if (direct) {
          renderCollectionCard(id, direct);
          return;
        }

        const meta = cardMetaById.get(id);
        if (!meta?.title) return;

        const card = findCardByTitle(meta.title);
        if (card) {
          const h3 = card.querySelector('h3');
          bindCollectionCardElement(id, h3, card);
        }
      }

      function renderVisibleCollectionCards() {
        if (!runtime.settings.isEnabled('collectionPrices')) {
          document.querySelectorAll('.wm-average-badge').forEach((badge) => badge.remove());
          return;
        }
        if (!isCollectionPage()) return;

        for (const card of document.querySelectorAll('[data-wm-card-id]')) {
          const id = card.dataset.wmCardId;
          if (!id) continue;

          renderCollectionCard(id, card);

          if (
            !isCacheEntryValid(cacheMemory.get(id)) &&
            !runtime.priceLoader.isPending(id)
          ) {
            ensureCollectionPriceObserver().observe(card);
          }
        }

        for (const h3 of document.querySelectorAll('h3:not([data-wm-card-bound])')) {
          const id = idByTitle.get(normalizeTitle(h3.textContent));
          if (!id) continue;

          const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
          if (card) bindCollectionCardElement(id, h3, card);
        }
      }

      function renderMarketplaceAverage(id) {
        if (!runtime.settings.isEnabled('marketplacePrice')) {
          document.getElementById('wm-marketplace-average')?.remove();
          return;
        }
        if (!isMarketplaceDetailPage() || marketplaceCardId !== id) return;

        const meta = cardMetaById.get(id);
        if (!meta?.title) return;

        const h1 = [...document.querySelectorAll('h1')]
          .find((el) => normalizeTitle(el.textContent) === normalizeTitle(meta.title));
        if (!h1) return;

        const headingRow = h1.parentElement;
        const titleBlock = headingRow?.parentElement;
        if (!titleBlock) return;

        let wrap = document.getElementById('wm-marketplace-average');
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.id = 'wm-marketplace-average';
          wrap.className = 'wm-marketplace-average-wrap';

          const priceCard = document.createElement('div');
          priceCard.className = 'wm-marketplace-average-card';

          const labelWrap = document.createElement('div');
          labelWrap.className = 'wm-marketplace-average-label-wrap';

          const label = document.createElement('span');
          label.className = 'wm-marketplace-average-label';
          label.textContent = 'Prix moyen';

          const rarity = document.createElement('span');
          rarity.className = 'wm-marketplace-average-rarity';
          rarity.dataset.role = 'rarity';

          labelWrap.append(label, rarity);

          const value = document.createElement('span');
          value.className = 'wm-marketplace-average-value';
          value.dataset.role = 'value';

          priceCard.append(labelWrap, value);
          wrap.append(priceCard, createSponsorNote());
          titleBlock.insertAdjacentElement('afterend', wrap);
        }

        const rarityEl = wrap.querySelector('[data-role="rarity"]');
        if (rarityEl) {
          rarityEl.textContent = meta.rarity ? `Rareté ${meta.rarity}` : '';
        }

        const valueEl = wrap.querySelector('[data-role="value"]');
        if (!valueEl) return;

        const cacheEntry = cacheMemory.get(id);
        if (!cacheEntry) {
          valueEl.className = 'wm-marketplace-average-value wm-marketplace-average-loading';
          valueEl.replaceChildren();

          const spinner = document.createElement('span');
          spinner.className = 'wm-average-spinner';
          spinner.setAttribute('aria-hidden', 'true');

          const loadingText = document.createElement('span');
          loadingText.textContent = 'Chargement…';

          valueEl.append(spinner, loadingText);
          return;
        }

        const average = chooseAverage(cacheEntry, null, meta.rarity || null);
        valueEl.className = 'wm-marketplace-average-value';
        valueEl.textContent = average == null ? '—' : `${formatAverage(average)} W`;
      }

      function renderKnownCard(id) {
        renderOne(id);
        renderMarketplaceAverage(id);

        runtime.packs?.onPriceUpdated(id);
        runtime.trades?.renderTradeDetailCard(id);

        if (id === globalCollectionCardId) {
          renderGlobalCollectionInspectedCard();
        }

        runtime.trades?.renderTradeValuesForCard(id);
      }

      function getGlobalCollectionInspection() {
        if (!isGlobalCollectionPage()) return null;

        for (const closeButton of document.querySelectorAll('button[aria-label="Fermer"]')) {
          const modal = closeButton.closest('.card-frame');
          if (!modal) continue;

          const h3 = modal.querySelector('h3');
          if (!h3) continue;

          const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
          if (card) {
            return { modal, card, h3 };
          }
        }

        return null;
      }

      function renderGlobalCollectionInspectedCard() {
        if (!runtime.settings.isEnabled('globalCollectionPrice')) return;
        if (!isGlobalCollectionPage() || !globalCollectionCardId) return;

        const inspection = getGlobalCollectionInspection();
        if (!inspection) return;

        const meta = cardMetaById.get(globalCollectionCardId);
        if (!meta?.title) return;

        if (normalizeTitle(inspection.h3.textContent) !== normalizeTitle(meta.title)) {
          return;
        }

        renderCollectionCard(meta.id, inspection.card, { force: true });
      }

      function ensureGlobalCollectionInspectedCard() {
        if (!runtime.settings.isEnabled('globalCollectionPrice')) return;
        if (!isGlobalCollectionPage() || !globalCollectionCardId) return;

        const inspection = getGlobalCollectionInspection();
        if (!inspection) return;

        const title = normalizeTitle(inspection.h3.textContent);
        if (!title) return;

        const existingMeta = cardMetaById.get(globalCollectionCardId);
        if (
          existingMeta?.title &&
          normalizeTitle(existingMeta.title) !== title
        ) {
          return;
        }

        const meta = {
          id: globalCollectionCardId,
          title,
          rarity: getRarityFromCard(inspection.card),
          imageUrl: inspection.card.querySelector('img[alt]')?.src || null,
          count: 1
        };

        registerCards([meta]);
        renderCollectionCard(meta.id, inspection.card);

        if (globalCollectionInitializedId === meta.id) return;

        // Important: mark as initialized BEFORE runtime.priceLoader.loadCacheForCards().
        // runtime.priceLoader.loadCacheForCards() calls renderKnownCard(), which can render this card again.
        globalCollectionInitializedId = meta.id;

        try {
          runtime.priceLoader.loadCacheForCards([meta]);
        } catch (error) {
          globalCollectionInitializedId = null;
          reportError('collection globale', error);
        }
      }


      window.addEventListener('wm-average-global-card-inspected', (event) => {
        if (!runtime.settings.isEnabled('globalCollectionPrice')) return;
        const id = event.detail?.id;
        if (!isGlobalCollectionPage() || !id) return;

        if (globalCollectionCardId !== id) {
          globalCollectionInitializedId = null;
        }

        globalCollectionCardId = id;
        ensureGlobalCollectionInspectedCard();
        renderGlobalCollectionInspectedCard();
      });

      window.addEventListener('wm-average-marketplace-detail', (event) => {
        if (!runtime.settings.isEnabled('marketplacePrice')) return;
        const card = event.detail?.card;
        if (!card?.id || !card?.title) return;

        marketplaceCardId = card.id;
        registerCards([card]);
        renderMarketplaceAverage(card.id);

        try {
          runtime.priceLoader.loadCacheForCards([card]);
        } catch (error) {
          reportError('marketplace', error);
        }
      });

      window.addEventListener('wm-average-collection', (event) => {
        const cards = event.detail?.cards;
        if (!Array.isArray(cards) || !cards.length) return;

        console.debug(`[WM Average] ${cards.length} cartes détectées`, cards);

        try {
          registerCards(cards);
          hydrateCacheForCards(cards);
          renderVisibleCollectionCards();
        } catch (error) {
          reportError('cache', error);
        }
      });


      function renderMarketplaceCurrent() {
        if (marketplaceCardId) renderMarketplaceAverage(marketplaceCardId);
      }

      return {
        getRarityFromCard, formatAverage, chooseAverage, renderCollectionCard,
        hydrateCacheForCards, renderVisibleCollectionCards, renderMarketplaceAverage,
        renderMarketplaceCurrent, renderKnownCard, renderGlobalCollectionInspectedCard,
        ensureGlobalCollectionInspectedCard
      };
    }
  };
})();
