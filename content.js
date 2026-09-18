(() => {
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
  const CACHE_PREFIX = 'wm_avg_v3_';
  const MAX_CONCURRENT = 3;

  const titleById = new Map();
  const idByTitle = new Map();
  const cacheMemory = new Map();
  const queued = [];
  const queuedIds = new Set();
  const inFlightIds = new Set();
  const pendingByRequestId = new Map();
  let activeRequests = 0;

  const bridge = document.createElement('script');
  bridge.src = chrome.runtime.getURL('page-bridge.js');
  bridge.onload = () => bridge.remove();
  (document.documentElement || document.head).appendChild(bridge);

  function normalizeTitle(value) {
    return String(value || '')
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cacheKey(id) {
    return CACHE_PREFIX + id;
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
    const target = normalizeTitle(title);
    const headings = document.querySelectorAll('h3');
    for (const h3 of headings) {
      if (normalizeTitle(h3.textContent) !== target) continue;
      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) return { card, h3 };
    }
    return null;
  }

  function chooseAverage(cacheEntry, cardEl) {
    const rarity = getRarityFromCard(cardEl);
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
    const title = titleById.get(id);
    const cacheEntry = cacheMemory.get(id);
    if (!title || !cacheEntry) return;

    const found = findCardByTitle(title);
    if (!found) return;

    const { card } = found;
    let badge = card.querySelector(':scope > .wm-average-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'wm-average-badge';
      badge.title = 'Prix moyen des ventes (cache 24 h)';
      card.appendChild(badge);
    }

    const average = chooseAverage(cacheEntry, card);
    if (average == null) {
      badge.textContent = 'Moy. —';
      badge.classList.add('wm-average-empty');
    } else {
      badge.textContent = `Moy. ${formatAverage(average)} W`;
      badge.classList.remove('wm-average-empty');
    }
  }

  function renderAll() {
    for (const id of titleById.keys()) renderOne(id);
  }

  async function loadCacheForCards(cards) {
    const keys = cards.map(({ id }) => cacheKey(id));
    const stored = await chrome.storage.local.get(keys);
    const now = Date.now();

    for (const { id, title } of cards) {
      titleById.set(id, title);
      idByTitle.set(normalizeTitle(title), id);

      const entry = stored[cacheKey(id)];
      if (entry && Number.isFinite(entry.fetchedAt) && now - entry.fetchedAt < CACHE_TTL) {
        cacheMemory.set(id, entry);
        renderOne(id);
      } else {
        enqueue(id);
      }
    }

    pumpQueue();
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
      idByTitle.set(normalizeTitle(detail.title), id);
    }

    cacheMemory.set(id, entry);
    await chrome.storage.local.set({ [cacheKey(id)]: entry });
    renderOne(id);

    if (!detail.ok) {
      console.debug('[WM Average] échec mis en cache 24 h', id, detail.error);
    }

    pumpQueue();
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

  let renderTimer = null;
  const observer = new MutationObserver(() => {
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

  console.debug('[WM Average] content script v3 chargé');
})();