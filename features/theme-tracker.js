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
      const CARD_BATCH = 80;
      const SEARCH_MIN_LENGTH = 2;
      const MAX_OWNERSHIP_KEYWORDS = 8;
      const MAX_OWNERSHIP_PAGES_PER_KEYWORD = 10;
      const OWNERSHIP_COVERAGE_TARGET = 0.95;
      const MAX_MARKET_PAGES_PER_CARD = 3;
      const MARKET_PAGE_SIZE = 50;

      let activeFamilyId = null;
      let editingFamilyId = null;
      let marketFamilyId = null;
      let currentFilter = 'all';
      let visibleCount = CARD_BATCH;
      let searchState = createEmptySearchState();
      let marketState = createEmptyMarketState();

      function createEmptyMarketState(familyId = null) {
        return {
          familyId,
          cards: {},
          batchLoading: false,
          batchProgress: '',
          batchError: ''
        };
      }

      function createEmptySearchState(familyId = null) {
        return {
          familyId,
          query: '',
          page: 0,
          results: [],
          hasMore: false,
          loading: false,
          error: '',
          requestToken: 0
        };
      }

      function isThemeRoute() {
        if (location.pathname !== '/global-collection') return false;
        try {
          return new URLSearchParams(location.search).get('wm') === 'themes';
        } catch (_) {
          return false;
        }
      }

      function isThemePage() {
        return runtime.settings.isEnabled('themeTracker') && isThemeRoute();
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
        if (!writeLocalValue(STORAGE_KEY, families)) {
          throw new Error('Impossible d’enregistrer les Familles dans le stockage local du navigateur.');
        }
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

      function wikipediaUrlForTitle(title) {
        const slug = encodeURIComponent(String(title || '').trim().replace(/ /g, '_'));
        return slug ? `https://fr.wikipedia.org/wiki/${slug}` : null;
      }

      function bytesToBase64Url(bytes) {
        let binary = '';
        const chunkSize = 0x8000;

        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
          binary += String.fromCharCode(...chunk);
        }

        return btoa(binary)
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
      }

      function base64UrlToBytes(value) {
        const normalized = String(value || '')
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
        const binary = atob(normalized + padding);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
      }

      async function compressBytes(bytes) {
        if (typeof CompressionStream !== 'function') return null;

        const stream = new Blob([bytes])
          .stream()
          .pipeThrough(new CompressionStream('gzip'));

        return new Uint8Array(await new Response(stream).arrayBuffer());
      }

      async function decompressBytes(bytes) {
        if (typeof DecompressionStream !== 'function') {
          throw new Error('La décompression gzip n’est pas disponible dans ce navigateur.');
        }

        const stream = new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream('gzip'));

        return new Uint8Array(await new Response(stream).arrayBuffer());
      }

      function compactFamilyPayload(family) {
        const cards = Array.isArray(family?.cards) ? family.cards : [];
        const coverIndex = family?.coverCardId
          ? cards.findIndex((card) => card.id === family.coverCardId)
          : -1;

        return [
          String(family?.name || '').trim(),
          coverIndex,
          cards.map((card) => [
            String(card?.id || ''),
            String(card?.title || ''),
            card?.rarity || '',
            card?.category || '',
            card?.imageUrl || '',
            Number.isFinite(Number(card?.atk)) ? Number(card.atk) : '',
            Number.isFinite(Number(card?.def)) ? Number(card.def) : ''
          ])
        ];
      }

      async function encodeFamilyCode(family) {
        const json = JSON.stringify(compactFamilyPayload(family));
        const rawBytes = new TextEncoder().encode(json);
        const rawCode = `F0.${bytesToBase64Url(rawBytes)}`;

        try {
          const compressed = await compressBytes(rawBytes);
          if (compressed) {
            const compressedCode = `F1.${bytesToBase64Url(compressed)}`;
            if (compressedCode.length < rawCode.length) return compressedCode;
          }
        } catch (_) {}

        return rawCode;
      }

      async function decodeFamilyCode(rawCode) {
        const code = String(rawCode || '').replace(/\s+/g, '').trim();
        if (!code) throw new Error('Colle un code de famille.');

        const separator = code.indexOf('.');
        if (separator <= 0) throw new Error('Code de famille invalide.');

        const version = code.slice(0, separator);
        const encoded = code.slice(separator + 1);
        if (!encoded) throw new Error('Code de famille invalide.');

        let bytes = base64UrlToBytes(encoded);

        if (version === 'F1') {
          bytes = await decompressBytes(bytes);
        } else if (version !== 'F0') {
          throw new Error('Version de famille non prise en charge.');
        }

        let payload;
        try {
          payload = JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) {
          throw new Error('Le code de famille est corrompu.');
        }

        if (!Array.isArray(payload) || payload.length < 3) {
          throw new Error('Format de famille invalide.');
        }

        const name = String(payload[0] || '').trim();
        const coverIndex = Number(payload[1]);
        const rows = Array.isArray(payload[2]) ? payload[2] : [];

        if (!name || name.length > 120) {
          throw new Error('Nom de famille invalide.');
        }
        if (rows.length > 5000) {
          throw new Error('Cette famille contient trop de cartes.');
        }

        const cards = [];
        const seen = new Set();

        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 2) continue;

          const id = String(row[0] || '').trim();
          const title = String(row[1] || '').trim();
          if (!id || !title || seen.has(id)) continue;
          seen.add(id);

          const rarity = ['L', 'UR', 'SR', 'R', 'PC', 'C'].includes(row[2])
            ? row[2]
            : 'C';
          const atk = row[5] === '' || row[5] == null ? null : Number(row[5]);
          const def = row[6] === '' || row[6] == null ? null : Number(row[6]);

          cards.push({
            id,
            title,
            rarity,
            category: String(row[3] || '').trim() || null,
            imageUrl: String(row[4] || '').trim() || null,
            wikipediaUrl: wikipediaUrlForTitle(title),
            atk: atk != null && Number.isFinite(atk) ? atk : null,
            def: def != null && Number.isFinite(def) ? def : null,
            owned: null,
            ownedCount: 0
          });
        }

        const importedCoverId =
          Number.isInteger(coverIndex) &&
          coverIndex >= 0 &&
          coverIndex < rows.length
            ? String(rows[coverIndex]?.[0] || '')
            : null;

        const now = Date.now();
        return {
          id: familyId(),
          name,
          cards: cards.sort((a, b) => a.title.localeCompare(b.title, 'fr')),
          coverCardId: importedCoverId && seen.has(importedCoverId)
            ? importedCoverId
            : null,
          createdAt: now,
          updatedAt: now,
          ownershipUpdatedAt: null,
          mode: 'manual'
        };
      }

      async function copyText(value) {
        const text = String(value || '');

        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch (_) {}

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();

        let copied = false;
        try {
          copied = document.execCommand('copy');
        } catch (_) {}

        textarea.remove();
        return copied;
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

      async function fetchJson(url, init = {}) {
        const parsed = new URL(url, location.origin);
        const maxAttempts = 4;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const response = await fetch(parsed.toString(), {
              method: 'GET',
              credentials: init.credentials ?? 'include',
              headers: { accept: '*/*', ...(init.headers || {}) }
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

      function ownedCountsFromIds(ids) {
        const counts = new Map();
        for (const id of Array.isArray(ids) ? ids : []) {
          if (!id) continue;
          counts.set(id, (counts.get(id) || 0) + 1);
        }
        return counts;
      }

      function mapGlobalCard(raw, ownedCounts = new Map()) {
        const card = raw?.card || raw;
        const id = raw?.card_id || card?.id;
        const title = card?.wikipedia_title || card?.title;
        if (!id || !title) return null;

        const ownedCount = ownedCounts.get(id) || 0;

        return {
          id,
          title,
          rarity: card?.rarity || raw?.rarity || null,
          category: card?.category || raw?.category || null,
          imageUrl: card?.image_url || raw?.image_url || null,
          wikipediaUrl: card?.wikipedia_url || raw?.wikipedia_url || null,
          atk: Number.isFinite(Number(card?.atk ?? raw?.atk)) ? Number(card?.atk ?? raw?.atk) : null,
          def: Number.isFinite(Number(card?.def ?? raw?.def)) ? Number(card?.def ?? raw?.def) : null,
          owned: ownedCount > 0,
          ownedCount,
          ownershipCheckedAt: Date.now()
        };
      }

      async function searchGlobalCards(query, page = 0) {
        const clean = String(query || '').trim();
        if (clean.length < SEARCH_MIN_LENGTH) {
          return { cards: [], hasMore: false };
        }

        const json = await fetchJson(
          `/api/cards?page=${page}&q=${encodeURIComponent(clean)}&sort=rarity`,
          { credentials: 'include' }
        );

        const ownedCounts = ownedCountsFromIds(json?.ownedCardIds);
        const cards = (Array.isArray(json?.cards) ? json.cards : [])
          .map((raw) => mapGlobalCard(raw, ownedCounts))
          .filter(Boolean);

        return {
          cards,
          hasMore: typeof json?.searchHasMore === 'boolean'
            ? json.searchHasMore
            : cards.length >= 50
        };
      }

      function familyStats(family) {
        const cards = Array.isArray(family?.cards) ? family.cards : [];
        const owned = cards.filter((card) => card.owned === true).length;
        const missing = cards.filter((card) => card.owned === false).length;
        const unchecked = cards.filter((card) => card.owned == null).length;
        const total = cards.length;

        return {
          total,
          owned,
          missing,
          unchecked,
          percent: total ? Math.round((owned / total) * 100) : 0
        };
      }

      function registerFamilyCards(family) {
        registerCards((family?.cards || []).map((card) => ({
          id: card.id,
          title: card.title,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          wikipediaUrl: card.wikipediaUrl,
          count: Math.max(1, card.ownedCount || 1)
        })));
      }

      function addCardToFamily(familyIdValue, card) {
        const family = getFamily(familyIdValue);
        if (!family || !card?.id) return false;
        if (family.cards.some((item) => item.id === card.id)) return false;

        family.cards.push({ ...card });
        family.cards.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
        family.updatedAt = Date.now();
        saveFamily(family);
        registerFamilyCards(family);
        return true;
      }

      function removeCardFromFamily(familyIdValue, cardId) {
        const family = getFamily(familyIdValue);
        if (!family) return false;

        const next = family.cards.filter((card) => card.id !== cardId);
        if (next.length === family.cards.length) return false;

        family.cards = next;
        if (family.coverCardId === cardId) family.coverCardId = null;
        family.updatedAt = Date.now();
        saveFamily(family);
        return true;
      }

      function setFamilyCoverCard(familyIdValue, cardId) {
        const family = getFamily(familyIdValue);
        if (!family || !family.cards.some((card) => card.id === cardId)) return false;

        family.coverCardId = cardId;
        family.updatedAt = Date.now();
        saveFamily(family);
        return true;
      }

      const OWNERSHIP_STOPWORDS = new Set([
        'avec', 'dans', 'pour', 'sans', 'sous', 'chez', 'entre', 'vers', 'plus',
        'moins', 'ainsi', 'comme', 'dont', 'leur', 'leurs', 'cette', 'celui', 'celle',
        'ceux', 'elles', 'elle', 'lui', 'des', 'les', 'une', 'un', 'du', 'de', 'la',
        'le', 'et', 'en', 'au', 'aux', 'sur', 'par', 'est', 'sont', 'être',
        'groupe', 'type', 'genre', 'forme', 'personne', 'personnes', 'article'
      ]);

      function tokenizeOwnershipText(value) {
        return normalize(value)
          .split(' ')
          .map((token) => token.trim())
          .filter((token) =>
            token.length >= 4 &&
            !OWNERSHIP_STOPWORDS.has(token) &&
            !/^\d+$/.test(token)
          );
      }

      function ownershipCorpus(card) {
        return normalize([card?.title, card?.category].filter(Boolean).join(' '));
      }

      function buildOwnershipKeywords(cards) {
        const familyIds = new Set(cards.map((card) => card.id).filter(Boolean));
        const corpusById = new Map(
          cards
            .filter((card) => card?.id)
            .map((card) => [card.id, ownershipCorpus(card)])
        );
        const coverage = new Map();

        const addCandidate = (candidate) => {
          const clean = normalize(candidate);
          if (!clean || clean.length < 4 || OWNERSHIP_STOPWORDS.has(clean)) return;

          let set = coverage.get(clean);
          if (!set) {
            set = new Set();
            coverage.set(clean, set);
          }

          for (const [id, corpus] of corpusById) {
            if (corpus.includes(clean)) set.add(id);
          }
        };

        for (const card of cards) {
          const titleTokens = tokenizeOwnershipText(card?.title);
          const categoryTokens = tokenizeOwnershipText(card?.category);

          for (const token of [...titleTokens, ...categoryTokens]) addCandidate(token);

          for (const tokens of [titleTokens, categoryTokens]) {
            for (let index = 0; index < tokens.length - 1; index += 1) {
              addCandidate(`${tokens[index]} ${tokens[index + 1]}`);
            }
          }
        }

        const selected = [];
        const covered = new Set();

        while (
          selected.length < MAX_OWNERSHIP_KEYWORDS &&
          covered.size / Math.max(1, familyIds.size) < OWNERSHIP_COVERAGE_TARGET
        ) {
          let best = null;

          for (const [keyword, ids] of coverage) {
            if (selected.includes(keyword)) continue;

            let gain = 0;
            for (const id of ids) {
              if (!covered.has(id)) gain += 1;
            }
            if (!gain) continue;

            const words = keyword.split(' ').filter(Boolean).length;
            const specificity = words >= 2 ? 1.25 : 1;
            const score = gain * specificity;

            if (!best || score > best.score) {
              best = { keyword, score };
            }
          }

          if (!best) break;
          selected.push(best.keyword);
          for (const id of coverage.get(best.keyword) || []) covered.add(id);
        }

        return { keywords: selected, coverageByKeyword: coverage };
      }

      function createMarketplaceIcon() {
        const span = document.createElement('span');
        span.className = 'wm-family-market-icon';
        span.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381"></path>
            <path d="m16 16 6-6"></path>
            <path d="m21.5 10.5-8-8"></path>
            <path d="m8 8 6-6"></path>
            <path d="m8.5 7.5 8 8"></path>
          </svg>`;
        return span;
      }

      function setMarketplaceButtonContent(button, label) {
        button.replaceChildren(createMarketplaceIcon(), document.createTextNode(label));
      }

      function marketplacePrice(auction) {
        const values = [
          auction?.effective_bid,
          auction?.current_bid,
          auction?.listing_base_amount,
          auction?.base_amount
        ];

        for (const value of values) {
          const number = Number(value);
          if (Number.isFinite(number)) return number;
        }

        return null;
      }

      function formatMarketplaceEnd(value) {
        if (!value) return '';
        try {
          return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          }).format(new Date(value));
        } catch (_) {
          return '';
        }
      }

      function marketCardState(cardId) {
        return marketState.cards?.[cardId] || {
          loading: false,
          error: '',
          listings: [],
          searchedAt: 0
        };
      }

      function setMarketCardState(familyIdValue, cardId, next) {
        const currentCards = marketState.familyId === familyIdValue
          ? (marketState.cards || {})
          : {};

        marketState = {
          ...(marketState.familyId === familyIdValue ? marketState : createEmptyMarketState(familyIdValue)),
          familyId: familyIdValue,
          cards: {
            ...currentCards,
            [cardId]: {
              ...marketCardState(cardId),
              ...next
            }
          }
        };
      }

      function marketplaceQueryForCoverageKeyword(keyword) {
        const tokens = normalize(keyword)
          .split(' ')
          .filter((token) =>
            token.length >= 4 &&
            !OWNERSHIP_STOPWORDS.has(token) &&
            !/^\d+$/.test(token)
          );

        if (!tokens.length) return String(keyword || '').trim();
        if (tokens.length === 1) return tokens[0];

        // Le Marketplace tolère mieux une recherche courte. Comme les
        // résultats sont ensuite validés par card_id, on peut élargir sans
        // créer de faux positif.
        return [...tokens].sort((a, b) => b.length - a.length)[0];
      }

      async function searchMarketplaceQuery(query, missingIds) {
        const listingsById = new Map();

        for (let page = 1; page <= MAX_MARKET_PAGES_PER_CARD; page += 1) {
          const json = await fetchJson(
            `/api/marketplace?page=${page}&limit=${MARKET_PAGE_SIZE}&sort=recent&q=${encodeURIComponent(query)}`,
            { credentials: 'include' }
          );

          const auctions = Array.isArray(json?.auctions) ? json.auctions : [];

          for (const auction of auctions) {
            const cardId = auction?.card_id || auction?.card?.id;
            if (
              !auction?.id ||
              !cardId ||
              !missingIds.has(cardId) ||
              (auction.status && auction.status !== 'active')
            ) {
              continue;
            }

            listingsById.set(auction.id, auction);
          }

          if (json?.hasMore === false || auctions.length < MARKET_PAGE_SIZE) break;
          await wait(45);
        }

        return [...listingsById.values()];
      }

      async function searchAllMissingMarketplace(family) {
        const missingCards = (family?.cards || []).filter((card) => card.owned === false);
        if (!missingCards.length) return;

        const plan = buildOwnershipKeywords(missingCards);
        const keywords = plan.keywords;

        if (!keywords.length) {
          marketState = {
            ...(marketState.familyId === family.id ? marketState : createEmptyMarketState(family.id)),
            familyId: family.id,
            batchLoading: false,
            batchProgress: '',
            batchError: 'Impossible de trouver des mots-clés utiles pour cette famille.'
          };
          renderPageContent();
          return;
        }

        const missingIds = new Set(missingCards.map((card) => card.id).filter(Boolean));
        const listingsByCard = new Map();
        const searchedCardIds = new Set();
        const failedKeywords = [];

        // Conserve les résultats d'une éventuelle recherche exacte déjà faite.
        for (const card of missingCards) {
          const previous = marketCardState(card.id);
          if (!Array.isArray(previous.listings) || !previous.listings.length) continue;

          const map = new Map();
          for (const auction of previous.listings) {
            if (auction?.id) map.set(auction.id, auction);
          }
          if (map.size) listingsByCard.set(card.id, map);
        }

        marketState = {
          ...(marketState.familyId === family.id ? marketState : createEmptyMarketState(family.id)),
          familyId: family.id,
          batchLoading: true,
          batchProgress: `Recherche 0/${keywords.length}…`,
          batchError: ''
        };
        renderPageContent();

        for (let index = 0; index < keywords.length; index += 1) {
          const keyword = keywords[index];

          try {
            const listings = await searchMarketplaceQuery(
              marketplaceQueryForCoverageKeyword(keyword),
              missingIds
            );

            for (const auction of listings) {
              const cardId = auction?.card_id || auction?.card?.id;
              if (!cardId) continue;

              const current = listingsByCard.get(cardId) || new Map();
              current.set(auction.id, auction);
              listingsByCard.set(cardId, current);
            }

            // Comme pour « Charger mes cartes », seules les cartes réellement
            // couvertes par une recherche réussie sont considérées comme vérifiées.
            for (const cardId of plan.coverageByKeyword.get(keyword) || []) {
              searchedCardIds.add(cardId);
            }
          } catch (error) {
            failedKeywords.push(keyword);
          }

          const listingCount = [...listingsByCard.values()]
            .reduce((sum, map) => sum + map.size, 0);

          marketState = {
            ...marketState,
            batchLoading: true,
            batchProgress: `Recherche ${index + 1}/${keywords.length} • ${listingCount} annonce${listingCount > 1 ? 's' : ''}`,
            batchError: ''
          };

          if (marketFamilyId === family.id) renderPageContent();
        }

        const now = Date.now();
        const nextCards = { ...(marketState.cards || {}) };

        for (const card of missingCards) {
          if (!searchedCardIds.has(card.id)) continue;

          const found = listingsByCard.get(card.id);
          nextCards[card.id] = {
            loading: false,
            error: '',
            listings: found ? [...found.values()] : [],
            searchedAt: now
          };
        }

        marketState = {
          familyId: family.id,
          cards: nextCards,
          batchLoading: false,
          batchProgress: '',
          batchError: failedKeywords.length
            ? `${failedKeywords.length} recherche${failedKeywords.length > 1 ? 's' : ''} n’ont pas pu être terminées.`
            : ''
        };

        if (marketFamilyId === family.id) renderPageContent();
      }

      function marketplaceQueriesForCard(card) {
        const rawTitle = String(card?.title || '').trim();
        if (!rawTitle) return [];

        const queries = [];
        const seen = new Set();

        const add = (value) => {
          const clean = String(value || '')
            .replace(/[()[\]{}]/g, ' ')
            .replace(/[,:;!?]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const key = normalize(clean);
          if (key.length < SEARCH_MIN_LENGTH || seen.has(key)) return;
          seen.add(key);
          queries.push(clean);
        };

        // Le moteur Marketplace répond mieux au titre principal qu'aux
        // qualificatifs Wikipédia entre parenthèses.
        add(
          rawTitle
            .replace(/\s*\([^)]*\)\s*$/g, '')
            .replace(/\s*\[[^\]]*\]\s*$/g, '')
            .replace(/\s*\{[^}]*\}\s*$/g, '')
            .trim()
        );

        add(rawTitle);

        const meaningful = normalize(rawTitle)
          .split(' ')
          .filter((token) =>
            token.length >= 4 &&
            !OWNERSHIP_STOPWORDS.has(token) &&
            !/^\d+$/.test(token)
          );

        // En dernier recours, tente le terme le plus distinctif. Le card_id
        // reste le filtre de vérité, donc une requête texte plus large est sûre.
        if (meaningful.length) {
          const distinctive = [...meaningful]
            .sort((a, b) => b.length - a.length)[0];
          add(distinctive);
        }

        return queries.slice(0, 3);
      }

      async function searchMarketplaceCard(family, card) {
        if (!family?.id || !card?.id || !card?.title) return;

        setMarketCardState(family.id, card.id, {
          loading: true,
          error: '',
          listings: []
        });
        renderPageContent();

        const queries = marketplaceQueriesForCard(card);
        const listingsById = new Map();
        let lastError = null;

        for (const query of queries) {
          try {
            const listings = await searchMarketplaceQuery(
              query,
              new Set([card.id])
            );

            for (const auction of listings) {
              if (auction?.id) listingsById.set(auction.id, auction);
            }

            // Dès qu'une variante retrouve cette carte par card_id, inutile
            // d'élargir davantage la recherche.
            if (listingsById.size) break;
          } catch (error) {
            lastError = error;
          }
        }

        if (listingsById.size || !lastError) {
          setMarketCardState(family.id, card.id, {
            loading: false,
            error: '',
            listings: [...listingsById.values()],
            searchedAt: Date.now()
          });
        } else {
          setMarketCardState(family.id, card.id, {
            loading: false,
            error: String(lastError?.message || lastError),
            listings: [],
            searchedAt: Date.now()
          });
        }

        if (marketFamilyId === family.id) renderPageContent();
      }

      function openMissingMarketplace(family) {
        marketFamilyId = family.id;

        if (marketState.familyId !== family.id) {
          marketState = createEmptyMarketState(family.id);
        }

        renderPageContent();
      }

      function mapOwnedEntry(entry) {
        const card = entry?.card;
        const id = entry?.card_id || card?.id;
        if (!id) return null;

        return {
          id,
          count: Math.max(1, Number(entry?.count) || 1),
          ownedCardId: entry?.id || null
        };
      }

      async function searchOwnedByKeyword(keyword, familyIds, report, index, total) {
        const found = new Map();
        let firstPageSize = 0;
        let complete = false;

        for (let page = 0; page < MAX_OWNERSHIP_PAGES_PER_KEYWORD; page += 1) {
          const json = await fetchJson(
            `/api/my-collection?sort=rarity&q=${encodeURIComponent(keyword)}&page=${page}&stats=0`,
            { credentials: 'include' }
          );
          const rows = Array.isArray(json?.collection)
            ? json.collection
            : Array.isArray(json?.cards)
              ? json.cards
              : [];

          if (page === 0) firstPageSize = rows.length;

          for (const row of rows) {
            const owned = mapOwnedEntry(row);
            if (!owned || !familyIds.has(owned.id)) continue;

            const previous = found.get(owned.id) || {
              id: owned.id,
              count: 0,
              ownedCardIds: new Set()
            };

            previous.count += owned.count;
            if (owned.ownedCardId) previous.ownedCardIds.add(owned.ownedCardId);
            found.set(owned.id, previous);
          }

          report({
            percent: 10 + Math.round(((index + (page + 1) / MAX_OWNERSHIP_PAGES_PER_KEYWORD) / Math.max(1, total)) * 82),
            title: 'Mes cartes',
            detail: `${index + 1}/${total} : “${keyword}” • ${found.size.toLocaleString('fr-FR')} retrouvée(s)`
          });

          const hasMore = typeof json?.searchHasMore === 'boolean'
            ? json.searchHasMore
            : null;

          if (!rows.length || hasMore === false) {
            complete = true;
            break;
          }

          if (hasMore == null && firstPageSize > 0 && rows.length < firstPageSize) {
            complete = true;
            break;
          }

          await wait(45);
        }

        return {
          cards: [...found.values()].map((item) => ({
            id: item.id,
            count: Math.max(item.count, item.ownedCardIds.size || 1),
            ownedCardIds: [...item.ownedCardIds]
          })),
          complete
        };
      }

      async function completeOwnedCards(family, report) {
        const cards = family?.cards || [];
        if (!cards.length) return family;

        const plan = buildOwnershipKeywords(cards);
        const keywords = plan.keywords;

        if (!keywords.length) {
          throw new Error('Impossible de trouver des termes utiles pour vérifier cette famille.');
        }

        const familyIds = new Set(cards.map((card) => card.id).filter(Boolean));
        const owned = new Map();
        const verifiedIds = new Set();

        report({
          percent: 5,
          title: 'Mes cartes',
          detail: `${keywords.length} recherche(s) ciblée(s) pour ${cards.length.toLocaleString('fr-FR')} cartes…`
        });

        for (let index = 0; index < keywords.length; index += 1) {
          try {
            const result = await searchOwnedByKeyword(
              keywords[index],
              familyIds,
              report,
              index,
              keywords.length
            );

            for (const item of result.cards) {
              const previous = owned.get(item.id) || {
                id: item.id,
                count: 0,
                ownedCardIds: new Set()
              };
              previous.count = Math.max(previous.count, item.count || 1);
              for (const ownedId of item.ownedCardIds || []) previous.ownedCardIds.add(ownedId);
              owned.set(item.id, previous);
            }

            if (result.complete) {
              for (const id of plan.coverageByKeyword.get(keywords[index]) || []) {
                verifiedIds.add(id);
              }
            }
          } catch (error) {
            console.debug('[WM Average] vérification de possession ignorée', keywords[index], error);
          }
        }

        const nextCards = cards.map((card) => {
          const ownedInfo = owned.get(card.id);
          if (ownedInfo) {
            return {
              ...card,
              owned: true,
              ownedCount: Math.max(ownedInfo.count, ownedInfo.ownedCardIds.size || 1),
              ownershipCheckedAt: Date.now()
            };
          }

          if (verifiedIds.has(card.id)) {
            return {
              ...card,
              owned: false,
              ownedCount: 0,
              ownershipCheckedAt: Date.now()
            };
          }

          // Une recherche ciblée incomplète ne doit pas effacer un statut
          // exact connu lors de l'ajout manuel de la carte.
          return { ...card };
        });

        const updated = {
          ...family,
          cards: nextCards,
          ownershipUpdatedAt: Date.now(),
          updatedAt: family.updatedAt || Date.now()
        };

        saveFamily(updated);

        report({
          percent: 100,
          title: 'Terminé',
          detail: `${nextCards.filter((card) => card.owned === true).length.toLocaleString('fr-FR')} carte(s) possédée(s) retrouvée(s).`
        });

        return updated;
      }

      function createFamilyCard(family) {
        const stats = familyStats(family);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wm-family-card';

        const representative =
          family.cards.find((card) => card.id === family.coverCardId) ||
          family.cards.find((card) => card.imageUrl) ||
          family.cards[0] ||
          null;
        const imageUrl = representative?.imageUrl || null;

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

        const numbers = document.createElement('span');
        numbers.className = 'wm-family-card-numbers';

        if (!stats.total) {
          numbers.textContent = 'Famille vide';
        } else if (!family.ownershipUpdatedAt) {
          numbers.textContent = `${stats.total} carte${stats.total > 1 ? 's' : ''} • collection non chargée`;
        } else {
          numbers.textContent = `${stats.owned} / ${stats.total} possédée${stats.owned > 1 ? 's' : ''}`;
        }

        const progress = document.createElement('span');
        progress.className = 'wm-family-progress';
        const fill = document.createElement('span');
        fill.style.width = `${stats.percent}%`;
        progress.append(fill);

        body.append(title, numbers, progress);
        button.append(thumb, body);
        button.setAttribute('aria-label', `Ouvrir la famille ${family.name}`);

        button.addEventListener('click', () => {
          activeFamilyId = family.id;
          editingFamilyId = null;
          marketFamilyId = null;
          marketState = createEmptyMarketState(family.id);
          currentFilter = 'all';
          visibleCount = CARD_BATCH;
          if (searchState.familyId !== family.id) {
            searchState = createEmptySearchState(family.id);
          }
          renderPageContent();
        });

        return button;
      }

      function createAddCard() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wm-family-add-card';
        button.innerHTML = '<span>+</span><strong>Créer une famille</strong>';
        button.addEventListener('click', openCreateModal);
        return button;
      }

      function buildHome() {
        const wrap = document.createElement('div');
        wrap.className = 'wm-family-home';

        const heading = document.createElement('div');
        heading.className = 'wm-family-page-head';

        const copy = document.createElement('div');

        const devNote = document.createElement('p');
        devNote.className = 'wm-family-dev-note';
        devNote.textContent = 'Si les devs veulent que je travaille pour eux, j’ai un Master 2 en conception logicielle et je suis très gentil.';

        const title = document.createElement('h1');
        title.textContent = 'Familles';

        const intro = document.createElement('div');
        intro.className = 'wm-family-intro';

        const introMain = document.createElement('p');
        introMain.textContent = 'Crée tes propres familles, choisis les cartes qui en font partie et charge ta collection pour voir celles que tu possèdes. Quand des cartes te manquent, le mode Marché peut chercher directement les annonces correspondantes.';

        const introShare = document.createElement('p');
        introShare.textContent = 'Tu peux aussi importer ou exporter une famille pour la partager. Dans le futur, j’ajouterai sûrement des familles préfaites si des gens m’en envoient.';

        intro.append(introMain, introShare);
        copy.append(devNote, title, intro);

        const homeActions = document.createElement('div');
        homeActions.className = 'wm-family-home-actions';

        const importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.className = 'wm-family-secondary';
        importButton.textContent = 'Importer une famille';
        importButton.addEventListener('click', openImportModal);

        homeActions.append(importButton);
        heading.append(copy, homeActions);

        const grid = document.createElement('div');
        grid.className = 'wm-family-grid';

        const families = readFamilies();

        if (!families.length) {
          const empty = document.createElement('div');
          empty.className = 'wm-family-empty';
          empty.innerHTML = '<strong>Aucune famille</strong><span>Crée une famille puis ajoute les cartes que tu veux.</span>';

          const emptyButton = document.createElement('button');
          emptyButton.type = 'button';
          emptyButton.className = 'wm-family-primary';
          emptyButton.textContent = 'Créer une famille';
          emptyButton.addEventListener('click', openCreateModal);

          const importEmptyButton = document.createElement('button');
          importEmptyButton.type = 'button';
          importEmptyButton.className = 'wm-family-secondary';
          importEmptyButton.textContent = 'Importer une famille';
          importEmptyButton.addEventListener('click', openImportModal);

          const emptyActions = document.createElement('div');
          emptyActions.className = 'wm-family-empty-actions';
          emptyActions.append(emptyButton, importEmptyButton);

          empty.append(emptyActions);
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

        if (currentFilter === 'owned') cards = cards.filter((card) => card.owned === true);
        if (currentFilter === 'missing') cards = cards.filter((card) => card.owned === false);
        if (currentFilter === 'unchecked') cards = cards.filter((card) => card.owned == null);

        return cards.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      }

      function createRealCard(family, card, editing) {
        const element = runtime.cardExtras.createCardElement(card, {
          owned: card.owned,
          ownedCount: card.ownedCount || 0
        });

        if (!element) return null;

        const slot = document.createElement('div');
        slot.className = 'wm-family-card-slot relative isolate group';
        if (card.owned === false) slot.classList.add('is-missing');
        if (editing && family.coverCardId === card.id) slot.classList.add('is-cover-card');

        slot.append(element);

        if (editing) {
          const controls = document.createElement('div');
          controls.className = 'wm-family-edit-controls';

          const cover = document.createElement('button');
          cover.type = 'button';
          cover.className = 'wm-family-cover-button';

          if (family.coverCardId === card.id) {
            cover.classList.add('is-selected');
            cover.textContent = '★ Image actuelle';
            cover.disabled = true;
          } else {
            cover.textContent = '☆ Utiliser comme image';
            cover.addEventListener('click', () => {
              if (!setFamilyCoverCard(family.id, card.id)) return;
              renderPageContent();
            });
          }

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'wm-family-card-remove';
          remove.textContent = 'Retirer';
          remove.addEventListener('click', () => {
            if (!removeCardFromFamily(family.id, card.id)) return;
            visibleCount = CARD_BATCH;
            renderPageContent();
          });

          controls.append(cover, remove);
          slot.append(controls);
        }

        return slot;
      }

      function renderDetailGrid(family, container, options = {}) {
        const cards = filteredCards(family);
        const grid = container.querySelector('[data-role="cards"]');
        const count = container.querySelector('[data-role="count"]');
        const more = container.querySelector('[data-role="more"]');
        if (!grid || !count || !more) return;

        registerFamilyCards(family);

        const append = Boolean(options.append);
        const previousVisible = append
          ? Math.min(Number(grid.dataset.visibleCount) || 0, cards.length)
          : 0;
        const nextVisible = Math.min(visibleCount, cards.length);

        if (!append) grid.replaceChildren();

        const fragment = document.createDocumentFragment();
        const editing = editingFamilyId === family.id;

        for (const card of cards.slice(previousVisible, nextVisible)) {
          const element = createRealCard(family, card, editing);
          if (element) fragment.append(element);
        }

        grid.append(fragment);
        grid.dataset.visibleCount = String(nextVisible);
        count.textContent = `${cards.length.toLocaleString('fr-FR')} carte${cards.length > 1 ? 's' : ''}`;

        if (nextVisible < cards.length) {
          more.hidden = false;
          more.textContent = `Afficher ${Math.min(CARD_BATCH, cards.length - nextVisible)} de plus`;
        } else {
          more.hidden = true;
        }

        requestAnimationFrame(() => runtime.cardExtras.renderCardExtras());
      }

      function createMarketplaceOffer(auction) {
        const link = document.createElement('a');
        link.className = 'wm-family-market-offer';
        link.href = `/marketplace/${encodeURIComponent(auction.id)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        const priceValue = marketplacePrice(auction);
        const price = document.createElement('strong');
        price.textContent = priceValue == null
          ? 'Voir l’annonce'
          : `${new Intl.NumberFormat('fr-FR').format(priceValue)} WikiBidous`;

        const meta = document.createElement('span');
        const seller = auction?.seller?.username
          ? `par ${auction.seller.username}`
          : '';
        const end = formatMarketplaceEnd(auction?.end_at);
        meta.textContent = [seller, end ? `fin ${end}` : ''].filter(Boolean).join(' • ');

        const badges = document.createElement('span');
        badges.className = 'wm-family-market-offer-badges';

        if (auction?.is_shiny || auction?.card?.is_shiny) {
          const shiny = document.createElement('em');
          shiny.textContent = 'Shiny';
          badges.append(shiny);
        }

        const arrow = document.createElement('span');
        arrow.className = 'wm-family-market-arrow';
        arrow.textContent = '↗';

        const copy = document.createElement('span');
        copy.className = 'wm-family-market-offer-copy';
        copy.append(price, meta);

        link.append(copy, badges, arrow);
        return link;
      }

      function buildMarketplacePanel(family) {
        const panel = document.createElement('section');
        panel.className = 'wm-family-market-panel';

        const header = document.createElement('div');
        header.className = 'wm-family-market-head';

        const copy = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = 'Marché des cartes manquantes';

        const subtitle = document.createElement('p');
        subtitle.textContent = 'Cherche une carte par son nom exact, ou lance une recherche intelligente sur toutes les manquantes avec les mêmes mots-clés de couverture que « Charger mes cartes ».';
        copy.append(title, subtitle);

        const searchAll = document.createElement('button');
        searchAll.type = 'button';
        searchAll.className = 'wm-family-primary wm-family-market-all';
        searchAll.textContent = marketState.batchLoading
          ? 'Recherche en cours…'
          : 'Rechercher toutes les manquantes';
        searchAll.disabled = Boolean(marketState.batchLoading);
        searchAll.addEventListener('click', () => searchAllMissingMarketplace(family));

        header.append(copy, searchAll);
        panel.append(header);

        const missingCards = (family.cards || [])
          .filter((card) => card.owned === false)
          .sort((a, b) => a.title.localeCompare(b.title, 'fr'));

        const summary = document.createElement('div');
        summary.className = 'wm-family-market-summary';

        const searchedCount = missingCards.filter((card) => {
          const state = marketCardState(card.id);
          return state.loading || state.searchedAt;
        }).length;

        const availableCount = missingCards.filter((card) => {
          const state = marketCardState(card.id);
          return Array.isArray(state.listings) && state.listings.length > 0;
        }).length;

        if (marketState.batchLoading) {
          summary.dataset.mode = 'loading';
          summary.textContent = marketState.batchProgress || 'Recherche des cartes manquantes…';
        } else if (marketState.batchError) {
          summary.dataset.mode = 'error';
          summary.textContent = `Recherche globale interrompue : ${marketState.batchError}`;
        } else {
          summary.textContent = searchedCount
            ? `${searchedCount} / ${missingCards.length} recherchée${searchedCount > 1 ? 's' : ''} • ${availableCount} avec annonce${availableCount > 1 ? 's' : ''}`
            : `${missingCards.length} carte${missingCards.length > 1 ? 's' : ''} manquante${missingCards.length > 1 ? 's' : ''} • aucune requête lancée pour le moment`;
        }

        panel.append(summary);

        const groups = document.createElement('div');
        groups.className = 'wm-family-market-groups';

        for (const card of missingCards) {
          const state = marketCardState(card.id);
          const offers = [...(state.listings || [])].sort((a, b) => {
            const priceA = marketplacePrice(a);
            const priceB = marketplacePrice(b);

            if (priceA != null && priceB != null && priceA !== priceB) {
              return priceA - priceB;
            }

            return new Date(a?.end_at || 0) - new Date(b?.end_at || 0);
          });

          const group = document.createElement('article');
          group.className = 'wm-family-market-card';

          const identity = document.createElement('div');
          identity.className = 'wm-family-market-card-head';

          const thumb = document.createElement('div');
          thumb.className = 'wm-family-market-thumb';

          if (card.imageUrl) {
            const image = document.createElement('img');
            image.src = card.imageUrl;
            image.alt = '';
            image.loading = 'lazy';
            thumb.append(image);
          } else {
            thumb.textContent = '✦';
          }

          const cardCopy = document.createElement('div');
          const cardTitle = document.createElement('strong');
          cardTitle.textContent = card.title;

          const cardMeta = document.createElement('span');
          const stateCopy = state.loading
            ? 'Recherche en cours…'
            : state.error
              ? 'Erreur de recherche'
              : state.searchedAt
                ? offers.length
                  ? `${offers.length} annonce${offers.length > 1 ? 's' : ''} trouvée${offers.length > 1 ? 's' : ''}`
                  : 'Aucune annonce'
                : 'Pas encore recherchée';

          cardMeta.textContent = [card.rarity, stateCopy]
            .filter(Boolean)
            .join(' • ');

          cardCopy.append(cardTitle, cardMeta);

          const search = document.createElement('button');
          search.type = 'button';
          search.className = 'wm-family-secondary wm-family-market-search';
          search.textContent = state.loading
            ? 'Recherche…'
            : state.searchedAt
              ? 'Rechercher à nouveau'
              : 'Chercher sur le marché';
          search.disabled = state.loading || Boolean(marketState.batchLoading);
          search.addEventListener('click', () => searchMarketplaceCard(family, card));

          identity.append(thumb, cardCopy, search);
          group.append(identity);

          if (state.error) {
            const error = document.createElement('div');
            error.className = 'wm-family-market-card-status is-error';
            error.textContent = `Impossible de vérifier cette carte : ${state.error}`;
            group.append(error);
          } else if (state.searchedAt && !state.loading && !offers.length) {
            const none = document.createElement('div');
            none.className = 'wm-family-market-card-status';
            none.textContent = 'Aucune annonce active trouvée pour cette carte.';
            group.append(none);
          } else if (offers.length) {
            const offerList = document.createElement('div');
            offerList.className = 'wm-family-market-offers';

            const visibleOffers = offers.slice(0, 4);
            for (const offer of visibleOffers) {
              offerList.append(createMarketplaceOffer(offer));
            }

            if (offers.length > visibleOffers.length) {
              const details = document.createElement('details');
              details.className = 'wm-family-market-more';

              const summaryMore = document.createElement('summary');
              const extraCount = offers.length - visibleOffers.length;
              summaryMore.textContent = `Voir ${extraCount} autre${extraCount > 1 ? 's' : ''} annonce${extraCount > 1 ? 's' : ''}`;

              const extra = document.createElement('div');
              for (const offer of offers.slice(visibleOffers.length)) {
                extra.append(createMarketplaceOffer(offer));
              }

              details.append(summaryMore, extra);
              offerList.append(details);
            }

            group.append(offerList);
          }

          groups.append(group);
        }

        panel.append(groups);
        return panel;
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
          editingFamilyId = null;
          marketFamilyId = null;
          marketState = createEmptyMarketState();
          renderPageContent();
        });

        const actions = document.createElement('div');
        actions.className = 'wm-family-actions';

        const editing = editingFamilyId === family.id;
        const marketMode = !editing && marketFamilyId === family.id;
        wrap.classList.toggle('is-editing', editing);
        wrap.classList.toggle('is-market-mode', marketMode);

        if (editing) {
          const manage = document.createElement('button');
          manage.type = 'button';
          manage.className = 'wm-family-primary';
          manage.textContent = '+ Ajouter des cartes';
          manage.addEventListener('click', () => openCardManager(family.id));

          const done = document.createElement('button');
          done.type = 'button';
          done.className = 'wm-family-secondary';
          done.textContent = 'Terminer';
          done.addEventListener('click', () => {
            editingFamilyId = null;
            renderPageContent();
          });

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'wm-family-danger';
          remove.textContent = 'Supprimer';
          remove.addEventListener('click', () => {
            if (!window.confirm(`Supprimer « ${family.name} » ?`)) return;
            removeFamily(family.id);
            activeFamilyId = null;
            editingFamilyId = null;
            renderPageContent();
          });

          actions.append(manage, done, remove);
        } else {
          const neverLoaded = !family.ownershipUpdatedAt && family.cards.length > 0;

          const complete = document.createElement('button');
          complete.type = 'button';
          complete.className = neverLoaded
            ? 'wm-family-primary wm-family-load-attention'
            : 'wm-family-secondary';
          complete.textContent = 'Charger mes cartes';
          complete.disabled = family.cards.length === 0;
          complete.title = neverLoaded
            ? 'Charge ta collection pour identifier les cartes que tu possèdes.'
            : 'Actualise les cartes que tu possèdes dans cette famille.';
          complete.addEventListener('click', () => syncOwnedFamily(family.id));

          const exportButton = document.createElement('button');
          exportButton.type = 'button';
          exportButton.className = 'wm-family-secondary';
          exportButton.textContent = 'Exporter';
          exportButton.addEventListener('click', () => openExportModal(family.id));

          const edit = document.createElement('button');
          edit.type = 'button';
          edit.className = neverLoaded ? 'wm-family-secondary' : 'wm-family-primary';
          edit.textContent = 'Modifier';
          edit.addEventListener('click', () => {
            marketFamilyId = null;
            marketState = createEmptyMarketState(family.id);
            editingFamilyId = family.id;
            renderPageContent();
          });

          if (family.ownershipUpdatedAt && stats.missing > 0) {
            const market = document.createElement('button');
            market.type = 'button';
            market.className = marketMode
              ? 'wm-family-primary wm-family-market-toggle'
              : 'wm-family-secondary wm-family-market-toggle';
            setMarketplaceButtonContent(
              market,
              marketMode
                ? 'Retour aux cartes'
                : `Marché des manquantes (${stats.missing})`
            );
            market.title = marketMode
              ? 'Quitter le mode Marché'
              : 'Chercher les cartes manquantes actuellement en vente';

            market.addEventListener('click', () => {
              if (marketMode) {
                marketFamilyId = null;
                renderPageContent();
              } else {
                openMissingMarketplace(family);
              }
            });

            actions.append(complete, market, exportButton, edit);
          } else {
            actions.append(complete, exportButton, edit);
          }
        }

        top.append(back, actions);

        const editBanner = document.createElement('div');
        editBanner.className = 'wm-family-edit-banner';
        editBanner.hidden = !editing;
        editBanner.innerHTML = '<strong>Mode édition</strong><span>Ajoute, retire ou choisis la carte de couverture.</span>';

        const heading = document.createElement('div');
        heading.className = 'wm-family-detail-head';

        const copy = document.createElement('div');
        const title = document.createElement('h1');
        title.textContent = family.name;

        const info = document.createElement('p');
        const ownershipCopy = family.ownershipUpdatedAt
          ? `Collection chargée le ${formatDate(family.ownershipUpdatedAt)}`
          : 'Collection non chargée';
        info.textContent = `${stats.total.toLocaleString('fr-FR')} carte${stats.total > 1 ? 's' : ''} • ${ownershipCopy}`;

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
          ${stats.unchecked ? `<button type="button" data-filter="unchecked">À vérifier <strong>${stats.unchecked.toLocaleString('fr-FR')}</strong></button>` : ''}
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

        const empty = document.createElement('div');
        empty.className = 'wm-family-detail-empty';
        empty.hidden = family.cards.length > 0;
        empty.innerHTML = editing
          ? '<strong>Cette famille est vide.</strong><span>Utilise « Ajouter des cartes » pour commencer.</span>'
          : '<strong>Cette famille est vide.</strong><span>Passe en mode édition pour ajouter des cartes.</span>';

        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'wm-family-secondary wm-family-more';
        more.dataset.role = 'more';
        more.addEventListener('click', () => {
          visibleCount += CARD_BATCH;
          renderDetailGrid(family, wrap, { append: true });
        });

        if (marketMode) {
          const marketPanel = buildMarketplacePanel(family);
          wrap.append(top, editBanner, heading, progress, marketPanel);
          return wrap;
        }

        wrap.append(top, editBanner, heading, progress, filters, toolbar, empty, grid, more);
        requestAnimationFrame(() => renderDetailGrid(family, wrap));
        return wrap;
      }

      function createSearchResultRow(family, card, refresh) {
        const row = document.createElement('div');
        row.className = 'wm-family-picker-result';

        const image = document.createElement('div');
        image.className = 'wm-family-picker-thumb';
        if (card.imageUrl) {
          const img = document.createElement('img');
          img.src = card.imageUrl;
          img.alt = '';
          img.loading = 'lazy';
          image.append(img);
        } else {
          image.textContent = '✦';
        }

        const copy = document.createElement('div');
        copy.className = 'wm-family-picker-copy';

        const title = document.createElement('strong');
        title.textContent = card.title;

        const meta = document.createElement('span');
        const ownedCopy = card.owned
          ? `✓ Possédée${card.ownedCount > 1 ? ` ×${card.ownedCount}` : ''}`
          : '';
        meta.textContent = [card.rarity, card.category, ownedCopy].filter(Boolean).join(' • ');

        copy.append(title, meta);

        const selected = family.cards.some((item) => item.id === card.id);
        const action = document.createElement('button');
        action.type = 'button';
        action.className = selected
          ? 'wm-family-picker-remove'
          : 'wm-family-picker-add';
        action.textContent = selected ? 'Retirer' : '+ Ajouter';

        action.addEventListener('click', () => {
          if (selected) removeCardFromFamily(family.id, card.id);
          else addCardToFamily(family.id, card);

          refresh();
        });

        row.append(image, copy, action);
        return row;
      }

      function renderCardManagerResults(familyIdValue, overlay) {
        const family = getFamily(familyIdValue);
        if (!family || !overlay?.isConnected) return;

        const status = overlay.querySelector('[data-role="picker-status"]');
        const results = overlay.querySelector('[data-role="picker-results"]');
        const more = overlay.querySelector('[data-role="picker-more"]');
        const selected = overlay.querySelector('[data-role="picker-selected"]');
        if (!status || !results || !more || !selected) return;

        selected.textContent = `${family.cards.length.toLocaleString('fr-FR')} carte${family.cards.length > 1 ? 's' : ''} dans la famille`;

        if (searchState.loading) {
          status.textContent = 'Recherche…';
          status.dataset.mode = 'loading';
        } else if (searchState.error) {
          status.textContent = searchState.error;
          status.dataset.mode = 'error';
        } else if (!searchState.query) {
          status.textContent = 'Recherche une carte par son nom, sa catégorie ou sa description.';
          status.dataset.mode = '';
        } else {
          status.textContent = `${searchState.results.length.toLocaleString('fr-FR')} résultat${searchState.results.length > 1 ? 's' : ''} chargé${searchState.results.length > 1 ? 's' : ''}`;
          status.dataset.mode = '';
        }

        results.replaceChildren();
        const fragment = document.createDocumentFragment();

        for (const card of searchState.results) {
          fragment.append(createSearchResultRow(
            family,
            card,
            () => renderCardManagerResults(familyIdValue, overlay)
          ));
        }

        results.append(fragment);

        more.hidden = !searchState.hasMore || searchState.loading;
        more.disabled = searchState.loading;
      }

      async function runCardSearch(familyIdValue, overlay, query, append = false) {
        const clean = String(query || '').trim();

        if (clean.length < SEARCH_MIN_LENGTH) {
          searchState = {
            ...createEmptySearchState(familyIdValue),
            query: clean,
            error: clean ? `Entre au moins ${SEARCH_MIN_LENGTH} caractères.` : ''
          };
          renderCardManagerResults(familyIdValue, overlay);
          return;
        }

        const token = searchState.requestToken + 1;
        const previousPage = searchState.page;
        const page = append ? previousPage + 1 : 0;

        searchState = {
          ...searchState,
          familyId: familyIdValue,
          query: clean,
          page,
          loading: true,
          error: '',
          requestToken: token,
          results: append ? searchState.results : []
        };
        renderCardManagerResults(familyIdValue, overlay);

        try {
          const result = await searchGlobalCards(clean, page);
          if (searchState.requestToken !== token) return;

          const merged = new Map(
            (append ? searchState.results : []).map((card) => [card.id, card])
          );
          for (const card of result.cards) merged.set(card.id, card);

          searchState = {
            ...searchState,
            page,
            results: [...merged.values()],
            hasMore: result.hasMore,
            loading: false,
            error: ''
          };
        } catch (error) {
          if (searchState.requestToken !== token) return;
          searchState = {
            ...searchState,
            page: previousPage,
            loading: false,
            error: `Erreur de recherche : ${String(error?.message || error)}`
          };
        }

        renderCardManagerResults(familyIdValue, overlay);
      }

      function openCardManager(familyIdValue) {
        const family = getFamily(familyIdValue);
        if (!family || document.querySelector('.wm-family-picker-overlay')) return;

        if (searchState.familyId !== familyIdValue) {
          searchState = createEmptySearchState(familyIdValue);
        }

        const overlay = document.createElement('div');
        overlay.className = 'wm-family-modal-overlay wm-family-picker-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-family-picker-modal';

        const head = document.createElement('div');
        head.className = 'wm-family-picker-head';

        const copy = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = `Cartes de « ${family.name} »`;
        const selected = document.createElement('span');
        selected.dataset.role = 'picker-selected';
        copy.append(title, selected);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'wm-family-secondary';
        close.textContent = 'Fermer';

        head.append(copy, close);

        const form = document.createElement('form');
        form.className = 'wm-family-picker-search';

        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Rechercher parmi toutes les cartes…';
        input.value = searchState.query;
        input.autocomplete = 'off';

        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'wm-family-primary';
        submit.textContent = 'Rechercher';

        form.append(input, submit);

        const status = document.createElement('div');
        status.className = 'wm-family-picker-status';
        status.dataset.role = 'picker-status';

        const results = document.createElement('div');
        results.className = 'wm-family-picker-results';
        results.dataset.role = 'picker-results';

        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'wm-family-secondary wm-family-picker-more';
        more.dataset.role = 'picker-more';
        more.textContent = 'Charger plus';

        modal.append(head, form, status, results, more);
        overlay.append(modal);
        document.body.append(overlay);

        const closeManager = () => {
          overlay.remove();
          renderPageContent();
        };

        close.addEventListener('click', closeManager);
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) closeManager();
        });

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          runCardSearch(familyIdValue, overlay, input.value, false);
        });

        more.addEventListener('click', () => {
          runCardSearch(familyIdValue, overlay, searchState.query, true);
        });

        renderCardManagerResults(familyIdValue, overlay);
        input.focus();
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

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'wm-family-secondary';
        closeButton.textContent = 'Fermer';
        closeButton.hidden = true;

        modal.append(title, stage, detail, bar, percent, closeButton);
        overlay.append(modal);
        document.body.append(overlay);

        const close = () => overlay.remove();
        closeButton.addEventListener('click', close);

        return {
          update(progress) {
            const value = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
            stage.textContent = progress?.title || 'Synchronisation';
            detail.textContent = progress?.detail || '';
            fill.style.width = `${value}%`;
            percent.textContent = `${Math.round(value)}%`;
          },
          fail(message) {
            stage.textContent = 'Erreur';
            detail.textContent = message;
            modal.dataset.mode = 'error';
            fill.style.width = '100%';
            percent.textContent = 'Erreur';
            closeButton.hidden = false;
          },
          close
        };
      }

      async function syncOwnedFamily(familyIdValue) {
        const family = getFamily(familyIdValue);
        if (!family?.cards?.length) return;

        const progress = openProgressModal('Charger mes cartes');

        try {
          const updated = await completeOwnedCards(family, progress.update);
          registerFamilyCards(updated);
          marketFamilyId = null;
          marketState = createEmptyMarketState(familyIdValue);
          await wait(350);
          progress.close();
          renderPageContent();
        } catch (error) {
          progress.fail(String(error?.message || error));
        }
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

        content.replaceChildren(family ? buildDetail(family) : buildHome());
      }

      function ensurePage() {
        const enabled = runtime.settings.isEnabled('themeTracker');

        if (!enabled && isThemeRoute()) {
          document.documentElement.classList.remove('wm-theme-route');
          document.getElementById(PAGE_ID)?.remove();
          location.replace('/global-collection');
          return;
        }

        const active = enabled && isThemeRoute();
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

      async function openExportModal(familyIdValue) {
        if (document.querySelector('.wm-family-modal-overlay')) return;

        const family = getFamily(familyIdValue);
        if (!family) return;

        const overlay = document.createElement('div');
        overlay.className = 'wm-family-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-family-modal wm-family-share-modal';

        const title = document.createElement('h2');
        title.textContent = `Exporter « ${family.name} »`;

        const description = document.createElement('p');
        description.textContent = 'Partage ce code pour transmettre la famille. Les possessions personnelles ne sont pas incluses.';

        const status = document.createElement('div');
        status.className = 'wm-family-modal-status';
        status.textContent = 'Génération du code…';

        const textarea = document.createElement('textarea');
        textarea.className = 'wm-family-code-area';
        textarea.readOnly = true;
        textarea.spellcheck = false;
        textarea.placeholder = 'Génération…';

        const meta = document.createElement('div');
        meta.className = 'wm-family-share-meta';

        const actions = document.createElement('div');
        actions.className = 'wm-family-modal-actions';

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'wm-family-secondary';
        close.textContent = 'Fermer';

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'wm-family-primary';
        copy.textContent = 'Copier';
        copy.disabled = true;

        close.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) overlay.remove();
        });

        copy.addEventListener('click', async () => {
          if (!textarea.value) return;
          const copied = await copyText(textarea.value);
          status.dataset.mode = copied ? 'success' : 'error';
          status.textContent = copied
            ? 'Code copié.'
            : 'Impossible de copier automatiquement. Sélectionne le code manuellement.';
          if (!copied) {
            textarea.focus();
            textarea.select();
          }
        });

        actions.append(close, copy);
        modal.append(title, description, textarea, meta, status, actions);
        overlay.append(modal);
        document.body.append(overlay);

        try {
          const code = await encodeFamilyCode(family);
          if (!overlay.isConnected) return;

          textarea.value = code;
          meta.textContent = `${family.cards.length.toLocaleString('fr-FR')} carte${family.cards.length > 1 ? 's' : ''} • ${code.length.toLocaleString('fr-FR')} caractères`;
          status.textContent = code.startsWith('F1.')
            ? 'Code compressé prêt à partager.'
            : 'Code prêt à partager.';
          copy.disabled = false;
          textarea.focus();
          textarea.select();
        } catch (error) {
          status.dataset.mode = 'error';
          status.textContent = `Erreur : ${String(error?.message || error)}`;
        }
      }

      function openImportModal() {
        if (document.querySelector('.wm-family-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'wm-family-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-family-modal wm-family-share-modal';

        const title = document.createElement('h2');
        title.textContent = 'Importer une famille';

        const description = document.createElement('p');
        description.textContent = 'Colle le code reçu. La famille sera ajoutée comme une nouvelle famille.';

        const textarea = document.createElement('textarea');
        textarea.className = 'wm-family-code-area';
        textarea.spellcheck = false;
        textarea.placeholder = 'F1.H4sI…';

        const status = document.createElement('div');
        status.className = 'wm-family-modal-status';
        status.textContent = 'Les possessions seront à vérifier sur ton propre compte.';

        const actions = document.createElement('div');
        actions.className = 'wm-family-modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'wm-family-secondary';
        cancel.textContent = 'Annuler';

        const importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.className = 'wm-family-primary';
        importButton.textContent = 'Importer';

        cancel.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) overlay.remove();
        });

        importButton.addEventListener('click', async () => {
          importButton.disabled = true;
          status.dataset.mode = '';
          status.textContent = 'Lecture du code…';

          try {
            const family = await decodeFamilyCode(textarea.value);
            saveFamily(family);
            registerFamilyCards(family);

            activeFamilyId = family.id;
            editingFamilyId = null;
            currentFilter = 'all';
            visibleCount = CARD_BATCH;
            searchState = createEmptySearchState(family.id);

            overlay.remove();
            renderPageContent();
          } catch (error) {
            status.dataset.mode = 'error';
            status.textContent = String(error?.message || error);
            importButton.disabled = false;
          }
        });

        actions.append(cancel, importButton);
        modal.append(title, description, textarea, status, actions);
        overlay.append(modal);
        document.body.append(overlay);
        textarea.focus();
      }

      function openCreateModal() {
        if (document.querySelector('.wm-family-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'wm-family-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-family-modal';

        const title = document.createElement('h2');
        title.textContent = 'Créer une famille';

        const description = document.createElement('p');
        description.textContent = 'Crée la famille vide, puis choisis manuellement ses cartes.';

        const label = document.createElement('label');
        label.textContent = 'Nom';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Ex. K-pop';
        input.autocomplete = 'off';
        label.append(input);

        const status = document.createElement('div');
        status.className = 'wm-family-modal-status';

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

        const submit = () => {
          const name = input.value.trim();
          if (!name) {
            status.dataset.mode = 'error';
            status.textContent = 'Entre un nom.';
            return;
          }

          const now = Date.now();
          const family = {
            id: familyId(),
            name,
            cards: [],
            createdAt: now,
            updatedAt: now,
            ownershipUpdatedAt: null,
            mode: 'manual'
          };

          try {
            saveFamily(family);
          } catch (error) {
            status.dataset.mode = 'error';
            status.textContent = String(error?.message || error);
            return;
          }

          activeFamilyId = family.id;
          editingFamilyId = family.id;
          currentFilter = 'all';
          visibleCount = CARD_BATCH;
          searchState = createEmptySearchState(family.id);
          overlay.remove();
          renderPageContent();
          requestAnimationFrame(() => openCardManager(family.id));
        };

        create.addEventListener('click', submit);
        cancel.addEventListener('click', () => overlay.remove());
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') submit();
        });

        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) overlay.remove();
        });

        actions.append(cancel, create);
        modal.append(title, description, label, status, actions);
        overlay.append(modal);
        document.body.append(overlay);
        input.focus();
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