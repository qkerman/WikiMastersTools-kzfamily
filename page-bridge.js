(() => {
  if (window.__wmAveragePriceBridgeInstalled) return;
  window.__wmAveragePriceBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const COLLECTION_FETCH_CONCURRENCY = 2;
  const MAX_COLLECTION_PAGES = 200;

  function mapEntry(entry) {
    const card = entry && entry.card;
    const id = (entry && entry.card_id) || (card && card.id);
    const title = card && card.wikipedia_title;
    if (!id || !title) return null;

    return {
      id,
      title,
      rarity: card?.rarity || null,
      imageUrl: card?.image_url || null,
      count: Number(entry?.count) || 1
    };
  }

  function extractCards(json) {
    if (!json || !Array.isArray(json.collection)) return [];
    return json.collection.map(mapEntry).filter(Boolean);
  }

  function emitCollection(json) {
    const cards = extractCards(json);
    if (!cards.length) return;

    window.dispatchEvent(new CustomEvent('wm-average-collection', {
      detail: { cards }
    }));
  }

  function isMarketplaceDetailApi(url) {
    try {
      const parsed = new URL(url, location.origin);
      return /^\/api\/marketplace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.pathname);
    } catch (_) {
      return false;
    }
  }

  function emitMarketplaceDetail(json) {
    const auction = json?.auction;
    const card = auction?.card;
    const id = auction?.card_id || card?.id;
    const title = card?.wikipedia_title;
    if (!id || !title) return;

    window.dispatchEvent(new CustomEvent('wm-average-marketplace-detail', {
      detail: {
        auctionId: auction?.id || null,
        card: {
          id,
          title,
          rarity: auction?.snapshot_rarity || card?.rarity || null,
          imageUrl: card?.image_url || null,
          count: 1
        }
      }
    }));
  }

  async function fetchCollectionPage(page, stats = false) {
    const response = await originalFetch(
      `/api/my-collection?sort=rarity&page=${encodeURIComponent(page)}&stats=${stats ? 1 : 0}`,
      {
        method: 'GET',
        credentials: 'include',
        headers: { accept: '*/*' }
      }
    );

    if (!response.ok) {
      throw new Error(`Collection page ${page}: HTTP ${response.status}`);
    }

    return response.json();
  }

  async function fetchAllCollection(requestId) {
    try {
      const first = await fetchCollectionPage(0, true);
      const firstCards = extractCards(first);
      const total = typeof first?.total === 'number' ? first.total : Number.NaN;
      const pageSize = firstCards.length;
      const pages = [firstCards];

      let totalPages = 1;
      if (Number.isFinite(total) && total > 0 && pageSize > 0) {
        totalPages = Math.max(1, Math.ceil(total / pageSize));
      }

      window.dispatchEvent(new CustomEvent('wm-average-all-collection-progress', {
        detail: { requestId, loadedPages: 1, totalPages }
      }));

      if (totalPages > 1) {
        let nextPage = 1;
        let loadedPages = 1;

        const worker = async () => {
          while (true) {
            const page = nextPage++;
            if (page >= totalPages || page >= MAX_COLLECTION_PAGES) return;
            const json = await fetchCollectionPage(page, false);
            pages[page] = extractCards(json);
            loadedPages += 1;
            window.dispatchEvent(new CustomEvent('wm-average-all-collection-progress', {
              detail: { requestId, loadedPages, totalPages }
            }));
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(COLLECTION_FETCH_CONCURRENCY, totalPages - 1) }, () => worker())
        );
      } else if (!Number.isFinite(total) && pageSize > 0) {
        for (let page = 1; page < MAX_COLLECTION_PAGES; page += 1) {
          const json = await fetchCollectionPage(page, false);
          const cards = extractCards(json);
          pages[page] = cards;
          window.dispatchEvent(new CustomEvent('wm-average-all-collection-progress', {
            detail: { requestId, loadedPages: page + 1, totalPages: 0 }
          }));
          if (cards.length < pageSize) break;
        }
      }

      const deduped = new Map();
      for (const pageCards of pages) {
        if (!Array.isArray(pageCards)) continue;
        for (const card of pageCards) {
          const existing = deduped.get(card.id);
          if (existing) {
            existing.count = Math.max(existing.count || 1, card.count || 1);
          } else {
            deduped.set(card.id, { ...card });
          }
        }
      }

      window.dispatchEvent(new CustomEvent('wm-average-all-collection', {
        detail: {
          requestId,
          ok: true,
          cards: [...deduped.values()],
          total: Number.isFinite(total) ? total : deduped.size
        }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('wm-average-all-collection', {
        detail: {
          requestId,
          ok: false,
          error: String(error?.message || error)
        }
      }));
    }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url;
      if (url && url.includes('/api/my-collection')) {
        response.clone().json().then(emitCollection).catch(() => {});
      } else if (url && isMarketplaceDetailApi(url)) {
        response.clone().json().then(emitMarketplaceDetail).catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const origOpen = OriginalXHR.prototype.open;
    const origSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function(method, url, ...rest) {
      this.__wmUrl = typeof url === 'string' ? url : String(url || '');
      return origOpen.call(this, method, url, ...rest);
    };

    OriginalXHR.prototype.send = function(...args) {
      if (
        this.__wmUrl &&
        (this.__wmUrl.includes('/api/my-collection') || isMarketplaceDetailApi(this.__wmUrl))
      ) {
        this.addEventListener('load', () => {
          try {
            const json = JSON.parse(this.responseText);
            if (this.__wmUrl.includes('/api/my-collection')) {
              emitCollection(json);
            } else if (isMarketplaceDetailApi(this.__wmUrl)) {
              emitMarketplaceDetail(json);
            }
          } catch (_) {}
        }, { once: true });
      }
      return origSend.apply(this, args);
    };
  }

  window.addEventListener('wm-average-load-all-collection', (event) => {
    const requestId = event.detail?.requestId;
    if (!requestId) return;
    fetchAllCollection(requestId);
  });

  window.addEventListener('wm-average-request', async (event) => {
    const { id, requestId } = event.detail || {};
    if (!id || !requestId) return;

    try {
      const response = await originalFetch(
        `/api/marketplace/cards/${encodeURIComponent(id)}/sales?scope=summary`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { accept: '*/*' }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      const averages = {};
      if (json?.summary && typeof json.summary === 'object') {
        for (const [rarity, value] of Object.entries(json.summary)) {
          if (value && Number.isFinite(Number(value.average))) {
            averages[rarity] = Number(value.average);
          }
        }
      }

      window.dispatchEvent(new CustomEvent('wm-average-response', {
        detail: {
          requestId,
          id,
          ok: true,
          title: json?.wikipedia_title || null,
          averages
        }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('wm-average-response', {
        detail: {
          requestId,
          id,
          ok: false,
          error: String(error?.message || error)
        }
      }));
    }
  });

  console.debug('[WM Average] bridge installé');
})();