(() => {
  if (window.__wmAveragePriceBridgeInstalled) return;
  window.__wmAveragePriceBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const COLLECTION_FETCH_CONCURRENCY = 2;
  const MAX_COLLECTION_PAGES = 200;
  const MAX_BULK_PACKS = 100;

  function mapEntry(entry) {
    const card = entry && entry.card;
    const id = (entry && entry.card_id) || (card && card.id);
    const ownedCardId = entry?.id || null;
    const title = card && card.wikipedia_title;
    if (!id || !title) return null;

    return {
      id,
      ownedCardId,
      ownedCardIds: ownedCardId ? [ownedCardId] : [],
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

  function isPacksOpenApi(url) {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.pathname === '/api/packs/open';
    } catch (_) {
      return false;
    }
  }

  function isTradesApi(url) {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.pathname === '/api/trades';
    } catch (_) {
      return false;
    }
  }

  function mapPackCards(json) {
    if (!Array.isArray(json?.cards)) return [];

    return json.cards
      .map((card) => {
        if (!card?.id || !card?.wikipedia_title) return null;
        return {
          id: card.id,
          title: card.wikipedia_title,
          rarity: card.rarity || null,
          imageUrl: card.image_url || null,
          count: 1
        };
      })
      .filter(Boolean);
  }

  function emitPackOpened(json) {
    const cards = mapPackCards(json);
    if (!cards.length) return;

    window.dispatchEvent(new CustomEvent('wm-average-pack-opened', {
      detail: {
        cards,
        packsRemaining: Number(json?.packs_remaining)
      }
    }));
  }

  function mapTrade(raw) {
    if (!raw?.id || !raw?.initiator_id || !raw?.recipient_id) return null;

    const items = Array.isArray(raw.items)
      ? raw.items.map((item) => {
          const card = item?.card;
          const id = item?.card_id || card?.id;
          const title = card?.wikipedia_title;
          if (!id || !title) return null;

          return {
            id: item?.id || null,
            offeredBy: item?.offered_by || null,
            card: {
              id,
              title,
              rarity: item?.snapshot_rarity || card?.rarity || null,
              imageUrl: card?.image_url || null,
              count: 1
            }
          };
        }).filter(Boolean)
      : [];

    return {
      id: raw.id,
      status: raw.status || null,
      initiatorId: raw.initiator_id,
      recipientId: raw.recipient_id,
      initiatorWikibidous: Number(raw.initiator_wikibidous) || 0,
      recipientWikibidous: Number(raw.recipient_wikibidous) || 0,
      initiator: {
        id: raw.initiator?.id || raw.initiator_id,
        username: raw.initiator?.username || 'Initiateur'
      },
      recipient: {
        id: raw.recipient?.id || raw.recipient_id,
        username: raw.recipient?.username || 'Destinataire'
      },
      items
    };
  }

  function emitTrades(json) {
    const trades = Array.isArray(json?.trades)
      ? json.trades.map(mapTrade).filter(Boolean)
      : [];

    window.dispatchEvent(new CustomEvent('wm-average-trades', {
      detail: { trades }
    }));
  }

  async function fetchTrades() {
    try {
      const response = await originalFetch('/api/trades', {
        method: 'GET',
        credentials: 'include',
        headers: { accept: '*/*' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      emitTrades(await response.json());
    } catch (error) {
      window.dispatchEvent(new CustomEvent('wm-average-trades', {
        detail: {
          trades: [],
          error: String(error?.message || error)
        }
      }));
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
    const maxAttempts = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await originalFetch(
          `/api/my-collection?sort=rarity&page=${encodeURIComponent(page)}&stats=${stats ? 1 : 0}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: { accept: '*/*' }
          }
        );

        if (response.ok) {
          return response.json();
        }

        lastError = new Error(`Collection page ${page}: HTTP ${response.status}`);

        const retryable = response.status >= 500 && response.status <= 599;
        if (!retryable || attempt >= maxAttempts) {
          throw lastError;
        }
      } catch (error) {
        lastError = error;

        const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        const retryable =
          status == null ||
          (status >= 500 && status <= 599);

        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }
      }

      const delayMs = Math.min(4000, 400 * (2 ** (attempt - 1)));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw lastError || new Error(`Collection page ${page}: erreur inconnue`);
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
            const ownershipIds = new Set([
              ...(Array.isArray(existing.ownedCardIds) ? existing.ownedCardIds : []),
              ...(Array.isArray(card.ownedCardIds) ? card.ownedCardIds : []),
              card.ownedCardId
            ].filter(Boolean));
            existing.ownedCardIds = [...ownershipIds];
            if (!existing.ownedCardId && existing.ownedCardIds.length) {
              existing.ownedCardId = existing.ownedCardIds[0];
            }
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

  async function openAllPacks(requestId) {
    const allCards = [];
    let openedPacks = 0;
    let packsRemaining = null;

    try {
      for (let index = 0; index < MAX_BULK_PACKS; index += 1) {
        let json = null;

        while (true) {
          const response = await originalFetch('/api/packs/open', {
            method: 'POST',
            credentials: 'include',
            headers: { accept: '*/*' }
          });

          try {
            json = await response.json();
          } catch (_) {
            json = null;
          }

          const retryAt = Date.parse(json?.retry_after || '');
          const canRetryRateLimit =
            Boolean(json?.rate_limited) &&
            !json?.rate_limit_daily &&
            Number.isFinite(retryAt);

          if (canRetryRateLimit) {
            packsRemaining = Number(json?.packs_remaining);

            const waitMs = Math.max(250, retryAt - Date.now() + 200);

            window.dispatchEvent(new CustomEvent('wm-average-open-all-packs-progress', {
              detail: {
                requestId,
                openedPacks,
                cardsCount: allCards.length,
                packsRemaining: Number.isFinite(packsRemaining) ? packsRemaining : null,
                waiting: true,
                retryAfter: json.retry_after,
                waitMs
              }
            }));

            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }

          if (!response.ok) {
            const message =
              json?.error ||
              json?.message ||
              (json?.rate_limit_daily ? 'Limite quotidienne atteinte.' : null) ||
              (response.status === 400 ? 'Aucun paquet disponible.' : `HTTP ${response.status}`);
            throw new Error(message);
          }

          break;
        }

        const cards = mapPackCards(json);
        if (!cards.length) {
          throw new Error('Le paquet ouvert ne contient aucune carte.');
        }

        openedPacks += 1;
        allCards.push(...cards);
        packsRemaining = Number(json?.packs_remaining);

        window.dispatchEvent(new CustomEvent('wm-average-open-all-packs-progress', {
          detail: {
            requestId,
            openedPacks,
            cardsCount: allCards.length,
            packsRemaining: Number.isFinite(packsRemaining) ? packsRemaining : null,
            waiting: false,
            cards
          }
        }));

        if (Number.isFinite(packsRemaining) && packsRemaining <= 0) {
          break;
        }
      }

      window.dispatchEvent(new CustomEvent('wm-average-open-all-packs-result', {
        detail: {
          requestId,
          ok: true,
          openedPacks,
          cards: allCards,
          packsRemaining: Number.isFinite(packsRemaining) ? packsRemaining : null
        }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('wm-average-open-all-packs-result', {
        detail: {
          requestId,
          ok: false,
          openedPacks,
          cards: allCards,
          packsRemaining: Number.isFinite(packsRemaining) ? packsRemaining : null,
          error: String(error?.message || error)
        }
      }));
    }
  }

  window.fetch = (...args) => {
    const fetchPromise = originalFetch(...args);

    fetchPromise.then((response) => {
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input?.url;
        if (url && url.includes('/api/my-collection')) {
          response.clone().json().then(emitCollection).catch(() => {});
        } else if (url && isTradesApi(url)) {
          response.clone().json().then(emitTrades).catch(() => {});
        } else if (url && isMarketplaceDetailApi(url)) {
          response.clone().json().then(emitMarketplaceDetail).catch(() => {});
        } else if (url && isPacksOpenApi(url)) {
          response.clone().json().then(emitPackOpened).catch(() => {});
        }
      } catch (_) {}
    }).catch(() => {
      // Ne pas transformer une erreur réseau du site en erreur de l'extension.
    });

    return fetchPromise;
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
        (
          this.__wmUrl.includes('/api/my-collection') ||
          isTradesApi(this.__wmUrl) ||
          isMarketplaceDetailApi(this.__wmUrl) ||
          isPacksOpenApi(this.__wmUrl)
        )
      ) {
        this.addEventListener('load', () => {
          try {
            const json = JSON.parse(this.responseText);
            if (this.__wmUrl.includes('/api/my-collection')) {
              emitCollection(json);
            } else if (isTradesApi(this.__wmUrl)) {
              emitTrades(json);
            } else if (isMarketplaceDetailApi(this.__wmUrl)) {
              emitMarketplaceDetail(json);
            } else if (isPacksOpenApi(this.__wmUrl)) {
              emitPackOpened(json);
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

  window.addEventListener('wm-average-open-all-packs', (event) => {
    const requestId = event.detail?.requestId;
    if (!requestId) return;
    openAllPacks(requestId);
  });

  window.addEventListener('wm-average-load-trades', () => {
    fetchTrades();
  });

  window.addEventListener('wm-average-create-listing', async (event) => {
    const { requestId, cardId, baseAmount, durationMinutes } = event.detail || {};
    if (!requestId || !cardId) return;

    const amount = Number(baseAmount);
    const duration = Number(durationMinutes);

    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(duration) || duration <= 0) {
      window.dispatchEvent(new CustomEvent('wm-average-create-listing-result', {
        detail: {
          requestId,
          cardId,
          ok: false,
          error: 'Prix ou durée invalide.'
        }
      }));
      return;
    }

    try {
      const response = await originalFetch('/api/marketplace', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: '*/*',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          card_id: cardId,
          base_amount: amount,
          duration_minutes: duration
        })
      });

      let json = null;
      try {
        json = await response.json();
      } catch (_) {}

      if (!response.ok) {
        throw new Error(
          json?.error ||
          json?.message ||
          `HTTP ${response.status}`
        );
      }

      window.dispatchEvent(new CustomEvent('wm-average-create-listing-result', {
        detail: {
          requestId,
          cardId,
          ok: true,
          listing: json
        }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('wm-average-create-listing-result', {
        detail: {
          requestId,
          cardId,
          ok: false,
          error: String(error?.message || error)
        }
      }));
    }
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