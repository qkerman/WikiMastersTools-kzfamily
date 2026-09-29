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
      const RETRY_ATTEMPTS = 4;
      const RECOVERY_ATTEMPTS = 3;

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

      function retryDelay(attempt) {
        return Math.min(5000, 550 * (2 ** Math.max(0, attempt - 1)));
      }

      function shouldRetry(error) {
        const status = Number(error?.status);
        if (!Number.isFinite(status)) return true;
        return status === 408 || status === 425 || status === 429 || status >= 500;
      }

      function emitProgress(detail) {
        window.dispatchEvent(new CustomEvent('wm-average-family-resolve-progress', {
          detail
        }));
      }

      async function fetchBatchOnce(template, titles) {
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

        let response;

        try {
          response = await originalFetch(url.toString(), {
            method: 'GET',
            credentials: 'omit',
            headers
          });
        } catch (error) {
          const wrapped = new Error(String(error?.message || error || 'Failed to fetch'));
          wrapped.cause = error;
          throw wrapped;
        }

        if (!response.ok) {
          const error = new Error(`WikiMasters : HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }

        const json = await response.json();
        return Array.isArray(json) ? json.map(mapCard).filter(Boolean) : [];
      }

      async function fetchBatchWithRetry({
        requestId,
        template,
        titles,
        batch,
        batches,
        maxAttempts = RETRY_ATTEMPTS,
        phase = 'normal'
      }) {
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            return await fetchBatchOnce(template, titles);
          } catch (error) {
            lastError = error;

            if (attempt >= maxAttempts || !shouldRetry(error)) {
              break;
            }

            const delayMs = retryDelay(attempt);

            emitProgress({
              requestId,
              batch,
              batches,
              retryAttempt: attempt + 1,
              retryMax: maxAttempts,
              retryDelayMs: delayMs,
              retryError: String(error?.message || error),
              phase
            });

            await sleep(delayMs);

            // Un nouveau token/header a pu être observé entre-temps.
            template = getSupabaseRequestTemplate() || template;
          }
        }

        throw lastError || new Error('Lot WikiMasters indisponible');
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
              detail: { requestId, ok: true, cards: [], totalTitles: 0, failedBatches: 0 }
            }));
            return;
          }

          let template = await waitForTemplate();
          if (!template?.headers || !Object.keys(template.headers).length) {
            throw new Error('Connexion au catalogue WikiMasters non détectée. Recharge la page puis réessaie.');
          }

          const cardsById = new Map();
          const batches = [];

          for (let index = 0; index < titles.length; index += BATCH_SIZE) {
            batches.push(titles.slice(index, index + BATCH_SIZE));
          }

          let failed = [];

          for (let index = 0; index < batches.length; index += 1) {
            try {
              const cards = await fetchBatchWithRetry({
                requestId,
                template,
                titles: batches[index],
                batch: index + 1,
                batches: batches.length
              });

              for (const card of cards) {
                cardsById.set(card.id, card);
              }
            } catch (error) {
              failed.push({
                index,
                titles: batches[index],
                error: String(error?.message || error)
              });
            }

            emitProgress({
              requestId,
              batch: index + 1,
              batches: batches.length,
              processedTitles: Math.min((index + 1) * BATCH_SIZE, titles.length),
              totalTitles: titles.length,
              matchedCards: cardsById.size,
              failedBatches: failed.length,
              phase: 'normal'
            });
          }

          // Deuxième passage uniquement sur les lots qui ont vraiment échoué.
          if (failed.length) {
            const retryList = failed;
            failed = [];
            template = getSupabaseRequestTemplate() || template;

            for (let recoveryIndex = 0; recoveryIndex < retryList.length; recoveryIndex += 1) {
              const item = retryList[recoveryIndex];

              emitProgress({
                requestId,
                batch: item.index + 1,
                batches: batches.length,
                matchedCards: cardsById.size,
                recoveryIndex: recoveryIndex + 1,
                recoveryTotal: retryList.length,
                phase: 'recovery'
              });

              try {
                const cards = await fetchBatchWithRetry({
                  requestId,
                  template,
                  titles: item.titles,
                  batch: item.index + 1,
                  batches: batches.length,
                  maxAttempts: RECOVERY_ATTEMPTS,
                  phase: 'recovery'
                });

                for (const card of cards) {
                  cardsById.set(card.id, card);
                }
              } catch (error) {
                failed.push({
                  ...item,
                  error: String(error?.message || error)
                });
              }
            }
          }

          window.dispatchEvent(new CustomEvent('wm-average-family-resolve-result', {
            detail: {
              requestId,
              ok: true,
              cards: [...cardsById.values()],
              totalTitles: titles.length,
              failedBatches: failed.length,
              failedTitles: failed.reduce((sum, item) => sum + item.titles.length, 0),
              partial: failed.length > 0,
              warnings: failed.map((item) => item.error)
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