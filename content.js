(() => {
  if (window.__wmAverageUiInstalled) return;
  window.__wmAverageUiInstalled = true;

  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
  const ERROR_CACHE_TTL = 60 * 1000;
  const CACHE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
  const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  const CACHE_CLEANUP_KEY = 'wm_avg_cache_cleanup_v1';
  const CACHE_PREFIX = 'wm_avg_v3_';
  const MAX_CONCURRENT = 3;
  const BULK_RARITY_LAST_LOAD_KEY = 'wm_bulk_rarity_last_load_v1';
  const ALL_COLLECTION_KEY = 'wm_all_collection_v1';
  const PULL_RECAP_ENABLED_KEY = 'wm_pull_recap_enabled_v1';
  const PULL_STATS_KEY = 'wm_pull_stats_v1';
  const AUTO_OPEN_ENABLED_KEY = 'wm_auto_open_enabled_v1';
  const AUTO_OPEN_NEXT_AT_KEY = 'wm_auto_open_next_at_v1';
  const AUTO_OPEN_SESSION_KEY = 'wm_auto_open_session_v1';
  const AUTO_OPEN_MIN_DELAY = 20 * 60 * 1000;
  const AUTO_OPEN_MAX_DELAY = 100 * 60 * 1000;
  const COMPACT_MODE_KEY = 'wm_compact_mode_v1';
  const MISSING_IMAGE_CACHE_PREFIX = 'wm_missing_img_v1_';
  const MISSING_IMAGE_FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
  const MISSING_IMAGE_MISS_TTL = 7 * 24 * 60 * 60 * 1000;
  const RARITIES = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
  const DEFAULT_RARE_RARITIES = ['L', 'UR', 'SR', 'R'];

  const cardMetaById = new Map();
  const idByTitle = new Map();
  const cacheMemory = new Map();
  const queued = [];
  const queuedIds = new Set();
  const inFlightIds = new Set();
  const pendingByRequestId = new Map();

  let activeRequests = 0;
  let bulkActive = false;
  let bulkRequestId = null;
  let bulkTotal = 0;
  let bulkSelectedRarities = new Set(DEFAULT_RARE_RARITIES);
  let bulkForceRarities = new Set();
  let bulkOnlyUnloaded = false;
  const bulkPendingIds = new Set();

  let bulkButton = null;
  let rankingButton = null;
  let marketplaceCardId = null;
  let globalCollectionCardId = null;
  let globalCollectionInitializedId = null;
  let pullRecapEnabled = readLocalValue(PULL_RECAP_ENABLED_KEY) !== false;
  let activePackRecap = null;
  let packRecapDismissed = false;
  let openAllActive = false;
  let openAllRequestId = null;
  let openAllButton = null;
  let openAllSummaryCards = [];
  let openAllOpenedPacks = 0;
  let openAllError = null;
  let openAllRenderTimer = null;
  let openAllSummaryTitle = 'Cartes obtenues';
  let openAllSummaryOnClose = null;
  let openAllSummaryReloadOnClose = true;
  let autoOpenEnabled = readLocalValue(AUTO_OPEN_ENABLED_KEY) === true;
  let autoOpenTimer = null;
  let autoOpenRequestId = null;
  let autoOpenShowSummaryAfterCurrent = false;
  let autoOpenToggleInput = null;
  let autoOpenToggleLabel = null;
  let collectionPriceObserver = null;
  let cardExtrasObserver = null;
  let compactModeEnabled = readLocalValue(COMPACT_MODE_KEY) === true;
  const missingImagePending = new Map();
  const tradesById = new Map();
  const activeTradeValueIds = new Set();
  let tradesRequested = false;
  const pendingMarketplaceListings = new Map();

  function isCollectionPage() {
    return location.pathname === '/collection' || location.pathname.startsWith('/collection/');
  }

  function isMarketplaceDetailPage() {
    return /^\/marketplace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(location.pathname);
  }

  function isMarketplacePage() {
    return location.pathname === '/marketplace' || location.pathname.startsWith('/marketplace/');
  }

  function isPullsPage() {
    return location.pathname === '/pulls' || location.pathname.startsWith('/pulls/');
  }

  function isTradesPage() {
    return location.pathname === '/trades' || location.pathname.startsWith('/trades/');
  }

  function isGlobalCollectionPage() {
    return location.pathname === '/global-collection' || location.pathname.startsWith('/global-collection/');
  }

  function isLastPullCardVisible() {
    if (!isPullsPage()) return false;

    for (const el of document.querySelectorAll('main div')) {
      const text = String(el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();

      const match = text.match(/^Carte\s*(\d+)\s*\/\s*(\d+)$/i);
      if (!match) continue;

      const current = Number(match[1]);
      const total = Number(match[2]);
      return total > 0 && current === total;
    }

    return false;
  }

  function normalizeTitle(value) {
    return String(value || '')
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cacheKey(id) {
    return CACHE_PREFIX + id;
  }

  function readLocalValue(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (_) {
      return undefined;
    }
  }

  function writeLocalValue(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('[WM Average] localStorage indisponible', error);
      return false;
    }
  }

  function storageGet(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const result = {};

    for (const key of list) {
      const value = readLocalValue(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }

    return result;
  }

  function storageSet(values) {
    for (const [key, value] of Object.entries(values || {})) {
      writeLocalValue(key, value);
    }
  }

  function isCacheEntryValid(entry, now = Date.now()) {
    if (!entry || !Number.isFinite(Number(entry.fetchedAt))) return false;
    const ttl = entry.ok === false ? ERROR_CACHE_TTL : CACHE_TTL;
    return now - Number(entry.fetchedAt) < ttl;
  }

  function cleanupPriceCacheOnceDaily() {
    const lastCleanup = Number(readLocalValue(CACHE_CLEANUP_KEY)) || 0;
    const now = Date.now();
    if (now - lastCleanup < CACHE_CLEANUP_INTERVAL) return;

    try {
      const keysToRemove = [];

      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;

        if (/^wm_avg_v[12]_/.test(key)) {
          keysToRemove.push(key);
          continue;
        }

        if (!key.startsWith(CACHE_PREFIX)) continue;

        const entry = readLocalValue(key);
        const fetchedAt = Number(entry?.fetchedAt) || 0;

        if (!fetchedAt || now - fetchedAt > CACHE_MAX_AGE) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
      writeLocalValue(CACHE_CLEANUP_KEY, now);
    } catch (error) {
      console.debug('[WM Average] nettoyage cache ignoré', error);
    }
  }

  function isContextInvalidatedError(error) {
    return String(error?.message || error).includes('Extension context invalidated');
  }

  function reportError(scope, error) {
    if (isContextInvalidatedError(error)) return;
    console.error(`[WM Average] ${scope}`, error);
  }

  function registerCards(cards) {
    for (const meta of cards) {
      if (!meta?.id || !meta?.title) continue;
      const normalized = {
        ...cardMetaById.get(meta.id),
        id: meta.id,
        title: meta.title,
        rarity: meta.rarity || null,
        imageUrl: meta.imageUrl || null,
        wikipediaUrl: meta.wikipediaUrl || cardMetaById.get(meta.id)?.wikipediaUrl || null,
        count: Number(meta.count) || 1,
        ownedCardId: meta.ownedCardId || cardMetaById.get(meta.id)?.ownedCardId || null,
        ownedCardIds: Array.isArray(meta.ownedCardIds)
          ? [...meta.ownedCardIds]
          : (cardMetaById.get(meta.id)?.ownedCardIds || [])
      };
      cardMetaById.set(normalized.id, normalized);
      idByTitle.set(normalizeTitle(normalized.title), normalized.id);
    }
  }

  function wikipediaUrlFor(title, meta = null) {
    if (meta?.wikipediaUrl) return meta.wikipediaUrl;
    const normalized = normalizeTitle(title);
    if (!normalized) return null;
    return `https://fr.wikipedia.org/wiki/${encodeURIComponent(normalized.replace(/ /g, '_'))}`;
  }

  function ensureWikipediaButton(card) {
    if (!card || card.querySelector(':scope > .wm-wikipedia-card-button')) return;

    const h3 = card.querySelector('h3');
    const title = normalizeTitle(h3?.textContent);
    if (!title) return;

    const id = idByTitle.get(title);
    const meta = id ? cardMetaById.get(id) : null;
    const url = wikipediaUrlFor(title, meta);
    if (!url) return;

    const button = document.createElement('a');
    button.className = 'wm-wikipedia-card-button';
    button.href = url;
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    button.referrerPolicy = 'no-referrer';
    button.textContent = 'W';
    button.title = 'Ouvrir l’article Wikipédia';
    button.setAttribute('aria-label', `Ouvrir Wikipédia : ${title}`);

    const stop = (event) => event.stopPropagation();
    button.addEventListener('pointerdown', stop);
    button.addEventListener('mousedown', stop);
    button.addEventListener('click', stop);

    card.append(button);
  }

  function findMissingImagePlaceholder(card) {
    if (!card) return null;

    for (const img of card.querySelectorAll('img')) {
      if (img.classList.contains('wm-replaced-missing-image')) continue;

      const alt = normalizeTitle(img.getAttribute('alt')).toLocaleLowerCase('fr');
      const src = String(img.currentSrc || img.src || '');

      if (
        alt === 'wikimasters' ||
        /(?:%2f|\/)logo\.png/i.test(src)
      ) {
        return img;
      }
    }

    return null;
  }

  function missingImageCacheKey(title) {
    return MISSING_IMAGE_CACHE_PREFIX + encodeURIComponent(normalizeTitle(title));
  }

  function readMissingImageCache(title) {
    const entry = readLocalValue(missingImageCacheKey(title));
    if (!entry || !Number.isFinite(Number(entry.fetchedAt))) return null;

    const ttl = entry.found ? MISSING_IMAGE_FOUND_TTL : MISSING_IMAGE_MISS_TTL;
    if (Date.now() - Number(entry.fetchedAt) >= ttl) return null;

    return entry;
  }

  async function resolveMissingImage(title) {
    const normalized = normalizeTitle(title);
    if (!normalized) return null;

    const cached = readMissingImageCache(normalized);
    if (cached) return cached;

    const pending = missingImagePending.get(normalized);
    if (pending) return pending;

    const task = (async () => {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        origin: '*',
        redirects: '1',
        prop: 'pageimages',
        piprop: 'thumbnail|name',
        pithumbsize: '720',
        titles: normalized
      });

      const response = await fetch(`https://fr.wikipedia.org/w/api.php?${params}`, {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { accept: 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Wikipedia HTTP ${response.status}`);
      }

      const json = await response.json();
      const page = Object.values(json?.query?.pages || {})[0] || null;
      const imageUrl = page?.thumbnail?.source || null;
      const fileName = page?.pageimage || null;

      // We intentionally keep only Wikimedia Commons images.
      const found = Boolean(
        imageUrl &&
        /\/wikipedia\/commons\//i.test(String(imageUrl))
      );

      const entry = {
        fetchedAt: Date.now(),
        found,
        url: found ? imageUrl : null,
        fileName: found ? fileName : null
      };

      writeLocalValue(missingImageCacheKey(normalized), entry);
      return entry;
    })();

    missingImagePending.set(normalized, task);

    try {
      return await task;
    } finally {
      missingImagePending.delete(normalized);
    }
  }

  function applyResolvedMissingImage(card, placeholder, title, entry) {
    if (!card?.isConnected || !placeholder?.isConnected || !entry?.found || !entry.url) return;

    placeholder.classList.add('wm-replaced-missing-image');
    placeholder.dataset.wmOriginalSrc = placeholder.getAttribute('src') || '';
    placeholder.dataset.wmOriginalSrcset = placeholder.getAttribute('srcset') || '';
    placeholder.src = entry.url;
    placeholder.removeAttribute('srcset');
    placeholder.alt = title;
    placeholder.referrerPolicy = 'no-referrer';

    if (!card.querySelector(':scope > .wm-missing-image-credit')) {
      const credit = document.createElement('a');
      credit.className = 'wm-missing-image-credit';
      credit.target = '_blank';
      credit.rel = 'noopener noreferrer';
      credit.referrerPolicy = 'no-referrer';
      credit.textContent = 'Wikimedia';
      credit.title = 'Image ajoutée depuis Wikimedia Commons';

      if (entry.fileName) {
        credit.href = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(entry.fileName.replace(/ /g, '_'))}`;
      } else {
        credit.href = wikipediaUrlFor(title);
      }

      const stop = (event) => event.stopPropagation();
      credit.addEventListener('pointerdown', stop);
      credit.addEventListener('click', stop);
      card.append(credit);
    }
  }

  async function ensureMissingImageForCard(card) {
    if (!card?.isConnected) return;
    if (card.dataset.wmMissingImageLoading === '1') return;

    const placeholder = findMissingImagePlaceholder(card);
    if (!placeholder) return;

    const retryAt = Number(card.dataset.wmMissingImageRetryAt) || 0;
    if (retryAt > Date.now()) return;

    const title = normalizeTitle(card.querySelector('h3')?.textContent);
    if (!title) return;

    card.dataset.wmMissingImageLoading = '1';

    try {
      const entry = await resolveMissingImage(title);

      if (entry?.found) {
        applyResolvedMissingImage(card, placeholder, title, entry);
      } else {
        card.dataset.wmMissingImageDone = '1';
      }
    } catch (error) {
      card.dataset.wmMissingImageRetryAt = String(Date.now() + 60 * 1000);
      console.debug('[WM Average] image Wikimedia indisponible', title, error);
    } finally {
      delete card.dataset.wmMissingImageLoading;
    }
  }

  function ensureCardExtrasObserver() {
    if (cardExtrasObserver) return cardExtrasObserver;

    cardExtrasObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const card = entry.target;
        cardExtrasObserver.unobserve(card);

        ensureMissingImageForCard(card).catch((error) => {
          console.debug('[WM Average] image manquante', error);
        });
      }
    }, {
      root: null,
      rootMargin: '280px 0px',
      threshold: 0
    });

    return cardExtrasObserver;
  }

  function renderCardExtras() {
    const observer = ensureCardExtrasObserver();

    for (const card of document.querySelectorAll('div[class*="glow-"]')) {
      if (!card.querySelector('h3')) continue;

      ensureWikipediaButton(card);

      if (
        card.dataset.wmMissingImageDone !== '1' &&
        findMissingImagePlaceholder(card)
      ) {
        observer.observe(card);
      }
    }
  }

  function readPullStats() {
    const raw = readLocalValue(PULL_STATS_KEY) || {};
    const counts = {};

    for (const rarity of RARITIES) {
      counts[rarity] = Math.max(0, Number(raw?.counts?.[rarity]) || 0);
    }

    return {
      counts,
      total: RARITIES.reduce((sum, rarity) => sum + counts[rarity], 0)
    };
  }

  function writePullStats(stats) {
    writeLocalValue(PULL_STATS_KEY, {
      counts: stats.counts,
      updatedAt: Date.now()
    });
  }

  function recordPullStats(cards) {
    if (!Array.isArray(cards) || !cards.length) return;

    const stats = readPullStats();

    for (const card of cards) {
      if (!RARITIES.includes(card?.rarity)) continue;
      stats.counts[card.rarity] += 1;
      stats.total += 1;
    }

    writePullStats(stats);
    renderPullStats();
  }

  function renderPullStats() {
    if (!isPullsPage()) return;

    const info = document.getElementById('wm-pulls-info');
    if (!info?.parentElement) return;

    const stats = readPullStats();
    const key = RARITIES.map((rarity) => stats.counts[rarity]).join(':');

    let panel = document.getElementById('wm-pull-stats');
    if (panel?.dataset.wmStatsKey === key) return;

    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'wm-pull-stats';
      panel.className = 'wm-pull-stats';
      info.insertAdjacentElement('afterend', panel);
    }

    panel.dataset.wmStatsKey = key;

    const head = document.createElement('div');
    head.className = 'wm-pull-stats-head';

    const title = document.createElement('strong');
    title.className = 'wm-pull-stats-title';
    title.textContent = 'Vos statistiques';

    const total = document.createElement('span');
    total.className = 'wm-pull-stats-total';
    total.textContent = `${stats.total} carte${stats.total > 1 ? 's' : ''}`;

    head.append(title, total);

    if (stats.total === 0) {
      const empty = document.createElement('div');
      empty.className = 'wm-pull-stats-note';
      empty.textContent = 'Aucune carte comptée pour le moment. Ouvrez un paquet pour commencer.';

      panel.replaceChildren(head, empty);
      return;
    }

    const rows = document.createElement('div');
    rows.className = 'wm-pull-stats-rows';

    for (const rarity of RARITIES) {
      const count = stats.counts[rarity];
      const percent = stats.total > 0 ? (count / stats.total) * 100 : 0;

      const row = document.createElement('div');
      row.className = 'wm-pull-stat-row';
      row.dataset.rarity = rarity.toLowerCase();

      const label = document.createElement('span');
      label.className = 'wm-pull-stat-label';
      label.textContent = rarity;

      const track = document.createElement('span');
      track.className = 'wm-pull-stat-track';

      if (count > 0) {
        const bar = document.createElement('span');
        bar.className = 'wm-pull-stat-bar';
        bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        track.append(bar);
      }

      const share = document.createElement('span');
      share.className = 'wm-pull-stat-percent';
      share.textContent = `${percent.toLocaleString('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1
      })} %`;

      const amount = document.createElement('span');
      amount.className = 'wm-pull-stat-count';
      amount.textContent = String(count);

      row.append(label, track, share, amount);
      rows.append(row);
    }

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'wm-pull-stats-reset';
    reset.textContent = 'Réinitialiser les statistiques';
    reset.addEventListener('click', () => {
      if (!confirm('Réinitialiser toutes les statistiques de tirage ?')) return;
      localStorage.removeItem(PULL_STATS_KEY);
      panel.dataset.wmStatsKey = '';
      renderPullStats();
    });

    panel.replaceChildren(head, rows, reset);
  }

  function compactEligiblePage() {
    return isCollectionPage() || isGlobalCollectionPage();
  }

  function applyCompactMode() {
    document.body?.classList.toggle(
      'wm-compact-mode',
      compactModeEnabled && compactEligiblePage()
    );

    for (const button of document.querySelectorAll('[data-wm-compact-button]')) {
      button.classList.toggle('is-enabled', compactModeEnabled);
      button.textContent = compactModeEnabled ? 'Compact ✓' : 'Compact';
      button.setAttribute('aria-pressed', compactModeEnabled ? 'true' : 'false');
    }
  }

  function makeCompactButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wm-tool-button wm-compact-button';
    button.dataset.wmCompactButton = '1';
    button.title = 'Réduire la taille des cartes pour en afficher davantage';
    button.addEventListener('click', () => {
      compactModeEnabled = !compactModeEnabled;
      writeLocalValue(COMPACT_MODE_KEY, compactModeEnabled);
      applyCompactMode();
    });
    return button;
  }

  function ensureCompactControl() {
    if (!compactEligiblePage()) {
      applyCompactMode();
      return;
    }

    if (isCollectionPage()) {
      const bar = document.getElementById('wm-tools-bar');
      if (bar && !bar.querySelector('[data-wm-compact-button]')) {
        const sponsor = bar.querySelector('.wm-sponsor-note');
        const button = makeCompactButton();
        if (sponsor) bar.insertBefore(button, sponsor);
        else bar.append(button);
      }
    } else if (isGlobalCollectionPage() && !document.getElementById('wm-global-compact-tools')) {
      const h1 = document.querySelector('main h1');
      if (h1) {
        const tools = document.createElement('div');
        tools.id = 'wm-global-compact-tools';
        tools.className = 'wm-compact-tools';
        tools.append(makeCompactButton());
        h1.parentElement?.insertAdjacentElement('afterend', tools);
      }
    }

    applyCompactMode();
  }

  function createSponsorNote() {
    const note = document.createElement('div');
    note.className = 'wm-sponsor-note';
    note.append(document.createTextNode('bouton sponsorisé par '));

    const link = document.createElement('a');
    link.href = 'https://www.twitch.tv/botkz';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'https://www.twitch.tv/botkz';

    note.append(link);
    return note;
  }

  function getRarityFromCard(cardEl) {
    if (!cardEl) return null;
    const candidates = cardEl.querySelectorAll('div, span');
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (/^(L|UR|SR|R|PC|C)$/.test(text)) return text;
    }
    return null;
  }

  function formatAverage(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2
    }).format(n);
  }

  function findCardByTitle(title) {
    if (!isCollectionPage()) return null;

    const target = normalizeTitle(title);
    for (const h3 of document.querySelectorAll('h3')) {
      if (normalizeTitle(h3.textContent) !== target) continue;
      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) return card;
    }
    return null;
  }

  function getOrCreateBadge(card) {
    let badge = card.querySelector('.wm-average-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'wm-average-badge';
    }

    const title = card.querySelector('h3');
    const textArea = title?.parentElement;

    if (title && textArea) {
      if (badge.parentElement !== textArea || title.nextElementSibling !== badge) {
        title.insertAdjacentElement('afterend', badge);
      }
    } else if (!badge.parentElement) {
      card.appendChild(badge);
    }

    return badge;
  }

  function renderLoadingBadge(badge) {
    if (
      badge.classList.contains('wm-average-loading') &&
      normalizeTitle(badge.textContent) === 'Prix…'
    ) {
      return;
    }

    badge.className = 'wm-average-badge wm-average-loading';
    badge.title = 'Chargement du prix moyen…';
    badge.replaceChildren();

    const spinner = document.createElement('span');
    spinner.className = 'wm-average-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = 'Prix…';

    badge.append(spinner, label);
  }

  function chooseAverage(cacheEntry, cardEl, explicitRarity = null) {
    const rarity = explicitRarity || getRarityFromCard(cardEl);
    const averages = cacheEntry?.averages || {};
    if (rarity && Number.isFinite(Number(averages[rarity]))) {
      return Number(averages[rarity]);
    }

    const values = Object.values(averages)
      .map(Number)
      .filter(Number.isFinite);
    return values.length === 1 ? values[0] : null;
  }

  function renderCollectionCard(id, card) {
    const badge = getOrCreateBadge(card);
    const cacheEntry = cacheMemory.get(id);

    if (!cacheEntry) {
      renderLoadingBadge(badge);
      return;
    }

    if (cacheEntry.ok === false) {
      if (badge.className !== 'wm-average-badge wm-average-empty') {
        badge.className = 'wm-average-badge wm-average-empty';
      }
      badge.title = 'Erreur temporaire lors du chargement du prix';
      if (badge.textContent !== 'Prix indispo.') badge.textContent = 'Prix indispo.';
      return;
    }

    badge.title = 'Prix moyen des ventes (cache 24 h)';
    const average = chooseAverage(cacheEntry, card, cardMetaById.get(id)?.rarity || null);

    if (average == null) {
      if (badge.className !== 'wm-average-badge wm-average-empty') {
        badge.className = 'wm-average-badge wm-average-empty';
      }
      if (badge.textContent !== 'Moy. —') badge.textContent = 'Moy. —';
    } else {
      if (badge.className !== 'wm-average-badge') {
        badge.className = 'wm-average-badge';
      }
      const text = `Moy. ${formatAverage(average)} W`;
      if (badge.textContent !== text) badge.textContent = text;
    }
  }

  function ensureCollectionPriceObserver() {
    if (collectionPriceObserver) return collectionPriceObserver;

    collectionPriceObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const cardEl = entry.target;
        const id = cardEl.dataset.wmCardId;
        if (!id) {
          collectionPriceObserver.unobserve(cardEl);
          continue;
        }

        const meta = cardMetaById.get(id);
        if (meta) {
          try {
            loadCacheForCards([meta]);
          } catch (error) {
            reportError('prix visible', error);
          }
        }

        collectionPriceObserver.unobserve(cardEl);
      }
    }, {
      root: null,
      rootMargin: '320px 0px',
      threshold: 0
    });

    return collectionPriceObserver;
  }

  function hydrateCacheForCards(cards) {
    const now = Date.now();
    const stored = storageGet(cards.map((card) => cacheKey(card.id)));

    for (const card of cards) {
      const entry = stored[cacheKey(card.id)];

      if (isCacheEntryValid(entry, now)) {
        cacheMemory.set(card.id, entry);
      } else {
        cacheMemory.delete(card.id);
      }
    }
  }

  function bindCollectionCardElement(id, h3, card) {
    if (!id || !card) return;

    card.dataset.wmCardId = id;
    if (h3) h3.dataset.wmCardBound = '1';

    renderCollectionCard(id, card);

    if (!isCacheEntryValid(cacheMemory.get(id))) {
      ensureCollectionPriceObserver().observe(card);
    }
  }

  function renderOne(id) {
    if (!isCollectionPage()) return;

    const direct = document.querySelector(`[data-wm-card-id="${CSS.escape(id)}"]`);
    if (direct) {
      renderCollectionCard(id, direct);
      return;
    }

    const meta = cardMetaById.get(id);
    if (!meta?.title) return;

    const card = findCardByTitle(meta.title);
    if (card) {
      const h3 = card.querySelector('h3');
      bindCollectionCardElement(id, h3, card);
    }
  }

  function renderVisibleCollectionCards() {
    if (!isCollectionPage()) return;

    for (const card of document.querySelectorAll('[data-wm-card-id]')) {
      const id = card.dataset.wmCardId;
      if (!id) continue;

      renderCollectionCard(id, card);

      if (
        !isCacheEntryValid(cacheMemory.get(id)) &&
        !queuedIds.has(id) &&
        !inFlightIds.has(id)
      ) {
        ensureCollectionPriceObserver().observe(card);
      }
    }

    for (const h3 of document.querySelectorAll('h3:not([data-wm-card-bound])')) {
      const id = idByTitle.get(normalizeTitle(h3.textContent));
      if (!id) continue;

      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) bindCollectionCardElement(id, h3, card);
    }
  }

  function renderMarketplaceAverage(id) {
    if (!isMarketplaceDetailPage() || marketplaceCardId !== id) return;

    const meta = cardMetaById.get(id);
    if (!meta?.title) return;

    const h1 = [...document.querySelectorAll('h1')]
      .find((el) => normalizeTitle(el.textContent) === normalizeTitle(meta.title));
    if (!h1) return;

    const headingRow = h1.parentElement;
    const titleBlock = headingRow?.parentElement;
    if (!titleBlock) return;

    let wrap = document.getElementById('wm-marketplace-average');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'wm-marketplace-average';
      wrap.className = 'wm-marketplace-average-wrap';

      const priceCard = document.createElement('div');
      priceCard.className = 'wm-marketplace-average-card';

      const labelWrap = document.createElement('div');
      labelWrap.className = 'wm-marketplace-average-label-wrap';

      const label = document.createElement('span');
      label.className = 'wm-marketplace-average-label';
      label.textContent = 'Prix moyen';

      const rarity = document.createElement('span');
      rarity.className = 'wm-marketplace-average-rarity';
      rarity.dataset.role = 'rarity';

      labelWrap.append(label, rarity);

      const value = document.createElement('span');
      value.className = 'wm-marketplace-average-value';
      value.dataset.role = 'value';

      priceCard.append(labelWrap, value);
      wrap.append(priceCard, createSponsorNote());
      titleBlock.insertAdjacentElement('afterend', wrap);
    }

    const rarityEl = wrap.querySelector('[data-role="rarity"]');
    if (rarityEl) {
      rarityEl.textContent = meta.rarity ? `Rareté ${meta.rarity}` : '';
    }

    const valueEl = wrap.querySelector('[data-role="value"]');
    if (!valueEl) return;

    const cacheEntry = cacheMemory.get(id);
    if (!cacheEntry) {
      valueEl.className = 'wm-marketplace-average-value wm-marketplace-average-loading';
      valueEl.replaceChildren();

      const spinner = document.createElement('span');
      spinner.className = 'wm-average-spinner';
      spinner.setAttribute('aria-hidden', 'true');

      const loadingText = document.createElement('span');
      loadingText.textContent = 'Chargement…';

      valueEl.append(spinner, loadingText);
      return;
    }

    const average = chooseAverage(cacheEntry, null, meta.rarity || null);
    valueEl.className = 'wm-marketplace-average-value';
    valueEl.textContent = average == null ? '—' : `${formatAverage(average)} W`;
  }

  function renderKnownCard(id) {
    renderOne(id);
    renderMarketplaceAverage(id);

    if (activePackRecap?.cards?.some((card) => card.id === id)) {
      renderPackRecap();
    }

    if (openAllSummaryCards.some((card) => card.id === id)) {
      scheduleOpenAllSummaryRender();
    }

    renderTradeDetailCard(id);

    if (id === globalCollectionCardId) {
      renderGlobalCollectionInspectedCard();
    }

    for (const tradeId of activeTradeValueIds) {
      const trade = tradesById.get(tradeId);
      if (trade?.items?.some((item) => item.card?.id === id)) {
        renderTradeValues(tradeId);
      }
    }
  }

  function getGlobalCollectionInspection() {
    if (!isGlobalCollectionPage()) return null;

    for (const closeButton of document.querySelectorAll('button[aria-label="Fermer"]')) {
      const modal = closeButton.closest('.card-frame');
      if (!modal) continue;

      const h3 = modal.querySelector('h3');
      if (!h3) continue;

      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) {
        return { modal, card, h3 };
      }
    }

    return null;
  }

  function renderGlobalCollectionInspectedCard() {
    if (!isGlobalCollectionPage() || !globalCollectionCardId) return;

    const inspection = getGlobalCollectionInspection();
    if (!inspection) return;

    const meta = cardMetaById.get(globalCollectionCardId);
    if (!meta?.title) return;

    if (normalizeTitle(inspection.h3.textContent) !== normalizeTitle(meta.title)) {
      return;
    }

    renderCollectionCard(meta.id, inspection.card);
  }

  function ensureGlobalCollectionInspectedCard() {
    if (!isGlobalCollectionPage() || !globalCollectionCardId) return;

    const inspection = getGlobalCollectionInspection();
    if (!inspection) return;

    const title = normalizeTitle(inspection.h3.textContent);
    if (!title) return;

    const existingMeta = cardMetaById.get(globalCollectionCardId);
    if (
      existingMeta?.title &&
      normalizeTitle(existingMeta.title) !== title
    ) {
      return;
    }

    const meta = {
      id: globalCollectionCardId,
      title,
      rarity: getRarityFromCard(inspection.card),
      imageUrl: inspection.card.querySelector('img[alt]')?.src || null,
      count: 1
    };

    registerCards([meta]);
    renderCollectionCard(meta.id, inspection.card);

    if (globalCollectionInitializedId === meta.id) return;

    // Important: mark as initialized BEFORE loadCacheForCards().
    // loadCacheForCards() calls renderKnownCard(), which can render this card again.
    globalCollectionInitializedId = meta.id;

    try {
      loadCacheForCards([meta]);
    } catch (error) {
      globalCollectionInitializedId = null;
      reportError('collection globale', error);
    }
  }

  function ensureTradesLoaded() {
    if (!isTradesPage() || tradesRequested) return;
    tradesRequested = true;
    window.dispatchEvent(new CustomEvent('wm-average-load-trades'));
  }

  function getTradeDetailModal() {
    if (!isTradesPage()) return null;

    const heading = [...document.querySelectorAll('h2')]
      .find((el) => normalizeTitle(el.textContent) === "Détail de l'échange");

    if (!heading) return null;

    return heading.closest('div[class*="fixed"][class*="inset-0"]') || heading.parentElement?.parentElement || null;
  }

  function renderTradeDetailCard(id) {
    if (!isTradesPage()) return;

    const meta = cardMetaById.get(id);
    if (!meta?.title) return;

    const modal = getTradeDetailModal();
    if (!modal) return;

    for (const h3 of modal.querySelectorAll('h3')) {
      if (normalizeTitle(h3.textContent) !== normalizeTitle(meta.title)) continue;

      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) {
        renderCollectionCard(id, card);
      }
    }
  }

  function renderTradeDetailCards() {
    const modal = getTradeDetailModal();
    if (!modal) return;

    const cardsToLoad = new Map();

    for (const h3 of modal.querySelectorAll('h3')) {
      const id = idByTitle.get(normalizeTitle(h3.textContent));
      if (!id) continue;

      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (!card) continue;

      renderCollectionCard(id, card);

      const meta = cardMetaById.get(id);
      if (meta?.id && meta?.title) {
        cardsToLoad.set(id, meta);
      }
    }

    if (!cardsToLoad.size) return;

    try {
      loadCacheForCards([...cardsToLoad.values()]);
    } catch (error) {
      reportError('prix cartes détail échange', error);
    }
  }

  function getTradeCardElements() {
    return [...document.querySelectorAll('.card-frame')].filter((card) =>
      [...card.querySelectorAll('button[aria-label]')].some(
        (button) => normalizeTitle(button.getAttribute('aria-label')) === "Voir le détail de l'échange"
      )
    );
  }

  function tradeMatchScore(cardEl, trade, usedIds) {
    if (!trade || usedIds.has(trade.id)) return -Infinity;

    const titled = new Set(
      [...cardEl.querySelectorAll('[title]')]
        .map((el) => normalizeTitle(el.getAttribute('title')))
        .filter(Boolean)
    );

    const itemTitles = trade.items.map((item) => normalizeTitle(item.card?.title)).filter(Boolean);
    const matchedItems = itemTitles.filter((title) => titled.has(title)).length;
    const text = normalizeTitle(cardEl.textContent).toLocaleLowerCase('fr');

    let score = 0;
    if (itemTitles.length) {
      score += matchedItems * 30;
      if (matchedItems === itemTitles.length) score += 100;
      else score -= (itemTitles.length - matchedItems) * 20;
    }

    for (const username of [trade.initiator?.username, trade.recipient?.username]) {
      const normalized = normalizeTitle(username).toLocaleLowerCase('fr');
      if (normalized && text.includes(normalized)) score += 12;
    }

    return score;
  }

  function findTradeForCard(cardEl, usedIds) {
    const presetId = cardEl.dataset.wmTradeId;
    if (presetId && tradesById.has(presetId) && !usedIds.has(presetId)) {
      return tradesById.get(presetId);
    }

    let best = null;
    let bestScore = 0;

    for (const trade of tradesById.values()) {
      const score = tradeMatchScore(cardEl, trade, usedIds);
      if (score > bestScore) {
        bestScore = score;
        best = trade;
      }
    }

    return best;
  }

  function getTradeCards(trade) {
    return trade.items.map((item) => item.card).filter((card) => card?.id && card?.title);
  }

  function setTradeButtonState(cardEl, tradeId) {
    const button = cardEl.querySelector('.wm-trade-values-button');
    if (!button) return;
    button.textContent = activeTradeValueIds.has(tradeId) ? 'Masquer les valeurs' : 'Valeurs';
  }

  function ensureTradeButton(cardEl, trade) {
    cardEl.dataset.wmTradeId = trade.id;

    let controls = cardEl.querySelector(':scope > .wm-trade-values-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'wm-trade-values-controls';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wm-tool-button wm-trade-values-button';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const tradeId = cardEl.dataset.wmTradeId;
        const currentTrade = tradesById.get(tradeId);
        if (!currentTrade) return;

        if (activeTradeValueIds.has(tradeId)) {
          activeTradeValueIds.delete(tradeId);
          cardEl.querySelector(':scope > .wm-trade-values-panel')?.remove();
          setTradeButtonState(cardEl, tradeId);
          return;
        }

        activeTradeValueIds.add(tradeId);
        setTradeButtonState(cardEl, tradeId);
        renderTradeValues(tradeId);

        const cards = [...new Map(
          getTradeCards(currentTrade).map((card) => [card.id, card])
        ).values()];

        try {
          loadCacheForCards(cards);
        } catch (error) {
          reportError('prix échange', error);
        }
      });

      controls.append(button, createSponsorNote());
      cardEl.append(controls);
    }

    setTradeButtonState(cardEl, trade.id);

    if (activeTradeValueIds.has(trade.id)) {
      renderTradeValues(trade.id);
    }
  }

  function createTradeSide(trade, side) {
    const isInitiator = side === 'initiator';
    const userId = isInitiator ? trade.initiatorId : trade.recipientId;
    const user = isInitiator ? trade.initiator : trade.recipient;
    const wikibidous = isInitiator ? trade.initiatorWikibidous : trade.recipientWikibidous;
    const items = trade.items.filter((item) => item.offeredBy === userId);

    const section = document.createElement('div');
    section.className = 'wm-trade-side';

    const heading = document.createElement('div');
    heading.className = 'wm-trade-side-heading';

    const name = document.createElement('strong');
    name.textContent = user?.username || (isInitiator ? 'Initiateur' : 'Destinataire');

    const summary = document.createElement('span');
    summary.textContent = `${items.length} carte${items.length > 1 ? 's' : ''}`;

    heading.append(name, summary);

    const list = document.createElement('div');
    list.className = 'wm-trade-value-list';

    let total = Number(wikibidous) || 0;
    let pending = 0;
    let missing = 0;
    let pricedCards = 0;

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'wm-trade-empty';
      empty.textContent = 'Aucune carte';
      list.append(empty);
    }

    for (const item of items) {
      const card = item.card;
      const row = document.createElement('div');
      row.className = 'wm-trade-value-row';

      const info = document.createElement('div');
      info.className = 'wm-trade-value-info';

      const title = document.createElement('span');
      title.className = 'wm-trade-value-title';
      title.textContent = card.title;

      const rarity = document.createElement('span');
      rarity.className = 'wm-trade-value-rarity';
      rarity.textContent = card.rarity || '—';

      info.append(title, rarity);

      const value = document.createElement('span');
      value.className = 'wm-trade-value-price';

      const entry = cacheMemory.get(card.id);
      if (!entry) {
        pending += 1;
        value.classList.add('is-loading');
        const spinner = document.createElement('span');
        spinner.className = 'wm-average-spinner';
        value.append(spinner, document.createTextNode('…'));
      } else {
        const average = chooseAverage(entry, null, card.rarity || null);
        if (Number.isFinite(average)) {
          pricedCards += 1;
          total += average;
          value.textContent = `${formatAverage(average)} W`;
        } else {
          missing += 1;
          value.textContent = '—';
          value.classList.add('is-empty');
        }
      }

      row.append(info, value);
      list.append(row);
    }

    if (wikibidous > 0) {
      const row = document.createElement('div');
      row.className = 'wm-trade-value-row wm-trade-currency-row';

      const label = document.createElement('span');
      label.className = 'wm-trade-value-title';
      label.textContent = 'WikiBidous';

      const value = document.createElement('span');
      value.className = 'wm-trade-value-price';
      value.textContent = `${formatAverage(wikibidous)} W`;

      row.append(label, value);
      list.append(row);
    }

    const totalRow = document.createElement('div');
    totalRow.className = 'wm-trade-total';

    const totalLabel = document.createElement('strong');
    const totalValue = document.createElement('strong');

    if (pending > 0) {
      totalLabel.textContent = 'Total';
      totalValue.className = 'is-loading';
      const spinner = document.createElement('span');
      spinner.className = 'wm-average-spinner';
      totalValue.append(spinner, document.createTextNode(' …'));
    } else {
      totalLabel.textContent = missing > 0 ? 'Total connu' : 'Total';
      totalValue.textContent = (pricedCards > 0 || wikibidous > 0)
        ? `${formatAverage(total)} W`
        : '—';
    }

    totalRow.append(totalLabel, totalValue);

    if (!pending && missing > 0) {
      const note = document.createElement('div');
      note.className = 'wm-trade-missing-note';
      note.textContent = `${missing} carte${missing > 1 ? 's' : ''} sans prix moyen`;
      section.append(heading, list, totalRow, note);
    } else {
      section.append(heading, list, totalRow);
    }

    return section;
  }

  function renderTradeValues(tradeId) {
    if (!isTradesPage() || !activeTradeValueIds.has(tradeId)) return;

    const trade = tradesById.get(tradeId);
    const cardEl = getTradeCardElements().find((el) => el.dataset.wmTradeId === tradeId);
    if (!trade || !cardEl) return;

    let panel = cardEl.querySelector(':scope > .wm-trade-values-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'wm-trade-values-panel';
      cardEl.append(panel);
    }

    panel.replaceChildren(
      createTradeSide(trade, 'initiator'),
      createTradeSide(trade, 'recipient')
    );
  }

  function renderTradeButtons() {
    if (!isTradesPage() || !tradesById.size) return;

    const usedIds = new Set();
    for (const cardEl of getTradeCardElements()) {
      const trade = findTradeForCard(cardEl, usedIds);
      if (!trade) continue;

      usedIds.add(trade.id);
      ensureTradeButton(cardEl, trade);
    }
  }

  // ── Anti-bot test : valide automatiquement la vérification « Je ne suis pas un robot »
  // sur la page pulls. Objectif défensif : tester la robustesse de la détection côté site.
  //
  // Approche « comportementale » :
  // - délais lognormaux (distribution réelle de la latence humaine, longue traîne à droite)
  // - personnalité de session constante (un humain garde le même rythme pendant toute
  //   la session ; un robot resample à chaque fois)
  // - on ne clique que lorsque le bloc est réellement visible et que l'onglet a le focus
  // Note : le honeypot `input[name="website"]` est volontairement ignoré.
  const antiBotDismissedBlocks = new WeakSet();

  const antiBotPersonality = {
    // Rythme de lecture : 1.0 = rapide, jusqu'à ~2.4 = lent.
    readingPace: 1 + Math.random() * 1.4,
    // Hésitation générale entre chaque action.
    hesitancy: 0.55 + Math.random() * 1.15,
    // Temps de « prise de conscience » : le bloc vient d'apparaître, l'utilisateur
    // doit d'abord le remarquer.
    awarenessOffset: 300 + Math.random() * 1500
  };

  function lognormalSample(mu, sigma) {
    // Box-Muller sur loi normale, puis exponentielle => lognormale.
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.exp(mu + sigma * z);
  }

  function humanDelay(muMs, sigma, minMs, maxMs, multiplier = 1) {
    const raw = lognormalSample(Math.log(muMs), sigma) * multiplier;
    return Math.min(maxMs, Math.max(minMs, raw));
  }

  function isElementEffectivelyVisible(element) {
    if (!element?.isConnected) return false;
    if (document.visibilityState !== 'visible') return false;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;

    // Au moins partiellement dans le viewport.
    return rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  // Attend qu'une condition soit vraie en sondant à intervalle irrégulier
  // (les sondes à intervalle fixe sont un signal de robot).
  function waitFor(condition, { timeoutMs = 15000, onDone } = {}) {
    const startedAt = Date.now();

    const probe = () => {
      if (condition()) {
        onDone(true);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        onDone(false);
        return;
      }

      setTimeout(probe, 90 + Math.random() * 160);
    };

    setTimeout(probe, 90 + Math.random() * 160);
  }

  function findAntiBotVerification() {
    if (!isPullsPage()) return null;

    for (const label of document.querySelectorAll('label')) {
      if (normalizeTitle(label.textContent) !== 'Je ne suis pas un robot') continue;

      const checkbox = label.querySelector('input[type="checkbox"]');
      if (!checkbox) continue;

      const block = checkbox.closest('div[class*="rounded-xl"]') || label.parentElement;
      if (!block) continue;

      const button = [...block.querySelectorAll('button')]
        .find((btn) => normalizeTitle(btn.textContent) === 'Continuer');

      if (button) return { block, checkbox, button };
    }

    return null;
  }

  function autoDismissAntiBotVerification() {
    const verification = findAntiBotVerification();
    if (!verification || antiBotDismissedBlocks.has(verification.block)) return;

    antiBotDismissedBlocks.add(verification.block);
    const { block, checkbox, button } = verification;

    console.debug('[WM Average] vérification anti-bot détectée, validation automatique');

    // Séquence :
    // 1. prise de conscience (bloc fraîchement apparu)      ~0.3 – 1.8 s
    // 2. lecture du texte de la vérification                ~1.2 – 9 s   (lognormal)
    // 3. clic sur la checkbox
    // 4. hésitation avant de cliquer « Continuer »          ~0.2 – 4 s   (lognormal)
    // 5. clic sur « Continuer »
    const awarenessDelay = antiBotPersonality.awarenessOffset;
    const readingDelay = humanDelay(2400, 0.55, 1200, 9000, antiBotPersonality.readingPace);

    setTimeout(() => {
      // Un humain ne clique pas un élément non visible : on attend la visibilité.
      waitFor(() => isElementEffectivelyVisible(block), {
        onDone: (visible) => {
          if (!visible || !checkbox.isConnected) return;

          setTimeout(() => {
            if (!checkbox.isConnected) return;

            if (!checkbox.checked) checkbox.click();

            const hesitation = humanDelay(650, 0.65, 180, 4200, antiBotPersonality.hesitancy);
            setTimeout(() => {
              if (button.isConnected && !button.disabled) button.click();
            }, hesitation);
          }, readingDelay);
        }
      });
    }, awarenessDelay);
  }

  function readAutoOpenSession() {
    const raw = readLocalValue(AUTO_OPEN_SESSION_KEY);

    return {
      startedAt: Number(raw?.startedAt) || Date.now(),
      openedPacks: Math.max(0, Number(raw?.openedPacks) || 0),
      runs: Math.max(0, Number(raw?.runs) || 0),
      cards: Array.isArray(raw?.cards) ? raw.cards.filter((card) => card?.id && card?.title) : [],
      errors: Array.isArray(raw?.errors) ? raw.errors.map(String).slice(-10) : []
    };
  }

  function writeAutoOpenSession(session) {
    writeLocalValue(AUTO_OPEN_SESSION_KEY, {
      startedAt: Number(session?.startedAt) || Date.now(),
      openedPacks: Math.max(0, Number(session?.openedPacks) || 0),
      runs: Math.max(0, Number(session?.runs) || 0),
      cards: Array.isArray(session?.cards) ? session.cards : [],
      errors: Array.isArray(session?.errors) ? session.errors.slice(-10) : []
    });
  }

  function resetAutoOpenSession() {
    const session = {
      startedAt: Date.now(),
      openedPacks: 0,
      runs: 0,
      cards: [],
      errors: []
    };
    writeAutoOpenSession(session);
    return session;
  }

  function randomAutoOpenDelay() {
    return Math.round(
      AUTO_OPEN_MIN_DELAY +
      Math.random() * (AUTO_OPEN_MAX_DELAY - AUTO_OPEN_MIN_DELAY)
    );
  }

  function clearAutoOpenTimer() {
    if (autoOpenTimer) {
      clearTimeout(autoOpenTimer);
      autoOpenTimer = null;
    }
  }

  function updateAutoOpenToggleUi() {
    if (autoOpenToggleInput) {
      autoOpenToggleInput.checked = autoOpenEnabled;
    }
    if (autoOpenToggleLabel) {
      autoOpenToggleLabel.classList.toggle('is-enabled', autoOpenEnabled);
    }
  }

  function scheduleNextAutoOpen({ keepExisting = true } = {}) {
    clearAutoOpenTimer();

    if (!autoOpenEnabled) {
      localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
      return;
    }

    let nextAt = keepExisting ? Number(readLocalValue(AUTO_OPEN_NEXT_AT_KEY)) || 0 : 0;
    const now = Date.now();

    if (nextAt <= now) {
      nextAt = now + randomAutoOpenDelay();
      writeLocalValue(AUTO_OPEN_NEXT_AT_KEY, nextAt);
    }

    const delay = Math.max(1000, nextAt - now);

    autoOpenTimer = setTimeout(() => {
      autoOpenTimer = null;
      runAutomaticOpen().catch((error) => {
        reportError('ouverture automatique', error);
        if (autoOpenEnabled) scheduleNextAutoOpen({ keepExisting: false });
      });
    }, delay);
  }

  function appendAutomaticOpenResult(detail) {
    const session = readAutoOpenSession();
    const cards = Array.isArray(detail?.cards) ? detail.cards : [];
    const openedPacks = Math.max(0, Number(detail?.openedPacks) || 0);

    if (cards.length || openedPacks > 0) {
      session.cards.push(...cards);
      session.openedPacks += openedPacks;
      session.runs += 1;
    }

    if (!detail?.ok && detail?.error) {
      session.errors.push(String(detail.error));
    }

    writeAutoOpenSession(session);
    return session;
  }

  function showAutomaticOpenSummary() {
    const session = readAutoOpenSession();

    if (!session.cards.length) {
      localStorage.removeItem(AUTO_OPEN_SESSION_KEY);
      showInfoModal(
        'Ouverture automatique',
        'Aucune carte n’a été ouverte automatiquement pendant cette session.'
      );
      return;
    }

    const error =
      session.errors.length > 0
        ? `${session.errors.length} cycle${session.errors.length > 1 ? 's' : ''} interrompu${session.errors.length > 1 ? 's' : ''} pendant la session.`
        : null;

    openOpenAllSummary(
      session.cards,
      session.openedPacks,
      error,
      {
        title: 'Récap ouverture automatique',
        reloadOnClose: false,
        onClose: () => {
          localStorage.removeItem(AUTO_OPEN_SESSION_KEY);
        }
      }
    );
  }

  function disableAutomaticOpening({ showSummary = true } = {}) {
    autoOpenEnabled = false;
    writeLocalValue(AUTO_OPEN_ENABLED_KEY, false);
    localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
    clearAutoOpenTimer();
    updateAutoOpenToggleUi();

    if (autoOpenRequestId && openAllActive && openAllRequestId === autoOpenRequestId) {
      autoOpenShowSummaryAfterCurrent = showSummary;
      return;
    }

    if (showSummary) {
      showAutomaticOpenSummary();
    }
  }

  function enableAutomaticOpening() {
    autoOpenEnabled = true;
    writeLocalValue(AUTO_OPEN_ENABLED_KEY, true);
    resetAutoOpenSession();
    localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
    autoOpenShowSummaryAfterCurrent = false;
    updateAutoOpenToggleUi();
    scheduleNextAutoOpen({ keepExisting: false });
  }

  function startOpenAllPacks({ automatic = false } = {}) {
    if (openAllActive) return false;

    openAllActive = true;
    openAllSummaryCards = [];
    openAllOpenedPacks = 0;
    openAllError = null;
    openAllRequestId = `${automatic ? 'auto-packs' : 'packs'}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    if (automatic) {
      autoOpenRequestId = openAllRequestId;
    }

    if (openAllButton?.isConnected) {
      openAllButton.disabled = true;
      openAllButton.textContent = automatic ? 'Auto ouverture…' : 'Ouverture…';
    }

    document.getElementById('wm-pack-recap')?.remove();
    document.getElementById('wm-open-all-overlay')?.remove();

    window.dispatchEvent(new CustomEvent('wm-average-open-all-packs', {
      detail: { requestId: openAllRequestId }
    }));

    return true;
  }

  async function runAutomaticOpen() {
    if (!autoOpenEnabled) return;

    localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);

    if (openAllActive) {
      scheduleNextAutoOpen({ keepExisting: false });
      return;
    }

    const started = startOpenAllPacks({ automatic: true });
    if (!started && autoOpenEnabled) {
      scheduleNextAutoOpen({ keepExisting: false });
    }
  }

  function showAutoOpenHelp() {
    showInfoModal(
      'Ouverture automatique',
      'Quand cette option est activée, l’extension attend aléatoirement entre 20 et 100 minutes puis utilise « Tout ouvrir » pour ouvrir tous les paquets disponibles. Les récaps intermédiaires restent masqués et le cycle recommence automatiquement. Quand vous désactivez l’option, un récapitulatif cumulé de toutes les cartes ouvertes automatiquement s’affiche. Les ouvertures sont espacées et aléatoires, il n\'y a aucune différence entre avoir cela activé et mettre un réveil toutes les x minutes, les requetes au serveur sont les mêmes. WikiMasters doit rester ouvert dans au moins un onglet pour que l’automatisation puisse s’exécuter.'
    );
  }

  function ensurePullsToolbar() {
    if (!isPullsPage() || document.getElementById('wm-pulls-tools')) return;

    const h1 = [...document.querySelectorAll('h1')]
      .find((el) => normalizeTitle(el.textContent) === 'Ouvrir un paquet');
    if (!h1) return;

    const header = h1.parentElement;
    if (!header) return;

    header.classList.add('wm-pulls-header');

    const tools = document.createElement('div');
    tools.id = 'wm-pulls-tools';
    tools.className = 'wm-pulls-tools';

    const label = document.createElement('label');
    label.className = 'wm-pulls-toggle';
    label.title = 'Afficher le récapitulatif des prix après chaque paquet';

    const textWrap = document.createElement('span');
    textWrap.className = 'wm-pulls-toggle-text';

    const title = document.createElement('strong');
    title.textContent = 'Récap prix';
    textWrap.append(title);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = pullRecapEnabled;

    const track = document.createElement('span');
    track.className = 'wm-toggle-track';
    const knob = document.createElement('span');
    knob.className = 'wm-toggle-knob';
    track.append(knob);

    input.addEventListener('change', () => {
      pullRecapEnabled = input.checked;
      writeLocalValue(PULL_RECAP_ENABLED_KEY, pullRecapEnabled);
      label.classList.toggle('is-enabled', pullRecapEnabled);

      if (pullRecapEnabled) {
        packRecapDismissed = false;
        renderPackRecap();
      } else {
        document.getElementById('wm-pack-recap')?.remove();
      }
    });

    label.classList.toggle('is-enabled', pullRecapEnabled);
    label.append(textWrap, input, track);

    const autoControl = document.createElement('span');
    autoControl.className = 'wm-auto-open-control';

    autoOpenToggleLabel = document.createElement('label');
    autoOpenToggleLabel.className = 'wm-pulls-toggle wm-auto-open-toggle';
    autoOpenToggleLabel.title = 'Ouvrir automatiquement tous les paquets à intervalles aléatoires';

    const autoTextWrap = document.createElement('span');
    autoTextWrap.className = 'wm-pulls-toggle-text';

    const autoTitle = document.createElement('strong');
    autoTitle.textContent = 'Ouvrir automatiquement';
    autoTextWrap.append(autoTitle);

    autoOpenToggleInput = document.createElement('input');
    autoOpenToggleInput.type = 'checkbox';
    autoOpenToggleInput.checked = autoOpenEnabled;

    const autoTrack = document.createElement('span');
    autoTrack.className = 'wm-toggle-track';

    const autoKnob = document.createElement('span');
    autoKnob.className = 'wm-toggle-knob';
    autoTrack.append(autoKnob);

    autoOpenToggleInput.addEventListener('change', () => {
      if (autoOpenToggleInput.checked) {
        enableAutomaticOpening();
      } else {
        disableAutomaticOpening({ showSummary: true });
      }
    });

    autoOpenToggleLabel.classList.toggle('is-enabled', autoOpenEnabled);
    autoOpenToggleLabel.append(autoTextWrap, autoOpenToggleInput, autoTrack);

    const helpButton = document.createElement('button');
    helpButton.type = 'button';
    helpButton.className = 'wm-auto-open-help';
    helpButton.textContent = '?';
    helpButton.title = 'Comment fonctionne l’ouverture automatique ?';
    helpButton.setAttribute('aria-label', 'Aide ouverture automatique');
    helpButton.addEventListener('click', showAutoOpenHelp);

    autoControl.append(autoOpenToggleLabel, helpButton);

    tools.append(label, autoControl);
    h1.insertAdjacentElement('afterend', tools);

    const info = document.createElement('div');
    info.id = 'wm-pulls-info';
    info.className = 'wm-pulls-info';

    const cacheNote = document.createElement('div');
    cacheNote.className = 'wm-pulls-cache-note';
    cacheNote.textContent = 'À chaque ouverture, le prix moyen des cartes obtenues est automatiquement ajouté au cache local.';

    openAllButton = document.createElement('button');
    openAllButton.type = 'button';
    openAllButton.className = 'wm-tool-button wm-open-all-button';
    openAllButton.textContent = openAllActive ? 'Ouverture…' : 'Tout ouvrir';
    openAllButton.disabled = openAllActive;
    openAllButton.title = 'Ouvrir tous les paquets disponibles sans afficher les animations';
    openAllButton.addEventListener('click', () => {
      handleOpenAllPacksClick().catch((error) => reportError('tout ouvrir', error));
    });

    info.append(openAllButton, cacheNote, createSponsorNote());

    const pageSubtitle = [...header.children]
      .find((el) => el.tagName === 'P');
    if (pageSubtitle) {
      pageSubtitle.insertAdjacentElement('afterend', info);
    } else {
      header.append(info);
    }
  }

  function showOpenAllConfirmation() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'wm-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'wm-modal wm-confirm-modal';

      const title = document.createElement('h2');
      title.textContent = 'Ouvrir tous les paquets ?';

      const text = document.createElement('p');
      text.textContent = 'Tous les paquets disponibles vont être ouverts immédiatement, sans animation. Cette action consomme les paquets.';

      const actions = document.createElement('div');
      actions.className = 'wm-modal-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'wm-tool-button wm-secondary-button';
      cancel.textContent = 'Annuler';

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'wm-tool-button';
      confirm.textContent = 'Tout ouvrir';

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      cancel.addEventListener('click', () => close(false));
      confirm.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(false);
      });

      actions.append(cancel, confirm);
      modal.append(title, text, actions);
      overlay.append(modal);
      document.body.append(overlay);
    });
  }

  async function handleOpenAllPacksClick() {
    if (openAllActive) return;

    const confirmed = await showOpenAllConfirmation();
    if (!confirmed) return;

    startOpenAllPacks({ automatic: false });
  }

  function setOpenAllButtonProgress(openedPacks, packsRemaining = null) {
    if (!openAllButton) return;

    if (Number.isFinite(Number(packsRemaining))) {
      openAllButton.textContent = `Ouverts ${openedPacks} • reste ${Number(packsRemaining)}`;
    } else {
      openAllButton.textContent = `Ouverts ${openedPacks}`;
    }
  }

  function setOpenAllButtonWaiting(waitMs) {
    if (!openAllButton) return;
    const seconds = Math.max(1, Math.ceil(Number(waitMs || 0) / 1000));
    openAllButton.textContent = `Attente ${seconds}s…`;
  }

  function scheduleOpenAllSummaryRender() {
    if (openAllRenderTimer) return;

    openAllRenderTimer = setTimeout(() => {
      openAllRenderTimer = null;
      renderOpenAllSummary();
    }, 100);
  }

  function renderOpenAllSummary() {
    const overlay = document.getElementById('wm-open-all-overlay');
    if (!overlay || !openAllSummaryCards.length) return;

    const list = overlay.querySelector('.wm-open-all-list');
    const subtitle = overlay.querySelector('[data-role="subtitle"]');
    const footer = overlay.querySelector('[data-role="footer"]');
    if (!list || !subtitle || !footer) return;

    const rows = openAllSummaryCards.map((card, index) => {
      const entry = cacheMemory.get(card.id);
      const loaded = Boolean(entry);
      const average = entry ? chooseAverage(entry, null, card.rarity || null) : null;
      return { ...card, _originalIndex: index, loaded, average };
    });

    rows.sort((a, b) => {
      const aPrice = Number.isFinite(a.average) ? a.average : -Infinity;
      const bPrice = Number.isFinite(b.average) ? b.average : -Infinity;
      if (bPrice !== aPrice) return bPrice - aPrice;

      if (a.loaded !== b.loaded) return a.loaded ? 1 : -1;
      return a._originalIndex - b._originalIndex;
    });

    const loadedCount = rows.filter((row) => row.loaded).length;
    const pricedRows = rows.filter((row) => Number.isFinite(row.average));
    const total = pricedRows.reduce((sum, row) => sum + row.average, 0);

    subtitle.textContent =
      `${openAllOpenedPacks} paquet${openAllOpenedPacks > 1 ? 's' : ''} • ${rows.length} cartes • ${loadedCount}/${rows.length} prix chargés`;

    list.replaceChildren();
    const fragment = document.createDocumentFragment();

    rows.forEach((row, index) => {
      const item = document.createElement('div');
      item.className = 'wm-open-all-row';

      const rank = document.createElement('span');
      rank.className = 'wm-open-all-rank';
      rank.textContent = String(index + 1);

      const thumb = document.createElement('span');
      thumb.className = 'wm-open-all-thumb';
      if (row.imageUrl) {
        const img = document.createElement('img');
        img.src = row.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        thumb.append(img);
      }

      const info = document.createElement('span');
      info.className = 'wm-open-all-info';

      const name = document.createElement('strong');
      name.textContent = row.title;

      const meta = document.createElement('span');
      meta.textContent = row.rarity || '—';

      info.append(name, meta);

      const value = document.createElement('span');
      value.className = 'wm-open-all-price';

      if (!row.loaded) {
        value.classList.add('is-loading');
        const spinner = document.createElement('span');
        spinner.className = 'wm-average-spinner';
        value.append(spinner, document.createTextNode('…'));
      } else if (Number.isFinite(row.average)) {
        value.textContent = `${formatAverage(row.average)} W`;
      } else {
        value.textContent = '—';
        value.classList.add('is-empty');
      }

      item.append(rank, thumb, info, value);
      fragment.append(item);
    });

    list.append(fragment);

    if (loadedCount < rows.length) {
      footer.textContent = 'Chargement des prix moyens…';
    } else if (!pricedRows.length) {
      footer.textContent = 'Aucune carte n’a de prix moyen';
    } else {
      footer.textContent = `Total des prix moyens connus : ${formatAverage(total)} W`;
    }

    if (openAllError) {
      const error = document.createElement('div');
      error.className = 'wm-open-all-error';
      error.textContent = openAllError;
      footer.append(document.createElement('br'), error);
    }
  }

  function openOpenAllSummary(cards, openedPacks, error = null, options = {}) {
    document.getElementById('wm-open-all-overlay')?.remove();

    openAllSummaryCards = cards;
    openAllOpenedPacks = openedPacks;
    openAllError = error;
    openAllSummaryTitle = options.title || 'Cartes obtenues';
    openAllSummaryOnClose = typeof options.onClose === 'function' ? options.onClose : null;
    openAllSummaryReloadOnClose = options.reloadOnClose !== false;

    const overlay = document.createElement('div');
    overlay.id = 'wm-open-all-overlay';
    overlay.className = 'wm-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'wm-modal wm-open-all-modal';

    const header = document.createElement('div');
    header.className = 'wm-open-all-header';

    const headingWrap = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = openAllSummaryTitle;

    const subtitle = document.createElement('p');
    subtitle.dataset.role = 'subtitle';

    headingWrap.append(title, subtitle);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'wm-ranking-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Fermer');

    const close = () => {
      overlay.remove();
      const onClose = openAllSummaryOnClose;
      const reloadOnClose = openAllSummaryReloadOnClose;

      openAllSummaryCards = [];
      openAllError = null;
      openAllSummaryTitle = 'Cartes obtenues';
      openAllSummaryOnClose = null;
      openAllSummaryReloadOnClose = true;

      try {
        onClose?.();
      } catch (error) {
        reportError('fermeture récap', error);
      }

      if (reloadOnClose) {
        location.reload();
      }
    };

    closeButton.addEventListener('click', close);

    header.append(headingWrap, closeButton);

    const list = document.createElement('div');
    list.className = 'wm-open-all-list';

    const footer = document.createElement('div');
    footer.className = 'wm-open-all-footer';
    footer.dataset.role = 'footer';

    modal.append(header, list, footer);
    overlay.append(modal);
    document.body.append(overlay);

    renderOpenAllSummary();
  }

  function mergePulledCardsIntoCollectionCache(cards) {
    const stored = storageGet(ALL_COLLECTION_KEY);
    const entry = stored[ALL_COLLECTION_KEY];
    if (!Array.isArray(entry?.cards) || !entry.cards.length) return;

    const byId = new Map(entry.cards.map((card) => [card.id, { ...card }]));
    const addedCounts = new Map();

    for (const card of cards) {
      addedCounts.set(card.id, (addedCounts.get(card.id) || 0) + 1);
      const existing = byId.get(card.id);
      if (!existing) {
        byId.set(card.id, { ...card, count: 0 });
      }
    }

    for (const [id, amount] of addedCounts) {
      const current = byId.get(id);
      current.count = (Number(current.count) || 0) + amount;
    }

    storageSet({
      [ALL_COLLECTION_KEY]: {
        ...entry,
        fetchedAt: Date.now(),
        cards: [...byId.values()]
      }
    });
  }

  function renderPackRecap() {
    const existing = document.getElementById('wm-pack-recap');

    if (
      !isPullsPage() ||
      !pullRecapEnabled ||
      packRecapDismissed ||
      !activePackRecap?.cards?.length ||
      !isLastPullCardVisible()
    ) {
      existing?.remove();
      return;
    }

    const panel = existing || document.createElement('aside');
    panel.id = 'wm-pack-recap';
    panel.className = 'wm-pack-recap';
    panel.replaceChildren();

    const header = document.createElement('div');
    header.className = 'wm-pack-recap-header';

    const headingWrap = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Prix moyens du paquet';

    const subtitle = document.createElement('span');
    const loaded = activePackRecap.cards.filter((card) => cacheMemory.has(card.id)).length;
    subtitle.textContent = `${loaded}/${activePackRecap.cards.length} chargées`;

    headingWrap.append(title, subtitle);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wm-pack-recap-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fermer le récap');
    close.addEventListener('click', () => {
      packRecapDismissed = true;
      panel.remove();
    });

    header.append(headingWrap, close);

    const list = document.createElement('div');
    list.className = 'wm-pack-recap-list';

    let total = 0;
    let priced = 0;

    for (const card of activePackRecap.cards) {
      const row = document.createElement('div');
      row.className = 'wm-pack-recap-row';

      const rarity = document.createElement('span');
      rarity.className = 'wm-pack-recap-rarity';
      rarity.textContent = card.rarity || '—';

      const name = document.createElement('span');
      name.className = 'wm-pack-recap-name';
      name.textContent = card.title;

      const value = document.createElement('span');
      value.className = 'wm-pack-recap-price';

      const cacheEntry = cacheMemory.get(card.id);
      if (!cacheEntry) {
        value.classList.add('is-loading');
        const spinner = document.createElement('span');
        spinner.className = 'wm-average-spinner';
        value.append(spinner, document.createTextNode('…'));
      } else {
        const average = chooseAverage(cacheEntry, null, card.rarity || null);
        if (Number.isFinite(average)) {
          total += average;
          priced += 1;
          value.textContent = `${formatAverage(average)} W`;
        } else {
          value.textContent = '—';
          value.classList.add('is-empty');
        }
      }

      row.append(rarity, name, value);
      list.append(row);
    }

    const footer = document.createElement('div');
    footer.className = 'wm-pack-recap-footer';

    if (loaded < activePackRecap.cards.length) {
      footer.textContent = 'Chargement des prix moyens…';
    } else if (priced === 0) {
      footer.textContent = 'Aucune carte n’a de prix moyen';
    } else {
      footer.textContent = `Total des prix moyens connus : ${formatAverage(total)} W`;
    }

    panel.append(header, list, footer);

    if (!existing) {
      document.body.append(panel);
    }
  }

  function handlePackOpened(cards) {
    if (!Array.isArray(cards) || !cards.length) return;

    recordPullStats(cards);

    activePackRecap = {
      openedAt: Date.now(),
      cards
    };
    packRecapDismissed = false;

    mergePulledCardsIntoCollectionCache(cards);

    try {
      loadCacheForCards(cards);
      renderPackRecap();
    } catch (error) {
      reportError('paquet', error);
    }
  }

  function renderAll() {
    if (isCollectionPage()) {
      ensureToolbar();
      ensurePriceLegend();
      renderVisibleCollectionCards();
    }

    if (isMarketplaceDetailPage() && marketplaceCardId) {
      renderMarketplaceAverage(marketplaceCardId);
    }

    if (isPullsPage()) {
      ensurePullsToolbar();
      updateAutoOpenToggleUi();
      renderPullStats();
      renderPackRecap();
      autoDismissAntiBotVerification();
    }

    if (isTradesPage()) {
      ensureTradesLoaded();
      renderTradeButtons();
      renderTradeDetailCards();
    }

    if (isGlobalCollectionPage()) {
      ensureGlobalCollectionInspectedCard();
      renderGlobalCollectionInspectedCard();
    }

    ensureCompactControl();
    renderCardExtras();
  }

  function loadCacheForCards(cards, { forceRarities = null, markBulk = false } = {}) {
    registerCards(cards);

    for (const card of cards) {
      const forceCard = Boolean(forceRarities?.has(card.rarity));
      if (forceCard) cacheMemory.delete(card.id);
      renderKnownCard(card.id);
    }

    const keys = cards.map(({ id }) => cacheKey(id));
    const stored = storageGet(keys);
    const now = Date.now();

    if (markBulk) {
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
        renderKnownCard(id);
      } else {
        cacheMemory.delete(id);
        if (markBulk) bulkPendingIds.add(id);
        enqueue(id);
      }
    }

    if (markBulk) updateBulkProgress();
    pumpQueue();

    if (markBulk && bulkPendingIds.size === 0) {
      finishBulkLoad();
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
    renderKnownCard(id);

    if (bulkPendingIds.delete(id)) {
      updateBulkProgress();
      if (bulkActive && bulkPendingIds.size === 0) {
        finishBulkLoad();
      }
    }

    if (!detail.ok) {
      console.debug('[WM Average] échec temporaire mis en cache 60 s', id, detail.error);
    }

    pumpQueue();
  }

  function ensurePriceLegend(toolbar = document.getElementById('wm-tools-bar')) {
    if (!isCollectionPage() || !toolbar || document.getElementById('wm-price-legend')) return;

    const legend = document.createElement('div');
    legend.id = 'wm-price-legend';
    legend.className = 'wm-price-legend';

    const heading = document.createElement('strong');
    heading.className = 'wm-price-legend-title';
    heading.textContent = 'Légende des prix';

    const items = document.createElement('div');
    items.className = 'wm-price-legend-items';

    const definitions = [
      {
        badge: 'Moy. 12 W',
        className: 'wm-price-legend-badge',
        text: 'prix moyen des ventes'
      },
      {
        badge: 'Moy. —',
        className: 'wm-price-legend-badge is-empty',
        text: 'aucune moyenne disponible'
      },
      {
        badge: 'Prix indispo.',
        className: 'wm-price-legend-badge is-error',
        text: 'erreur temporaire, nouvel essai automatique'
      },
      {
        badge: 'Prix…',
        className: 'wm-price-legend-badge is-loading',
        text: 'prix en cours de chargement'
      }
    ];

    for (const definition of definitions) {
      const item = document.createElement('span');
      item.className = 'wm-price-legend-item';

      const badge = document.createElement('span');
      badge.className = definition.className;
      badge.textContent = definition.badge;

      const text = document.createElement('span');
      text.className = 'wm-price-legend-text';
      text.textContent = definition.text;

      item.append(badge, text);
      items.append(item);
    }

    legend.append(heading, items);
    toolbar.insertAdjacentElement('afterend', legend);
  }

  function ensureToolbar() {
    if (!isCollectionPage() || document.getElementById('wm-tools-bar')) return;

    const h1 = [...document.querySelectorAll('h1')].find((el) => normalizeTitle(el.textContent) === 'Collection');
    if (!h1) return;

    const header = h1.parentElement;
    if (!header?.parentElement) return;

    const bar = document.createElement('div');
    bar.id = 'wm-tools-bar';
    bar.className = 'wm-tools-bar';

    bulkButton = document.createElement('button');
    bulkButton.type = 'button';
    bulkButton.className = 'wm-tool-button';
    bulkButton.textContent = 'Charger les prix';
    bulkButton.title = 'Choisir les raretés dont tu veux charger ou actualiser les prix';
    bulkButton.addEventListener('click', () => {
      handleBulkClick().catch((error) => reportError('chargement', error));
    });

    rankingButton = document.createElement('button');
    rankingButton.type = 'button';
    rankingButton.className = 'wm-tool-button';
    rankingButton.textContent = 'Plus chères';
    rankingButton.title = 'Affiche toute la collection triée par prix moyen décroissant';
    rankingButton.addEventListener('click', () => {
      openRankingModal().catch((error) => {
        reportError('classement', error);
        showInfoModal(
          'Classement impossible',
          String(error?.message || error || 'Impossible de charger la collection.')
        );
      });
    });

    bar.append(bulkButton, rankingButton, createSponsorNote());
    header.insertAdjacentElement('afterend', bar);
    ensurePriceLegend(bar);
  }

  async function handleBulkClick() {
    if (bulkActive) return;

    const lastLoadsData = storageGet(BULK_RARITY_LAST_LOAD_KEY);
    const lastLoads = lastLoadsData[BULK_RARITY_LAST_LOAD_KEY] || {};

    const selection = await showRaritySelectionModal(lastLoads);
    if (!selection?.rarities?.length) return;

    const selected = selection.rarities;
    const onlyUnloaded = Boolean(selection.onlyUnloaded);
    const now = Date.now();

    const forceRarities = new Set();
    if (!onlyUnloaded) {
      const recentRarities = selected.filter((rarity) => {
        const timestamp = Number(lastLoads[rarity]) || 0;
        return timestamp > 0 && now - timestamp < CACHE_TTL;
      });

      if (recentRarities.length > 0) {
        const confirmed = await showReloadConfirmation(recentRarities, lastLoads);
        if (!confirmed) return;
        recentRarities.forEach((rarity) => forceRarities.add(rarity));
      }
    }

    bulkActive = true;
    bulkSelectedRarities = new Set(selected);
    bulkForceRarities = forceRarities;
    bulkOnlyUnloaded = onlyUnloaded;
    bulkPendingIds.clear();
    bulkTotal = 0;
    bulkRequestId = `bulk:${now}:${Math.random().toString(36).slice(2)}`;

    setBulkButtonState('Collection…', true);

    window.dispatchEvent(new CustomEvent('wm-average-load-all-collection', {
      detail: {
        requestId: bulkRequestId,
        selectedRarities: [...bulkSelectedRarities]
      }
    }));
  }

  function showRaritySelectionModal(lastLoads = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'wm-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'wm-modal wm-confirm-modal wm-rarity-modal';

      const title = document.createElement('h2');
      title.textContent = 'Quels prix mettre à jour ?';

      const text = document.createElement('p');
      text.className = 'wm-rarity-explanation';
      text.textContent = 'Sélectionne seulement les raretés qui t’intéressent. Le gros avantage, c’est de ne pas perdre du temps à charger les prix de toutes les cartes communes.';

      const tip = document.createElement('p');
      tip.className = 'wm-rarity-tip';
      tip.textContent = 'Exemple : L / UR / SR / R tous les jours, puis PC / C seulement une fois par semaine.';

      const presets = document.createElement('div');
      presets.className = 'wm-rarity-presets';

      const grid = document.createElement('div');
      grid.className = 'wm-rarity-grid';

      const selected = new Set(DEFAULT_RARE_RARITIES);
      const checkboxByRarity = new Map();

      const updateChecks = () => {
        for (const [rarity, input] of checkboxByRarity) {
          input.checked = selected.has(rarity);
          input.closest('.wm-rarity-option')?.classList.toggle('is-selected', input.checked);
        }
      };

      let onlyUnloaded = false;

      const makePreset = (label, rarities) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wm-tool-button wm-rarity-preset';
        button.textContent = label;
        button.addEventListener('click', () => {
          selected.clear();
          rarities.forEach((rarity) => selected.add(rarity));
          updateChecks();
        });
        return button;
      };

      const missingOption = document.createElement('label');
      missingOption.className = 'wm-missing-option';

      const missingInput = document.createElement('input');
      missingInput.type = 'checkbox';

      const missingText = document.createElement('span');
      missingText.className = 'wm-missing-text';

      const missingTitle = document.createElement('strong');
      missingTitle.textContent = 'Uniquement les cartes non chargées';

      const missingDescription = document.createElement('span');
      missingDescription.textContent = 'Idéal après avoir ajouté de nouvelles cartes : seules celles qui n’ont encore aucun prix en cache seront chargées.';

      missingText.append(missingTitle, missingDescription);
      missingOption.append(missingInput, missingText);

      const updateMissingState = () => {
        onlyUnloaded = missingInput.checked;
        missingOption.classList.toggle('is-selected', onlyUnloaded);
      };

      missingInput.addEventListener('change', updateMissingState);

      const missingPreset = document.createElement('button');
      missingPreset.type = 'button';
      missingPreset.className = 'wm-tool-button wm-rarity-preset';
      missingPreset.textContent = 'Non chargées';
      missingPreset.addEventListener('click', () => {
        selected.clear();
        RARITIES.forEach((rarity) => selected.add(rarity));
        updateChecks();
        missingInput.checked = true;
        updateMissingState();
      });

      presets.append(
        makePreset('Rares', ['L', 'UR', 'SR', 'R']),
        makePreset('Courantes', ['PC', 'C']),
        makePreset('Toutes', RARITIES),
        missingPreset
      );

      for (const rarity of RARITIES) {
        const label = document.createElement('label');
        label.className = 'wm-rarity-option';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = rarity;
        input.checked = selected.has(rarity);
        checkboxByRarity.set(rarity, input);

        const main = document.createElement('span');
        main.className = 'wm-rarity-option-main';
        main.textContent = rarity;

        const last = document.createElement('span');
        last.className = 'wm-rarity-last';
        const timestamp = Number(lastLoads[rarity]) || 0;
        last.textContent = timestamp ? `dernier chargement : il y a ${humanElapsed(timestamp)}` : 'jamais chargé en masse';

        input.addEventListener('change', () => {
          if (input.checked) selected.add(rarity);
          else selected.delete(rarity);
          label.classList.toggle('is-selected', input.checked);
        });

        label.classList.toggle('is-selected', input.checked);
        label.append(input, main, last);
        grid.append(label);
      }

      const actions = document.createElement('div');
      actions.className = 'wm-modal-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'wm-tool-button wm-secondary-button';
      cancel.textContent = 'Annuler';

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'wm-tool-button';
      confirm.textContent = 'Charger ces raretés';

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      cancel.addEventListener('click', () => close(null));
      confirm.addEventListener('click', () => {
        const values = RARITIES.filter((rarity) => selected.has(rarity));
        if (!values.length) {
          confirm.textContent = 'Choisis au moins une rareté';
          return;
        }
        close({ rarities: values, onlyUnloaded });
      });
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });

      actions.append(cancel, confirm);
      modal.append(title, text, tip, presets, missingOption, grid, actions);
      overlay.append(modal);
      document.body.append(overlay);
    });
  }

  function setBulkButtonState(label, disabled) {
    ensureToolbar();
    if (!bulkButton) return;
    bulkButton.textContent = label;
    bulkButton.disabled = Boolean(disabled);
  }

  function updateBulkProgress() {
    if (!bulkActive || !bulkTotal) return;
    const completed = Math.max(0, bulkTotal - bulkPendingIds.size);
    const label = bulkOnlyUnloaded ? 'Nouvelles' : 'Prix';
    setBulkButtonState(`${label} ${completed}/${bulkTotal}`, true);
  }

  function finishBulkLoad(doneLabel = 'Chargé ✓') {
    if (!bulkActive) return;

    if (!bulkOnlyUnloaded) {
      const selectedRarities = [...bulkSelectedRarities];
      const data = storageGet(BULK_RARITY_LAST_LOAD_KEY);
      const lastLoads = { ...(data[BULK_RARITY_LAST_LOAD_KEY] || {}) };
      const now = Date.now();
      selectedRarities.forEach((rarity) => {
        lastLoads[rarity] = now;
      });
      storageSet({ [BULK_RARITY_LAST_LOAD_KEY]: lastLoads });
    }

    bulkActive = false;
    bulkRequestId = null;
    bulkForceRarities.clear();
    bulkPendingIds.clear();
    bulkOnlyUnloaded = false;
    setBulkButtonState(doneLabel, false);
    setTimeout(() => {
      if (!bulkActive) setBulkButtonState('Charger les prix', false);
    }, 2200);
  }

  function failBulkLoad(message) {
    bulkActive = false;
    bulkRequestId = null;
    bulkPendingIds.clear();
    bulkOnlyUnloaded = false;
    setBulkButtonState('Erreur', false);
    showInfoModal('Chargement impossible', message || 'Impossible de charger toute la collection pour le moment.');
    setTimeout(() => {
      if (!bulkActive) setBulkButtonState('Charger les prix', false);
    }, 2200);
  }

  function humanElapsed(timestamp) {
    const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
  }

  function showReloadConfirmation(recentRarities, lastLoads) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'wm-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'wm-modal wm-confirm-modal';

      const title = document.createElement('h2');
      title.textContent = 'Recharger des prix déjà récents ?';

      const text = document.createElement('p');
      const details = recentRarities
        .map((rarity) => `${rarity} (il y a ${humanElapsed(Number(lastLoads[rarity]) || Date.now())})`)
        .join(', ');
      text.textContent = `Ces raretés ont déjà été chargées il y a moins de 24 h : ${details}. Les relancer force de nouvelles requêtes pour leurs cartes. Par prudence, évite de le faire trop souvent si ce n’est pas nécessaire. Recharger quand même ces raretés ?`;

      const actions = document.createElement('div');
      actions.className = 'wm-modal-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'wm-tool-button wm-secondary-button';
      cancel.textContent = 'Garder le cache';

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'wm-tool-button wm-danger-button';
      confirm.textContent = 'Recharger quand même';

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      cancel.addEventListener('click', () => close(false));
      confirm.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(false);
      });

      actions.append(cancel, confirm);
      modal.append(title, text, actions);
      overlay.append(modal);
      document.body.append(overlay);
    });
  }

  function showInfoModal(titleText, message) {
    const overlay = document.createElement('div');
    overlay.className = 'wm-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'wm-modal wm-confirm-modal';

    const title = document.createElement('h2');
    title.textContent = titleText;

    const text = document.createElement('p');
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'wm-modal-actions';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'wm-tool-button';
    closeButton.textContent = 'Fermer';

    const close = () => overlay.remove();
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    actions.append(closeButton);
    modal.append(title, text, actions);
    overlay.append(modal);
    document.body.append(overlay);
  }


  async function openRankingModal() {
    const storedCollection = storageGet(ALL_COLLECTION_KEY);
    const collectionEntry = storedCollection[ALL_COLLECTION_KEY];
    const storedCards = Array.isArray(collectionEntry?.cards) ? collectionEntry.cards : [];

    // Merge persisted metadata with cards already discovered during this page session.
    // This lets the ranking work even before a full bulk collection load.
    const knownCards = new Map();

    for (const card of storedCards) {
      if (card?.id && card?.title) knownCards.set(card.id, { ...card });
    }

    for (const card of cardMetaById.values()) {
      if (!card?.id || !card?.title) continue;
      const previous = knownCards.get(card.id);
      knownCards.set(card.id, previous ? { ...previous, ...card } : { ...card });
    }

    const candidates = [...knownCards.values()];

    if (!candidates.length) {
      showInfoModal(
        'Aucun prix chargé',
        'Aucune carte avec métadonnées n’est encore disponible. Parcourez votre collection ou utilisez « Charger les prix », puis réessayez.'
      );
      return;
    }

    const priceKeys = candidates.map((card) => cacheKey(card.id));
    const prices = storageGet(priceKeys);

    const rows = candidates
      .map((card) => {
        const entry = prices[cacheKey(card.id)];

        // Errors are not useful in a "most expensive" ranking.
        if (!entry || entry.ok === false) return null;

        const average = chooseAverage(entry, null, card.rarity || null);

        return {
          ...card,
          average,
          fetchedAt: Number(entry?.fetchedAt) || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aPrice = Number.isFinite(a.average) ? a.average : -Infinity;
        const bPrice = Number.isFinite(b.average) ? b.average : -Infinity;
        if (bPrice !== aPrice) return bPrice - aPrice;
        return a.title.localeCompare(b.title, 'fr');
      });

    if (!rows.length) {
      showInfoModal(
        'Aucun prix chargé',
        'Aucun prix n’est encore présent dans le cache. Parcourez votre collection ou utilisez « Charger les prix », puis réessayez.'
      );
      return;
    }

    const isComplete =
      collectionEntry?.complete === true &&
      rows.length >= candidates.length;

    renderRankingModal(
      rows,
      collectionEntry?.fetchedAt || 0,
      {
        incomplete: !isComplete,
        knownCards: candidates.length,
        cachedCards: rows.length
      }
    );
  }

  function renderRankingModal(rows, collectionFetchedAt, status = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'wm-modal-overlay wm-ranking-overlay';

    const modal = document.createElement('div');
    modal.className = 'wm-modal wm-ranking-modal wm-ranking-sales-enabled';

    const header = document.createElement('div');
    header.className = 'wm-ranking-header';

    const headingWrap = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = 'Cartes les plus chères';

    const subtitle = document.createElement('p');
    const pricedCount = rows.filter((row) => Number.isFinite(row.average)).length;
    subtitle.textContent = `${rows.length} cartes du cache • ${pricedCount} avec un prix moyen${collectionFetchedAt ? ` • données collection il y a ${humanElapsed(collectionFetchedAt)}` : ''}`;

    headingWrap.append(title, subtitle);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'wm-ranking-close';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.textContent = '×';

    header.append(headingWrap, closeButton);

    let cacheNotice = null;
    if (status.incomplete) {
      cacheNotice = document.createElement('div');
      cacheNotice.className = 'wm-ranking-cache-notice';

      const noticeTitle = document.createElement('strong');
      noticeTitle.textContent = 'Classement partiel';

      const noticeText = document.createElement('span');
      noticeText.textContent =
        'Vous n’avez pas chargé tous les prix : seules les cartes actuellement disponibles dans votre cache sont affichées ici.';

      cacheNotice.append(noticeTitle, noticeText);
    }

    const saleControls = document.createElement('div');
    saleControls.className = 'wm-ranking-sale-controls';

    const priceField = document.createElement('label');
    priceField.className = 'wm-ranking-sale-field';

    const priceLabel = document.createElement('span');
    priceLabel.textContent = 'Prix de mise en vente';

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '1';
    priceInput.step = '1';
    priceInput.value = '10';
    priceInput.inputMode = 'decimal';

    priceField.append(priceLabel, priceInput);

    const durationField = document.createElement('label');
    durationField.className = 'wm-ranking-sale-field';

    const durationLabel = document.createElement('span');
    durationLabel.textContent = 'Durée';

    const durationInput = document.createElement('select');

    const durationOptions = [
      [10, '10 min'],
      [30, '30 min'],
      [60, '1 h'],
      [180, '3 h'],
      [360, '6 h'],
      [720, '12 h'],
      [1440, '24 h']
    ];

    for (const [value, label] of durationOptions) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = label;
      durationInput.append(option);
    }

    durationInput.value = '10';

    durationField.append(durationLabel, durationInput);

    const hint = document.createElement('div');
    hint.className = 'wm-ranking-sale-hint';
    hint.textContent = 'Chaque bouton utilise ces deux valeurs.';

    saleControls.append(priceField, durationField, hint);

    const list = document.createElement('div');
    list.className = 'wm-ranking-list';

    const PAGE_SIZE = 50;
    let renderedCount = 0;

    const saleInputsAreValid = () => {
      const amount = Number(priceInput.value);
      const duration = Number(durationInput.value);
      return Number.isFinite(amount) && amount > 0 && Number.isFinite(duration) && duration > 0;
    };

    const refreshSaleButtons = () => {
      const valid = saleInputsAreValid();

      for (const button of list.querySelectorAll('.wm-ranking-sell-button')) {
        if (button.dataset.state === 'pending' || button.dataset.state === 'success') continue;
        button.disabled = !valid;
      }
    };

    const createRankingRow = (row, index) => {
      const item = document.createElement('div');
      item.className = 'wm-ranking-row';

      const rank = document.createElement('div');
      rank.className = 'wm-ranking-rank';
      rank.textContent = String(index + 1);

      const thumb = document.createElement('div');
      thumb.className = 'wm-ranking-thumb';
      if (row.imageUrl) {
        const img = document.createElement('img');
        img.src = row.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        thumb.append(img);
      }

      const info = document.createElement('div');
      info.className = 'wm-ranking-info';

      const name = document.createElement('div');
      name.className = 'wm-ranking-title';
      name.textContent = row.title;

      const meta = document.createElement('div');
      meta.className = 'wm-ranking-meta';
      const countText = row.count > 1 ? ` • ×${row.count}` : '';
      meta.textContent = `${row.rarity || '—'}${countText}`;

      info.append(name, meta);

      const price = document.createElement('div');
      price.className = 'wm-ranking-price';
      if (Number.isFinite(row.average)) {
        price.textContent = `${formatAverage(row.average)} W`;
      } else {
        price.textContent = '—';
        price.classList.add('wm-ranking-price-empty');
      }

      const sellButton = document.createElement('button');
      sellButton.type = 'button';
      sellButton.className = 'wm-tool-button wm-ranking-sell-button';
      sellButton.textContent = 'Mettre en vente';
      sellButton.dataset.cardId = row.id;
      sellButton.disabled = !saleInputsAreValid();

      sellButton.addEventListener('click', () => {
        const amount = Number(priceInput.value);
        const duration = Number(durationInput.value);

        if (!Number.isFinite(amount) || amount <= 0) {
          priceInput.focus();
          return;
        }

        if (!Number.isFinite(duration) || duration <= 0) {
          durationInput.focus();
          return;
        }

        const ownedCardId = row.ownedCardId || row.ownedCardIds?.[0] || null;
        const requestId = `listing:${row.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        sellButton.disabled = true;
        sellButton.dataset.state = 'pending';
        sellButton.textContent = ownedCardId ? 'Mise en vente…' : 'Recherche ID…';

        pendingMarketplaceListings.set(requestId, {
          button: sellButton,
          row,
          amount,
          duration
        });

        window.dispatchEvent(new CustomEvent('wm-average-create-listing', {
          detail: {
            requestId,
            ownedCardId,
            catalogueCardId: row.id,
            title: row.title,
            baseAmount: amount,
            durationMinutes: duration
          }
        }));
      });

      item.append(rank, thumb, info, price, sellButton);
      return item;
    };

    const sentinel = document.createElement('div');
    sentinel.className = 'wm-ranking-sentinel';

    const renderNextChunk = () => {
      if (renderedCount >= rows.length) {
        sentinel.remove();
        return;
      }

      const fragment = document.createDocumentFragment();
      const end = Math.min(renderedCount + PAGE_SIZE, rows.length);

      for (let index = renderedCount; index < end; index += 1) {
        fragment.append(createRankingRow(rows[index], index));
      }

      renderedCount = end;
      sentinel.remove();
      list.append(fragment);

      if (renderedCount < rows.length) {
        list.append(sentinel);
      }

      refreshSaleButtons();
    };

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        renderNextChunk();
      }
    }, {
      root: list,
      rootMargin: '250px 0px',
      threshold: 0
    });

    priceInput.addEventListener('input', refreshSaleButtons);
    durationInput.addEventListener('change', refreshSaleButtons);

    renderNextChunk();
    if (renderedCount < rows.length) {
      observer.observe(sentinel);
    }

    const close = () => {
      observer.disconnect();
      overlay.remove();
    };

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    modal.append(header);
    if (cacheNotice) modal.append(cacheNotice);
    modal.append(saleControls, list);
    overlay.append(modal);
    document.body.append(overlay);
  }

  window.addEventListener('wm-average-create-listing-progress', (event) => {
    const detail = event.detail || {};
    const pending = pendingMarketplaceListings.get(detail.requestId);
    if (!pending?.button?.isConnected) return;

    if (detail.state === 'refreshing-id') {
      pending.button.textContent = 'ID expiré • recherche…';
    } else if (detail.state === 'resolving-id') {
      pending.button.textContent = 'Recherche ID…';
    }
  });

  window.addEventListener('wm-average-create-listing-result', (event) => {
    const detail = event.detail || {};
    const pending = pendingMarketplaceListings.get(detail.requestId);
    if (!pending) return;

    pendingMarketplaceListings.delete(detail.requestId);

    const { button, row, amount, duration } = pending;
    if (!button?.isConnected) return;

    if (detail.ok) {
      if (detail.ownedCardId) {
        const staleId = detail.staleOwnedCardId || null;

        row.ownedCardId = detail.ownedCardId;
        row.ownedCardIds = [
          ...new Set([
            ...(Array.isArray(row.ownedCardIds) ? row.ownedCardIds : [])
              .filter((id) => id && id !== staleId),
            detail.ownedCardId
          ])
        ];

        const stored = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];
        if (Array.isArray(stored?.cards)) {
          const target = stored.cards.find((card) => card?.id === row.id);
          if (target) {
            target.ownedCardId = detail.ownedCardId;
            target.ownedCardIds = [
              ...new Set([
                ...(Array.isArray(target.ownedCardIds) ? target.ownedCardIds : [])
                  .filter((id) => id && id !== staleId),
                detail.ownedCardId
              ])
            ];
            storageSet({ [ALL_COLLECTION_KEY]: stored });
          }
        }
      }

      button.dataset.state = 'success';
      button.disabled = true;
      button.textContent = 'En vente ✓';
      button.title = `${formatAverage(amount)} W pendant ${formatAverage(duration)} min`;
      return;
    }

    if (detail.notOwned) {
      const stored = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];

      if (Array.isArray(stored?.cards)) {
        stored.cards = stored.cards.filter((card) => card?.id !== row.id);
        storageSet({ [ALL_COLLECTION_KEY]: stored });
      }

      row.ownedCardId = null;
      row.ownedCardIds = [];

      const rankingRow = button.closest('.wm-ranking-row');
      rankingRow?.classList.add('wm-ranking-row-unowned');

      button.dataset.state = 'success';
      button.disabled = true;
      button.textContent = 'Plus possédée';
      button.title = 'Cette carte n’est plus dans ta collection.';
      return;
    }

    if (detail.alreadyListed) {
      button.dataset.state = 'success';
      button.disabled = true;
      button.textContent = 'Déjà en vente';
      button.title = detail.error || 'Toutes tes copies disponibles sont déjà en vente.';
      return;
    }

    const staleId = detail.staleOwnedCardId || (detail.ownershipError ? detail.ownedCardId : null);

    if (staleId) {
      if (row.ownedCardId === staleId) {
        row.ownedCardId = null;
      }
      row.ownedCardIds = (Array.isArray(row.ownedCardIds) ? row.ownedCardIds : [])
        .filter((id) => id && id !== staleId);

      const stored = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];
      if (Array.isArray(stored?.cards)) {
        const target = stored.cards.find((card) => card?.id === row.id);
        if (target) {
          if (target.ownedCardId === staleId) {
            target.ownedCardId = null;
          }
          target.ownedCardIds = (Array.isArray(target.ownedCardIds) ? target.ownedCardIds : [])
            .filter((id) => id && id !== staleId);
          storageSet({ [ALL_COLLECTION_KEY]: stored });
        }
      }
    }

    button.dataset.state = 'error';
    button.disabled = false;
    button.textContent = detail.ownershipError
      ? 'ID invalide — réessayer'
      : 'Erreur — réessayer';
    button.title = detail.error || 'Impossible de mettre cette carte en vente.';
  });

  document.addEventListener('click', (event) => {
    if (!isPullsPage() || !activePackRecap) return;

    const button = event.target?.closest?.('button');
    if (!button) return;

    if (normalizeTitle(button.textContent) === 'Continuer') {
      packRecapDismissed = true;
      document.getElementById('wm-pack-recap')?.remove();
    }
  }, true);

  window.addEventListener('wm-average-trades', (event) => {
    const detail = event.detail || {};
    const trades = Array.isArray(detail.trades) ? detail.trades : [];

    tradesById.clear();

    for (const trade of trades) {
      if (!trade?.id) continue;
      tradesById.set(trade.id, trade);
      registerCards(getTradeCards(trade));
    }

    renderTradeButtons();
    renderTradeDetailCards();
  });

  window.addEventListener('wm-average-open-all-packs-progress', (event) => {
    const detail = event.detail || {};
    if (!openAllActive || detail.requestId !== openAllRequestId) return;

    openAllOpenedPacks = Number(detail.openedPacks) || 0;

    if (detail.waiting) {
      setOpenAllButtonWaiting(detail.waitMs);
      return;
    }

    setOpenAllButtonProgress(openAllOpenedPacks, detail.packsRemaining);

    const packCards = Array.isArray(detail.cards) ? detail.cards : [];
    if (!packCards.length) return;

    recordPullStats(packCards);
    openAllSummaryCards.push(...packCards);
    mergePulledCardsIntoCollectionCache(packCards);

    const uniquePackCards = [...new Map(packCards.map((card) => [card.id, card])).values()];
    try {
      loadCacheForCards(uniquePackCards);
    } catch (error) {
      reportError('prix pendant tout ouvrir', error);
    }
  });

  window.addEventListener('wm-average-open-all-packs-result', (event) => {
    const detail = event.detail || {};
    if (!openAllActive || detail.requestId !== openAllRequestId) return;

    const wasAutomatic = Boolean(autoOpenRequestId && detail.requestId === autoOpenRequestId);

    openAllActive = false;
    openAllRequestId = null;

    if (openAllButton?.isConnected) {
      openAllButton.disabled = false;
      openAllButton.textContent = 'Tout ouvrir';
    }

    const cards = Array.isArray(detail.cards) ? detail.cards : [];
    const openedPacks = Number(detail.openedPacks) || 0;

    if (wasAutomatic) {
      autoOpenRequestId = null;

      appendAutomaticOpenResult(detail);
      document.getElementById('wm-open-all-overlay')?.remove();
      document.getElementById('wm-pack-recap')?.remove();
      openAllSummaryCards = [];
      openAllError = null;

      if (autoOpenShowSummaryAfterCurrent || !autoOpenEnabled) {
        autoOpenShowSummaryAfterCurrent = false;
        showAutomaticOpenSummary();
      } else {
        scheduleNextAutoOpen({ keepExisting: false });
      }
      return;
    }

    if (!cards.length) {
      showInfoModal(
        detail.ok ? 'Aucun paquet ouvert' : 'Ouverture impossible',
        detail.error || 'Aucun paquet disponible.'
      );
      return;
    }

    openOpenAllSummary(
      cards,
      openedPacks,
      detail.ok ? null : `Ouverture interrompue : ${detail.error || 'erreur inconnue'}`
    );
  });

  window.addEventListener('wm-average-pack-opened', (event) => {
    const cards = event.detail?.cards;
    if (!Array.isArray(cards) || !cards.length) return;
    handlePackOpened(cards);
  });

  window.addEventListener('wm-average-global-card-inspected', (event) => {
    const id = event.detail?.id;
    if (!isGlobalCollectionPage() || !id) return;

    if (globalCollectionCardId !== id) {
      globalCollectionInitializedId = null;
    }

    globalCollectionCardId = id;
    ensureGlobalCollectionInspectedCard();
    renderGlobalCollectionInspectedCard();
  });

  window.addEventListener('wm-average-marketplace-detail', (event) => {
    const card = event.detail?.card;
    if (!card?.id || !card?.title) return;

    marketplaceCardId = card.id;
    registerCards([card]);
    renderMarketplaceAverage(card.id);

    try {
      loadCacheForCards([card]);
    } catch (error) {
      reportError('marketplace', error);
    }
  });

  window.addEventListener('wm-average-collection', (event) => {
    const cards = event.detail?.cards;
    if (!Array.isArray(cards) || !cards.length) return;

    console.debug(`[WM Average] ${cards.length} cartes détectées`, cards);

    try {
      registerCards(cards);
      hydrateCacheForCards(cards);
      renderVisibleCollectionCards();
    } catch (error) {
      reportError('cache', error);
    }
  });

  window.addEventListener('wm-average-response', (event) => {
    try {
      finishRequest(event.detail || {});
    } catch (error) {
      reportError('réponse', error);
    }
  });

  window.addEventListener('wm-average-all-collection-progress', (event) => {
    if (!bulkActive || event.detail?.requestId !== bulkRequestId) return;
    const loadedPages = Number(event.detail.loadedPages) || 0;
    const totalPages = Number(event.detail.totalPages) || 0;
    if (totalPages > 0) {
      setBulkButtonState(`Collection ${loadedPages}/${totalPages}`, true);
    }
  });

  window.addEventListener('wm-average-all-collection', (event) => {
    const detail = event.detail || {};
    if (!bulkActive || detail.requestId !== bulkRequestId) return;

    if (!detail.ok) {
      failBulkLoad(detail.error || 'Erreur réseau');
      return;
    }

    const cards = Array.isArray(detail.cards) ? detail.cards : [];
    const fetchedAt = Date.now();

    if (detail.complete) {
      storageSet({
        [ALL_COLLECTION_KEY]: { fetchedAt, cards, complete: true }
      });
    } else {
      // Keep every piece of collection metadata we have already seen.
      // A partial load is enough for « Plus chères » to rank the cached prices.
      const existingEntry = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];
      const existingCards = Array.isArray(existingEntry?.cards) ? existingEntry.cards : [];
      const merged = new Map(existingCards.map((card) => [card.id, { ...card }]));

      for (const card of cards) {
        const previous = merged.get(card.id);
        merged.set(card.id, previous ? { ...previous, ...card } : { ...card });
      }

      storageSet({
        [ALL_COLLECTION_KEY]: {
          fetchedAt,
          cards: [...merged.values()],
          complete: existingEntry?.complete === true
        }
      });
    }

    if (!cards.length) {
      finishBulkLoad();
      return;
    }

    let selectedCards = cards.filter((card) => bulkSelectedRarities.has(card.rarity));

    if (bulkOnlyUnloaded && selectedCards.length) {
      const cached = storageGet(selectedCards.map((card) => cacheKey(card.id)));
      selectedCards = selectedCards.filter((card) => cached[cacheKey(card.id)] === undefined);
    }

    if (!selectedCards.length) {
      finishBulkLoad(bulkOnlyUnloaded ? 'Aucune nouvelle ✓' : 'Chargé ✓');
      return;
    }

    setBulkButtonState(
      bulkOnlyUnloaded
        ? `Nouvelles (${selectedCards.length})…`
        : `Préparation (${selectedCards.length})…`,
      true
    );

    try {
      loadCacheForCards(selectedCards, {
        forceRarities: bulkOnlyUnloaded ? null : bulkForceRarities,
        markBulk: true
      });
    } catch (error) {
      if (!isContextInvalidatedError(error)) {
        failBulkLoad(String(error?.message || error));
      }
    }
  });

  let renderTimer = null;
  let previousPath = location.pathname;
  let observedMain = null;

  function routeIsSupported() {
    return (
      isCollectionPage() ||
      isMarketplacePage() ||
      isPullsPage() ||
      isTradesPage() ||
      isGlobalCollectionPage()
    );
  }

  function handlePathChange() {
    const currentPath = location.pathname;
    if (currentPath === previousPath) return false;

    previousPath = currentPath;
    if (isTradesPage()) tradesRequested = false;
    if (!compactEligiblePage()) {
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
        '.wm-auto-open-control, .wm-auto-open-help'
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

    if (autoOpenEnabled) {
      scheduleNextAutoOpen({ keepExisting: true });
    }

    outsideObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    renderAll();
  }

  startObserver();

  window.addEventListener('popstate', () => {
    previousPath = location.pathname;
    attachMainObserver();
    scheduleRender(0);
  });

  console.debug('[WM Average] page runtime v4.1.2 chargé');
})();
