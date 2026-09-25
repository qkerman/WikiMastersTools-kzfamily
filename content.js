(() => {
  if (window.__wmAverageUiInstalled) return;
  window.__wmAverageUiInstalled = true;

  const featureRegistry = window.__wmAverageFeatures || {};

  const requiredFeatures = [
    'core',
    'settings',
    'imageResolver',
    'priceUi',
    'priceLoader',
    'cardExtras',
    'pullStats',
    'compactMode',
    'trades',
    'modalUi',
    'packs',
    'ranking',
    'collectionBulk',
    'app'
  ];

  const missingFeatures = requiredFeatures.filter(
    (name) => typeof featureRegistry[name]?.create !== 'function'
  );

  if (missingFeatures.length) {
    document.documentElement?.classList.remove('wm-premium-cards-enabled');
    console.error(
      '[WM Average] initialisation annulée : modules manquants',
      missingFeatures
    );
    return;
  }

  const runtime = {};
  window.__wmAverageRuntime = runtime;

  runtime.core = featureRegistry.core.create();
  runtime.settings = featureRegistry.settings.create(runtime.core);
  runtime.imageResolver = featureRegistry.imageResolver.create({
    normalizeTitle: runtime.core.normalizeTitle,
    readLocalValue: runtime.core.readLocalValue,
    writeLocalValue: runtime.core.writeLocalValue,
    MISSING_IMAGE_CACHE_PREFIX: runtime.core.MISSING_IMAGE_CACHE_PREFIX,
    MISSING_IMAGE_FOUND_TTL: runtime.core.MISSING_IMAGE_FOUND_TTL,
    MISSING_IMAGE_MISS_TTL: runtime.core.MISSING_IMAGE_MISS_TTL
  });
  runtime.priceUi = featureRegistry.priceUi.create(runtime);
  runtime.priceLoader = featureRegistry.priceLoader.create(runtime);

  runtime.cardExtras = featureRegistry.cardExtras.create({
    normalizeTitle: runtime.core.normalizeTitle,
    idByTitle: runtime.core.idByTitle,
    cardMetaById: runtime.core.cardMetaById,
    imageResolver: runtime.imageResolver,
    isFeatureEnabled: runtime.settings.isEnabled
  });

  runtime.pullStats = featureRegistry.pullStats.create({
    RARITIES: runtime.core.RARITIES,
    PULL_STATS_KEY: runtime.core.PULL_STATS_KEY,
    readLocalValue: runtime.core.readLocalValue,
    writeLocalValue: runtime.core.writeLocalValue,
    isPullsPage: runtime.core.isPullsPage,
    isFeatureEnabled: runtime.settings.isEnabled
  });

  runtime.compactMode = featureRegistry.compactMode.create({
    COMPACT_MODE_KEY: runtime.core.COMPACT_MODE_KEY,
    readLocalValue: runtime.core.readLocalValue,
    writeLocalValue: runtime.core.writeLocalValue,
    isCollectionPage: runtime.core.isCollectionPage,
    isGlobalCollectionPage: runtime.core.isGlobalCollectionPage,
    isFeatureEnabled: runtime.settings.isEnabled
  });

  runtime.trades = featureRegistry.trades.create({
    isTradesPage: runtime.core.isTradesPage,
    normalizeTitle: runtime.core.normalizeTitle,
    cardMetaById: runtime.core.cardMetaById,
    idByTitle: runtime.core.idByTitle,
    cacheMemory: runtime.core.cacheMemory,
    renderCollectionCard: runtime.priceUi.renderCollectionCard,
    reportError: runtime.core.reportError,
    loadCacheForCards: runtime.priceLoader.loadCacheForCards,
    createSponsorNote: runtime.core.createSponsorNote,
    formatAverage: runtime.priceUi.formatAverage,
    chooseAverage: runtime.priceUi.chooseAverage,
    registerCards: runtime.core.registerCards,
    isFeatureEnabled: runtime.settings.isEnabled
  });

  runtime.modalUi = featureRegistry.modalUi.create();
  runtime.packs = featureRegistry.packs.create(runtime);
  runtime.ranking = featureRegistry.ranking.create(runtime);
  runtime.collectionBulk = featureRegistry.collectionBulk.create(runtime);
  runtime.app = featureRegistry.app.create(runtime);

  runtime.app.startObserver();
  console.debug('[WM Average] runtime modulaire v4.4.0 chargé');
})();
