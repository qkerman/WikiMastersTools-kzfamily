(() => {
  if (window.__wmAverageUiInstalled) return;
  window.__wmAverageUiInstalled = true;

  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
  const CACHE_PREFIX = 'wm_avg_v3_';
  const MAX_CONCURRENT = 3;
  const BULK_LAST_CLICK_KEY = 'wm_bulk_last_click_v1'; // legacy, conservé pour compatibilité
  const BULK_RARITY_LAST_LOAD_KEY = 'wm_bulk_rarity_last_load_v1';
  const ALL_COLLECTION_KEY = 'wm_all_collection_v1';
  const RARITIES = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
  const DEFAULT_RARE_RARITIES = ['L', 'UR', 'SR', 'R'];

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
  let bulkSelectedRarities = new Set(DEFAULT_RARE_RARITIES);
  let bulkForceRarities = new Set();
  const bulkPendingIds = new Set();

  let bulkButton = null;
  let rankingButton = null;
  let marketplaceCardId = null;

  function isCollectionPage() {
    return location.pathname === '/collection' || location.pathname.startsWith('/collection/');
  }

  function isMarketplaceDetailPage() {
    return /^\/marketplace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(location.pathname);
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

    for (const key of list) {
      const value = readLocalValue(key);
      if (value !== undefined) {
        result[key] = value;
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

  function renderMarketplaceAverage(id) {
    if (!isMarketplaceDetailPage() || marketplaceCardId !== id) return;

    const meta = cardMetaById.get(id);
    if (!meta?.title) return;

    const h1 = [...document.querySelectorAll('h1')]
      .find((el) => normalizeTitle(el.textContent) === normalizeTitle(meta.title));
    if (!h1) return;

    const headingRow = h1.parentElement;
    const titleBlock = headingRow?.parentElement;
    const infoColumn = titleBlock?.parentElement;
    if (!titleBlock || !infoColumn) return;

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
  }

  function renderAll() {
    if (isCollectionPage()) {
      ensureToolbar();
      for (const id of titleById.keys()) renderOne(id);
    }

    if (isMarketplaceDetailPage() && marketplaceCardId) {
      renderMarketplaceAverage(marketplaceCardId);
    }
  }

  async function loadCacheForCards(cards, { force = false, forceRarities = null, markBulk = false } = {}) {
    registerCards(cards);

    for (const card of cards) {
      const forceCard = force || Boolean(forceRarities?.has(card.rarity));
      if (forceCard) cacheMemory.delete(card.id);
      renderKnownCard(card.id);
    }

    const keys = cards.map(({ id }) => cacheKey(id));
    const stored = await storageGet(keys);
    const now = Date.now();

    if (markBulk) {
      bulkPendingIds.clear();
      bulkTotal = cards.length;
    }

    for (const card of cards) {
      const { id } = card;
      const forceCard = force || Boolean(forceRarities?.has(card.rarity));
      const entry = stored[cacheKey(id)];
      const valid = !forceCard && entry && Number.isFinite(entry.fetchedAt) && now - entry.fetchedAt < CACHE_TTL;

      if (valid) {
        cacheMemory.set(id, entry);
        renderKnownCard(id);
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
    renderKnownCard(id);

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
    bulkButton.textContent = 'Charger les prix';
    bulkButton.title = 'Choisir les raretés dont tu veux charger ou actualiser les prix';
    bulkButton.addEventListener('click', handleBulkClick);

    rankingButton = document.createElement('button');
    rankingButton.type = 'button';
    rankingButton.className = 'wm-tool-button';
    rankingButton.textContent = 'Plus chères';
    rankingButton.title = 'Affiche toute la collection triée par prix moyen décroissant';
    rankingButton.addEventListener('click', openRankingModal);

    bar.append(bulkButton, rankingButton, createSponsorNote());
    header.insertAdjacentElement('afterend', bar);
  }

  async function handleBulkClick() {
    if (bulkActive) return;

    const lastLoadsData = await storageGet(BULK_RARITY_LAST_LOAD_KEY);
    const lastLoads = lastLoadsData[BULK_RARITY_LAST_LOAD_KEY] || {};

    const selected = await showRaritySelectionModal(lastLoads);
    if (!selected?.length) return;

    const now = Date.now();
    const recentRarities = selected.filter((rarity) => {
      const timestamp = Number(lastLoads[rarity]) || 0;
      return timestamp > 0 && now - timestamp < CACHE_TTL;
    });

    const forceRarities = new Set();
    if (recentRarities.length > 0) {
      const confirmed = await showReloadConfirmation(recentRarities, lastLoads);
      if (!confirmed) return;
      recentRarities.forEach((rarity) => forceRarities.add(rarity));
    }

    bulkActive = true;
    bulkForce = false;
    bulkSelectedRarities = new Set(selected);
    bulkForceRarities = forceRarities;
    bulkPendingIds.clear();
    bulkTotal = 0;
    bulkRequestId = `bulk:${now}:${Math.random().toString(36).slice(2)}`;

    setBulkButtonState('Collection…', true);

    window.dispatchEvent(new CustomEvent('wm-average-load-all-collection', {
      detail: { requestId: bulkRequestId }
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

      presets.append(
        makePreset('Rares', ['L', 'UR', 'SR', 'R']),
        makePreset('Courantes', ['PC', 'C']),
        makePreset('Toutes', RARITIES)
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
        close(values);
      });
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });

      actions.append(cancel, confirm);
      modal.append(title, text, tip, presets, grid, actions);
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
    setBulkButtonState(`Prix ${completed}/${bulkTotal}`, true);
  }

  async function finishBulkLoad() {
    if (!bulkActive) return;

    const selectedRarities = [...bulkSelectedRarities];
    const data = await storageGet(BULK_RARITY_LAST_LOAD_KEY);
    const lastLoads = { ...(data[BULK_RARITY_LAST_LOAD_KEY] || {}) };
    const now = Date.now();
    selectedRarities.forEach((rarity) => {
      lastLoads[rarity] = now;
    });
    await storageSet({ [BULK_RARITY_LAST_LOAD_KEY]: lastLoads });

    bulkActive = false;
    bulkForce = false;
    bulkRequestId = null;
    bulkForceRarities.clear();
    bulkPendingIds.clear();
    setBulkButtonState('Chargé ✓', false);
    setTimeout(() => {
      if (!bulkActive) setBulkButtonState('Charger les prix', false);
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

    const PAGE_SIZE = 50;
    let renderedCount = 0;

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

      item.append(rank, thumb, info, price);
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

    modal.append(header, list);
    overlay.append(modal);
    document.body.append(overlay);
  }

  window.addEventListener('wm-average-marketplace-detail', (event) => {
    const card = event.detail?.card;
    if (!card?.id || !card?.title) return;

    marketplaceCardId = card.id;
    registerCards([card]);
    renderMarketplaceAverage(card.id);

    loadCacheForCards([card]).catch((err) => {
      console.error('[WM Average] marketplace', err);
    });
  });

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

    const selectedCards = cards.filter((card) => bulkSelectedRarities.has(card.rarity));

    if (!selectedCards.length) {
      finishBulkLoad();
      return;
    }

    setBulkButtonState(`Préparation (${selectedCards.length})…`, true);
    loadCacheForCards(selectedCards, {
      force: bulkForce,
      forceRarities: bulkForceRarities,
      markBulk: true
    }).catch((error) => failBulkLoad(String(error?.message || error)));
  });

  let renderTimer = null;
  let previousPath = location.pathname;

  const observer = new MutationObserver(() => {
    const currentPath = location.pathname;

    if (currentPath !== previousPath) {
      previousPath = currentPath;
      console.debug('[WM Average] navigation SPA détectée:', currentPath);
    }

    if (!isCollectionPage() && !isMarketplaceDetailPage()) return;

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
    if (isCollectionPage() || isMarketplaceDetailPage()) {
      setTimeout(renderAll, 0);
    }
  });

  console.debug('[WM Average] content script v3.5 chargé');
})();