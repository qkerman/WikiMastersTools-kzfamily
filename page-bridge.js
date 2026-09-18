(() => {
  if (window.__wmAveragePriceBridgeInstalled) return;
  window.__wmAveragePriceBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);

  function emitCollection(json) {
    if (!json || !Array.isArray(json.collection)) return;

    const cards = json.collection
      .map((entry) => {
        const card = entry && entry.card;
        const id = (entry && entry.card_id) || (card && card.id);
        const title = card && card.wikipedia_title;
        return id && title ? { id, title } : null;
      })
      .filter(Boolean);

    if (!cards.length) return;

    window.dispatchEvent(new CustomEvent('wm-average-collection', {
      detail: { cards }
    }));
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url;
      if (url && url.includes('/api/my-collection')) {
        response.clone().json().then(emitCollection).catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const origOpen = OriginalXHR.prototype.open;
    const origSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function(method, url, ...rest) {
      this.__wmUrl = typeof url === 'string' ? url : String(url || '');
      return origOpen.call(this, method, url, ...rest);
    };

    OriginalXHR.prototype.send = function(...args) {
      if (this.__wmUrl && this.__wmUrl.includes('/api/my-collection')) {
        this.addEventListener('load', () => {
          try {
            const json = JSON.parse(this.responseText);
            emitCollection(json);
          } catch (_) {}
        }, { once: true });
      }
      return origSend.apply(this, args);
    };
  }

  window.addEventListener('wm-average-request', async (event) => {
    const { id, requestId } = event.detail || {};
    if (!id || !requestId) return;

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
        throw new Error(`HTTP ${response.status}`);
      }

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
    } catch (error) {
      window.dispatchEvent(new CustomEvent('wm-average-response', {
        detail: {
          requestId,
          id,
          ok: false,
          error: String(error?.message || error)
        }
      }));
    }
  });

  console.debug('[WM Average] bridge installé');
})();