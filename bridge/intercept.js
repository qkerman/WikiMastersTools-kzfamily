(() => {
  const registry = window.__wmBridgeFeatures ||= {};

  registry.bridgeIntercept = {
    create(runtime) {
      const {
        originalFetch, emitCollection, isMarketplaceDetailApi, isPacksOpenApi,
        isTradesApi, getGlobalCollectionSummaryCardId,
        emitGlobalCollectionInspectedCard, emitTrades, fetchTrades,
        emitMarketplaceDetail, emitPackOpened
      } = runtime.core;

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

        runtime.collection.fetchAllCollection(requestId, selectedRarities);
      });

      window.addEventListener('wm-average-open-all-packs', (event) => {
        const requestId = event.detail?.requestId;
        if (!requestId) return;
        runtime.packs.openAllPacks(requestId);
      });

      window.addEventListener('wm-average-load-trades', () => {
        fetchTrades();
      });


      return {};
    }
  };
})();
