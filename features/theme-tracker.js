(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.themeTracker = {
    create(runtime) {
      const {
        readLocalValue,
        writeLocalValue,
        registerCards
      } = runtime.core;

      const PAGE_ID = 'wm-theme-tracker-page';
      const NAV_ID = 'wm-theme-tracker-nav';
      const STORAGE_KEY = 'wm_families_v1';
      const PAGE_SIZE_FALLBACK = 50;
      const MAX_RESULTS = 3000;
      const MAX_PAGES = 60;
      const REQUEST_DELAY_MS = 70;
      const CARD_BATCH = 120;

      let activeFamilyId = null;
      let currentFilter = 'all';
      let visibleCount = CARD_BATCH;

      function isThemePage() {
        if (location.pathname !== '/global-collection') return false;
        try {
          return new URLSearchParams(location.search).get('wm') === 'themes';
        } catch (_) {
          return false;
        }
      }

      function normalize(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('fr')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function familyId() {
        return `family-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }

      function readFamilies() {
        const value = readLocalValue(STORAGE_KEY);
        return Array.isArray(value) ? value.filter((item) => item?.id && item?.name && Array.isArray(item.cards)) : [];
      }

      function writeFamilies(families) {
        writeLocalValue(STORAGE_KEY, families);
      }

      function getFamily(id) {
        return readFamilies().find((item) => item.id === id) || null;
      }

      function saveFamily(family) {
        const families = readFamilies();
        const index = families.findIndex((item) => item.id === family.id);
        if (index >= 0) families[index] = family;
        else families.unshift(family);
        writeFamilies(families);
      }

      function removeFamily(id) {
        writeFamilies(readFamilies().filter((item) => item.id !== id));
      }

      function formatDate(timestamp) {
        if (!timestamp) return '';
        try {
          return new Intl.DateTimeFormat('fr-FR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          }).format(new Date(timestamp));
        } catch (_) {
          return '';
        }
      }

      function ensureNavLink() {
        if (!runtime.settings.isEnabled('themeTracker')) {
          document.getElementById(NAV_ID)?.remove();
          return;
        }

        let link = document.getElementById(NAV_ID);

        if (!link) {
          const anchor =
            document.querySelector('nav a[href="/collection"]') ||
            document.querySelector('nav a[href="/global-collection"]');

          if (!anchor?.parentElement) return;

          link = document.createElement('a');
          link.id = NAV_ID;
          link.href = '/global-collection?wm=themes';
          link.className = 'wm-family-nav flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200';

          const icon = document.createElement('span');
          icon.className = 'wm-family-nav-icon';
          icon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="7" height="7" rx="2"></rect>
              <rect x="14" y="4" width="7" height="7" rx="2"></rect>
              <rect x="3" y="14" width="7" height="7" rx="2"></rect>
              <rect x="14" y="14" width="7" height="7" rx="2"></rect>
            </svg>`;

          const label = document.createElement('span');
          label.textContent = 'Familles';

          link.append(icon, label);
          anchor.insertAdjacentElement('afterend', link);
        }

        link.classList.toggle('is-active', isThemePage());
        if (isThemePage()) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }

      function extractRows(json, owned = false) {
        const candidates = owned
          ? [json?.collection, json?.cards, json?.items, json?.results, json?.data]
          : [json?.cards, json?.collection, json?.items, json?.results, json?.data];

        for (const candidate of candidates) {
          if (Array.isArray(candidate)) return candidate;
        }

        if (Array.isArray(json)) return json;
        return [];
      }

      function mapGlobalRow(row, ownedCount = 0) {
        const card = row?.card || row;
        const id = row?.card_id || card?.id;
        const title = card?.wikipedia_title || card?.title;

        if (!id || !title) return null;

        return {
          id,
          title,
          rarity: card?.rarity || row?.rarity || null,
          category: card?.category || row?.category || null,
          imageUrl: card?.image_url || row?.image_url || null,
          wikipediaUrl: card?.wikipedia_url || row?.wikipedia_url || null,
          owned: ownedCount > 0,
          ownedCount
        };
      }

      function countOwnedIds(json) {
        const counts = new Map();

        for (const id of Array.isArray(json?.ownedCardIds) ? json.ownedCardIds : []) {
          if (!id) continue;
          counts.set(id, (counts.get(id) || 0) + 1);
        }

        return counts;
      }

      function readTotal(json, currentRowCount = 0) {
        const values = [
          json?.total,
          json?.total_count,
          json?.pagination?.total,
          json?.pagination?.total_count,
          json?.meta?.total,
          json?.meta?.total_count
        ];

        const valid = values
          .map(Number)
          .filter((number) =>
            Number.isFinite(number) &&
            number >= 0 &&
            number >= currentRowCount
          );

        if (!valid.length) return null;
        return Math.max(...valid);
      }

      function readSearchHasMore(json) {
        if (typeof json?.searchHasMore === 'boolean') return json.searchHasMore;
        if (typeof json?.hasMore === 'boolean') return json.hasMore;
        if (typeof json?.pagination?.hasMore === 'boolean') return json.pagination.hasMore;
        if (typeof json?.meta?.hasMore === 'boolean') return json.meta.hasMore;
        return null;
      }

      async function fetchJson(url) {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { accept: '*/*' }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      }

      function endpointUrl(keyword, page) {
        const q = encodeURIComponent(keyword);
        return `/api/cards?page=${encodeURIComponent(page)}&q=${q}&sort=rarity`;
      }

      async function previewKeyword(keyword) {
        const json = await fetchJson(endpointUrl(keyword, 0));
        const rows = extractRows(json, false);
        const total = readTotal(json, rows.length);
        const searchHasMore = readSearchHasMore(json);
        const exact = total != null || searchHasMore === false;

        return {
          total: total == null ? rows.length : total,
          firstPageSize: rows.length || PAGE_SIZE_FALLBACK,
          exact,
          searchHasMore
        };
      }

      async function fetchAll(keyword, onProgress) {
        const rows = [];
        const ownedCounts = new Map();
        let total = null;

        for (let page = 0; page < MAX_PAGES; page += 1) {
          const json = await fetchJson(endpointUrl(keyword, page));
          const pageRows = extractRows(json, false);
          const pageOwnedCounts = countOwnedIds(json);
          const searchHasMore = readSearchHasMore(json);

          if (page === 0) {
            total = readTotal(json, pageRows.length);

            if (total != null && total > MAX_RESULTS) {
              throw new Error(`Cette recherche contient ${total.toLocaleString('fr-FR')} résultats. Utilise un mot-clé plus précis (maximum ${MAX_RESULTS.toLocaleString('fr-FR')}).`);
            }
          }

          rows.push(...pageRows);

          for (const [id, count] of pageOwnedCounts) {
            ownedCounts.set(id, Math.max(ownedCounts.get(id) || 0, count));
          }

          const effectiveTotal =
            total != null
              ? total
              : searchHasMore === false
                ? rows.length
                : null;

          onProgress?.({
            page: page + 1,
            loaded: rows.length,
            total: effectiveTotal
          });

          const reachedTotal = total != null && rows.length >= total;
          const shortPage = pageRows.length < PAGE_SIZE_FALLBACK;

          if (!pageRows.length || reachedTotal || searchHasMore === false) break;
          if (searchHasMore == null && shortPage) break;

          if (rows.length >= MAX_RESULTS) {
            throw new Error(`Cette recherche dépasse ${MAX_RESULTS.toLocaleString('fr-FR')} cartes. Utilise un mot-clé plus précis.`);
          }

          await wait(REQUEST_DELAY_MS);
        }

        return { rows, ownedCounts };
      }

      function mergeFamilyCards(globalRows, ownedCounts) {
        const cardsById = new Map();

        for (const raw of globalRows) {
          const rawId = raw?.card_id || raw?.card?.id || raw?.id;
          const card = mapGlobalRow(raw, ownedCounts.get(rawId) || 0);
          if (!card) continue;

          const previous = cardsById.get(card.id);
          cardsById.set(card.id, previous ? {
            ...previous,
            ...card,
            imageUrl: card.imageUrl || previous.imageUrl || null,
            category: card.category || previous.category || null,
            owned: previous.owned || card.owned,
            ownedCount: Math.max(previous.ownedCount || 0, card.ownedCount || 0)
          } : card);
        }

        const cards = [...cardsById.values()]
          .sort((a, b) => a.title.localeCompare(b.title, 'fr'));

        registerCards(cards.map((card) => ({
          id: card.id,
          title: card.title,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          wikipediaUrl: card.wikipediaUrl,
          count: Math.max(1, card.ownedCount || 1)
        })));

        return cards;
      }

      function familyStats(family) {
        const cards = Array.isArray(family?.cards) ? family.cards : [];
        const owned = cards.filter((card) => card.owned).length;
        const total = cards.length;

        return {
          total,
          owned,
          missing: Math.max(0, total - owned),
          percent: total ? Math.round((owned / total) * 100) : 0
        };
      }

      async function buildFamily({ id = null, name, keyword }, onProgress) {
        const result = await fetchAll(keyword, onProgress);
        const cards = mergeFamilyCards(result.rows, result.ownedCounts);
        const now = Date.now();

        return {
          id: id || familyId(),
          name: String(name || keyword).trim(),
          keyword: String(keyword || '').trim(),
          cards,
          createdAt: id ? (getFamily(id)?.createdAt || now) : now,
          updatedAt: now
        };
      }

      function createFamilyCard(family) {
        const stats = familyStats(family);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wm-family-card';

        const imageUrl = family.cards.find((card) => card.imageUrl)?.imageUrl || null;

        const thumb = document.createElement('span');
        thumb.className = 'wm-family-card-thumb';

        if (imageUrl) {
          const image = document.createElement('img');
          image.src = imageUrl;
          image.alt = '';
          image.loading = 'lazy';
          thumb.append(image);
        } else {
          thumb.textContent = '✦';
        }

        const body = document.createElement('span');
        body.className = 'wm-family-card-body';

        const title = document.createElement('strong');
        title.textContent = family.name;

        const keyword = document.createElement('span');
        keyword.className = 'wm-family-card-keyword';
        keyword.textContent = `“${family.keyword}”`;

        const numbers = document.createElement('span');
        numbers.className = 'wm-family-card-numbers';
        numbers.textContent = `${stats.owned.toLocaleString('fr-FR')} / ${stats.total.toLocaleString('fr-FR')} possédées`;

        const progress = document.createElement('span');
        progress.className = 'wm-family-progress';

        const fill = document.createElement('span');
        fill.style.width = `${stats.percent}%`;
        progress.append(fill);

        body.append(title, keyword, numbers, progress);
        button.append(thumb, body);

        button.addEventListener('click', () => {
          activeFamilyId = family.id;
          currentFilter = 'all';
          visibleCount = CARD_BATCH;
          renderPageContent();
        });

        return button;
      }

      function createAddCard() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wm-family-add-card';
        button.innerHTML = '<span>+</span><strong>Ajouter une famille</strong>';
        button.addEventListener('click', openCreateModal);
        return button;
      }

      function buildHome() {
        const wrap = document.createElement('div');
        wrap.className = 'wm-family-home';

        const heading = document.createElement('div');
        heading.className = 'wm-family-page-head';

        const copy = document.createElement('div');
        const title = document.createElement('h1');
        title.textContent = 'Familles';

        const subtitle = document.createElement('p');
        subtitle.textContent = 'Crée des groupes de cartes à partir d’un mot-clé.';

        copy.append(title, subtitle);

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'wm-family-primary';
        add.textContent = '+ Ajouter une famille';
        add.addEventListener('click', openCreateModal);

        heading.append(copy, add);

        const grid = document.createElement('div');
        grid.className = 'wm-family-grid';

        const families = readFamilies();

        if (!families.length) {
          const empty = document.createElement('div');
          empty.className = 'wm-family-empty';
          empty.innerHTML = '<strong>Aucune famille</strong><span>Ajoute un mot-clé pour commencer.</span>';

          const emptyButton = document.createElement('button');
          emptyButton.type = 'button';
          emptyButton.className = 'wm-family-primary';
          emptyButton.textContent = 'Ajouter une famille';
          emptyButton.addEventListener('click', openCreateModal);

          empty.append(emptyButton);
          grid.append(empty);
        } else {
          families.forEach((family) => grid.append(createFamilyCard(family)));
          grid.append(createAddCard());
        }

        wrap.append(heading, grid);
        return wrap;
      }

      function filteredCards(family) {
        let cards = [...family.cards];

        if (currentFilter === 'owned') cards = cards.filter((card) => card.owned);
        if (currentFilter === 'missing') cards = cards.filter((card) => !card.owned);

        return cards.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      }

      function createResultCard(card) {
        const item = document.createElement('article');
        item.className = `wm-family-result ${card.owned ? 'is-owned' : 'is-missing'}`;

        const visual = document.createElement('div');
        visual.className = 'wm-family-result-image';

        if (card.imageUrl) {
          const image = document.createElement('img');
          image.src = card.imageUrl;
          image.alt = '';
          image.loading = 'lazy';
          visual.append(image);
        } else {
          visual.textContent = '✦';
        }

        const badge = document.createElement('span');
        badge.className = `wm-family-owned-badge ${card.owned ? 'is-owned' : ''}`;
        badge.textContent = card.owned
          ? `✓ Possédée${card.ownedCount > 1 ? ` ×${card.ownedCount}` : ''}`
          : 'Manquante';
        visual.append(badge);

        const body = document.createElement('div');
        body.className = 'wm-family-result-body';

        const title = document.createElement('h3');
        title.textContent = card.title;

        const meta = document.createElement('div');
        meta.className = 'wm-family-result-meta';

        if (card.rarity) {
          const rarity = document.createElement('span');
          rarity.textContent = card.rarity;
          meta.append(rarity);
        }

        if (card.category) {
          const category = document.createElement('span');
          category.textContent = card.category;
          meta.append(category);
        }

        body.append(title, meta);
        item.append(visual, body);
        return item;
      }

      function renderDetailGrid(family, container) {
        const cards = filteredCards(family);
        const shown = cards.slice(0, visibleCount);

        const grid = container.querySelector('[data-role="cards"]');
        const count = container.querySelector('[data-role="count"]');
        const more = container.querySelector('[data-role="more"]');

        grid.replaceChildren();
        const fragment = document.createDocumentFragment();
        shown.forEach((card) => fragment.append(createResultCard(card)));
        grid.append(fragment);

        count.textContent = `${cards.length.toLocaleString('fr-FR')} carte${cards.length > 1 ? 's' : ''}`;

        if (shown.length < cards.length) {
          more.hidden = false;
          more.textContent = `Afficher ${Math.min(CARD_BATCH, cards.length - shown.length)} de plus`;
        } else {
          more.hidden = true;
        }
      }

      function buildDetail(family) {
        const stats = familyStats(family);
        const wrap = document.createElement('div');
        wrap.className = 'wm-family-detail';

        const top = document.createElement('div');
        top.className = 'wm-family-detail-top';

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'wm-family-link-button';
        back.textContent = '← Familles';
        back.addEventListener('click', () => {
          activeFamilyId = null;
          renderPageContent();
        });

        const actions = document.createElement('div');
        actions.className = 'wm-family-actions';

        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'wm-family-secondary';
        refresh.textContent = 'Actualiser';
        refresh.addEventListener('click', async () => {
          refresh.disabled = true;
          refresh.textContent = 'Actualisation…';

          try {
            const updated = await buildFamily({
              id: family.id,
              name: family.name,
              keyword: family.keyword
            }, (progress) => {
              const totalText = Number.isFinite(progress.total)
                ? ` / ${progress.total.toLocaleString('fr-FR')}`
                : '';
              refresh.textContent = `Cartes ${progress.loaded.toLocaleString('fr-FR')}${totalText}`;
            });

            saveFamily(updated);
            renderPageContent();
          } catch (error) {
            window.alert(String(error?.message || error));
            refresh.disabled = false;
            refresh.textContent = 'Actualiser';
          }
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'wm-family-danger';
        remove.textContent = 'Supprimer';
        remove.addEventListener('click', () => {
          if (!window.confirm(`Supprimer « ${family.name} » ?`)) return;
          removeFamily(family.id);
          activeFamilyId = null;
          renderPageContent();
        });

        actions.append(refresh, remove);
        top.append(back, actions);

        const heading = document.createElement('div');
        heading.className = 'wm-family-detail-head';

        const copy = document.createElement('div');
        const title = document.createElement('h1');
        title.textContent = family.name;

        const info = document.createElement('p');
        info.textContent = `Mot-clé : “${family.keyword}” • actualisée le ${formatDate(family.updatedAt)}`;

        copy.append(title, info);

        const progressCopy = document.createElement('strong');
        progressCopy.textContent = `${stats.percent} %`;

        heading.append(copy, progressCopy);

        const progress = document.createElement('div');
        progress.className = 'wm-family-progress is-large';
        const progressFill = document.createElement('span');
        progressFill.style.width = `${stats.percent}%`;
        progress.append(progressFill);

        const filters = document.createElement('div');
        filters.className = 'wm-family-filters';
        filters.innerHTML = `
          <button type="button" data-filter="all">Toutes <strong>${stats.total.toLocaleString('fr-FR')}</strong></button>
          <button type="button" data-filter="owned">Possédées <strong>${stats.owned.toLocaleString('fr-FR')}</strong></button>
          <button type="button" data-filter="missing">Manquantes <strong>${stats.missing.toLocaleString('fr-FR')}</strong></button>
        `;

        filters.querySelectorAll('[data-filter]').forEach((button) => {
          button.classList.toggle('is-active', button.dataset.filter === currentFilter);
          button.addEventListener('click', () => {
            currentFilter = button.dataset.filter || 'all';
            visibleCount = CARD_BATCH;
            filters.querySelectorAll('[data-filter]').forEach((item) => {
              item.classList.toggle('is-active', item === button);
            });
            renderDetailGrid(family, wrap);
          });
        });

        const toolbar = document.createElement('div');
        toolbar.className = 'wm-family-toolbar';
        toolbar.innerHTML = '<span data-role="count"></span>';

        const grid = document.createElement('div');
        grid.className = 'wm-family-results';
        grid.dataset.role = 'cards';

        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'wm-family-secondary wm-family-more';
        more.dataset.role = 'more';
        more.addEventListener('click', () => {
          visibleCount += CARD_BATCH;
          renderDetailGrid(family, wrap);
        });

        wrap.append(top, heading, progress, filters, toolbar, grid, more);
        requestAnimationFrame(() => renderDetailGrid(family, wrap));
        return wrap;
      }

      function buildPage() {
        const page = document.createElement('section');
        page.id = PAGE_ID;
        page.className = 'wm-family-page';

        const shell = document.createElement('div');
        shell.className = 'wm-family-shell';

        const content = document.createElement('div');
        content.dataset.role = 'page-content';

        shell.append(content);
        page.append(shell);
        return page;
      }

      function renderPageContent() {
        const page = document.getElementById(PAGE_ID);
        const content = page?.querySelector('[data-role="page-content"]');
        if (!content) return;

        const family = activeFamilyId ? getFamily(activeFamilyId) : null;

        if (activeFamilyId && !family) activeFamilyId = null;

        content.replaceChildren(
          family ? buildDetail(family) : buildHome()
        );
      }

      function ensurePage() {
        const enabled = runtime.settings.isEnabled('themeTracker');
        const active = enabled && isThemePage();
        document.documentElement.classList.toggle('wm-theme-route', active);

        if (!active) {
          document.getElementById(PAGE_ID)?.remove();
          return;
        }

        const main = document.querySelector('main');
        if (!main) return;

        let page = document.getElementById(PAGE_ID);

        if (!page) {
          page = buildPage();
          main.append(page);
          renderPageContent();
        } else if (page.parentElement !== main) {
          main.append(page);
        }
      }

      function closeModal(overlay) {
        overlay?.remove();
      }

      function openCreateModal() {
        if (document.querySelector('.wm-family-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'wm-family-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-family-modal';

        const title = document.createElement('h2');
        title.textContent = 'Ajouter une famille';

        const description = document.createElement('p');
        description.textContent = 'Le mot-clé est recherché dans les cartes WikiMasters.';

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Nom';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Ex. K-pop';

        const keywordLabel = document.createElement('label');
        keywordLabel.textContent = 'Mot-clé';
        const keywordInput = document.createElement('input');
        keywordInput.type = 'text';
        keywordInput.placeholder = 'Ex. kpop';

        nameLabel.append(nameInput);
        keywordLabel.append(keywordInput);

        const status = document.createElement('div');
        status.className = 'wm-family-modal-status';
        status.textContent = 'Vérifie le mot-clé avant de créer la famille.';

        const actions = document.createElement('div');
        actions.className = 'wm-family-modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'wm-family-secondary';
        cancel.textContent = 'Annuler';

        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'wm-family-secondary';
        preview.textContent = 'Vérifier';

        const create = document.createElement('button');
        create.type = 'button';
        create.className = 'wm-family-primary';
        create.textContent = 'Créer';
        create.disabled = true;

        let checkedKeyword = '';

        const resetPreview = () => {
          checkedKeyword = '';
          create.disabled = true;
          status.dataset.mode = '';
          status.textContent = 'Vérifie le mot-clé avant de créer la famille.';
        };

        keywordInput.addEventListener('input', resetPreview);

        preview.addEventListener('click', async () => {
          const keyword = keywordInput.value.trim();
          if (!keyword) {
            status.dataset.mode = 'error';
            status.textContent = 'Entre un mot-clé.';
            return;
          }

          preview.disabled = true;
          status.dataset.mode = '';
          status.textContent = 'Recherche…';

          try {
            const result = await previewKeyword(keyword);

            if (result.total > MAX_RESULTS) {
              checkedKeyword = '';
              create.disabled = true;
              status.dataset.mode = 'error';
              status.textContent = `${result.total.toLocaleString('fr-FR')} résultats : mot-clé trop large. Affine la recherche.`;
            } else if (!result.total) {
              checkedKeyword = '';
              create.disabled = true;
              status.dataset.mode = 'error';
              status.textContent = 'Aucune carte trouvée.';
            } else {
              checkedKeyword = keyword;
              create.disabled = false;
              status.dataset.mode = 'success';
              status.textContent = result.exact
                ? `${result.total.toLocaleString('fr-FR')} cartes trouvées.`
                : `Au moins ${result.total.toLocaleString('fr-FR')} cartes trouvées.`;

              if (!nameInput.value.trim()) {
                nameInput.value = keyword.charAt(0).toUpperCase() + keyword.slice(1);
              }
            }
          } catch (error) {
            checkedKeyword = '';
            create.disabled = true;
            status.dataset.mode = 'error';
            status.textContent = `Erreur : ${String(error?.message || error)}`;
          } finally {
            preview.disabled = false;
          }
        });

        create.addEventListener('click', async () => {
          const keyword = keywordInput.value.trim();
          const name = nameInput.value.trim() || keyword;

          if (!keyword || keyword !== checkedKeyword) {
            status.dataset.mode = 'error';
            status.textContent = 'Vérifie à nouveau ce mot-clé.';
            create.disabled = true;
            return;
          }

          create.disabled = true;
          preview.disabled = true;
          cancel.disabled = true;

          try {
            const family = await buildFamily({ name, keyword }, (progress) => {
              const total = Number.isFinite(progress.total)
                ? ` / ${progress.total.toLocaleString('fr-FR')}`
                : '';
              status.dataset.mode = '';
              status.textContent = `Cartes : ${progress.loaded.toLocaleString('fr-FR')}${total}`;
            });

            saveFamily(family);
            activeFamilyId = family.id;
            currentFilter = 'all';
            visibleCount = CARD_BATCH;
            closeModal(overlay);
            renderPageContent();
          } catch (error) {
            status.dataset.mode = 'error';
            status.textContent = String(error?.message || error);
            create.disabled = false;
            preview.disabled = false;
            cancel.disabled = false;
          }
        });

        cancel.addEventListener('click', () => closeModal(overlay));
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) closeModal(overlay);
        });

        actions.append(cancel, preview, create);
        modal.append(title, description, nameLabel, keywordLabel, status, actions);
        overlay.append(modal);
        document.body.append(overlay);
        nameInput.focus();
      }

      function render() {
        ensureNavLink();
        ensurePage();
      }

      return {
        render,
        isThemePage
      };
    }
  };
})();