(() => {
  const registry = window.__wmBridgeFeatures ||= {};

  registry.bridgeThemes = {
    create(runtime) {
      const {
        originalFetch,
        getGlobalCardsRequestTemplate,
        extractGlobalCards
      } = runtime.core;

      const CATALOGUE_PAGE_SIZE = 1000;
      const MAX_CATALOGUE_PAGES = 80;

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      function normalizeTitle(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('fr')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function rarityFromElement(element) {
        let current = element;
        for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
          const classes = [...(current.classList || [])];
          for (const rarity of ['L', 'UR', 'SR', 'R', 'PC', 'C']) {
            if (classes.some((name) => name === `glow-${rarity.toLowerCase()}`)) {
              return rarity;
            }
          }
        }
        return null;
      }

      function idFromElement(element, title) {
        let current = element;
        for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
          const direct =
            current.dataset?.wmCardId ||
            current.dataset?.cardId ||
            current.getAttribute?.('data-card-id') ||
            null;
          if (direct) return direct;

          const href = current.getAttribute?.('href') || '';
          const match = href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          if (match) return match[0];
        }

        return `title:${normalizeTitle(title)}`;
      }

      function extractCatalogueFromDocument() {
        const result = new Map();
        const main = document.querySelector('main');
        if (!main) return [];

        for (const heading of main.querySelectorAll('h3')) {
          if (heading.closest('#wm-theme-tracker-page')) continue;

          const title = String(heading.textContent || '').replace(/\s+/g, ' ').trim();
          if (!title) continue;

          const card =
            heading.closest('div[class*="glow-"]') ||
            heading.closest('div[class*="rounded-2xl"][class*="overflow-hidden"]') ||
            heading.closest('article:has(img)');

          if (!card || card.closest('#wm-theme-tracker-page')) continue;

          const image = card.querySelector('img');
          const id = idFromElement(card, title);
          const key = normalizeTitle(title);

          const meta = {
            id,
            title,
            rarity: rarityFromElement(card),
            imageUrl: image?.currentSrc || image?.src || null,
            wikipediaUrl: null,
            summary: '',
            count: 1
          };

          const previous = result.get(key);
          result.set(key, previous ? {
            ...previous,
            ...meta,
            rarity: meta.rarity || previous.rarity || null,
            imageUrl: meta.imageUrl || previous.imageUrl || null
          } : meta);
        }

        return [...result.values()];
      }

      async function waitForNativeCatalogue(timeoutMs = 6000) {
        const started = Date.now();
        let best = [];
        let unchangedSince = Date.now();

        while (Date.now() - started < timeoutMs) {
          const cards = extractCatalogueFromDocument();

          if (cards.length > best.length) {
            best = cards;
            unchangedSince = Date.now();
          }

          if (best.length > 0 && Date.now() - unchangedSince >= 900) {
            break;
          }

          await sleep(180);
        }

        return best;
      }

      async function waitForCatalogueTemplate(timeoutMs = 2200) {
        const started = Date.now();

        while (Date.now() - started < timeoutMs) {
          const template = getGlobalCardsRequestTemplate();
          if (template?.url) return template;
          await sleep(100);
        }

        return getGlobalCardsRequestTemplate();
      }

      async function fetchFromSupabaseTemplate(template, requestId) {
        const base = new URL(template.url, location.origin);
        base.search = '';
        base.searchParams.set(
          'select',
          'id,wikipedia_title,rarity,image_url,wikipedia_url,summary'
        );

        const headers = { ...(template.headers || {}) };
        delete headers.range;
        delete headers.Range;
        delete headers['content-range'];
        delete headers['Content-Range'];
        delete headers['if-none-match'];
        delete headers['If-None-Match'];

        const merged = new Map();
        let complete = false;

        for (let page = 0; page < MAX_CATALOGUE_PAGES; page += 1) {
          const url = new URL(base.toString());
          url.searchParams.set('limit', String(CATALOGUE_PAGE_SIZE));
          url.searchParams.set('offset', String(page * CATALOGUE_PAGE_SIZE));

          const response = await originalFetch(url.toString(), {
            method: 'GET',
            credentials: 'include',
            headers
          });

          if (!response.ok) {
            throw new Error(`Catalogue global : HTTP ${response.status}`);
          }

          const json = await response.json();
          const cards = extractGlobalCards(json);

          for (const card of cards) {
            if (card?.id) merged.set(card.id, card);
          }

          window.dispatchEvent(new CustomEvent('wm-average-theme-catalogue-progress', {
            detail: {
              requestId,
              loaded: merged.size,
              page: page + 1
            }
          }));

          if (cards.length < CATALOGUE_PAGE_SIZE) {
            complete = true;
            break;
          }
        }

        return {
          cards: [...merged.values()],
          complete,
          source: 'api'
        };
      }

      async function fetchAllCatalogue(requestId) {
        try {
          const template = await waitForCatalogueTemplate();

          if (template?.url) {
            const apiResult = await fetchFromSupabaseTemplate(template, requestId);

            window.dispatchEvent(new CustomEvent('wm-average-theme-catalogue-result', {
              detail: {
                requestId,
                ok: true,
                ...apiResult
              }
            }));
            return;
          }

          const cards = await waitForNativeCatalogue();

          if (!cards.length) {
            throw new Error('Aucune carte n’a pu être lue depuis « Toutes les cartes ».');
          }

          window.dispatchEvent(new CustomEvent('wm-average-theme-catalogue-result', {
            detail: {
              requestId,
              ok: true,
              cards,
              complete: false,
              source: 'page'
            }
          }));
        } catch (error) {
          window.dispatchEvent(new CustomEvent('wm-average-theme-catalogue-result', {
            detail: {
              requestId,
              ok: false,
              cards: [],
              complete: false,
              source: 'none',
              error: String(error?.message || error)
            }
          }));
        }
      }

      window.addEventListener('wm-average-theme-load-catalogue', (event) => {
        const requestId = event.detail?.requestId;
        if (requestId) fetchAllCatalogue(requestId);
      });

      return { fetchAllCatalogue };
    }
  };
})();