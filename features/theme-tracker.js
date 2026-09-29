(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.themeTracker = {
    create(runtime) {
      const {
        ALL_COLLECTION_KEY,
        readLocalValue,
        writeLocalValue,
        storageGet,
        storageSet,
        registerCards
      } = runtime.core;

      const PAGE_ID = 'wm-theme-tracker-page';
      const NAV_ID = 'wm-theme-tracker-nav';
      const STORAGE_KEY = 'wm_families_v1';
      const CARD_BATCH = 80;
      const MAX_SEMANTIC_TITLES = 650;
      const MAX_CATEGORY_REQUESTS = 12;
      const MAX_CATEGORY_DEPTH = 2;
      const MAX_DIRECT_SEARCH_PAGES = 4;

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
          .replace(/[’']/g, "'")
          .replace(/[^a-z0-9' -]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function compact(value) {
        return normalize(value).replace(/[^a-z0-9]+/g, '');
      }

      function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function familyId() {
        return `family-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }

      function readFamilies() {
        const value = readLocalValue(STORAGE_KEY);
        return Array.isArray(value)
          ? value.filter((item) => item?.id && item?.name && Array.isArray(item.cards))
          : [];
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

      function extensionFetchJson(url, accept = 'application/json') {
        return new Promise((resolve, reject) => {
          const requestId = `semantic:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          let timer = null;

          const handler = (event) => {
            if (event.source !== window) return;
            const message = event.data;
            if (
              !message ||
              message.source !== 'wm-average-extension' ||
              message.type !== 'semantic-fetch-result' ||
              message.requestId !== requestId
            ) {
              return;
            }

            clearTimeout(timer);
            window.removeEventListener('message', handler);

            if (message.ok) resolve(message.data);
            else reject(new Error(message.error || 'Requête externe impossible'));
          };

          window.addEventListener('message', handler);
          timer = setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('Délai dépassé pour la source externe'));
          }, 60000);

          window.postMessage({
            source: 'wm-average-page',
            type: 'semantic-fetch',
            requestId,
            url,
            accept
          }, '*');
        });
      }

      async function fetchJson(url, init = {}) {
        const parsed = new URL(url, location.origin);

        if (parsed.origin !== location.origin) {
          // Le contexte extension effectue déjà jusqu'à 4 essais.
          return extensionFetchJson(
            parsed.toString(),
            init.headers?.accept || 'application/json'
          );
        }

        const maxAttempts = 4;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const response = await fetch(parsed.toString(), {
              method: 'GET',
              credentials: init.credentials ?? 'omit',
              referrerPolicy: 'no-referrer',
              headers: { accept: 'application/json', ...(init.headers || {}) }
            });

            if (!response.ok) {
              const error = new Error(`HTTP ${response.status}`);
              error.status = response.status;
              throw error;
            }

            return response.json();
          } catch (error) {
            lastError = error;
            const status = Number(error?.status);
            const retryable =
              !Number.isFinite(status) ||
              status === 408 ||
              status === 425 ||
              status === 429 ||
              status >= 500;

            if (!retryable || attempt >= maxAttempts) break;

            await wait(Math.min(4000, 500 * (2 ** (attempt - 1))));
          }
        }

        throw lastError || new Error('Requête WikiMasters impossible');
      }

      function titleFromWikipediaUrl(url) {
        try {
          const parsed = new URL(url);
          const raw = parsed.pathname.replace(/^\/wiki\//, '');
          return decodeURIComponent(raw).replace(/_/g, ' ').trim();
        } catch (_) {
          return '';
        }
      }

      function addTitle(set, title) {
        const clean = String(title || '').trim();
        if (!clean || clean.startsWith('Catégorie:')) return false;
        if (set.size >= MAX_SEMANTIC_TITLES) return false;
        set.add(clean);
        return true;
      }

      async function discoverWikidata(keyword, titles, report) {
        report({
          stage: 'wikidata',
          percent: 10,
          title: 'Wikidata',
          detail: 'Recherche du concept…'
        });

        const search = new URL('https://www.wikidata.org/w/api.php');
        search.searchParams.set('action', 'wbsearchentities');
        search.searchParams.set('search', keyword);
        search.searchParams.set('language', 'fr');
        search.searchParams.set('uselang', 'fr');
        search.searchParams.set('type', 'item');
        search.searchParams.set('limit', '5');
        search.searchParams.set('format', 'json');
        search.searchParams.set('origin', '*');

        const json = await fetchJson(search.toString());
        const candidates = Array.isArray(json?.search) ? json.search : [];
        const entity = candidates[0];

        if (!entity?.id || !/^Q\d+$/.test(entity.id)) {
          report({
            stage: 'wikidata',
            percent: 24,
            title: 'Wikidata',
            detail: 'Aucun concept précis trouvé, passage aux catégories Wikipédia.'
          });
          return { entity: null, added: 0 };
        }

        const query = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
SELECT DISTINCT ?article WHERE {
  VALUES ?theme { wd:${entity.id} }
  {
    ?item wdt:P136 ?genre .
    ?genre wdt:P279* ?theme .
  }
  UNION
  {
    ?item wdt:P31 ?class .
    ?class wdt:P279* ?theme .
  }
  UNION
  {
    ?item wdt:P279* ?theme .
  }
  ?article schema:about ?item ;
           schema:isPartOf <https://fr.wikipedia.org/> .
}
LIMIT ${MAX_SEMANTIC_TITLES}
        `.trim();

        report({
          stage: 'wikidata',
          percent: 16,
          title: 'Wikidata',
          detail: `Concept : ${entity.label || keyword}. Recherche des pages liées…`
        });

        const endpoint = new URL('https://query.wikidata.org/sparql');
        endpoint.searchParams.set('query', query);
        endpoint.searchParams.set('format', 'json');
        endpoint.searchParams.set('origin', '*');

        const before = titles.size;

        try {
          const result = await fetchJson(endpoint.toString(), {
            headers: { accept: 'application/sparql-results+json' }
          });

          for (const row of result?.results?.bindings || []) {
            addTitle(titles, titleFromWikipediaUrl(row?.article?.value));
          }
        } catch (error) {
          console.debug('[WM Average] Wikidata SPARQL indisponible', error);
        }

        report({
          stage: 'wikidata',
          percent: 25,
          title: 'Wikidata',
          detail: `${(titles.size - before).toLocaleString('fr-FR')} pages liées trouvées.`
        });

        return {
          entity: {
            id: entity.id,
            label: entity.label || keyword,
            description: entity.description || ''
          },
          added: titles.size - before
        };
      }

      function categoryScore(title, keyword) {
        const candidate = String(title || '').replace(/^Cat[ée]gorie\s*:/i, '').trim();
        const a = compact(candidate);
        const b = compact(keyword);

        if (!a || !b) return 0;
        if (a === b) return 1000;
        if (a.startsWith(b) || b.startsWith(a)) return 850;
        if (a.includes(b)) return 720;
        return 0;
      }

      async function discoverWikipediaCategories(keyword, titles, report) {
        report({
          stage: 'wikipedia',
          percent: 28,
          title: 'Wikipédia',
          detail: 'Recherche des catégories…'
        });

        const search = new URL('https://fr.wikipedia.org/w/api.php');
        search.searchParams.set('action', 'query');
        search.searchParams.set('list', 'search');
        search.searchParams.set('srnamespace', '14');
        search.searchParams.set('srlimit', '8');
        search.searchParams.set('srsearch', keyword);
        search.searchParams.set('format', 'json');
        search.searchParams.set('formatversion', '2');
        search.searchParams.set('origin', '*');

        const json = await fetchJson(search.toString());
        const categories = (Array.isArray(json?.query?.search) ? json.query.search : [])
          .map((item) => ({
            title: item.title,
            score: categoryScore(item.title, keyword)
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);

        if (!categories.length) {
          report({
            stage: 'wikipedia',
            percent: 44,
            title: 'Wikipédia',
            detail: 'Pas de catégorie suffisamment proche.'
          });
          return { roots: [], requests: 1, added: 0 };
        }

        const before = titles.size;
        const queue = categories.map((item) => ({
          title: item.title,
          depth: 0
        }));
        const queued = new Set(queue.map((item) => item.title));
        const visited = new Set();
        let requests = 1;

        while (
          queue.length &&
          requests < MAX_CATEGORY_REQUESTS &&
          titles.size < MAX_SEMANTIC_TITLES
        ) {
          const current = queue.shift();
          if (!current || visited.has(current.title)) continue;
          visited.add(current.title);

          let continuation = null;

          do {
            const url = new URL('https://fr.wikipedia.org/w/api.php');
            url.searchParams.set('action', 'query');
            url.searchParams.set('list', 'categorymembers');
            url.searchParams.set('cmtitle', current.title);
            url.searchParams.set('cmnamespace', '0|14');
            url.searchParams.set('cmtype', 'page|subcat');
            url.searchParams.set('cmlimit', '500');
            url.searchParams.set('format', 'json');
            url.searchParams.set('formatversion', '2');
            url.searchParams.set('origin', '*');
            if (continuation) url.searchParams.set('cmcontinue', continuation);

            const page = await fetchJson(url.toString());
            requests += 1;

            for (const member of page?.query?.categorymembers || []) {
              if (Number(member?.ns) === 0) {
                addTitle(titles, member.title);
              } else if (
                Number(member?.ns) === 14 &&
                current.depth < MAX_CATEGORY_DEPTH &&
                queue.length + visited.size < 70 &&
                !queued.has(member.title)
              ) {
                queued.add(member.title);
                queue.push({
                  title: member.title,
                  depth: current.depth + 1
                });
              }

              if (titles.size >= MAX_SEMANTIC_TITLES) break;
            }

            continuation = page?.continue?.cmcontinue || null;

            report({
              stage: 'wikipedia',
              percent: Math.min(45, 30 + Math.round((requests / MAX_CATEGORY_REQUESTS) * 15)),
              title: 'Wikipédia',
              detail: `${titles.size.toLocaleString('fr-FR')} pages candidates • ${requests} requêtes`
            });

            if (requests >= MAX_CATEGORY_REQUESTS || titles.size >= MAX_SEMANTIC_TITLES) {
              break;
            }

            await wait(55);
          } while (continuation);
        }

        return {
          roots: categories.map((item) => item.title),
          requests,
          added: titles.size - before
        };
      }

      function readSearchHasMore(json) {
        if (typeof json?.searchHasMore === 'boolean') return json.searchHasMore;
        if (typeof json?.hasMore === 'boolean') return json.hasMore;
        return null;
      }

      async function discoverDirectWikiMasters(keyword, titles, report) {
        report({
          stage: 'wikimasters-search',
          percent: 46,
          title: 'WikiMasters',
          detail: 'Ajout des correspondances textuelles directes…'
        });

        const cards = new Map();

        for (let page = 0; page < MAX_DIRECT_SEARCH_PAGES; page += 1) {
          const url = `/api/cards?page=${page}&q=${encodeURIComponent(keyword)}&sort=rarity`;
          const json = await fetchJson(url, { credentials: 'include' });

          for (const card of Array.isArray(json?.cards) ? json.cards : []) {
            if (!card?.id || !card?.wikipedia_title) continue;
            cards.set(card.id, {
              id: card.id,
              title: card.wikipedia_title,
              rarity: card.rarity || null,
              category: card.category || null,
              imageUrl: card.image_url || null,
              wikipediaUrl: card.wikipedia_url || null,
              atk: Number.isFinite(Number(card.atk)) ? Number(card.atk) : null,
              def: Number.isFinite(Number(card.def)) ? Number(card.def) : null
            });
            addTitle(titles, card.wikipedia_title);
          }

          report({
            stage: 'wikimasters-search',
            percent: Math.min(50, 47 + page),
            title: 'WikiMasters',
            detail: `${cards.size.toLocaleString('fr-FR')} correspondances directes ajoutées.`
          });

          if (readSearchHasMore(json) === false) break;
          await wait(55);
        }

        return [...cards.values()];
      }

      function bridgeRequest(eventName, resultName, detail, options = {}) {
        return new Promise((resolve, reject) => {
          const requestId = `${eventName}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          const timeoutMs = options.timeoutMs || 90000;
          let timer = null;

          const cleanup = () => {
            clearTimeout(timer);
            window.removeEventListener(resultName, onResult);
            if (options.progressName) {
              window.removeEventListener(options.progressName, onProgress);
            }
          };

          const onResult = (event) => {
            if (event.detail?.requestId !== requestId) return;
            cleanup();
            resolve(event.detail || {});
          };

          const onProgress = (event) => {
            if (event.detail?.requestId !== requestId) return;
            options.onProgress?.(event.detail || {});
          };

          window.addEventListener(resultName, onResult);
          if (options.progressName) {
            window.addEventListener(options.progressName, onProgress);
          }

          timer = setTimeout(() => {
            cleanup();
            reject(new Error('Délai dépassé'));
          }, timeoutMs);

          window.dispatchEvent(new CustomEvent(eventName, {
            detail: { ...(detail || {}), requestId }
          }));
        });
      }

      async function resolveWikiMastersTitles(titles, directCards, report) {
        const list = [...titles].slice(0, MAX_SEMANTIC_TITLES);

        report({
          stage: 'resolve',
          percent: 52,
          title: 'WikiMasters',
          detail: `Correspondance de ${list.length.toLocaleString('fr-FR')} titres par lots…`
        });

        const result = await bridgeRequest(
          'wm-average-family-resolve',
          'wm-average-family-resolve-result',
          { titles: list },
          {
            timeoutMs: 180000,
            progressName: 'wm-average-family-resolve-progress',
            onProgress: (progress) => {
              const ratio = progress.batches
                ? progress.batch / progress.batches
                : 0;
              const percent = 52 + Math.round(ratio * 30);

              if (progress.retryAttempt) {
                const seconds = Math.max(1, Math.round((Number(progress.retryDelayMs) || 0) / 1000));
                report({
                  stage: 'resolve',
                  percent,
                  title: 'WikiMasters — nouvel essai',
                  detail: `Lot ${progress.batch}/${progress.batches} en erreur • essai ${progress.retryAttempt}/${progress.retryMax} dans ~${seconds}s`
                });
                return;
              }

              if (progress.phase === 'recovery') {
                report({
                  stage: 'resolve',
                  percent: Math.max(percent, 78),
                  title: 'WikiMasters — récupération',
                  detail: `Nouveau passage sur les lots échoués : ${progress.recoveryIndex}/${progress.recoveryTotal} • ${(progress.matchedCards || 0).toLocaleString('fr-FR')} cartes récupérées`
                });
                return;
              }

              const failedCopy = progress.failedBatches
                ? ` • ${progress.failedBatches} lot(s) à réessayer`
                : '';

              report({
                stage: 'resolve',
                percent,
                title: 'WikiMasters',
                detail: `Lot ${progress.batch}/${progress.batches} • ${(progress.matchedCards || 0).toLocaleString('fr-FR')} cartes trouvées${failedCopy}`
              });
            }
          }
        );

        if (!result.ok) {
          throw new Error(result.error || 'Impossible de faire correspondre les cartes WikiMasters.');
        }

        if (result.partial) {
          report({
            stage: 'resolve',
            percent: 82,
            title: 'WikiMasters',
            detail: `${(result.cards?.length || 0).toLocaleString('fr-FR')} cartes récupérées • ${result.failedBatches} lot(s) toujours indisponible(s), création poursuivie.`
          });
        }

        const merged = new Map();

        for (const card of [...(Array.isArray(result.cards) ? result.cards : []), ...(directCards || [])]) {
          if (card?.id && card?.title) merged.set(card.id, card);
        }

        return [...merged.values()];
      }

      async function loadOwnedCards(report) {
        const cached = storageGet(ALL_COLLECTION_KEY)[ALL_COLLECTION_KEY];

        if (
          cached?.complete === true &&
          Array.isArray(cached.cards) &&
          Date.now() - (Number(cached.fetchedAt) || 0) < 5 * 60 * 1000
        ) {
          report({
            stage: 'ownership',
            percent: 94,
            title: 'Ta collection',
            detail: `${cached.cards.length.toLocaleString('fr-FR')} cartes déjà en cache.`
          });
          return cached.cards;
        }

        report({
          stage: 'ownership',
          percent: 84,
          title: 'Ta collection',
          detail: 'Synchronisation des cartes possédées…'
        });

        const result = await bridgeRequest(
          'wm-average-load-all-collection',
          'wm-average-all-collection',
          { selectedRarities: [] },
          {
            timeoutMs: 120000,
            progressName: 'wm-average-all-collection-progress',
            onProgress: (progress) => {
              const totalPages = Number(progress.totalPages) || 0;
              const loadedPages = Number(progress.loadedPages) || 0;
              const ratio = totalPages > 0 ? loadedPages / totalPages : 0;

              report({
                stage: 'ownership',
                percent: 84 + Math.min(10, Math.round(ratio * 10)),
                title: 'Ta collection',
                detail: totalPages > 0
                  ? `Page ${loadedPages}/${totalPages}`
                  : `Page ${loadedPages}`
              });
            }
          }
        );

        if (!result.ok) {
          throw new Error(result.error || 'Impossible de synchroniser ta collection.');
        }

        const cards = Array.isArray(result.cards) ? result.cards : [];
        storageSet({
          [ALL_COLLECTION_KEY]: {
            fetchedAt: Date.now(),
            cards,
            complete: result.complete !== false
          }
        });

        return cards;
      }

      function applyOwnership(cards, ownedCards) {
        const owned = new Map();

        for (const card of ownedCards || []) {
          if (!card?.id) continue;
          const count = Math.max(
            Number(card.count) || 1,
            Array.isArray(card.ownedCardIds) ? card.ownedCardIds.length : 0
          );
          const previous = owned.get(card.id) || 0;
          owned.set(card.id, Math.max(previous, count));
        }

        return cards.map((card) => ({
          ...card,
          owned: owned.has(card.id),
          ownedCount: owned.get(card.id) || 0
        }));
      }

      async function buildFamily({ id = null, name, keyword }, report = () => {}) {
        const cleanKeyword = String(keyword || '').trim();
        if (!cleanKeyword) throw new Error('Entre un thème.');

        const titles = new Set();

        report({
          stage: 'start',
          percent: 4,
          title: 'Analyse du thème',
          detail: `Préparation de « ${cleanKeyword} »…`
        });

        let wikidata = null;
        let wikipedia = null;

        try {
          wikidata = await discoverWikidata(cleanKeyword, titles, report);
        } catch (error) {
          console.debug('[WM Average] découverte Wikidata ignorée', error);
          report({
            stage: 'wikidata',
            percent: 25,
            title: 'Wikidata',
            detail: 'Source indisponible, poursuite avec Wikipédia.'
          });
        }

        try {
          wikipedia = await discoverWikipediaCategories(cleanKeyword, titles, report);
        } catch (error) {
          console.debug('[WM Average] catégories Wikipédia ignorées', error);
          report({
            stage: 'wikipedia',
            percent: 45,
            title: 'Wikipédia',
            detail: 'Catégories indisponibles, poursuite avec WikiMasters.'
          });
        }

        let directCards = [];

        try {
          directCards = await discoverDirectWikiMasters(cleanKeyword, titles, report);
        } catch (error) {
          console.debug('[WM Average] recherche WikiMasters directe ignorée après retries', error);
          report({
            stage: 'wikimasters-search',
            percent: 50,
            title: 'WikiMasters',
            detail: 'Recherche directe momentanément indisponible après plusieurs essais. Poursuite avec les pages sémantiques.'
          });
        }

        if (!titles.size) {
          throw new Error('Aucune page liée à ce thème n’a été trouvée.');
        }

        const resolved = await resolveWikiMastersTitles(titles, directCards, report);

        if (!resolved.length) {
          throw new Error('Aucune carte WikiMasters correspondante n’a été trouvée.');
        }

        const ownedCards = await loadOwnedCards(report);
        const cards = applyOwnership(resolved, ownedCards)
          .sort((a, b) => a.title.localeCompare(b.title, 'fr'));

        registerCards(cards.map((card) => ({
          id: card.id,
          title: card.title,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          wikipediaUrl: card.wikipediaUrl,
          count: Math.max(1, card.ownedCount || 1)
        })));

        const now = Date.now();
        const previous = id ? getFamily(id) : null;

        report({
          stage: 'save',
          percent: 98,
          title: 'Enregistrement',
          detail: `${cards.length.toLocaleString('fr-FR')} cartes dans la famille.`
        });

        const family = {
          id: id || familyId(),
          name: String(name || cleanKeyword).trim(),
          keyword: cleanKeyword,
          cards,
          createdAt: previous?.createdAt || now,
          updatedAt: now,
          discovery: {
            candidateTitles: titles.size,
            matchedCards: cards.length,
            wikidataEntity: wikidata?.entity || null,
            wikipediaCategories: wikipedia?.roots || [],
            semanticVersion: 1
          }
        };

        report({
          stage: 'done',
          percent: 100,
          title: 'Terminé',
          detail: `${cards.length.toLocaleString('fr-FR')} cartes • ${cards.filter((card) => card.owned).length.toLocaleString('fr-FR')} possédées`
        });

        return family;
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
        subtitle.textContent = 'Crée des groupes de cartes à partir d’un thème.';

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
          empty.innerHTML = '<strong>Aucune famille</strong><span>Ajoute un thème pour commencer.</span>';

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

      function createRealCard(card) {
        const element = runtime.cardExtras.createCardElement(card, {
          owned: Boolean(card.owned),
          ownedCount: card.ownedCount || 0
        });

        if (!element) return null;

        const slot = document.createElement('div');
        slot.className = 'wm-family-card-slot';
        slot.append(element);
        return slot;
      }

      function renderDetailGrid(family, container) {
        const cards = filteredCards(family);
        const shown = cards.slice(0, visibleCount);

        registerCards((family.cards || []).map((card) => ({
          id: card.id,
          title: card.title,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          wikipediaUrl: card.wikipediaUrl,
          count: Math.max(1, card.ownedCount || 1)
        })));

        const grid = container.querySelector('[data-role="cards"]');
        const count = container.querySelector('[data-role="count"]');
        const more = container.querySelector('[data-role="more"]');

        grid.replaceChildren();
        const fragment = document.createDocumentFragment();

        for (const card of shown) {
          const element = createRealCard(card);
          if (element) fragment.append(element);
        }

        grid.append(fragment);
        count.textContent = `${cards.length.toLocaleString('fr-FR')} carte${cards.length > 1 ? 's' : ''}`;

        if (shown.length < cards.length) {
          more.hidden = false;
          more.textContent = `Afficher ${Math.min(CARD_BATCH, cards.length - shown.length)} de plus`;
        } else {
          more.hidden = true;
        }

        requestAnimationFrame(() => {
          runtime.cardExtras.renderCardExtras();
        });
      }

      async function rebuildFamily(family) {
        const progress = openProgressModal(`Actualisation de « ${family.name} »`);

        try {
          const updated = await buildFamily({
            id: family.id,
            name: family.name,
            keyword: family.keyword
          }, progress.update);

          saveFamily(updated);
          await wait(450);
          progress.close();
          renderPageContent();
        } catch (error) {
          progress.fail(String(error?.message || error));
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
        refresh.addEventListener('click', () => rebuildFamily(family));

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

        const discovery = family.discovery;
        const info = document.createElement('p');
        info.textContent = discovery?.candidateTitles
          ? `${discovery.candidateTitles.toLocaleString('fr-FR')} pages liées → ${stats.total.toLocaleString('fr-FR')} cartes WikiMasters • actualisée le ${formatDate(family.updatedAt)}`
          : `Thème : “${family.keyword}” • actualisée le ${formatDate(family.updatedAt)}`;

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

      function openProgressModal(titleText) {
        const overlay = document.createElement('div');
        overlay.className = 'wm-family-modal-overlay wm-family-progress-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-family-modal wm-family-progress-modal';

        const title = document.createElement('h2');
        title.textContent = titleText;

        const stage = document.createElement('strong');
        stage.className = 'wm-family-progress-stage';
        stage.textContent = 'Préparation';

        const detail = document.createElement('p');
        detail.className = 'wm-family-progress-detail';
        detail.textContent = 'Initialisation…';

        const bar = document.createElement('div');
        bar.className = 'wm-family-build-progress';
        const fill = document.createElement('span');
        bar.append(fill);

        const percent = document.createElement('span');
        percent.className = 'wm-family-build-percent';
        percent.textContent = '0 %';

        const note = document.createElement('div');
        note.className = 'wm-family-progress-note';
        note.textContent = 'Ne ferme pas cet onglet pendant la création.';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'wm-family-secondary';
        closeButton.textContent = 'Fermer';
        closeButton.hidden = true;

        modal.append(title, stage, detail, bar, percent, note, closeButton);
        overlay.append(modal);
        document.body.append(overlay);

        const close = () => overlay.remove();
        closeButton.addEventListener('click', close);

        return {
          update(progress) {
            const value = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
            stage.textContent = progress?.title || 'Création';
            detail.textContent = progress?.detail || '';
            fill.style.width = `${value}%`;
            percent.textContent = `${value}%`;
          },
          fail(message) {
            stage.textContent = 'Erreur';
            detail.textContent = message;
            modal.dataset.mode = 'error';
            fill.style.width = '100%';
            percent.textContent = 'Erreur';
            note.textContent = 'La famille n’a pas été modifiée.';
            closeButton.hidden = false;
          },
          close
        };
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
        description.textContent = 'Le thème est recherché dans Wikidata, Wikipédia puis associé aux cartes WikiMasters.';

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Nom';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Ex. K-pop';

        const keywordLabel = document.createElement('label');
        keywordLabel.textContent = 'Thème';
        const keywordInput = document.createElement('input');
        keywordInput.type = 'text';
        keywordInput.placeholder = 'Ex. K-pop';

        nameLabel.append(nameInput);
        keywordLabel.append(keywordInput);

        const hint = document.createElement('div');
        hint.className = 'wm-family-modal-status';
        hint.textContent = 'La création peut prendre quelques secondes selon la taille du thème.';

        const actions = document.createElement('div');
        actions.className = 'wm-family-modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'wm-family-secondary';
        cancel.textContent = 'Annuler';

        const create = document.createElement('button');
        create.type = 'button';
        create.className = 'wm-family-primary';
        create.textContent = 'Créer';

        cancel.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) overlay.remove();
        });

        create.addEventListener('click', async () => {
          const keyword = keywordInput.value.trim();
          const name = nameInput.value.trim() || keyword;

          if (!keyword) {
            hint.dataset.mode = 'error';
            hint.textContent = 'Entre un thème.';
            return;
          }

          overlay.remove();
          const progress = openProgressModal(`Création de « ${name} »`);

          try {
            const family = await buildFamily({ name, keyword }, progress.update);
            saveFamily(family);
            activeFamilyId = family.id;
            currentFilter = 'all';
            visibleCount = CARD_BATCH;
            await wait(500);
            progress.close();
            renderPageContent();
          } catch (error) {
            progress.fail(String(error?.message || error));
          }
        });

        actions.append(cancel, create);
        modal.append(title, description, nameLabel, keywordLabel, hint, actions);
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