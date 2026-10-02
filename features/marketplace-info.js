(() => {
  const registry = window.__wmAverageFeatures ||= {};

  // Page Marché, onglet « Mes ventes » uniquement : sous chaque annonce, affiche le prix de départ et le nombre d'enchères.
  //  - sans mise : le site affiche « Mise de départ » → départ lu dans la carte, 0 enchère, aucune requête ;
  //  - avec mises : le site affiche « Mise actuelle » → départ et nombre d'enchères lus dans la fiche de l'annonce.
  // Les informations déjà connues sont gardées en cache (localStorage) : tant que la mise actuelle affichée n'est pas
  // supérieure à celle du cache, rien n'est redemandé ; sinon on met à jour le texte (l'ancien reste affiché en attendant).
  registry.marketplaceInfo = {
    create(runtime) {
      const { isMarketplacePage, isMarketplaceDetailPage, readLocalValue, writeLocalValue } = runtime.core;

      const INFO_CLASS = 'wm-marketplace-info';
      const STORAGE_KEY = 'wm_marketplace_info_v1';
      const AUCTION_HREF = /^\/marketplace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
      const MAX_PARALLEL = 2;
      const REQUEST_GAP_MS = 150;
      const RETRY_AFTER_MS = 60 * 1000;
      const KEEP_MS = 3 * 24 * 60 * 60 * 1000; // une enchère dure 24 h au plus : on oublie le reste
      const MAX_CACHED = 500;

      // idAnnonce -> { amount (mise actuelle connue), start, bids, t }
      const cache = loadCache();
      const failures = new Map(); // idAnnonce -> instant du prochain essai
      // nombre d'enchères et mise actuelle connus à la première apparition de l'annonce dans cette page : servent à afficher
      // « (+N) » et « +X W » (nouveautés depuis le cache précédent, c'est-à-dire depuis ta dernière visite ou le dernier chargement)
      const baseline = new Map();
      const queue = [];
      const queued = new Set();
      let running = 0;
      let observer = null;

      const numberFormat = new Intl.NumberFormat('fr-FR');

      function loadCache() {
        const map = new Map();
        const stored = readLocalValue(STORAGE_KEY);
        if (!stored || typeof stored !== 'object') return map;

        for (const [id, entry] of Object.entries(stored)) {
          if (entry && Number.isFinite(entry.amount) && Number.isFinite(entry.t) && Date.now() - entry.t < KEEP_MS) {
            map.set(id, entry);
          }
        }
        return map;
      }

      function persist() {
        const entries = [...cache.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, MAX_CACHED);
        writeLocalValue(STORAGE_KEY, Object.fromEntries(entries));
      }

      function parseAmount(text) {
        const digits = String(text || '').replace(/[^\d]/g, '');
        return digits ? Number(digits) : null;
      }

      function bidsLabel(count) {
        return `${count} enchère${count > 1 ? 's' : ''}`;
      }

      function textFor(entry, gain = 0, priceGain = 0) {
        const start = entry.start == null ? '?' : numberFormat.format(entry.start);
        const bids = entry.bids;
        // nouveautés depuis le cache précédent, sur une 2e ligne : d'abord la hausse du prix, puis les enchères en plus
        const delta = [
          priceGain > 0 ? `+${numberFormat.format(priceGain)} W` : null,
          gain > 0 ? `+${gain} enchère${gain > 1 ? 's' : ''}` : null
        ].filter(Boolean).join(' · ');
        return {
          text: `Départ ${start} W · ${bids == null ? '? enchères' : bidsLabel(bids)}`,
          tone: bids == null ? null : (bids > 0 ? 'some' : 'none'),
          delta
        };
      }

      function readCard(anchor) {
        const label = [...anchor.querySelectorAll('span')]
          .find((span) => /^mise (de départ|actuelle)$/i.test(span.textContent.trim()));
        if (!label || !label.parentElement) return null;

        const holder = label.parentElement;
        return {
          hasBid: /actuelle/i.test(label.textContent),
          amount: parseAmount(holder.textContent.replace(label.textContent, ''))
        };
      }

      function setInfo(anchor, text, tone, delta = '') {
        let info = anchor.querySelector(`:scope > .${INFO_CLASS}`);
        if (!info) {
          info = document.createElement('div');
          info.className = INFO_CLASS;
          anchor.append(info);
        }

        let main = info.querySelector(':scope > .wm-marketplace-info-main');
        if (!main) {
          info.textContent = '';
          main = document.createElement('div');
          main.className = 'wm-marketplace-info-main';
          info.append(main);
        }
        if (main.textContent !== text) main.textContent = text;

        let news = info.querySelector(':scope > .wm-marketplace-info-delta');
        if (delta) {
          if (!news) {
            news = document.createElement('div');
            news.className = 'wm-marketplace-info-delta';
            info.append(news);
          }
          if (news.textContent !== delta) news.textContent = delta;
        } else {
          news?.remove();
        }

        info.classList.toggle('is-zero-bids', tone === 'none');
        info.classList.toggle('has-bids', tone === 'some');
      }

      function removeAll() {
        for (const node of document.querySelectorAll(`.${INFO_CLASS}`)) node.remove();
      }

      async function load(id, shownAmount) {
        try {
          const response = await fetch(`/api/marketplace/${encodeURIComponent(id)}`, {
            method: 'GET',
            credentials: 'include',
            headers: { accept: '*/*' }
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const json = await response.json();
          const auction = json?.auction || {};
          const start = Number(auction.listing_base_amount ?? auction.base_amount);
          const current = Number(auction.current_bid ?? auction.effective_bid);

          cache.set(id, {
            // mise actuelle réellement connue (la carte affichée peut avoir quelques secondes de retard)
            amount: Number.isFinite(current) ? Math.max(current, shownAmount) : shownAmount,
            start: Number.isFinite(start) ? start : null,
            bids: Array.isArray(json?.bids) ? json.bids.length : null,
            t: Date.now()
          });
          failures.delete(id);
          persist();
        } catch (_) {
          failures.set(id, Date.now() + RETRY_AFTER_MS);
        }
      }

      function pump() {
        if (!isMySalesTab()) { // on a quitté « Mes ventes » : on abandonne les requêtes en attente
          queue.length = 0;
          queued.clear();
          return;
        }
        while (running < MAX_PARALLEL && queue.length) {
          const { id, amount } = queue.shift();
          queued.delete(id);
          running += 1;

          load(id, amount).finally(() => {
            running -= 1;
            render();
            setTimeout(pump, REQUEST_GAP_MS);
          });
        }
      }

      function enqueue(id, amount) {
        if (queued.has(id)) return;
        queued.add(id);
        queue.push({ id, amount });
        pump();
      }

      function getObserver() {
        observer ||= new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (!isMySalesTab()) { observer.unobserve(entry.target); continue; }
            observer.unobserve(entry.target);
            const id = entry.target.dataset.wmAuctionId;
            const amount = Number(entry.target.dataset.wmAuctionAmount);
            if (id && Number.isFinite(amount)) enqueue(id, amount);
          }
        }, { rootMargin: '300px 0px' });
        return observer;
      }

      // Onglet actif de la page Marché : le site marque l'onglet courant d'un soulignement (border-b-2).
      // L'affichage ne concerne que « Mes ventes » : ni la liste générale (« Parcourir »), ni les autres onglets.
      function isMySalesTab() {
        const tabs = [...document.querySelectorAll('main button')]
          .filter((button) => /^(Parcourir|Mes ventes|Mes enchères|Gagnées|Historique)/i.test(button.textContent.trim()));
        const active = tabs.find((button) => /(^|\s)border-b-2(\s|$)/.test(button.className));
        return Boolean(active && /^Mes ventes/i.test(active.textContent.trim()));
      }

      function isBidsPage() {
        try {
          return new URLSearchParams(location.search).get('wm') === 'bids';
        } catch (_) {
          return false;
        }
      }

      function render() {
        if (!runtime.settings.isEnabled('marketplaceInfo')) {
          removeAll();
          return;
        }
        if (!isMarketplacePage() || isMarketplaceDetailPage() || isBidsPage()) return;
        if (!isMySalesTab()) {
          removeAll(); // autre onglet : aucune info affichée, aucune requête
          return;
        }

        let dirty = false;

        for (const anchor of document.querySelectorAll('a[href^="/marketplace/"]')) {
          const match = AUCTION_HREF.exec(anchor.getAttribute('href') || '');
          if (!match) continue;

          const card = readCard(anchor);
          if (!card || card.amount == null) continue;

          const id = match[1];

          if (!card.hasBid) {
            setInfo(anchor, `Départ ${numberFormat.format(card.amount)} W · 0 enchère`, 'none');
            // on retient « 0 enchère » (sans requête) : à la prochaine visite, les enchères arrivées depuis s'afficheront en « +N »
            if (!baseline.has(id)) baseline.set(id, { bids: 0, amount: card.amount });
            if (!cache.has(id)) {
              cache.set(id, { amount: card.amount, start: card.amount, bids: 0, t: Date.now() });
              dirty = true;
            }
            continue;
          }

          const known = cache.get(id);

          if (known) {
            if (!baseline.has(id)) baseline.set(id, { bids: known.bids ?? 0, amount: known.amount });
            const before = baseline.get(id);
            const { text, tone, delta } = textFor(known, (known.bids ?? 0) - before.bids, known.amount - before.amount);
            setInfo(anchor, text, tone, delta);
            // les mises ne font que monter : si la mise affichée n'est pas plus haute que celle du cache, il est à jour
            // sauf si le cache dit « 0 enchère » alors qu'une mise existe (1re mise placée pile au prix de départ)
            if (card.amount <= known.amount && (known.bids ?? 0) > 0) continue;
          } else if (failures.has(id)) {
            setInfo(anchor, 'Départ et enchères indisponibles', null);
          } else {
            setInfo(anchor, 'Départ … · … enchères', null);
          }

          if (Date.now() < (failures.get(id) || 0)) continue;

          anchor.dataset.wmAuctionId = id;
          anchor.dataset.wmAuctionAmount = String(card.amount);
          getObserver().observe(anchor);
        }

        if (dirty) persist();
      }

      return { render };
    }
  };
})();
