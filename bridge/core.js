(() => {
  const registry = window.__wmBridgeFeatures ||= {};

  registry.bridgeCore = {
    create() {
      const originalFetch = window.fetch.bind(window);
      const MAX_COLLECTION_PAGES = 200;
      const MAX_BULK_PACKS = 100;
      const RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
      const MARKETPLACE_MINE_CACHE_TTL = 15 * 1000;

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
          wikipediaUrl: card?.wikipedia_url || null,
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
              wikipediaUrl: card.wikipedia_url || null,
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
                  wikipediaUrl: card?.wikipedia_url || null,
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
              wikipediaUrl: card?.wikipedia_url || null,
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


      return {
        originalFetch, MAX_COLLECTION_PAGES, MAX_BULK_PACKS, RARITY_ORDER,
        MARKETPLACE_MINE_CACHE_TTL, mapEntry, extractCards, emitCollection,
        isMarketplaceDetailApi, isPacksOpenApi, isTradesApi,
        getGlobalCollectionSummaryCardId, emitGlobalCollectionInspectedCard,
        mapPackCards, emitPackOpened, mapTrade, emitTrades, fetchTrades,
        emitMarketplaceDetail, fetchJsonRetry
      };
    }
  };
})();
