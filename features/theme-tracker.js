(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.themeTracker = {
    create(runtime) {
      const {
        ALL_COLLECTION_KEY,
        storageGet,
        registerCards
      } = runtime.core;

      const PAGE_ID = 'wm-theme-tracker-page';
      const NAV_ID = 'wm-theme-tracker-nav';
      const RECENT_KEY = 'wm_theme_recent_v1';
      const RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C'];

      const THEME_SYNONYMS = {
        animal: [
          'animal', 'animaux', 'mammifere', 'mammiferes', 'mammal', 'oiseau', 'oiseaux',
          'poisson', 'poissons', 'reptile', 'reptiles', 'amphibien', 'amphibiens',
          'insecte', 'insectes', 'arachnide', 'arachnides', 'mollusque', 'mollusques',
          'crustace', 'crustaces', 'primate', 'primates', 'felin', 'felins', 'canide',
          'canides', 'equide', 'equides', 'bovin', 'bovins', 'chien', 'chiens', 'chat',
          'chats', 'lion', 'tigre', 'panthere', 'leopard', 'loup', 'renard', 'ours',
          'cheval', 'zebre', 'girafe', 'elephant', 'rhinoceros', 'hippopotame', 'singe',
          'gorille', 'requin', 'baleine', 'dauphin', 'orque', 'tortue', 'serpent',
          'crocodile', 'aigle', 'faucon', 'hibou', 'papillon', 'abeille'
        ],
        animaux: ['animal'],
        chateau: ['chateau', 'chateaux', 'forteresse', 'citadelle', 'palais', 'donjon'],
        chateaux: ['chateau'],
        voiture: ['voiture', 'voitures', 'automobile', 'automobiles', 'vehicule', 'vehicules', 'auto'],
        voitures: ['voiture'],
        espace: ['espace', 'astronomie', 'planete', 'planetes', 'etoile', 'etoiles', 'galaxie', 'galaxies', 'satellite', 'cosmos'],
        astronomie: ['espace'],
        dinosaure: ['dinosaure', 'dinosaures', 'theropode', 'sauropode', 'ceratopsien'],
        dinosaures: ['dinosaure'],
        mythologie: ['mythologie', 'mythologique', 'dieu', 'deesse', 'divinite', 'legende'],
        musique: ['musique', 'musicien', 'musicienne', 'chanteur', 'chanteuse', 'compositeur', 'groupe musical'],
        sport: ['sport', 'sportif', 'sportive', 'football', 'tennis', 'basketball', 'rugby', 'cyclisme']
      };

      let catalogueCards = [];
      let catalogueComplete = false;
      let ownedCards = [];
      let marketplaceListings = [];
      let marketplaceAvailable = null;
      let currentRows = [];
      let currentFilter = 'all';
      let currentSort = 'relevance';
      let searchGeneration = 0;

      function isThemePage() {
        if (location.pathname !== '/global-collection') return false;
        try {
          return new URLSearchParams(location.search).get('wm') === 'themes';
        } catch (_) {
          return false;
        }
      }

      function normalizeSearch(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('fr')
          .replace(/[’']/g, "'")
          .replace(/[^a-z0-9' -]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function expandTheme(query) {
        const normalized = normalizeSearch(query);
        const words = new Set([normalized, ...normalized.split(' ').filter((word) => word.length >= 3)]);
        const queue = [...words];

        while (queue.length) {
          const word = queue.shift();
          for (const synonym of THEME_SYNONYMS[word] || []) {
            const clean = normalizeSearch(synonym);
            if (!clean || words.has(clean)) continue;
            words.add(clean);
            queue.push(clean);
          }
        }

        return [...words].filter(Boolean);
      }

      function getRecentThemes() {
        try {
          const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
          return Array.isArray(value) ? value.filter(Boolean).slice(0, 6) : [];
        } catch (_) {
          return [];
        }
      }

      function saveRecentTheme(query) {
        const clean = String(query || '').trim();
        if (!clean) return;
        const next = [clean, ...getRecentThemes().filter((item) => normalizeSearch(item) !== normalizeSearch(clean))].slice(0, 6);
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch (_) {}
      }

      function createIcon() {
        const wrap = document.createElement('span');
        wrap.className = 'flex shrink-0 items-center justify-center wm-theme-nav-icon';
        wrap.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"></path>
            <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"></path>
            <path d="M5 13l.8 1.7L7.5 15l-1.7.8L5 17.5l-.8-1.7L2.5 15l1.7-.8L5 13z"></path>
          </svg>`;
        return wrap;
      }

      function ensureNavLink() {
        if (!runtime.settings.isEnabled('themeTracker')) {
          document.getElementById(NAV_ID)?.remove();
          return;
        }

        let link = document.getElementById(NAV_ID);
        if (!link) {
          const collectionLink = document.querySelector('nav a[href="/collection"]');
          const globalLink = document.querySelector('nav a[href="/global-collection"]');
          const anchor = collectionLink || globalLink;
          if (!anchor?.parentElement) return;

          link = document.createElement('a');
          link.id = NAV_ID;
          link.href = '/global-collection?wm=themes';
          link.className = 'wm-theme-nav-link flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200';
          link.title = 'Fonction ajoutée par WikiMastersTools';

          const label = document.createElement('span');
          label.className = 'wm-theme-nav-label';
          label.textContent = 'Collections thématiques';

          const badge = document.createElement('span');
          badge.className = 'wm-theme-nav-badge';
          badge.textContent = 'EXT';

          link.append(createIcon(), label, badge);
          anchor.insertAdjacentElement('afterend', link);
        }

        link.classList.toggle('is-active', isThemePage());
        if (isThemePage()) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }

      function setStatus(text, mode = 'normal') {
        const status = document.querySelector(`#${PAGE_ID} [data-role="status"]`);
        if (!status) return;
        status.textContent = text || '';
        status.dataset.mode = mode;
      }

      function updateProgress(loaded) {
        if (!isThemePage()) return;
        if (loaded > 0) setStatus(`Chargement du catalogue… ${loaded.toLocaleString('fr-FR')} cartes`);
      }

      function buildPage() {
        const page = document.createElement('section');
        page.id = PAGE_ID;
        page.className = 'wm-theme-tracker-page';
        page.innerHTML = `
          <div class="wm-theme-shell">
            <header class="wm-theme-hero">
              <div class="wm-theme-hero-copy">
                <div class="wm-theme-kicker"><span>WikiMastersTools</span><strong>EXTENSION</strong></div>
                <h1>Collections thématiques</h1>
                <p>Trouve toutes les cartes autour d’un thème, vois celles que tu possèdes, celles qu’il te manque et celles disponibles sur le marché.</p>
              </div>
              <div class="wm-theme-hero-orb" aria-hidden="true">✦</div>
            </header>

            <form class="wm-theme-search" data-role="search-form">
              <div class="wm-theme-search-box">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
                <input data-role="search-input" type="search" autocomplete="off" placeholder="Ex. animaux, châteaux, voitures, espace…" aria-label="Rechercher un thème">
                <button type="submit">Explorer</button>
              </div>
              <div class="wm-theme-suggestions" data-role="suggestions"></div>
            </form>

            <div class="wm-theme-status" data-role="status">Le catalogue se prépare en arrière-plan…</div>

            <section class="wm-theme-dashboard is-hidden" data-role="dashboard">
              <div class="wm-theme-summary-head">
                <div>
                  <span class="wm-theme-eyebrow">Collection</span>
                  <h2 data-role="theme-title">—</h2>
                </div>
                <div class="wm-theme-progress-copy"><strong data-role="progress-value">0 %</strong><span>complétée</span></div>
              </div>
              <div class="wm-theme-progress"><span data-role="progress-bar"></span></div>

              <div class="wm-theme-stats">
                <button type="button" class="wm-theme-stat is-active" data-filter="all"><span>Toutes</span><strong data-role="count-all">0</strong></button>
                <button type="button" class="wm-theme-stat" data-filter="owned"><span>Possédées</span><strong data-role="count-owned">0</strong></button>
                <button type="button" class="wm-theme-stat" data-filter="missing"><span>Manquantes</span><strong data-role="count-missing">0</strong></button>
                <button type="button" class="wm-theme-stat" data-filter="market"><span>En vente</span><strong data-role="count-market">—</strong></button>
              </div>

              <div class="wm-theme-toolbar">
                <span data-role="result-copy">0 carte</span>
                <label>Trier
                  <select data-role="sort">
                    <option value="relevance">Pertinence</option>
                    <option value="rarity">Rareté</option>
                    <option value="title">Nom</option>
                    <option value="market">Prix marché</option>
                  </select>
                </label>
              </div>

              <div class="wm-theme-grid" data-role="grid"></div>
              <div class="wm-theme-empty is-hidden" data-role="empty">Aucune carte dans ce filtre.</div>
            </section>
          </div>`;

        const form = page.querySelector('[data-role="search-form"]');
        const input = page.querySelector('[data-role="search-input"]');
        const suggestions = page.querySelector('[data-role="suggestions"]');

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          runSearch(input.value);
        });

        page.querySelectorAll('[data-filter]').forEach((button) => {
          button.addEventListener('click', () => {
            currentFilter = button.dataset.filter || 'all';
            page.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
            renderRows();
          });
        });

        page.querySelector('[data-role="sort"]').addEventListener('change', (event) => {
          currentSort = event.target.value || 'relevance';
          renderRows();
        });

        const presets = ['Animaux', 'Châteaux', 'Automobiles', 'Espace', 'Dinosaures'];
        const values = [...new Set([...getRecentThemes(), ...presets])].slice(0, 8);
        values.forEach((value) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'wm-theme-chip';
          chip.textContent = value;
          chip.addEventListener('click', () => {
            input.value = value;
            runSearch(value);
          });
          suggestions.append(chip);
        });

        return page;
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
          primeData();
        } else if (page.parentElement !== main) {
          main.append(page);
        }
      }

      function mergeCatalogue(cards) {
        if (!Array.isArray(cards) || !cards.length) return;
        const merged = new Map(catalogueCards.map((card) => [card.id, card]));
        for (const card of cards) {
          if (!card?.id || !card?.title) continue;
          const previous = merged.get(card.id) || {};
          merged.set(card.id, { ...previous, ...card });
        }
        catalogueCards = [...merged.values()];
        registerCards(catalogueCards);
      }

      function requestBridge(eventName, resultName, detail = {}, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
          const requestId = `${eventName}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          let timer = null;

          const handler = (event) => {
            if (event.detail?.requestId !== requestId) return;
            clearTimeout(timer);
            window.removeEventListener(resultName, handler);
            resolve(event.detail || {});
          };

          window.addEventListener(resultName, handler);
          timer = setTimeout(() => {
            window.removeEventListener(resultName, handler);
            reject(new Error('Délai dépassé'));
          }, timeoutMs);

          window.dispatchEvent(new CustomEvent(eventName, {
            detail: { ...detail, requestId }
          }));
        });
      }

      async function loadCatalogue(force = false) {
        if (catalogueComplete && catalogueCards.length && !force) return catalogueCards;

        const result = await requestBridge(
          'wm-average-theme-load-catalogue',
          'wm-average-theme-catalogue-result',
          {},
          45000
        );

        if (!result.ok) throw new Error(result.error || 'Catalogue indisponible');
        mergeCatalogue(result.cards);
        catalogueComplete = result.complete !== false;
        return catalogueCards;
      }

      async function loadOwnedCollection() {
        const stored = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];
        if (stored?.complete === true && Array.isArray(stored.cards)) {
          ownedCards = stored.cards;
          registerCards(ownedCards);
          return ownedCards;
        }

        const result = await requestBridge(
          'wm-average-load-all-collection',
          'wm-average-all-collection',
          { selectedRarities: [] },
          45000
        );

        if (!result.ok) throw new Error(result.error || 'Collection indisponible');
        ownedCards = Array.isArray(result.cards) ? result.cards : [];
        registerCards(ownedCards);
        return ownedCards;
      }

      async function loadMarketplace() {
        const result = await requestBridge(
          'wm-average-theme-load-marketplace',
          'wm-average-theme-marketplace-result',
          {},
          30000
        );

        marketplaceAvailable = Boolean(result.ok);
        marketplaceListings = result.ok && Array.isArray(result.listings) ? result.listings : [];
        return marketplaceListings;
      }

      async function primeData() {
        if (!isThemePage()) return;
        try {
          await loadCatalogue(false);
          setStatus(`${catalogueCards.length.toLocaleString('fr-FR')} cartes prêtes • cherche un thème`);
        } catch (error) {
          if (catalogueCards.length) {
            setStatus(`${catalogueCards.length.toLocaleString('fr-FR')} cartes déjà détectées • catalogue complet indisponible`, 'warning');
          } else {
            setStatus(`Catalogue indisponible : ${String(error?.message || error)}`, 'warning');
          }
        }
      }

      function scoreCard(card, query, keywords) {
        const title = normalizeSearch(card.title);
        const summary = normalizeSearch(card.summary);
        const normalizedQuery = normalizeSearch(query);
        let score = 0;

        if (title === normalizedQuery) score += 250;
        else if (title.startsWith(normalizedQuery)) score += 140;
        else if (title.includes(normalizedQuery)) score += 100;
        if (summary.includes(normalizedQuery)) score += 42;

        for (const keyword of keywords) {
          if (keyword.length < 3) continue;
          if (title === keyword) score += 70;
          else if (title.includes(keyword)) score += 24;
          if (summary.includes(keyword)) score += 7;
        }

        return score;
      }

      function buildRows(query) {
        const keywords = expandTheme(query);
        const ownedById = new Map(ownedCards.map((card) => [card.id, card]));
        const marketById = new Map();

        for (const listing of marketplaceListings) {
          if (!listing?.cardId) continue;
          const list = marketById.get(listing.cardId) || [];
          list.push(listing);
          marketById.set(listing.cardId, list);
        }

        return catalogueCards
          .map((card) => {
            const score = scoreCard(card, query, keywords);
            if (score <= 0) return null;
            const owned = ownedById.get(card.id) || null;
            const listings = marketById.get(card.id) || [];
            const prices = listings.map((item) => Number(item.amount)).filter(Number.isFinite);
            return {
              ...card,
              score,
              owned: Boolean(owned),
              ownedCount: Number(owned?.count) || (owned ? 1 : 0),
              listings,
              marketCount: listings.length,
              marketMin: prices.length ? Math.min(...prices) : null
            };
          })
          .filter(Boolean);
      }

      function rarityRank(rarity) {
        const index = RARITY_ORDER.indexOf(rarity);
        return index < 0 ? 999 : index;
      }

      function filteredRows() {
        let rows = currentRows.filter((row) => {
          if (currentFilter === 'owned') return row.owned;
          if (currentFilter === 'missing') return !row.owned;
          if (currentFilter === 'market') return row.marketCount > 0;
          return true;
        });

        rows = [...rows].sort((a, b) => {
          if (currentSort === 'title') return a.title.localeCompare(b.title, 'fr');
          if (currentSort === 'rarity') {
            const diff = rarityRank(a.rarity) - rarityRank(b.rarity);
            return diff || a.title.localeCompare(b.title, 'fr');
          }
          if (currentSort === 'market') {
            const pa = Number.isFinite(a.marketMin) ? a.marketMin : Infinity;
            const pb = Number.isFinite(b.marketMin) ? b.marketMin : Infinity;
            return pa - pb || b.score - a.score;
          }
          return b.score - a.score || a.title.localeCompare(b.title, 'fr');
        });

        return rows;
      }

      function createResultCard(row) {
        const card = document.createElement('article');
        card.className = `wm-theme-card ${row.owned ? 'is-owned' : 'is-missing'} ${row.marketCount ? 'is-market' : ''}`;

        const visual = document.createElement('div');
        visual.className = 'wm-theme-card-visual';
        if (row.imageUrl) {
          const image = document.createElement('img');
          image.src = row.imageUrl;
          image.alt = '';
          image.loading = 'lazy';
          visual.append(image);
        } else {
          const fallback = document.createElement('div');
          fallback.className = 'wm-theme-card-fallback';
          fallback.textContent = '✦';
          visual.append(fallback);
        }

        const badges = document.createElement('div');
        badges.className = 'wm-theme-card-badges';
        if (row.rarity) {
          const rarity = document.createElement('span');
          rarity.className = `wm-theme-rarity wm-theme-rarity-${String(row.rarity).toLowerCase()}`;
          rarity.textContent = row.rarity;
          badges.append(rarity);
        }
        const state = document.createElement('span');
        state.className = `wm-theme-state ${row.owned ? 'is-owned' : 'is-missing'}`;
        state.textContent = row.owned ? `✓ Possédée${row.ownedCount > 1 ? ` ×${row.ownedCount}` : ''}` : 'Manquante';
        badges.append(state);
        visual.append(badges);

        const body = document.createElement('div');
        body.className = 'wm-theme-card-body';
        const title = document.createElement('h3');
        title.textContent = row.title;
        body.append(title);

        const footer = document.createElement('div');
        footer.className = 'wm-theme-card-footer';
        if (row.marketCount > 0) {
          const market = document.createElement('span');
          market.className = 'wm-theme-market-pill';
          const price = Number.isFinite(row.marketMin) ? ` • dès ${Math.round(row.marketMin).toLocaleString('fr-FR')} W` : '';
          market.textContent = `${row.marketCount} en vente${price}`;
          footer.append(market);
        } else {
          const market = document.createElement('span');
          market.className = 'wm-theme-market-empty';
          market.textContent = marketplaceAvailable === false ? 'Marché non chargé' : 'Pas en vente';
          footer.append(market);
        }
        body.append(footer);
        card.append(visual, body);
        return card;
      }

      function renderRows() {
        const page = document.getElementById(PAGE_ID);
        if (!page) return;
        const grid = page.querySelector('[data-role="grid"]');
        const empty = page.querySelector('[data-role="empty"]');
        const resultCopy = page.querySelector('[data-role="result-copy"]');
        if (!grid || !empty) return;

        const rows = filteredRows();
        grid.replaceChildren();
        const fragment = document.createDocumentFragment();
        rows.forEach((row) => fragment.append(createResultCard(row)));
        grid.append(fragment);

        empty.classList.toggle('is-hidden', rows.length > 0);
        resultCopy.textContent = `${rows.length.toLocaleString('fr-FR')} carte${rows.length > 1 ? 's' : ''}`;
      }

      function updateDashboard(query) {
        const page = document.getElementById(PAGE_ID);
        if (!page) return;
        const dashboard = page.querySelector('[data-role="dashboard"]');
        dashboard.classList.remove('is-hidden');

        const total = currentRows.length;
        const owned = currentRows.filter((row) => row.owned).length;
        const missing = Math.max(0, total - owned);
        const market = currentRows.filter((row) => row.marketCount > 0).length;
        const percent = total ? Math.round((owned / total) * 100) : 0;

        page.querySelector('[data-role="theme-title"]').textContent = query;
        page.querySelector('[data-role="progress-value"]').textContent = `${percent} %`;
        page.querySelector('[data-role="progress-bar"]').style.width = `${percent}%`;
        page.querySelector('[data-role="count-all"]').textContent = total.toLocaleString('fr-FR');
        page.querySelector('[data-role="count-owned"]').textContent = owned.toLocaleString('fr-FR');
        page.querySelector('[data-role="count-missing"]').textContent = missing.toLocaleString('fr-FR');
        page.querySelector('[data-role="count-market"]').textContent = marketplaceAvailable === false ? '—' : market.toLocaleString('fr-FR');

        renderRows();
      }

      async function runSearch(rawQuery) {
        const query = String(rawQuery || '').trim();
        if (!query || !isThemePage()) return;
        const generation = ++searchGeneration;
        currentFilter = 'all';
        saveRecentTheme(query);

        const page = document.getElementById(PAGE_ID);
        page?.querySelectorAll('[data-filter]').forEach((button) => {
          button.classList.toggle('is-active', button.dataset.filter === 'all');
        });

        setStatus(`Recherche de « ${query} »…`);

        const [catalogueResult, ownedResult, marketResult] = await Promise.allSettled([
          loadCatalogue(false),
          loadOwnedCollection(),
          loadMarketplace()
        ]);

        if (generation !== searchGeneration) return;
        if (catalogueResult.status === 'rejected' && !catalogueCards.length) {
          setStatus(`Impossible de charger le catalogue : ${String(catalogueResult.reason?.message || catalogueResult.reason)}`, 'error');
          return;
        }
        if (ownedResult.status === 'rejected') ownedCards = [];
        if (marketResult.status === 'rejected') {
          marketplaceAvailable = false;
          marketplaceListings = [];
        }

        currentRows = buildRows(query);
        updateDashboard(query);

        const pieces = [
          `${currentRows.length.toLocaleString('fr-FR')} cartes trouvées`,
          `${currentRows.filter((row) => row.owned).length.toLocaleString('fr-FR')} possédées`
        ];
        if (marketplaceAvailable !== false) {
          pieces.push(`${currentRows.filter((row) => row.marketCount > 0).length.toLocaleString('fr-FR')} en vente`);
        } else {
          pieces.push('marché indisponible');
        }
        if (!catalogueComplete) pieces.push('catalogue partiel');
        setStatus(pieces.join(' • '), catalogueComplete ? 'success' : 'warning');
      }

      window.addEventListener('wm-average-global-catalogue', (event) => {
        mergeCatalogue(event.detail?.cards);
      });

      window.addEventListener('wm-average-theme-catalogue-progress', (event) => {
        if (event.detail?.loaded) updateProgress(Number(event.detail.loaded));
      });

      function render() {
        ensureNavLink();
        ensurePage();
      }

      return { render, isThemePage, runSearch };
    }
  };
})();