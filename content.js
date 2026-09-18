(() => {
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
  const CACHE_PREFIX = 'wm_avg_v3_';
  const MAX_CONCURRENT = 3;
  const BULK_LAST_CLICK_KEY = 'wm_bulk_last_click_v1';
  const ALL_COLLECTION_KEY = 'wm_all_collection_v1';

  const titleById = new Map();
  const cardMetaById = new Map();
  const cacheMemory = new Map();
  const queued = [];
  const queuedIds = new Set();
  const inFlightIds = new Set();
  const pendingByRequestId = new Map();

  let activeRequests = 0;
  let bulkActive = false;
  let bulkForce = false;
  let bulkRequestId = null;
  let bulkTotal = 0;
  const bulkPendingIds = new Set();

  let bulkButton = null;
  let rankingButton = null;

  const bridge = document.createElement('script');
  bridge.src = chrome.runtime.getURL('page-bridge.js');
  bridge.onload = () => bridge.remove();
  (document.documentElement || document.head).appendChild(bridge);

  function isCollectionPage() {
    return location.pathname === '/collection' || location.pathname.startsWith('/collection/');
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

  async function storageGet(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const result = {};
    const missing = [];

    for (const key of list) {
      const value = readLocalValue(key);
      if (value !== undefined) {
        result[key] = value;
      } else {
        missing.push(key);
      }
    }

    // Migration best-effort depuis les anciennes versions qui utilisaient
    // chrome.storage.local. Si l'extension vient d'être rechargée, son ancien
    // content script peut avoir un contexte invalidé : on ignore alors
    // silencieusement l'API Chromium au lieu de casser l'extension.
    if (missing.length > 0) {
      try {
        if (chrome?.runtime?.id && chrome?.storage?.local) {
          const legacy = await chrome.storage.local.get(missing);
          for (const key of missing) {
            if (legacy?.[key] !== undefined) {
              result[key] = legacy[key];
              writeLocalValue(key, legacy[key]);
            }
          }
        }
      } catch (_) {
        // Contexte d'extension invalidé : localStorage reste pleinement utilisable.
      }
    }

    return result;
  }

  async function storageSet(values) {
    for (const [key, value] of Object.entries(values || {})) {
      writeLocalValue(key, value);
    }
  }

  function registerCards(cards) {
    for (const meta of cards) {
      if (!meta?.id || !meta?.title) continue;
      const normalized = {
        id: meta.id,
        title: meta.title,
        rarity: meta.rarity || null,
        imageUrl: meta.imageUrl || null,
        count: Number(meta.count) || 1
      };
      titleById.set(normalized.id, normalized.title);
      cardMetaById.set(normalized.id, normalized);
    }
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
    const headings = document.querySelectorAll('h3');
    for (const h3 of headings) {
      if (normalizeTitle(h3.textContent) !== target) continue;
      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) return { card, h3 };
    }
    return null;
  }

  function getOrCreateBadge(card) {
    let badge = card.querySelector(':scope > .wm-average-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'wm-average-badge';
      card.appendChild(badge);
    }
    return badge;
  }

  function renderLoadingBadge(badge) {
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

  function renderOne(id) {
    if (!isCollectionPage()) return;

    const title = titleById.get(id);
    if (!title) return;

    const found = findCardByTitle(title);
    if (!found) return;

    const { card } = found;
    const badge = getOrCreateBadge(card);
    const cacheEntry = cacheMemory.get(id);

    if (!cacheEntry) {
      renderLoadingBadge(badge);
      return;
    }

    badge.title = 'Prix moyen des ventes (cache 24 h)';
    const average = chooseAverage(cacheEntry, card, cardMetaById.get(id)?.rarity || null);
    if (average == null) {
      badge.className = 'wm-average-badge wm-average-empty';
      badge.textContent = 'Moy. —';
    } else {
      badge.className = 'wm-average-badge';
      badge.textContent = `Moy. ${formatAverage(average)} W`;
    }
  }

  function renderAll() {
    if (!isCollectionPage()) return;
    ensureToolbar();
    for (const id of titleById.keys()) renderOne(id);
  }

  async function loadCacheForCards(cards, { force = false, markBulk = false } = {}) {
    registerCards(cards);

    for (const { id } of cards) {
      if (force) cacheMemory.delete(id);
      renderOne(id);
    }

    const keys = cards.map(({ id }) => cacheKey(id));
    const stored = force ? {} : await storageGet(keys);
    const now = Date.now();

    if (markBulk) {
      bulkPendingIds.clear();
      bulkTotal = cards.length;
    }

    for (const { id } of cards) {
      const entry = stored[cacheKey(id)];
      const valid = !force && entry && Number.isFinite(entry.fetchedAt) && now - entry.fetchedAt < CACHE_TTL;

      if (valid) {
        cacheMemory.set(id, entry);
        renderOne(id);
      } else {
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
    if (cacheMemory.has(id) || queuedIds.has(id) || inFlightIds.has(id)) return;
    queued.push(id);
    queuedIds.add(id);
  }

  function pumpQueue() {
    while (activeRequests < MAX_CONCURRENT && queued.length > 0) {
      const id = queued.shift();
      queuedIds.delete(id);
      if (cacheMemory.has(id) || inFlightIds.has(id)) continue;
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

  async function finishRequest(detail) {
    const id = pendingByRequestId.get(detail.requestId) || detail.id;
    if (!id) return;

    pendingByRequestId.delete(detail.requestId);
    inFlightIds.delete(id);
    activeRequests = Math.max(0, activeRequests - 1);

    const entry = {
      fetchedAt: Date.now(),
      averages: detail.ok ? (detail.averages || {}) : {},
      ok: Boolean(detail.ok)
    };

    if (detail.title) {
      titleById.set(id, detail.title);
      const oldMeta = cardMetaById.get(id) || { id };
      cardMetaById.set(id, { ...oldMeta, title: detail.title });
    }

    cacheMemory.set(id, entry);
    await storageSet({ [cacheKey(id)]: entry });
    renderOne(id);

    if (bulkPendingIds.delete(id)) {
      updateBulkProgress();
      if (bulkActive && bulkPendingIds.size === 0) {
        finishBulkLoad();
      }
    }

    if (!detail.ok) {
      console.debug('[WM Average] échec mis en cache 24 h', id, detail.error);
    }

    pumpQueue();
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
    bulkButton.textContent = 'Tout charger';
    bulkButton.title = 'Charge toute la collection et les prix manquants';
    bulkButton.addEventListener('click', handleBulkClick);

    rankingButton = document.createElement('button');
    rankingButton.type = 'button';
    rankingButton.className = 'wm-tool-button';
    rankingButton.textContent = 'Plus chères';
    rankingButton.title = 'Affiche toute la collection triée par prix moyen décroissant';
    rankingButton.addEventListener('click', openRankingModal);

    bar.append(bulkButton, rankingButton);
    header.insertAdjacentElement('afterend', bar);
  }

  async function handleBulkClick() {
    if (bulkActive) return;

    const data = await storageGet(BULK_LAST_CLICK_KEY);
    const lastClick = Number(data[BULK_LAST_CLICK_KEY]) || 0;
    const now = Date.now();
    const recent = lastClick > 0 && now - lastClick < CACHE_TTL;

    let force = false;
    if (recent) {
      const confirmed = await showReloadConfirmation(lastClick);
      if (!confirmed) return;
      force = true;
    }

    await storageSet({ [BULK_LAST_CLICK_KEY]: now });

    bulkActive = true;
    bulkForce = force;
    bulkPendingIds.clear();
    bulkTotal = 0;
    bulkRequestId = `bulk:${now}:${Math.random().toString(36).slice(2)}`;

    setBulkButtonState('Collection…', true);

    window.dispatchEvent(new CustomEvent('wm-average-load-all-collection', {
      detail: { requestId: bulkRequestId }
    }));
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
    setBulkButtonState(`Prix ${completed}/${bulkTotal}`, true);
  }

  function finishBulkLoad() {
    if (!bulkActive) return;
    bulkActive = false;
    bulkForce = false;
    bulkRequestId = null;
    bulkPendingIds.clear();
    setBulkButtonState('Tout chargé ✓', false);
    setTimeout(() => {
      if (!bulkActive) setBulkButtonState('Tout charger', false);
    }, 2200);
  }

  function failBulkLoad(message) {
    bulkActive = false;
    bulkForce = false;
    bulkRequestId = null;
    bulkPendingIds.clear();
    setBulkButtonState('Erreur', false);
    showInfoModal('Chargement impossible', message || 'Impossible de charger toute la collection pour le moment.');
    setTimeout(() => {
      if (!bulkActive) setBulkButtonState('Tout charger', false);
    }, 2200);
  }

  function humanElapsed(timestamp) {
    const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
  }

  function showReloadConfirmation(lastClick) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'wm-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'wm-modal wm-confirm-modal';

      const title = document.createElement('h2');
      title.textContent = 'Recharger tous les prix ?';

      const text = document.createElement('p');
      text.textContent = `Tu as déjà lancé « Tout charger » il y a ${humanElapsed(lastClick)}, donc il y a moins de 24 h. Relancer maintenant peut envoyer beaucoup de requêtes à WikiMasters. Par prudence, mieux vaut attendre un peu : le site peut appliquer des limitations. Recharger quand même ?`;

      const actions = document.createElement('div');
      actions.className = 'wm-modal-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'wm-tool-button wm-secondary-button';
      cancel.textContent = 'Attendre';

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
    const storedCollection = await storageGet(ALL_COLLECTION_KEY);
    const collectionEntry = storedCollection[ALL_COLLECTION_KEY];
    const cards = Array.isArray(collectionEntry?.cards) ? collectionEntry.cards : [];

    if (!cards.length) {
      showInfoModal('Collection non chargée', 'Clique d’abord sur « Tout charger » pour récupérer toute la collection et pouvoir la trier par prix moyen.');
      return;
    }

    const priceKeys = cards.map((card) => cacheKey(card.id));
    const prices = await storageGet(priceKeys);

    const rows = cards.map((card) => {
      const entry = prices[cacheKey(card.id)];
      const average = entry ? chooseAverage(entry, null, card.rarity || null) : null;
      return {
        ...card,
        average,
        fetchedAt: Number(entry?.fetchedAt) || 0
      };
    }).sort((a, b) => {
      const aPrice = Number.isFinite(a.average) ? a.average : -Infinity;
      const bPrice = Number.isFinite(b.average) ? b.average : -Infinity;
      if (bPrice !== aPrice) return bPrice - aPrice;
      return a.title.localeCompare(b.title, 'fr');
    });

    renderRankingModal(rows, collectionEntry.fetchedAt || 0);
  }

  function renderRankingModal(rows, collectionFetchedAt) {
    const overlay = document.createElement('div');
    overlay.className = 'wm-modal-overlay wm-ranking-overlay';

    const modal = document.createElement('div');
    modal.className = 'wm-modal wm-ranking-modal';

    const header = document.createElement('div');
    header.className = 'wm-ranking-header';

    const headingWrap = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = 'Cartes les plus chères';

    const subtitle = document.createElement('p');
    const pricedCount = rows.filter((row) => Number.isFinite(row.average)).length;
    subtitle.textContent = `${rows.length} cartes • ${pricedCount} avec un prix moyen${collectionFetchedAt ? ` • collection chargée il y a ${humanElapsed(collectionFetchedAt)}` : ''}`;

    headingWrap.append(title, subtitle);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'wm-ranking-close';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.textContent = '×';

    header.append(headingWrap, closeButton);

    const list = document.createElement('div');
    list.className = 'wm-ranking-list';

    rows.forEach((row, index) => {
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

      item.append(rank, thumb, info, price);
      list.append(item);
    });

    const close = () => overlay.remove();
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    modal.append(header, list);
    overlay.append(modal);
    document.body.append(overlay);
  }

  window.addEventListener('wm-average-collection', (event) => {
    const cards = event.detail?.cards;
    if (!Array.isArray(cards) || !cards.length) return;
    console.debug(`[WM Average] ${cards.length} cartes détectées`, cards);
    loadCacheForCards(cards).catch((err) => console.error('[WM Average] cache', err));
  });

  window.addEventListener('wm-average-response', (event) => {
    finishRequest(event.detail || {}).catch((err) => console.error('[WM Average] réponse', err));
  });

  window.addEventListener('wm-average-all-collection-progress', (event) => {
    if (!bulkActive || event.detail?.requestId !== bulkRequestId) return;
    const loadedPages = Number(event.detail.loadedPages) || 0;
    const totalPages = Number(event.detail.totalPages) || 0;
    if (totalPages > 0) {
      setBulkButtonState(`Collection ${loadedPages}/${totalPages}`, true);
    }
  });

  window.addEventListener('wm-average-all-collection', async (event) => {
    const detail = event.detail || {};
    if (!bulkActive || detail.requestId !== bulkRequestId) return;

    if (!detail.ok) {
      failBulkLoad(detail.error || 'Erreur réseau');
      return;
    }

    const cards = Array.isArray(detail.cards) ? detail.cards : [];
    const fetchedAt = Date.now();

    await storageSet({
      [ALL_COLLECTION_KEY]: { fetchedAt, cards }
    });

    if (!cards.length) {
      finishBulkLoad();
      return;
    }

    setBulkButtonState('Préparation des prix…', true);
    loadCacheForCards(cards, { force: bulkForce, markBulk: true })
      .catch((error) => failBulkLoad(String(error?.message || error)));
  });

  let renderTimer = null;
  let previousPath = location.pathname;

  const observer = new MutationObserver(() => {
    const currentPath = location.pathname;

    if (currentPath !== previousPath) {
      previousPath = currentPath;
      console.debug('[WM Average] navigation SPA détectée:', currentPath);
    }

    if (!isCollectionPage()) return;

    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, 80);
  });

  function startObserver() {
    if (!document.body) {
      requestAnimationFrame(startObserver);
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
    renderAll();
  }
  startObserver();

  window.addEventListener('popstate', () => {
    previousPath = location.pathname;
    if (isCollectionPage()) {
      setTimeout(renderAll, 0);
    }
  });

  console.debug('[WM Average] content script v3.3.1 chargé');
})();