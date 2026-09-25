function getExtensionRuntime() {
  return (typeof browser !== 'undefined' && browser?.runtime)
    ? browser.runtime
    : (typeof chrome !== 'undefined' && chrome?.runtime)
      ? chrome.runtime
      : null;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (() => {
    if (window.__wmAverageBootstrapInjected) return;
    window.__wmAverageBootstrapInjected = true;

    // Posé dès document_start : le CSS peut masquer le design WikiMasters
    // avant le premier paint, sauf si l'utilisateur a désactivé les cartes premium.
    let premiumCardsEnabled = true;
    try {
      const saved = JSON.parse(localStorage.getItem('wm_feature_settings_v1') || 'null');
      premiumCardsEnabled = saved?.premiumCards !== false;
    } catch (_) {}

    if (premiumCardsEnabled) {
      document.documentElement?.classList.add('wm-premium-cards-enabled');
    }

    const extensionRuntime = getExtensionRuntime();
    if (!extensionRuntime?.getURL) return;

    const urls = [
      'bridge/core.js',
      'bridge/collection.js',
      'bridge/packs.js',
      'bridge/intercept.js',
      'bridge/marketplace.js',
      'bridge/prices.js',
      'page-bridge.js',
      'features/core.js',
      'features/settings.js',
      'features/price-ui.js',
      'features/price-loader.js',
      'features/card-extras.js',
      'features/pull-stats.js',
      'features/compact-mode.js',
      'features/trades.js',
      'features/modal-ui.js',
      'features/packs.js',
      'features/ranking.js',
      'features/collection-bulk.js',
      'features/app.js',
      'content.js'
    ].map((path) => extensionRuntime.getURL(path));

    const parent = document.head || document.documentElement;

    for (const src of urls) {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.wmAverageInjected = '1';
      parent.appendChild(script);
    }
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getExtensionRuntime };
}