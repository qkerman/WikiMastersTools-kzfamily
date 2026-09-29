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
      const RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C'];

      const CATEGORIES = [
        {
          key: 'animaux',
          label: 'Animaux',
          icon: '🐾',
          description: 'Faune, espèces, oiseaux, poissons, insectes…',
          terms: [
            'animal', 'animaux', 'mammifere', 'mammiferes', 'oiseau', 'oiseaux', 'poisson',
            'poissons', 'reptile', 'reptiles', 'amphibien', 'amphibiens', 'insecte', 'insectes',
            'arachnide', 'arachnides', 'mollusque', 'mollusques', 'crustace', 'crustaces',
            'felin', 'felins', 'canide', 'canides', 'primate', 'primates', 'chien', 'chiens',
            'chat', 'chats', 'lion', 'tigre', 'panthere', 'leopard', 'guepard', 'lynx', 'loup',
            'renard', 'ours', 'panda', 'cheval', 'zebre', 'girafe', 'elephant', 'rhinoceros',
            'hippopotame', 'singe', 'gorille', 'chimpanze', 'requin', 'baleine', 'dauphin',
            'orque', 'tortue', 'serpent', 'crocodile', 'aigle', 'faucon', 'hibou', 'chouette',
            'papillon', 'abeille', 'fourmi', 'scarabee', 'araignee', 'pieuvre', 'poulpe'
          ]
        },
        {
          key: 'chateaux',
          label: 'Châteaux',
          icon: '🏰',
          description: 'Châteaux, palais, forteresses et citadelles.',
          terms: ['chateau', 'chateaux', 'forteresse', 'forteresses', 'citadelle', 'citadelles', 'palais', 'donjon']
        },
        {
          key: 'automobiles',
          label: 'Automobiles',
          icon: '🏎️',
          description: 'Voitures, marques et modèles automobiles.',
          terms: ['voiture', 'voitures', 'automobile', 'automobiles', 'vehicule', 'vehicules', 'ferrari', 'porsche', 'bugatti', 'lamborghini']
        },
        {
          key: 'espace',
          label: 'Espace',
          icon: '🪐',
          description: 'Astronomie, planètes, étoiles et exploration spatiale.',
          terms: ['espace', 'astronomie', 'planete', 'planetes', 'etoile', 'etoiles', 'galaxie', 'galaxies', 'satellite', 'cosmos', 'nebuleuse', 'lune']
        },
        {
          key: 'dinosaures',
          label: 'Dinosaures',
          icon: '🦖',
          description: 'Dinosaures et espèces préhistoriques.',
          terms: ['dinosaure', 'dinosaures', 'tyrannosaure', 'triceratops', 'velociraptor', 'sauropode', 'theropode', 'ceratopsien']
        },
        {
          key: 'sport',
          label: 'Sport',
          icon: '🏆',
          description: 'Sports, athlètes et grandes compétitions.',
          terms: ['sport', 'sportif', 'sportive', 'football', 'tennis', 'basketball', 'rugby', 'cyclisme', 'athlete', 'athletisme']
        },
        {
          key: 'musique',
          label: 'Musique',
          icon: '🎵',
          description: 'Artistes, groupes, instruments et compositeurs.',
          terms: ['musique', 'musicien', 'musicienne', 'chanteur', 'chanteuse', 'compositeur', 'groupe musical', 'album', 'instrument']
        },
        {
          key: 'mythologie',
          label: 'Mythologie',
          icon: '⚡',
          description: 'Dieux, déesses, héros et créatures mythologiques.',
          terms: ['mythologie', 'mythologique', 'dieu', 'deesse', 'divinite', 'legende', 'mythe']
        }
      ];

      let catalogueCards = [];
      let catalogueComplete = false;
      let catalogueSource = 'none';
      let ownedCards = [];
      let currentRows = [];
      let currentFilter = 'all';
      let currentSort = 'relevance';
      let currentCategory = null;
      let searchGeneration = 0;

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
          .replace(/[’']/g, "'")
          .replace(/[^a-z0-9' -]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
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
        if (!isThemePage() || !loaded) return;
        setStatus(`Chargement du répertoire… ${loaded.toLocaleString('fr-FR')} cartes`);
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
                <p>Parcours les cartes par catégorie et vois immédiatement celles que tu possèdes et celles qu’il te manque.</p>
              </div>
              <div class="wm-theme-hero-orb" aria-hidden="true">✦</div>
            </header>

            <section class="wm-theme-categories-section">
              <div class="wm-theme-section-heading">
                <div>
                  <span class="wm-theme-eyebrow">Répertoire</span>
                  <h2>Choisis une catégorie</h2>
                </div>
              </div>
              <div class="wm-theme-categories" data-role="categories"></div>
            </section>

            <form class="wm-theme-search" data-role="search-form">
              <div class="wm-theme-search-box">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
                <input data-role="search-input" type="search" autocomplete="off" placeholder="Ou cherche un autre thème…" aria-label="Rechercher un thème">
                <button type="submit">Explorer</button>
              </div>
            </form>

            <div class="wm-theme-status" data-role="status">Préparation du répertoire…</div>

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
              </div>

              <div class="wm-theme-toolbar">
                <span data-role="result-copy">0 carte</span>
                <label>Trier
                  <select data-role="sort">
                    <option value="relevance">Pertinence</option>
                    <option value="rarity">Rareté</option>
                    <option value="title">Nom</option>
                  </select>
                </label>
              </div>

              <div class="wm-theme-grid" data-role="grid"></div>
              <div class="wm-theme-empty is-hidden" data-role="empty">Aucune carte dans ce filtre.</div>
            </section>
          </div>`;

        const categories = page.querySelector('[data-role="categories"]');

        for (const category of CATEGORIES) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'wm-theme-category';
          button.dataset.category = category.key;

          const icon = document.createElement('span');
          icon.className = 'wm-theme-category-icon';
          icon.textContent = category.icon;

          const copy = document.createElement('span');
          copy.className = 'wm-theme-category-copy';

          const title = document.createElement('strong');
          title.textContent = category.label;

          const description = document.createElement('span');
          description.textContent = category.description;

          copy.append(title, description);
          button.append(icon, copy);

          button.addEventListener('click', () => runCategory(category));
          categories.append(button);
        }

        const form = page.querySelector('[data-role="search-form"]');
        const input = page.querySelector('[data-role="search-input"]');

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const query = String(input.value || '').trim();
          if (query) runSearch(query);
        });

        page.querySelectorAll('[data-filter]').forEach((button) => {
          button.addEventListener('click', () => {
            currentFilter = button.dataset.filter || 'all';
            page.querySelectorAll('[data-filter]').forEach((item) => {
              item.classList.toggle('is-active', item === button);
            });
            renderRows();
          });
        });

        page.querySelector('[data-role="sort"]').addEventListener('change', (event) => {
          currentSort = event.target.value || 'relevance';
          renderRows();
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

        const merged = new Map(
          catalogueCards.map((card) => [normalize(card.title) || card.id, { ...card }])
        );

        for (const card of cards) {
          if (!card?.title) continue;
          const key = normalize(card.title) || card.id;
          const previous = merged.get(key) || {};

          merged.set(key, {
            ...previous,
            ...card,
            id: card.id || previous.id || `title:${key}`,
            rarity: card.rarity || previous.rarity || null,
            imageUrl: card.imageUrl || previous.imageUrl || null,
            summary: card.summary || previous.summary || ''
          });
        }

        catalogueCards = [...merged.values()];
        registerCards(catalogueCards.filter((card) => card.id && card.title));
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
        if (catalogueCards.length && !force) return catalogueCards;

        const result = await requestBridge(
          'wm-average-theme-load-catalogue',
          'wm-average-theme-catalogue-result',
          {},
          45000
        );

        if (!result.ok) throw new Error(result.error || 'Catalogue indisponible');

        mergeCatalogue(result.cards);
        catalogueComplete = result.complete === true;
        catalogueSource = result.source || 'unknown';

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

      async function primeData() {
        if (!isThemePage()) return;

        try {
          await Promise.allSettled([loadCatalogue(false), loadOwnedCollection()]);

          if (catalogueCards.length) {
            const suffix = catalogueComplete
              ? 'répertoire prêt'
              : catalogueSource === 'page'
                ? 'répertoire détecté depuis « Toutes les cartes »'
                : 'répertoire partiel';

            setStatus(
              `${catalogueCards.length.toLocaleString('fr-FR')} cartes disponibles • ${suffix}`,
              catalogueComplete ? 'success' : 'normal'
            );
          } else {
            setStatus('Impossible de préparer le répertoire des cartes.', 'error');
          }
        } catch (error) {
          setStatus(`Impossible de préparer le répertoire : ${String(error?.message || error)}`, 'error');
        }
      }

      function termsForQuery(query) {
        const normalized = normalize(query);
        return [...new Set([
          normalized,
          ...normalized.split(' ').filter((word) => word.length >= 3)
        ])].filter(Boolean);
      }

      function scoreCard(card, terms, exactQuery = '') {
        const title = normalize(card.title);
        const summary = normalize(card.summary);
        const query = normalize(exactQuery);
        let score = 0;

        if (query) {
          if (title === query) score += 260;
          else if (title.startsWith(query)) score += 150;
          else if (title.includes(query)) score += 105;

          if (summary.includes(query)) score += 45;
        }

        for (const term of terms) {
          if (!term || term.length < 3) continue;

          if (title === term) score += 85;
          else if (title.includes(term)) score += 28;

          if (summary.includes(term)) score += 8;
        }

        return score;
      }

      function ownershipMaps() {
        const byId = new Map();
        const byTitle = new Map();

        for (const card of ownedCards) {
          if (card?.id) byId.set(card.id, card);
          if (card?.title) byTitle.set(normalize(card.title), card);
        }

        return { byId, byTitle };
      }

      function buildRows(terms, query = '') {
        const { byId, byTitle } = ownershipMaps();

        return catalogueCards
          .map((card) => {
            const score = scoreCard(card, terms, query);
            if (score <= 0) return null;

            const owned =
              (card.id ? byId.get(card.id) : null) ||
              byTitle.get(normalize(card.title)) ||
              null;

            return {
              ...card,
              score,
              owned: Boolean(owned),
              ownedCount: Number(owned?.count) || (owned ? 1 : 0)
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
          return true;
        });

        rows = [...rows].sort((a, b) => {
          if (currentSort === 'title') return a.title.localeCompare(b.title, 'fr');

          if (currentSort === 'rarity') {
            const diff = rarityRank(a.rarity) - rarityRank(b.rarity);
            return diff || a.title.localeCompare(b.title, 'fr');
          }

          return b.score - a.score || a.title.localeCompare(b.title, 'fr');
        });

        return rows;
      }

      function createResultCard(row) {
        const card = document.createElement('article');
        card.className = `wm-theme-card ${row.owned ? 'is-owned' : 'is-missing'}`;

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
        state.textContent = row.owned
          ? `✓ Possédée${row.ownedCount > 1 ? ` ×${row.ownedCount}` : ''}`
          : 'Manquante';
        badges.append(state);
        visual.append(badges);

        const body = document.createElement('div');
        body.className = 'wm-theme-card-body';

        const title = document.createElement('h3');
        title.textContent = row.title;

        const ownership = document.createElement('span');
        ownership.className = `wm-theme-ownership-copy ${row.owned ? 'is-owned' : 'is-missing'}`;
        ownership.textContent = row.owned ? 'Dans ta collection' : 'À obtenir';

        body.append(title, ownership);
        card.append(visual, body);

        return card;
      }

      function renderRows() {
        const page = document.getElementById(PAGE_ID);
        if (!page) return;

        const grid = page.querySelector('[data-role="grid"]');
        const empty = page.querySelector('[data-role="empty"]');
        const resultCopy = page.querySelector('[data-role="result-copy"]');
        if (!grid || !empty || !resultCopy) return;

        const rows = filteredRows();
        grid.replaceChildren();

        const fragment = document.createDocumentFragment();
        rows.forEach((row) => fragment.append(createResultCard(row)));
        grid.append(fragment);

        empty.classList.toggle('is-hidden', rows.length > 0);
        resultCopy.textContent = `${rows.length.toLocaleString('fr-FR')} carte${rows.length > 1 ? 's' : ''}`;
      }

      function updateDashboard(label) {
        const page = document.getElementById(PAGE_ID);
        if (!page) return;

        const dashboard = page.querySelector('[data-role="dashboard"]');
        dashboard.classList.remove('is-hidden');

        const total = currentRows.length;
        const owned = currentRows.filter((row) => row.owned).length;
        const missing = Math.max(0, total - owned);
        const percent = total ? Math.round((owned / total) * 100) : 0;

        page.querySelector('[data-role="theme-title"]').textContent = label;
        page.querySelector('[data-role="progress-value"]').textContent = `${percent} %`;
        page.querySelector('[data-role="progress-bar"]').style.width = `${percent}%`;
        page.querySelector('[data-role="count-all"]').textContent = total.toLocaleString('fr-FR');
        page.querySelector('[data-role="count-owned"]').textContent = owned.toLocaleString('fr-FR');
        page.querySelector('[data-role="count-missing"]').textContent = missing.toLocaleString('fr-FR');

        renderRows();
      }

      async function prepareSearch() {
        const results = await Promise.allSettled([
          loadCatalogue(false),
          loadOwnedCollection()
        ]);

        if (!catalogueCards.length && results[0].status === 'rejected') {
          throw results[0].reason;
        }

        if (results[1].status === 'rejected') {
          ownedCards = [];
        }
      }

      async function runCategory(category) {
        if (!category || !isThemePage()) return;

        const generation = ++searchGeneration;
        currentCategory = category.key;
        currentFilter = 'all';
        currentSort = 'relevance';

        const page = document.getElementById(PAGE_ID);
        page?.querySelectorAll('[data-category]').forEach((button) => {
          button.classList.toggle('is-active', button.dataset.category === category.key);
        });
        page?.querySelectorAll('[data-filter]').forEach((button) => {
          button.classList.toggle('is-active', button.dataset.filter === 'all');
        });
        const sort = page?.querySelector('[data-role="sort"]');
        if (sort) sort.value = 'relevance';

        setStatus(`Ouverture de la catégorie « ${category.label} »…`);

        try {
          await prepareSearch();
        } catch (error) {
          if (generation !== searchGeneration) return;
          setStatus(`Impossible de charger le répertoire : ${String(error?.message || error)}`, 'error');
          return;
        }

        if (generation !== searchGeneration) return;

        currentRows = buildRows(category.terms, category.label);
        updateDashboard(category.label);

        const owned = currentRows.filter((row) => row.owned).length;
        const suffix = catalogueComplete ? '' : ' • répertoire détecté depuis la page';
        setStatus(
          `${currentRows.length.toLocaleString('fr-FR')} cartes • ${owned.toLocaleString('fr-FR')} possédées${suffix}`,
          catalogueComplete ? 'success' : 'normal'
        );
      }

      async function runSearch(rawQuery) {
        const query = String(rawQuery || '').trim();
        if (!query || !isThemePage()) return;

        const generation = ++searchGeneration;
        currentCategory = null;
        currentFilter = 'all';
        currentSort = 'relevance';

        const page = document.getElementById(PAGE_ID);
        page?.querySelectorAll('[data-category]').forEach((button) => button.classList.remove('is-active'));
        page?.querySelectorAll('[data-filter]').forEach((button) => {
          button.classList.toggle('is-active', button.dataset.filter === 'all');
        });
        const sort = page?.querySelector('[data-role="sort"]');
        if (sort) sort.value = 'relevance';

        setStatus(`Recherche de « ${query} »…`);

        try {
          await prepareSearch();
        } catch (error) {
          if (generation !== searchGeneration) return;
          setStatus(`Impossible de charger le répertoire : ${String(error?.message || error)}`, 'error');
          return;
        }

        if (generation !== searchGeneration) return;

        currentRows = buildRows(termsForQuery(query), query);
        updateDashboard(query);

        const owned = currentRows.filter((row) => row.owned).length;
        const suffix = catalogueComplete ? '' : ' • répertoire détecté depuis la page';
        setStatus(
          `${currentRows.length.toLocaleString('fr-FR')} cartes • ${owned.toLocaleString('fr-FR')} possédées${suffix}`,
          catalogueComplete ? 'success' : 'normal'
        );
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

      return { render, isThemePage, runSearch, runCategory };
    }
  };
})();