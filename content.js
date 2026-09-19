(() => {
  if (window.__wmAverageUiInstalled) return;
  window.__wmAverageUiInstalled = true;

  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
  const CACHE_PREFIX = 'wm_avg_v3_';
  const MAX_CONCURRENT = 3;
  const BULK_RARITY_LAST_LOAD_KEY = 'wm_bulk_rarity_last_load_v1';
  const ALL_COLLECTION_KEY = 'wm_all_collection_v1';
  const PULL_RECAP_ENABLED_KEY = 'wm_pull_recap_enabled_v1';
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
  let pullRecapEnabled = readLocalValue(PULL_RECAP_ENABLED_KEY) !== false;
  let activePackRecap = null;
  let packRecapDismissed = false;
  let openAllActive = false;
  let openAllRequestId = null;
  let openAllButton = null;
  let openAllSummaryCards = [];
  let openAllOpenedPacks = 0;
  let openAllError = null;

  function isCollectionPage() {
    return location.pathname === '/collection' || location.pathname.startsWith('/collection/');
  }

  function isMarketplaceDetailPage() {
    return /^\/marketplace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(location.pathname);
  }

  function isPullsPage() {
    return location.pathname === '/pulls' || location.pathname.startsWith('/pulls/');
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
        id: meta.id,
        title: meta.title,
        rarity: meta.rarity || null,
        imageUrl: meta.imageUrl || null,
        count: Number(meta.count) || 1
      };
      cardMetaById.set(normalized.id, normalized);
      idByTitle.set(normalizeTitle(normalized.title), normalized.id);
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
    for (const h3 of document.querySelectorAll('h3')) {
      if (normalizeTitle(h3.textContent) !== target) continue;
      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) return card;
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

  function renderCollectionCard(id, card) {
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

  function renderOne(id) {
    if (!isCollectionPage()) return;
    const meta = cardMetaById.get(id);
    if (!meta?.title) return;

    const card = findCardByTitle(meta.title);
    if (card) renderCollectionCard(id, card);
  }

  function renderVisibleCollectionCards() {
    if (!isCollectionPage()) return;

    for (const h3 of document.querySelectorAll('h3')) {
      const id = idByTitle.get(normalizeTitle(h3.textContent));
      if (!id) continue;

      const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
      if (card) renderCollectionCard(id, card);
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
      renderOpenAllSummary();
    }
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
    tools.append(label);
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

    openAllActive = true;
    openAllSummaryCards = [];
    openAllOpenedPacks = 0;
    openAllError = null;
    openAllRequestId = `packs:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    if (openAllButton) {
      openAllButton.disabled = true;
      openAllButton.textContent = 'Ouverture…';
    }

    document.getElementById('wm-pack-recap')?.remove();

    window.dispatchEvent(new CustomEvent('wm-average-open-all-packs', {
      detail: { requestId: openAllRequestId }
    }));
  }

  function setOpenAllButtonProgress(openedPacks, packsRemaining = null) {
    if (!openAllButton) return;

    if (Number.isFinite(Number(packsRemaining))) {
      openAllButton.textContent = `Ouverts ${openedPacks} • reste ${Number(packsRemaining)}`;
    } else {
      openAllButton.textContent = `Ouverts ${openedPacks}`;
    }
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

  function openOpenAllSummary(cards, openedPacks, error = null) {
    document.getElementById('wm-open-all-overlay')?.remove();

    openAllSummaryCards = cards;
    openAllOpenedPacks = openedPacks;
    openAllError = error;

    const overlay = document.createElement('div');
    overlay.id = 'wm-open-all-overlay';
    overlay.className = 'wm-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'wm-modal wm-open-all-modal';

    const header = document.createElement('div');
    header.className = 'wm-open-all-header';

    const headingWrap = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = 'Cartes obtenues';

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
      openAllSummaryCards = [];
      openAllError = null;
      location.reload();
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
      renderVisibleCollectionCards();
    }

    if (isMarketplaceDetailPage() && marketplaceCardId) {
      renderMarketplaceAverage(marketplaceCardId);
    }

    if (isPullsPage()) {
      ensurePullsToolbar();
      renderPackRecap();
    }
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

  function finishRequest(detail) {
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
    bulkButton.addEventListener('click', () => {
      handleBulkClick().catch((error) => reportError('chargement', error));
    });

    rankingButton = document.createElement('button');
    rankingButton.type = 'button';
    rankingButton.className = 'wm-tool-button';
    rankingButton.textContent = 'Plus chères';
    rankingButton.title = 'Affiche toute la collection triée par prix moyen décroissant';
    rankingButton.addEventListener('click', () => {
      try {
        openRankingModal();
      } catch (error) {
        reportError('classement', error);
      }
    });

    bar.append(bulkButton, rankingButton, createSponsorNote());
    header.insertAdjacentElement('afterend', bar);
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

  function openRankingModal() {
    const storedCollection = storageGet(ALL_COLLECTION_KEY);
    const collectionEntry = storedCollection[ALL_COLLECTION_KEY];
    const cards = Array.isArray(collectionEntry?.cards) ? collectionEntry.cards : [];

    if (!cards.length) {
      showInfoModal('Collection non chargée', 'Clique d’abord sur « Charger les prix » pour récupérer toute la collection et pouvoir la trier par prix moyen.');
      return;
    }

    const priceKeys = cards.map((card) => cacheKey(card.id));
    const prices = storageGet(priceKeys);

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

  document.addEventListener('click', (event) => {
    if (!isPullsPage() || !activePackRecap) return;

    const button = event.target?.closest?.('button');
    if (!button) return;

    if (normalizeTitle(button.textContent) === 'Continuer') {
      packRecapDismissed = true;
      document.getElementById('wm-pack-recap')?.remove();
    }
  }, true);

  window.addEventListener('wm-average-open-all-packs-progress', (event) => {
    const detail = event.detail || {};
    if (!openAllActive || detail.requestId !== openAllRequestId) return;

    openAllOpenedPacks = Number(detail.openedPacks) || 0;
    setOpenAllButtonProgress(openAllOpenedPacks, detail.packsRemaining);
  });

  window.addEventListener('wm-average-open-all-packs-result', (event) => {
    const detail = event.detail || {};
    if (!openAllActive || detail.requestId !== openAllRequestId) return;

    openAllActive = false;
    openAllRequestId = null;

    if (openAllButton) {
      openAllButton.disabled = false;
      openAllButton.textContent = 'Tout ouvrir';
    }

    const cards = Array.isArray(detail.cards) ? detail.cards : [];
    const openedPacks = Number(detail.openedPacks) || 0;

    if (!cards.length) {
      showInfoModal(
        detail.ok ? 'Aucun paquet ouvert' : 'Ouverture impossible',
        detail.error || 'Aucun paquet disponible.'
      );
      return;
    }

    mergePulledCardsIntoCollectionCache(cards);

    const uniqueCards = [...new Map(cards.map((card) => [card.id, card])).values()];
    try {
      loadCacheForCards(uniqueCards);
    } catch (error) {
      reportError('prix après tout ouvrir', error);
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
      loadCacheForCards(cards);
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

    storageSet({
      [ALL_COLLECTION_KEY]: { fetchedAt, cards }
    });

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

  const observer = new MutationObserver(() => {
    try {
      const currentPath = location.pathname;

      if (currentPath !== previousPath) {
        previousPath = currentPath;
        console.debug('[WM Average] navigation SPA détectée:', currentPath);
      }

      if (!isCollectionPage() && !isMarketplaceDetailPage() && !isPullsPage()) return;

      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        try {
          renderAll();
        } catch (error) {
          reportError('rendu', error);
        }
      }, 80);
    } catch (error) {
      reportError('observation', error);
    }
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
    if (isCollectionPage() || isMarketplaceDetailPage() || isPullsPage()) {
      setTimeout(() => {
        try {
          renderAll();
        } catch (error) {
          reportError('navigation', error);
        }
      }, 0);
    }
  });

  console.debug('[WM Average] page runtime v3.10 chargé');
})();