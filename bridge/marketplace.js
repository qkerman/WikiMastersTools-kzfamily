(() => {
  const registry = window.__wmBridgeFeatures ||= {};

  registry.bridgeMarketplace = {
    create(runtime) {
      const {
        originalFetch, MAX_COLLECTION_PAGES, MARKETPLACE_MINE_CACHE_TTL,
        fetchJsonRetry, extractCards, emitMarketplaceDetail
      } = runtime.core;

      let marketplaceMineCache = {
        fetchedAt: 0,
        json: null,
        text: ''
      };

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

      window.addEventListener('wm-average-load-marketplace-detail', async (event) => {
        const auctionId = String(event.detail?.auctionId || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auctionId)) {
          return;
        }

        try {
          const json = await fetchJsonRetry(
            `/api/marketplace/${auctionId}`,
            {
              method: 'GET',
              credentials: 'include',
              headers: { accept: '*/*' }
            },
            { label: 'Annonce Marketplace', maxAttempts: 3 }
          );

          emitMarketplaceDetail(json);
        } catch (error) {
          console.debug('[WM Average] annonce Marketplace indisponible', auctionId, error);
        }
      });

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


      return {};
    }
  };
})();
