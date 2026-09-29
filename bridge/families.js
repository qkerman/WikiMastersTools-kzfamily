(() => {
  const registry = window.__wmBridgeFeatures ||= {};

  registry.bridgeFamilies = {
    create(runtime) {
      const {
        originalFetch,
        getSupabaseRequestTemplate
      } = runtime.core;

      const SUPABASE_HOST = 'cyrxjeppjqsxxjayfrur.supabase.co';
      const BATCH_SIZE = 40;
      const TEMPLATE_WAIT_MS = 5000;

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      async function waitForTemplate() {
        const started = Date.now();

        while (Date.now() - started < TEMPLATE_WAIT_MS) {
          const template = getSupabaseRequestTemplate();
          if (template?.headers && Object.keys(template.headers).length) return template;
          await sleep(100);
        }

        return getSupabaseRequestTemplate();
      }

      function quotePostgrest(value) {
        return `"${String(value || '')
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')}"`;
      }

      function mapCard(row) {
        if (!row?.id || !row?.wikipedia_title) return null;

        return {
          id: row.id,
          title: row.wikipedia_title,
          rarity: row.rarity || null,
          category: row.category || null,
          imageUrl: row.image_url || null,
          wikipediaUrl: row.wikipedia_url || null,
          atk: Number.isFinite(Number(row.atk)) ? Number(row.atk) : null,
          def: Number.isFinite(Number(row.def)) ? Number(row.def) : null
        };
      }

      async function fetchBatch(template, titles) {
        const url = new URL(`https://${SUPABASE_HOST}/rest/v1/cards`);
        url.searchParams.set(
          'select',
          'id,wikipedia_title,rarity,category,image_url,wikipedia_url,atk,def'
        );
        url.searchParams.set(
          'wikipedia_title',
          `in.(${titles.map(quotePostgrest).join(',')})`
        );
        url.searchParams.set('limit', String(Math.max(50, titles.length * 2)));

        const headers = { ...(template?.headers || {}) };
        delete headers.range;
        delete headers.Range;
        delete headers['content-range'];
        delete headers['Content-Range'];
        delete headers['if-none-match'];
        delete headers['If-None-Match'];

        const response = await originalFetch(url.toString(), {
          method: 'GET',
          credentials: 'omit',
          headers
        });

        if (!response.ok) {
          throw new Error(`WikiMasters : HTTP ${response.status}`);
        }

        const json = await response.json();
        return Array.isArray(json) ? json.map(mapCard).filter(Boolean) : [];
      }

      async function resolveTitles(requestId, rawTitles) {
        try {
          const titles = [...new Set(
            (Array.isArray(rawTitles) ? rawTitles : [])
              .map((value) => String(value || '').trim())
              .filter(Boolean)
          )];

          if (!titles.length) {
            window.dispatchEvent(new CustomEvent('wm-average-family-resolve-result', {
              detail: { requestId, ok: true, cards: [], totalTitles: 0 }
            }));
            return;
          }

          const template = await waitForTemplate();
          if (!template?.headers || !Object.keys(template.headers).length) {
            throw new Error('Connexion au catalogue WikiMasters non détectée. Recharge la page puis réessaie.');
          }

          const cardsById = new Map();
          const batches = [];

          for (let index = 0; index < titles.length; index += BATCH_SIZE) {
            batches.push(titles.slice(index, index + BATCH_SIZE));
          }

          for (let index = 0; index < batches.length; index += 1) {
            const cards = await fetchBatch(template, batches[index]);

            for (const card of cards) {
              cardsById.set(card.id, card);
            }

            window.dispatchEvent(new CustomEvent('wm-average-family-resolve-progress', {
              detail: {
                requestId,
                batch: index + 1,
                batches: batches.length,
                processedTitles: Math.min((index + 1) * BATCH_SIZE, titles.length),
                totalTitles: titles.length,
                matchedCards: cardsById.size
              }
            }));
          }

          window.dispatchEvent(new CustomEvent('wm-average-family-resolve-result', {
            detail: {
              requestId,
              ok: true,
              cards: [...cardsById.values()],
              totalTitles: titles.length
            }
          }));
        } catch (error) {
          window.dispatchEvent(new CustomEvent('wm-average-family-resolve-result', {
            detail: {
              requestId,
              ok: false,
              cards: [],
              error: String(error?.message || error)
            }
          }));
        }
      }

      window.addEventListener('wm-average-family-resolve', (event) => {
        const requestId = event.detail?.requestId;
        if (!requestId) return;
        resolveTitles(requestId, event.detail?.titles);
      });

      return { resolveTitles };
    }
  };
})();