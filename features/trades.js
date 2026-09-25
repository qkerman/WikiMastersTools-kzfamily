(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.trades = {
    create(deps) {
      const { isTradesPage, normalizeTitle, cardMetaById, idByTitle, cacheMemory, renderCollectionCard, reportError, loadCacheForCards, createSponsorNote, formatAverage, chooseAverage, registerCards, isFeatureEnabled } = deps;
      const tradesById = new Map();
      const activeTradeValueIds = new Set();
      let tradesRequested = false;
      function ensureTradesLoaded() {
        if (!isFeatureEnabled('tradeValues')) return;
        if (!isTradesPage() || tradesRequested) return;
        tradesRequested = true;
        window.dispatchEvent(new CustomEvent('wm-average-load-trades'));
      }
    
      function getTradeDetailModal() {
        if (!isTradesPage()) return null;
    
        const heading = [...document.querySelectorAll('h2')]
          .find((el) => normalizeTitle(el.textContent) === "Détail de l'échange");
    
        if (!heading) return null;
    
        return heading.closest('div[class*="fixed"][class*="inset-0"]') || heading.parentElement?.parentElement || null;
      }
    
      function renderTradeDetailCard(id) {
        if (!isFeatureEnabled('tradeValues')) return;
        if (!isTradesPage()) return;
    
        const meta = cardMetaById.get(id);
        if (!meta?.title) return;
    
        const modal = getTradeDetailModal();
        if (!modal) return;
    
        for (const h3 of modal.querySelectorAll('h3')) {
          if (normalizeTitle(h3.textContent) !== normalizeTitle(meta.title)) continue;
    
          const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
          if (card) {
            renderCollectionCard(id, card, { force: true });
          }
        }
      }
    
      function renderTradeDetailCards() {
        if (!isFeatureEnabled('tradeValues')) return;
        const modal = getTradeDetailModal();
        if (!modal) return;
    
        const cardsToLoad = new Map();
    
        for (const h3 of modal.querySelectorAll('h3')) {
          const id = idByTitle.get(normalizeTitle(h3.textContent));
          if (!id) continue;
    
          const card = h3.closest('div[class*="rounded-2xl"][class*="overflow-hidden"][class*="cursor-pointer"]');
          if (!card) continue;
    
          renderCollectionCard(id, card, { force: true });
    
          const meta = cardMetaById.get(id);
          if (meta?.id && meta?.title) {
            cardsToLoad.set(id, meta);
          }
        }
    
        if (!cardsToLoad.size) return;
    
        try {
          loadCacheForCards([...cardsToLoad.values()]);
        } catch (error) {
          reportError('prix cartes détail échange', error);
        }
      }
    
      function getTradeCardElements() {
        return [...document.querySelectorAll('.card-frame')].filter((card) =>
          [...card.querySelectorAll('button[aria-label]')].some(
            (button) => normalizeTitle(button.getAttribute('aria-label')) === "Voir le détail de l'échange"
          )
        );
      }
    
      function tradeMatchScore(cardEl, trade, usedIds) {
        if (!trade || usedIds.has(trade.id)) return -Infinity;
    
        const titled = new Set(
          [...cardEl.querySelectorAll('[title]')]
            .map((el) => normalizeTitle(el.getAttribute('title')))
            .filter(Boolean)
        );
    
        const itemTitles = trade.items.map((item) => normalizeTitle(item.card?.title)).filter(Boolean);
        const matchedItems = itemTitles.filter((title) => titled.has(title)).length;
        const text = normalizeTitle(cardEl.textContent).toLocaleLowerCase('fr');
    
        let score = 0;
        if (itemTitles.length) {
          score += matchedItems * 30;
          if (matchedItems === itemTitles.length) score += 100;
          else score -= (itemTitles.length - matchedItems) * 20;
        }
    
        for (const username of [trade.initiator?.username, trade.recipient?.username]) {
          const normalized = normalizeTitle(username).toLocaleLowerCase('fr');
          if (normalized && text.includes(normalized)) score += 12;
        }
    
        return score;
      }
    
      function findTradeForCard(cardEl, usedIds) {
        const presetId = cardEl.dataset.wmTradeId;
        if (presetId && tradesById.has(presetId) && !usedIds.has(presetId)) {
          return tradesById.get(presetId);
        }
    
        let best = null;
        let bestScore = 0;
    
        for (const trade of tradesById.values()) {
          const score = tradeMatchScore(cardEl, trade, usedIds);
          if (score > bestScore) {
            bestScore = score;
            best = trade;
          }
        }
    
        return best;
      }
    
      function getTradeCards(trade) {
        return trade.items.map((item) => item.card).filter((card) => card?.id && card?.title);
      }
    
      function setTradeButtonState(cardEl, tradeId) {
        const button = cardEl.querySelector('.wm-trade-values-button');
        if (!button) return;
        button.textContent = activeTradeValueIds.has(tradeId) ? 'Masquer les valeurs' : 'Valeurs';
      }
    
      function ensureTradeButton(cardEl, trade) {
        cardEl.dataset.wmTradeId = trade.id;
    
        let controls = cardEl.querySelector(':scope > .wm-trade-values-controls');
        if (!controls) {
          controls = document.createElement('div');
          controls.className = 'wm-trade-values-controls';
    
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'wm-tool-button wm-trade-values-button';
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
    
            const tradeId = cardEl.dataset.wmTradeId;
            const currentTrade = tradesById.get(tradeId);
            if (!currentTrade) return;
    
            if (activeTradeValueIds.has(tradeId)) {
              activeTradeValueIds.delete(tradeId);
              cardEl.querySelector(':scope > .wm-trade-values-panel')?.remove();
              setTradeButtonState(cardEl, tradeId);
              return;
            }
    
            activeTradeValueIds.add(tradeId);
            setTradeButtonState(cardEl, tradeId);
            renderTradeValues(tradeId);
    
            const cards = [...new Map(
              getTradeCards(currentTrade).map((card) => [card.id, card])
            ).values()];
    
            try {
              loadCacheForCards(cards);
            } catch (error) {
              reportError('prix échange', error);
            }
          });
    
          controls.append(button, createSponsorNote());
          cardEl.append(controls);
        }
    
        setTradeButtonState(cardEl, trade.id);
    
        if (activeTradeValueIds.has(trade.id)) {
          renderTradeValues(trade.id);
        }
      }
    
      function createTradeSide(trade, side) {
        const isInitiator = side === 'initiator';
        const userId = isInitiator ? trade.initiatorId : trade.recipientId;
        const user = isInitiator ? trade.initiator : trade.recipient;
        const wikibidous = isInitiator ? trade.initiatorWikibidous : trade.recipientWikibidous;
        const items = trade.items.filter((item) => item.offeredBy === userId);
    
        const section = document.createElement('div');
        section.className = 'wm-trade-side';
    
        const heading = document.createElement('div');
        heading.className = 'wm-trade-side-heading';
    
        const name = document.createElement('strong');
        name.textContent = user?.username || (isInitiator ? 'Initiateur' : 'Destinataire');
    
        const summary = document.createElement('span');
        summary.textContent = `${items.length} carte${items.length > 1 ? 's' : ''}`;
    
        heading.append(name, summary);
    
        const list = document.createElement('div');
        list.className = 'wm-trade-value-list';
    
        let total = Number(wikibidous) || 0;
        let pending = 0;
        let missing = 0;
        let pricedCards = 0;
    
        if (!items.length) {
          const empty = document.createElement('div');
          empty.className = 'wm-trade-empty';
          empty.textContent = 'Aucune carte';
          list.append(empty);
        }
    
        for (const item of items) {
          const card = item.card;
          const row = document.createElement('div');
          row.className = 'wm-trade-value-row';
    
          const info = document.createElement('div');
          info.className = 'wm-trade-value-info';
    
          const title = document.createElement('span');
          title.className = 'wm-trade-value-title';
          title.textContent = card.title;
    
          const rarity = document.createElement('span');
          rarity.className = 'wm-trade-value-rarity';
          rarity.textContent = card.rarity || '—';
    
          info.append(title, rarity);
    
          const value = document.createElement('span');
          value.className = 'wm-trade-value-price';
    
          const entry = cacheMemory.get(card.id);
          if (!entry) {
            pending += 1;
            value.classList.add('is-loading');
            const spinner = document.createElement('span');
            spinner.className = 'wm-average-spinner';
            value.append(spinner, document.createTextNode('…'));
          } else {
            const average = chooseAverage(entry, null, card.rarity || null);
            if (Number.isFinite(average)) {
              pricedCards += 1;
              total += average;
              value.textContent = `${formatAverage(average)} W`;
            } else {
              missing += 1;
              value.textContent = '—';
              value.classList.add('is-empty');
            }
          }
    
          row.append(info, value);
          list.append(row);
        }
    
        if (wikibidous > 0) {
          const row = document.createElement('div');
          row.className = 'wm-trade-value-row wm-trade-currency-row';
    
          const label = document.createElement('span');
          label.className = 'wm-trade-value-title';
          label.textContent = 'WikiBidous';
    
          const value = document.createElement('span');
          value.className = 'wm-trade-value-price';
          value.textContent = `${formatAverage(wikibidous)} W`;
    
          row.append(label, value);
          list.append(row);
        }
    
        const totalRow = document.createElement('div');
        totalRow.className = 'wm-trade-total';
    
        const totalLabel = document.createElement('strong');
        const totalValue = document.createElement('strong');
    
        if (pending > 0) {
          totalLabel.textContent = 'Total';
          totalValue.className = 'is-loading';
          const spinner = document.createElement('span');
          spinner.className = 'wm-average-spinner';
          totalValue.append(spinner, document.createTextNode(' …'));
        } else {
          totalLabel.textContent = missing > 0 ? 'Total connu' : 'Total';
          totalValue.textContent = (pricedCards > 0 || wikibidous > 0)
            ? `${formatAverage(total)} W`
            : '—';
        }
    
        totalRow.append(totalLabel, totalValue);
    
        if (!pending && missing > 0) {
          const note = document.createElement('div');
          note.className = 'wm-trade-missing-note';
          note.textContent = `${missing} carte${missing > 1 ? 's' : ''} sans prix moyen`;
          section.append(heading, list, totalRow, note);
        } else {
          section.append(heading, list, totalRow);
        }
    
        return section;
      }
    
      function renderTradeValues(tradeId) {
        if (!isTradesPage() || !activeTradeValueIds.has(tradeId)) return;
    
        const trade = tradesById.get(tradeId);
        const cardEl = getTradeCardElements().find((el) => el.dataset.wmTradeId === tradeId);
        if (!trade || !cardEl) return;
    
        let panel = cardEl.querySelector(':scope > .wm-trade-values-panel');
        if (!panel) {
          panel = document.createElement('div');
          panel.className = 'wm-trade-values-panel';
          cardEl.append(panel);
        }
    
        panel.replaceChildren(
          createTradeSide(trade, 'initiator'),
          createTradeSide(trade, 'recipient')
        );
      }
    
      function renderTradeButtons() {
        if (!isFeatureEnabled('tradeValues')) return;
        if (!isTradesPage() || !tradesById.size) return;
    
        const usedIds = new Set();
        for (const cardEl of getTradeCardElements()) {
          const trade = findTradeForCard(cardEl, usedIds);
          if (!trade) continue;
    
          usedIds.add(trade.id);
          ensureTradeButton(cardEl, trade);
        }
      }
    
      // Rappel de consentement mémorisé : si l'utilisateur a déjà confirmé la case lors
      // d'une session précédente, on restaure son choix automatiquement pour éviter de
      // lui redemander la même chose à chaque visite (préférence persistante).
      const acknowledgedChecks = new WeakSet();
    
      // Profil de réactivité de la session : chaque utilisateur garde un rythme
      // constant pendant toute sa visite ; on le calibre une seule fois au chargement.
      const uiResponseProfile = {
        // Rythme de lecture global : 1.0 = rapide, jusqu'à ~2.4 = lent.
        responsePace: 1 + Math.random() * 1.4,
        // Délai de délibération général entre deux interactions.
        deliberation: 0.55 + Math.random() * 1.15,
        // Temps de stabilisation de l'interface avant la première interaction :
        // le bloc vient d'apparaître, on attend que la mise en page soit complète.
        settleDelay: 300 + Math.random() * 1500
      };
    
    
      function renderTradeValuesForCard(id) {
        if (!isFeatureEnabled('tradeValues')) return;
        for (const tradeId of activeTradeValueIds) {
          const trade = tradesById.get(tradeId);
          if (trade?.items?.some((item) => item.card?.id === id)) {
            renderTradeValues(tradeId);
          }
        }
      }
      
      function resetTradesRequest() {
        tradesRequested = false;
      }
      
      window.addEventListener('wm-average-trades', (event) => {
          if (!isFeatureEnabled('tradeValues')) return;
          const detail = event.detail || {};
          const trades = Array.isArray(detail.trades) ? detail.trades : [];
      
          tradesById.clear();
      
          for (const trade of trades) {
            if (!trade?.id) continue;
            tradesById.set(trade.id, trade);
            registerCards(getTradeCards(trade));
          }
      
          renderTradeButtons();
          renderTradeDetailCards();
        });
      return { ensureTradesLoaded, renderTradeDetailCard, renderTradeDetailCards, renderTradeButtons, renderTradeValuesForCard, resetTradesRequest };
    }
  };
})();
