(() => {
  const registry = window.__wmBridgeFeatures ||= {};

  registry.bridgePrices = {
    create(runtime) {
      const { originalFetch } = runtime.core;

      window.addEventListener('wm-average-request', async (event) => {
        const { id, requestId } = event.detail || {};
        if (!id || !requestId) return;

        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const response = await originalFetch(
              `/api/marketplace/cards/${encodeURIComponent(id)}/sales?scope=summary`,
              {
                method: 'GET',
                credentials: 'include',
                headers: { accept: '*/*' }
              }
            );

            if (!response.ok) {
              const retryable = response.status >= 500 && response.status <= 599;
              lastError = new Error(`HTTP ${response.status}`);

              if (!retryable || attempt >= 3) {
                throw lastError;
              }
            } else {
              const json = await response.json();
              const averages = {};

              if (json?.summary && typeof json.summary === 'object') {
                for (const [rarity, value] of Object.entries(json.summary)) {
                  if (value && Number.isFinite(Number(value.average))) {
                    averages[rarity] = Number(value.average);
                  }
                }
              }

              window.dispatchEvent(new CustomEvent('wm-average-response', {
                detail: {
                  requestId,
                  id,
                  ok: true,
                  title: json?.wikipedia_title || null,
                  averages
                }
              }));
              return;
            }
          } catch (error) {
            lastError = error;

            const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/);
            const status = statusMatch ? Number(statusMatch[1]) : null;
            const retryable = status == null || (status >= 500 && status <= 599);

            if (!retryable || attempt >= 3) {
              break;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        }

        window.dispatchEvent(new CustomEvent('wm-average-response', {
          detail: {
            requestId,
            id,
            ok: false,
            retryAfterMs: 60 * 1000,
            error: String(lastError?.message || lastError || 'Erreur réseau')
          }
        }));
      });


      return {};
    }
  };
})();
