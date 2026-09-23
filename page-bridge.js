(() => {
  if (window.__wmAveragePriceBridgeInstalled) return;
  window.__wmAveragePriceBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const COLLECTION_FETCH_CONCURRENCY = 1;
  const MAX_COLLECTION_PAGES = 200;
  const MAX_BULK_PACKS = 100;
  const RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
  const MARKETPLACE_MINE_CACHE_TTL = 15 * 1000;

  let marketplaceMineCache = {
    fetchedAt: 0,
    json: null,
    text: ''
  };

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

  function getGlobalCollectionSummaryCardId(url) {
    try {
      const parsed = new URL(url, location.origin);
      if (parsed.hostname !== 'cyrxjeppjqsxxjayfrur.supabase.co') return null;
      if (parsed.pathname !== '/rest/v1/cards') return null;

      const select = parsed.searchParams.get('select') || '';
      if (!select.split(',').map((value) => value.trim()).includes('summary')) return null;

      const rawId = parsed.searchParams.get('id') || '';
      const match = rawId.match(/^eq\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  function emitGlobalCollectionInspectedCard(url) {
    const id = getGlobalCollectionSummaryCardId(url);
    if (!id) return;

    window.dispatchEvent(new CustomEvent('wm-average-global-card-inspected', {
      detail: { id }
    }));
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

  async function fetchJsonRetry(url, options = {}, {
    label = 'Requête',
    maxAttempts = 3
  } = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await originalFetch(url, options);

        if (response.ok) {
          return await response.json();
        }

        const retryable = response.status >= 500 && response.status <= 599;
        lastError = new Error(`${label}: HTTP ${response.status}`);

        if (!retryable || attempt >= maxAttempts) {
          throw lastError;
        }
      } catch (error) {
        lastError = error;

        const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        const retryable = status == null || (status >= 500 && status <= 599);

        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }
      }

      const delayMs = Math.min(1800, 300 * (2 ** (attempt - 1)));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw lastError || new Error(`${label}: erreur inconnue`);
  }

  function extractRarityCounts(json) {
    if (!json || typeof json !== 'object') return null;

    const candidates = [
      json.rarityCounts,
      json.rarity_counts,
      json.rarities,
      json.counts,
      json.stats?.rarityCounts,
      json.stats?.rarity_counts,
      json.stats?.rarities,
      json.stats?.counts
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;

      const counts = {};
      let found = false;

      for (const rarity of RARITY_ORDER) {
        const value = Number(candidate[rarity]);
        if (Number.isFinite(value) && value >= 0) {
          counts[rarity] = value;
          found = true;
        }
      }

      if (found) return counts;
    }

    if (Array.isArray(json.rarities)) {
      const counts = {};
      for (const row of json.rarities) {
        const rarity = row?.rarity || row?.name || row?.key;
        const count = Number(row?.count ?? row?.total ?? row?.value);
        if (RARITY_ORDER.includes(rarity) && Number.isFinite(count) && count >= 0) {
          counts[rarity] = count;
        }
      }
      if (Object.keys(counts).length) return counts;
    }

    return null;
  }

  async function fetchCollectionRarityCounts() {
    try {
      const json = await fetchJsonRetry(
        '/api/my-collection/stats?sort=rarity',
        {
          method: 'GET',
          credentials: 'include',
          headers: { accept: '*/*' }
        },
        { label: 'Stats collection', maxAttempts: 3 }
      );
      return extractRarityCounts(json);
    } catch (error) {
      console.debug('[WM Average] stats de rareté indisponibles, fallback pages', error);
      return null;
    }
  }

  async function fetchCollectionPage(page, stats = false) {
    let attempt = 0;

    while (true) {
      attempt += 1;

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

        const retryable = response.status >= 500 && response.status <= 599;
        if (!retryable) {
          throw new Error(`Collection page ${page}: HTTP ${response.status}`);
        }

        console.warn(
          `[WM Average] Collection page ${page}: HTTP ${response.status}, retry ${attempt}`
        );
      } catch (error) {
        const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        const retryable =
          status == null ||
          (status >= 500 && status <= 599);

        if (!retryable) {
          throw error;
        }

        console.warn(
          `[WM Average] Collection page ${page}: erreur réseau, retry ${attempt}`
        );
      }

      const delayMs = Math.min(5000, 500 * (2 ** Math.min(attempt - 1, 4)));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  async function fetchAllCollection(requestId, selectedRarities = []) {
    try {
      const selectedIndexes = (Array.isArray(selectedRarities) ? selectedRarities : [])
        .map((rarity) => RARITY_ORDER.indexOf(rarity))
        .filter((index) => index >= 0);

      const lowestRequestedIndex = selectedIndexes.length
        ? Math.max(...selectedIndexes)
        : RARITY_ORDER.length - 1;

      const rarityCounts = await fetchCollectionRarityCounts();
      const first = await fetchCollectionPage(0, true);
      const firstCards = extractCards(first);
      const total = typeof first?.total === 'number' ? first.total : Number.NaN;
      const pageSize = firstCards.length;
      const pages = [firstCards];

      let totalPages = 1;
      if (Number.isFinite(total) && total > 0 && pageSize > 0) {
        totalPages = Math.max(1, Math.ceil(total / pageSize));
      }

      let targetPages = totalPages;
      let exactTargetFromStats = false;

      if (rarityCounts && pageSize > 0 && selectedIndexes.length) {
        let cardsThroughLowestRarity = 0;

        for (let index = 0; index <= lowestRequestedIndex; index += 1) {
          cardsThroughLowestRarity += Number(rarityCounts[RARITY_ORDER[index]]) || 0;
        }

        if (cardsThroughLowestRarity > 0) {
          targetPages = Math.max(1, Math.ceil(cardsThroughLowestRarity / pageSize));
          if (Number.isFinite(totalPages) && totalPages > 0) {
            targetPages = Math.min(targetPages, totalPages);
          }
          exactTargetFromStats = true;
        }
      }

      let loadedPages = 1;
      let stoppedEarly = exactTargetFromStats && targetPages < totalPages;

      const pageHasPassedRequestedRarity = (cards) => {
        if (!Array.isArray(cards) || !cards.length) return false;
        const lastRarity = cards[cards.length - 1]?.rarity;
        const lastIndex = RARITY_ORDER.indexOf(lastRarity);
        return lastIndex >= 0 && lastIndex > lowestRequestedIndex;
      };

      window.dispatchEvent(new CustomEvent('wm-average-all-collection-progress', {
        detail: {
          requestId,
          loadedPages,
          totalPages: exactTargetFromStats ? targetPages : totalPages,
          serverTotalPages: totalPages
        }
      }));

      if (!exactTargetFromStats && pageHasPassedRequestedRarity(firstCards)) {
        stoppedEarly = true;
      } else if (pageSize > 0) {
        const maxPageExclusive = exactTargetFromStats
          ? Math.min(targetPages, MAX_COLLECTION_PAGES)
          : (Number.isFinite(total) && totalPages > 0
              ? Math.min(totalPages, MAX_COLLECTION_PAGES)
              : MAX_COLLECTION_PAGES);

        for (let page = 1; page < maxPageExclusive; page += 1) {
          const json = await fetchCollectionPage(page, false);
          const cards = extractCards(json);
          pages[page] = cards;
          loadedPages += 1;

          window.dispatchEvent(new CustomEvent('wm-average-all-collection-progress', {
            detail: {
              requestId,
              loadedPages,
              totalPages: exactTargetFromStats ? targetPages : (Number.isFinite(total) ? totalPages : 0),
              serverTotalPages: totalPages
            }
          }));

          if (!exactTargetFromStats && pageHasPassedRequestedRarity(cards)) {
            stoppedEarly = Number.isFinite(total) ? page + 1 < totalPages : true;
            break;
          }

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

      const complete =
        lowestRequestedIndex >= RARITY_ORDER.length - 1 &&
        !stoppedEarly &&
        (
          !Number.isFinite(total) ||
          loadedPages >= totalPages
        );

      window.dispatchEvent(new CustomEvent('wm-average-all-collection', {
        detail: {
          requestId,
          ok: true,
          cards: [...deduped.values()],
          total: Number.isFinite(total) ? total : deduped.size,
          complete,
          loadedPages,
          totalPages: exactTargetFromStats ? targetPages : totalPages,
          usedRarityStats: exactTargetFromStats
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
        if (url && getGlobalCollectionSummaryCardId(url)) {
          if (response.ok) emitGlobalCollectionInspectedCard(url);
        } else if (url && url.includes('/api/my-collection')) {
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
          Boolean(getGlobalCollectionSummaryCardId(this.__wmUrl)) ||
          isTradesApi(this.__wmUrl) ||
          isMarketplaceDetailApi(this.__wmUrl) ||
          isPacksOpenApi(this.__wmUrl)
        )
      ) {
        this.addEventListener('load', () => {
          try {
            const json = JSON.parse(this.responseText);
            if (getGlobalCollectionSummaryCardId(this.__wmUrl)) {
              emitGlobalCollectionInspectedCard(this.__wmUrl);
            } else if (this.__wmUrl.includes('/api/my-collection')) {
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

    const selectedRarities = Array.isArray(event.detail?.selectedRarities)
      ? event.detail.selectedRarities
      : [];

    fetchAllCollection(requestId, selectedRarities);
  });

  window.addEventListener('wm-average-open-all-packs', (event) => {
    const requestId = event.detail?.requestId;
    if (!requestId) return;
    openAllPacks(requestId);
  });

  window.addEventListener('wm-average-load-trades', () => {
    fetchTrades();
  });

  function createSaleError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async function fetchMarketplaceMine(force = false) {
    const now = Date.now();

    if (
      !force &&
      marketplaceMineCache.json &&
      now - marketplaceMineCache.fetchedAt < MARKETPLACE_MINE_CACHE_TTL
    ) {
      return marketplaceMineCache;
    }

    const json = await fetchJsonRetry(
      '/api/marketplace/mine',
      {
        method: 'GET',
        credentials: 'include',
        headers: { accept: '*/*' }
      },
      { label: 'Mes ventes', maxAttempts: 3 }
    );

    marketplaceMineCache = {
      fetchedAt: now,
      json,
      text: JSON.stringify(json || {})
    };

    return marketplaceMineCache;
  }

  function markOwnedCardListedInMineCache(ownedCardId) {
    if (!ownedCardId) return;
    marketplaceMineCache.fetchedAt = Date.now();
    marketplaceMineCache.text = `${marketplaceMineCache.text || ''} ${ownedCardId}`;
  }

  async function fetchOwnedCardCandidates(catalogueCardId, title) {
    if (!catalogueCardId || !title) {
      throw createSaleError('Carte invalide.', 'INVALID_CARD');
    }

    const query = String(title).trim();
    const candidates = [];
    let page = 0;
    let totalPages = 1;

    while (page < Math.min(totalPages, MAX_COLLECTION_PAGES)) {
      let attempt = 0;
      let json = null;

      while (true) {
        attempt += 1;

        try {
          const response = await originalFetch(
            `/api/my-collection?sort=rarity&q=${encodeURIComponent(query)}&page=${page}&stats=${page === 0 ? 1 : 0}`,
            {
              method: 'GET',
              credentials: 'include',
              headers: { accept: '*/*' }
            }
          );

          if (response.ok) {
            json = await response.json();
            break;
          }

          if (response.status < 500 || response.status > 599) {
            throw createSaleError(
              `Recherche copie: HTTP ${response.status}`,
              'OWNERSHIP_LOOKUP_FAILED'
            );
          }
        } catch (error) {
          if (error?.code) throw error;

          const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
          const status = statusMatch ? Number(statusMatch[1]) : null;
          const retryable = status == null || (status >= 500 && status <= 599);
          if (!retryable) throw error;
        }

        const delayMs = Math.min(5000, 500 * (2 ** Math.min(attempt - 1, 4)));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const cards = extractCards(json);
      for (const card of cards) {
        if (
          card.id === catalogueCardId &&
          card.ownedCardId
        ) {
          candidates.push(card);
        }
      }

      if (page === 0) {
        const total = Number(json?.total);
        const pageSize = cards.length;
        totalPages =
          Number.isFinite(total) && total > 0 && pageSize > 0
            ? Math.max(1, Math.ceil(total / pageSize))
            : 1;
      }

      page += 1;
    }

    if (!candidates.length) {
      throw createSaleError('Tu ne possèdes plus cette carte.', 'NOT_OWNED');
    }

    return candidates;
  }

  async function resolveAvailableOwnedCardId(
    catalogueCardId,
    title,
    excludedIds = new Set(),
    forceMine = false
  ) {
    const candidates = await fetchOwnedCardCandidates(
      catalogueCardId,
      title
    );

    let mine = null;
    try {
      mine = await fetchMarketplaceMine(forceMine);
    } catch (error) {
      console.debug('[WM Average] /marketplace/mine indisponible, fallback copie collection', error);
    }

    const eligible = candidates.filter(
      (candidate) => !excludedIds.has(candidate.ownedCardId)
    );

    if (!eligible.length) {
      const excludedIsListed = mine && candidates.some(
        (candidate) =>
          excludedIds.has(candidate.ownedCardId) &&
          mine.text.includes(candidate.ownedCardId)
      );

      if (excludedIsListed) {
        throw createSaleError(
          'Toutes tes copies de cette carte sont déjà en vente.',
          'ALREADY_LISTED'
        );
      }

      throw createSaleError(
        'Tu ne possèdes plus cette carte.',
        'NOT_OWNED'
      );
    }

    if (!mine) {
      return eligible[0].ownedCardId;
    }

    const available = eligible.find(
      (candidate) => !mine.text.includes(candidate.ownedCardId)
    );

    if (available?.ownedCardId) {
      return available.ownedCardId;
    }

    throw createSaleError(
      'Toutes tes copies de cette carte sont déjà en vente.',
      'ALREADY_LISTED'
    );
  }

  async function submitMarketplaceListing(cardId, amount, duration) {
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

    return { response, json };
  }

  function isOwnershipListingError(json) {
    const message = String(json?.error || json?.message || '').toLocaleLowerCase('fr');
    return message.includes('vous ne possédez pas cette carte') ||
      message.includes('vous ne possedez pas cette carte');
  }

  window.addEventListener('wm-average-create-listing', async (event) => {
    const {
      requestId,
      ownedCardId,
      catalogueCardId,
      title,
      baseAmount,
      durationMinutes
    } = event.detail || {};

    if (!requestId || !catalogueCardId) return;

    const amount = Number(baseAmount);
    const duration = Number(durationMinutes);

    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(duration) || duration <= 0) {
      window.dispatchEvent(new CustomEvent('wm-average-create-listing-result', {
        detail: {
          requestId,
          catalogueCardId,
          ok: false,
          error: 'Prix ou durée invalide.'
        }
      }));
      return;
    }

    let resolvedOwnedCardId = ownedCardId || null;
    let staleOwnedCardId = null;

    try {
      const mine = await fetchMarketplaceMine(false).catch(() => null);

      if (
        resolvedOwnedCardId &&
        mine?.text?.includes(resolvedOwnedCardId)
      ) {
        staleOwnedCardId = resolvedOwnedCardId;
        resolvedOwnedCardId = null;
      }

      if (!resolvedOwnedCardId) {
        window.dispatchEvent(new CustomEvent('wm-average-create-listing-progress', {
          detail: { requestId, state: 'resolving-id' }
        }));

        resolvedOwnedCardId = await resolveAvailableOwnedCardId(
          catalogueCardId,
          title,
          new Set(staleOwnedCardId ? [staleOwnedCardId] : [])
        );
      }

      let { response, json } = await submitMarketplaceListing(
        resolvedOwnedCardId,
        amount,
        duration
      );

      if (!response.ok && isOwnershipListingError(json)) {
        staleOwnedCardId = resolvedOwnedCardId;

        window.dispatchEvent(new CustomEvent('wm-average-create-listing-progress', {
          detail: {
            requestId,
            state: 'refreshing-id',
            staleOwnedCardId
          }
        }));

        resolvedOwnedCardId = await resolveAvailableOwnedCardId(
          catalogueCardId,
          title,
          new Set([staleOwnedCardId]),
          true
        );

        ({ response, json } = await submitMarketplaceListing(
          resolvedOwnedCardId,
          amount,
          duration
        ));
      }

      if (!response.ok) {
        const ownershipError = isOwnershipListingError(json);

        window.dispatchEvent(new CustomEvent('wm-average-create-listing-result', {
          detail: {
            requestId,
            catalogueCardId,
            ownedCardId: resolvedOwnedCardId,
            staleOwnedCardId,
            ownershipError,
            ok: false,
            error: json?.error || json?.message || `HTTP ${response.status}`
          }
        }));
        return;
      }

      markOwnedCardListedInMineCache(resolvedOwnedCardId);

      window.dispatchEvent(new CustomEvent('wm-average-create-listing-result', {
        detail: {
          requestId,
          catalogueCardId,
          ownedCardId: resolvedOwnedCardId,
          staleOwnedCardId,
          ok: true,
          listing: json
        }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('wm-average-create-listing-result', {
        detail: {
          requestId,
          catalogueCardId,
          ownedCardId: resolvedOwnedCardId,
          staleOwnedCardId,
          notOwned: error?.code === 'NOT_OWNED',
          alreadyListed: error?.code === 'ALREADY_LISTED',
          ownershipError:
            error?.code === 'NOT_OWNED' ||
            String(error?.message || '')
              .toLocaleLowerCase('fr')
              .includes('vous ne possédez pas cette carte'),
          ok: false,
          error: String(error?.message || error)
        }
      }));
    }
  });

  window.addEventListener('wm-average-request', async (event) => {
    const { id, requestId } = event.detail || {};
    if (!id || !requestId) return;

    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
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
          const retryable = response.status >= 500 && response.status <= 599;
          lastError = new Error(`HTTP ${response.status}`);

          if (!retryable || attempt >= 3) {
            throw lastError;
          }
        } else {
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
          return;
        }
      } catch (error) {
        lastError = error;

        const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        const retryable = status == null || (status >= 500 && status <= 599);

        if (!retryable || attempt >= 3) {
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }

    window.dispatchEvent(new CustomEvent('wm-average-response', {
      detail: {
        requestId,
        id,
        ok: false,
        retryAfterMs: 60 * 1000,
        error: String(lastError?.message || lastError || 'Erreur réseau')
      }
    }));
  });

  console.debug('[WM Average] bridge installé');
})();