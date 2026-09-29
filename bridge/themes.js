(() => {
  const registry = window.__wmBridgeFeatures ||= {};

  registry.bridgeThemes = {
    create(runtime) {
      const {
        originalFetch,
        MAX_COLLECTION_PAGES,
        getGlobalCardsRequestTemplate,
        extractGlobalCards
      } = runtime.core;

      const CATALOGUE_PAGE_SIZE = 1000;
      const MAX_CATALOGUE_PAGES = 80;

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      async function waitForCatalogueTemplate(timeoutMs = 5000) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const template = getGlobalCardsRequestTemplate();
          if (template?.url) return template;
          await sleep(100);
        }
        return getGlobalCardsRequestTemplate();
      }

      async function fetchAllCatalogue(requestId) {
        try {
          const template = await waitForCatalogueTemplate();
          if (!template?.url) {
            throw new Error('La collection globale n’a pas encore exposé sa requête de catalogue.');
          }

          const base = new URL(template.url, location.origin);
          base.search = '';
          base.searchParams.set(
            'select',
            'id,wikipedia_title,rarity,image_url,wikipedia_url,summary'
          );

          const headers = { ...(template.headers || {}) };
          delete headers.range;
          delete headers.Range;
          delete headers['content-range'];
          delete headers['Content-Range'];
          delete headers['if-none-match'];
          delete headers['If-None-Match'];

          const merged = new Map();
          let complete = false;

          for (let page = 0; page < MAX_CATALOGUE_PAGES; page += 1) {
            const url = new URL(base.toString());
            url.searchParams.set('limit', String(CATALOGUE_PAGE_SIZE));
            url.searchParams.set('offset', String(page * CATALOGUE_PAGE_SIZE));

            const response = await originalFetch(url.toString(), {
              method: 'GET',
              credentials: 'include',
              headers
            });

            if (!response.ok) {
              throw new Error(`Catalogue global : HTTP ${response.status}`);
            }

            const json = await response.json();
            const cards = extractGlobalCards(json);

            for (const card of cards) {
              if (card?.id) merged.set(card.id, card);
            }

            window.dispatchEvent(new CustomEvent('wm-average-theme-catalogue-progress', {
              detail: {
                requestId,
                loaded: merged.size,
                page: page + 1
              }
            }));

            if (cards.length < CATALOGUE_PAGE_SIZE) {
              complete = true;
              break;
            }
          }

          window.dispatchEvent(new CustomEvent('wm-average-theme-catalogue-result', {
            detail: {
              requestId,
              ok: true,
              cards: [...merged.values()],
              complete
            }
          }));
        } catch (error) {
          window.dispatchEvent(new CustomEvent('wm-average-theme-catalogue-result', {
            detail: {
              requestId,
              ok: false,
              error: String(error?.message || error)
            }
          }));
        }
      }

      function extractMarketplaceRows(json) {
        if (Array.isArray(json)) return json;
        for (const key of ['auctions', 'listings', 'marketplace', 'items', 'results', 'data']) {
          if (Array.isArray(json?.[key])) return json[key];
        }
        if (json?.auction && typeof json.auction === 'object') return [json.auction];
        if (json?.listing && typeof json.listing === 'object') return [json.listing];
        return [];
      }

      function mapMarketplaceRow(row) {
        const source = row?.auction || row?.listing || row;
        const card = source?.card || source?.item?.card || row?.card || null;
        const cardId = source?.card_id || row?.card_id || card?.id || null;
        if (!cardId) return null;

        const amountCandidates = [
          source?.current_amount,
          source?.current_bid,
          source?.base_amount,
          source?.price,
          source?.amount
        ];
        const amount = amountCandidates
          .map(Number)
          .find((value) => Number.isFinite(value) && value >= 0);

        return {
          id: source?.id || row?.id || null,
          cardId,
          title: card?.wikipedia_title || card?.title || null,
          rarity: source?.snapshot_rarity || card?.rarity || null,
          imageUrl: card?.image_url || null,
          amount: Number.isFinite(amount) ? amount : null,
          endsAt: source?.ends_at || source?.end_at || source?.expires_at || null
        };
      }

      async function fetchMarketplacePage(page) {
        const candidates = [
          `/api/marketplace?page=${encodeURIComponent(page)}`,
          page === 0 ? '/api/marketplace' : null
        ].filter(Boolean);

        let lastError = null;
        for (const url of candidates) {
          try {
            const response = await originalFetch(url, {
              method: 'GET',
              credentials: 'include',
              headers: { accept: '*/*' }
            });
            if (!response.ok) {
              lastError = new Error(`Marketplace : HTTP ${response.status}`);
              continue;
            }
            return await response.json();
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('Marketplace indisponible');
      }

      async function fetchMarketplace(requestId) {
        try {
          const deduped = new Map();
          let totalPages = 1;
          let total = null;

          for (let page = 0; page < Math.min(totalPages, MAX_COLLECTION_PAGES); page += 1) {
            const json = await fetchMarketplacePage(page);
            const rows = extractMarketplaceRows(json);
            const listings = rows.map(mapMarketplaceRow).filter(Boolean);

            listings.forEach((listing) => {
              const key = listing.id || `${listing.cardId}:${listing.amount ?? 'x'}:${listing.endsAt || 'x'}`;
              deduped.set(key, listing);
            });

            if (page === 0) {
              const parsedTotal = Number(json?.total ?? json?.count);
              total = Number.isFinite(parsedTotal) ? parsedTotal : null;
              if (total != null && rows.length > 0) {
                totalPages = Math.max(1, Math.ceil(total / rows.length));
              }
            }

            window.dispatchEvent(new CustomEvent('wm-average-theme-marketplace-progress', {
              detail: {
                requestId,
                loaded: deduped.size,
                page: page + 1,
                total
              }
            }));

            if (!rows.length || (total == null && page === 0)) break;
          }

          window.dispatchEvent(new CustomEvent('wm-average-theme-marketplace-result', {
            detail: {
              requestId,
              ok: true,
              listings: [...deduped.values()],
              total
            }
          }));
        } catch (error) {
          window.dispatchEvent(new CustomEvent('wm-average-theme-marketplace-result', {
            detail: {
              requestId,
              ok: false,
              listings: [],
              error: String(error?.message || error)
            }
          }));
        }
      }

      window.addEventListener('wm-average-theme-load-catalogue', (event) => {
        const requestId = event.detail?.requestId;
        if (requestId) fetchAllCatalogue(requestId);
      });

      window.addEventListener('wm-average-theme-load-marketplace', (event) => {
        const requestId = event.detail?.requestId;
        if (requestId) fetchMarketplace(requestId);
      });

      return { fetchAllCatalogue, fetchMarketplace };
    }
  };
})();