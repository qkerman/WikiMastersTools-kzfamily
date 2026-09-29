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
      const MAX_CONCURRENT_BATCHES = 2;
      const MIN_SPLIT_BATCH_SIZE = 10;

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

          let cursor = 0;
          let completedBatches = 0;
          let failed = [];

          const runInitialWorker = async () => {
            while (true) {
              const index = cursor;
              cursor += 1;
              if (index >= batches.length) return;

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

              completedBatches += 1;
              emitProgress({
                requestId,
                batch: index + 1,
                batches: batches.length,
                completedBatches,
                processedTitles: Math.min(completedBatches * BATCH_SIZE, titles.length),
                totalTitles: titles.length,
                matchedCards: cardsById.size,
                failedBatches: failed.length,
                phase: 'normal'
              });
            }
          };

          await Promise.all(
            Array.from(
              { length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) },
              () => runInitialWorker()
            )
          );

          const finalFailures = [];

          async function recoverTitles(item, titlesToRecover, depth = 0) {
            try {
              template = getSupabaseRequestTemplate() || template;
              const cards = await fetchBatchWithRetry({
                requestId,
                template,
                titles: titlesToRecover,
                batch: item.index + 1,
                batches: batches.length,
                maxAttempts: RECOVERY_ATTEMPTS,
                phase: 'recovery'
              });

              for (const card of cards) {
                cardsById.set(card.id, card);
              }
              return;
            } catch (error) {
              if (
                titlesToRecover.length > MIN_SPLIT_BATCH_SIZE &&
                depth < 2
              ) {
                const middle = Math.ceil(titlesToRecover.length / 2);
                const halves = [
                  titlesToRecover.slice(0, middle),
                  titlesToRecover.slice(middle)
                ].filter((part) => part.length);

                for (const half of halves) {
                  await recoverTitles(item, half, depth + 1);
                }
                return;
              }

              finalFailures.push({
                index: item.index,
                titles: titlesToRecover,
                error: String(error?.message || error)
              });
            }
          }

          if (failed.length) {
            const retryList = failed;
            failed = [];

            for (let recoveryIndex = 0; recoveryIndex < retryList.length; recoveryIndex += 1) {
              const item = retryList[recoveryIndex];

              emitProgress({
                requestId,
                batch: item.index + 1,
                batches: batches.length,
                completedBatches,
                matchedCards: cardsById.size,
                recoveryIndex: recoveryIndex + 1,
                recoveryTotal: retryList.length,
                phase: 'recovery'
              });

              await recoverTitles(item, item.titles);
            }
          }

          window.dispatchEvent(new CustomEvent('wm-average-family-resolve-result', {
            detail: {
              requestId,
              ok: true,
              cards: [...cardsById.values()],
              totalTitles: titles.length,
              failedBatches: finalFailures.length,
              failedTitles: finalFailures.reduce((sum, item) => sum + item.titles.length, 0),
              partial: finalFailures.length > 0,
              warnings: finalFailures.map((item) => item.error)
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