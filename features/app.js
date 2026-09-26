(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.app = {
    create(runtime) {
      const {
        isCollectionPage, isMarketplaceDetailPage, isMarketplacePage,
        isPullsPage, isTradesPage, isGlobalCollectionPage, isGuildPage,
        cleanupPriceCacheOnceDaily, reportError
      } = runtime.core;

      function renderAll() {
        if (isCollectionPage()) {
          runtime.collectionBulk.ensureToolbar();
          runtime.collectionBulk.ensurePriceLegend();
          runtime.priceUi.renderVisibleCollectionCards();
        }

        if (isMarketplaceDetailPage()) {
          runtime.priceUi.renderMarketplaceCurrent();
        }

        if (isPullsPage()) {
          runtime.settings.ensureButton();
          runtime.packs.ensurePullsToolbar();
          runtime.packs.updateAutoOpenToggleUi();
          runtime.pullStats.renderPullStats();
          runtime.packs.renderPackRecap();
          runtime.packs.restoreAcknowledgedConsent();
        }

        if (isTradesPage()) {
          runtime.trades.ensureTradesLoaded();
          runtime.trades.renderTradeButtons();
          runtime.trades.renderTradeDetailCards();
        }

        if (isGlobalCollectionPage()) {
          runtime.priceUi.ensureGlobalCollectionInspectedCard();
          runtime.priceUi.renderGlobalCollectionInspectedCard();
        }

        runtime.compactMode.ensureCompactControl();
        runtime.cardExtras.renderCardExtras();
      }


      let renderTimer = null;
      let previousPath = location.pathname;
      let observedMain = null;

      function routeIsSupported() {
        return (
          isCollectionPage() ||
          isMarketplacePage() ||
          isPullsPage() ||
          isTradesPage() ||
          isGlobalCollectionPage() ||
          isGuildPage() ||
          Boolean(document.querySelector('div[class*="glow-"] h3'))
        );
      }

      function handlePathChange() {
        const currentPath = location.pathname;
        if (currentPath === previousPath) return false;

        previousPath = currentPath;
        if (isTradesPage()) runtime.trades.resetTradesRequest();
        if (!runtime.compactMode.compactEligiblePage()) {
          document.body?.classList.remove('wm-compact-mode');
        }

        console.debug('[WM Average] navigation SPA détectée:', currentPath);
        return true;
      }

      function scheduleRender(delay = 70) {
        if (!routeIsSupported()) return;

        clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
          try {
            renderAll();
          } catch (error) {
            reportError('rendu', error);
          }
        }, delay);
      }

      function mutationIsExtensionOwned(mutation) {
        const target = mutation?.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation?.target?.parentElement;

        return Boolean(
          target?.closest?.(
            '.wm-average-badge, .wm-tools-bar, .wm-modal-overlay, .wm-marketplace-average-wrap, ' +
            '.wm-pulls-tools, .wm-pulls-info, .wm-pack-recap, .wm-trade-values-panel, ' +
            '.wm-trade-values-controls, #wm-open-all-overlay, .wm-pull-stats, ' +
            '.wm-wikipedia-card-button, .wm-missing-image-credit, .wm-compact-tools, .wm-price-legend, ' +
            '.wm-auto-open-control, .wm-auto-open-help, .wm-settings-launch, .wm-settings-modal'
          )
        );
      }

      const mainObserver = new MutationObserver((mutations) => {
        handlePathChange();

        if (mutations.every(mutationIsExtensionOwned)) {
          return;
        }

        scheduleRender();
      });

      function attachMainObserver() {
        const currentMain = document.querySelector('main');
        if (currentMain === observedMain) return;

        mainObserver.disconnect();
        observedMain = currentMain;

        if (observedMain) {
          mainObserver.observe(observedMain, {
            childList: true,
            subtree: true
          });
        }
      }

      const outsideObserver = new MutationObserver((mutations) => {
        const pathChanged = handlePathChange();
        const previousMain = observedMain;

        attachMainObserver();

        const hasOutsideChange = mutations.some((mutation) => {
          if (mutationIsExtensionOwned(mutation)) return false;
          if (!previousMain) return true;
          return !previousMain.contains(mutation.target);
        });

        if (pathChanged || hasOutsideChange || previousMain !== observedMain) {
          scheduleRender();
        }
      });

      function startObserver() {
        if (!document.body) {
          requestAnimationFrame(startObserver);
          return;
        }

        cleanupPriceCacheOnceDaily();
        attachMainObserver();

        if (runtime.packs.isAutoOpenEnabled()) {
          runtime.packs.scheduleNextAutoOpen({ keepExisting: true });
        }

        outsideObserver.observe(document.body, {
          childList: true,
          subtree: true
        });

        renderAll();
      }

      window.addEventListener('popstate', () => {
        previousPath = location.pathname;
        attachMainObserver();
        scheduleRender(0);
      });

      console.debug('[WM Average] app module v4.15.2 prêt');

      return { startObserver };
    }
  };
})();
