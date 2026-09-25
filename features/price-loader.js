(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.priceLoader = {
    create(runtime) {
      const {
        MAX_CONCURRENT, ERROR_CACHE_TTL, cardMetaById, idByTitle, cacheMemory,
        normalizeTitle, cacheKey, storageGet, storageSet, isCacheEntryValid,
        registerCards
      } = runtime.core;

      const queued = [];
      const queuedIds = new Set();
      const inFlightIds = new Set();
      const pendingByRequestId = new Map();
      const bulkPendingIds = new Set();
      let activeRequests = 0;
      let bulkBatchActive = false;
      let bulkTotal = 0;

      function notifyBulkProgress() {
        runtime.collectionBulk?.updateBulkProgress(bulkTotal, bulkPendingIds.size);
      }

      function loadCacheForCards(cards, { forceRarities = null, markBulk = false } = {}) {
        registerCards(cards);

        for (const card of cards) {
          const forceCard = Boolean(forceRarities?.has(card.rarity));
          if (forceCard) cacheMemory.delete(card.id);
          runtime.priceUi.renderKnownCard(card.id);
        }

        const keys = cards.map(({ id }) => cacheKey(id));
        const stored = storageGet(keys);
        const now = Date.now();

        if (markBulk) {
          bulkBatchActive = true;
          bulkPendingIds.clear();
          bulkTotal = cards.length;
        }

        for (const card of cards) {
          const { id } = card;
          const forceCard = Boolean(forceRarities?.has(card.rarity));
          const entry = stored[cacheKey(id)];
          const valid = !forceCard && isCacheEntryValid(entry, now);

          if (valid) {
            cacheMemory.set(id, entry);
            runtime.priceUi.renderKnownCard(id);
          } else {
            cacheMemory.delete(id);
            if (markBulk) bulkPendingIds.add(id);
            enqueue(id);
          }
        }

        if (markBulk) notifyBulkProgress();
        pumpQueue();

        if (markBulk && bulkPendingIds.size === 0) {
          runtime.collectionBulk.finishBulkLoad();
        }
      }

      function enqueue(id) {
        const memoryEntry = cacheMemory.get(id);

        if (memoryEntry && isCacheEntryValid(memoryEntry)) return;
        if (memoryEntry) cacheMemory.delete(id);

        if (queuedIds.has(id) || inFlightIds.has(id)) return;
        queued.push(id);
        queuedIds.add(id);
      }

      function pumpQueue() {
        while (activeRequests < MAX_CONCURRENT && queued.length > 0) {
          const id = queued.shift();
          queuedIds.delete(id);

          const memoryEntry = cacheMemory.get(id);
          if (memoryEntry && isCacheEntryValid(memoryEntry)) continue;
          if (memoryEntry) cacheMemory.delete(id);

          if (inFlightIds.has(id)) continue;
          requestAverage(id);
        }
      }

      function requestAverage(id) {
        activeRequests += 1;
        inFlightIds.add(id);

        const requestId = `${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        pendingByRequestId.set(requestId, id);

        window.dispatchEvent(new CustomEvent('wm-average-request', {
          detail: { id, requestId }
        }));
      }

      function finishRequest(detail) {
        const id = pendingByRequestId.get(detail.requestId) || detail.id;
        if (!id) return;

        pendingByRequestId.delete(detail.requestId);
        inFlightIds.delete(id);
        activeRequests = Math.max(0, activeRequests - 1);

        const entry = {
          fetchedAt: Date.now(),
          averages: detail.ok ? (detail.averages || {}) : {},
          ok: Boolean(detail.ok),
          retryAfterMs: detail.ok ? null : (Number(detail.retryAfterMs) || ERROR_CACHE_TTL)
        };

        if (detail.title) {
          const oldMeta = cardMetaById.get(id) || { id };
          const updatedMeta = { ...oldMeta, title: detail.title };
          cardMetaById.set(id, updatedMeta);
          idByTitle.set(normalizeTitle(detail.title), id);
        }

        cacheMemory.set(id, entry);
        storageSet({ [cacheKey(id)]: entry });
        runtime.priceUi.renderKnownCard(id);

        if (bulkPendingIds.delete(id)) {
          notifyBulkProgress();
          if (bulkBatchActive && bulkPendingIds.size === 0) {
            runtime.collectionBulk.finishBulkLoad();
          }
        }

        if (!detail.ok) {
          console.debug('[WM Average] échec temporaire mis en cache 60 s', id, detail.error);
        }

        pumpQueue();
      }


      window.addEventListener('wm-average-response', (event) => {
        try {
          finishRequest(event.detail || {});
        } catch (error) {
          reportError('réponse', error);
        }
      });


      function isPending(id) {
        return queuedIds.has(id) || inFlightIds.has(id);
      }

      return { loadCacheForCards, isPending };
    }
  };
})();
