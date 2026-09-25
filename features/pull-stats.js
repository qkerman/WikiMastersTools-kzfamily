(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.pullStats = {
    create(deps) {
      const { RARITIES, PULL_STATS_KEY, readLocalValue, writeLocalValue, isPullsPage, isFeatureEnabled } = deps;
      function readPullStats() {
        const raw = readLocalValue(PULL_STATS_KEY) || {};
        const counts = {};
    
        for (const rarity of RARITIES) {
          counts[rarity] = Math.max(0, Number(raw?.counts?.[rarity]) || 0);
        }
    
        return {
          counts,
          total: RARITIES.reduce((sum, rarity) => sum + counts[rarity], 0)
        };
      }
    
      function writePullStats(stats) {
        writeLocalValue(PULL_STATS_KEY, {
          counts: stats.counts,
          updatedAt: Date.now()
        });
      }
    
      function recordPullStats(cards) {
        if (!isFeatureEnabled('pullStats')) return;
        if (!Array.isArray(cards) || !cards.length) return;
    
        const stats = readPullStats();
    
        for (const card of cards) {
          if (!RARITIES.includes(card?.rarity)) continue;
          stats.counts[card.rarity] += 1;
          stats.total += 1;
        }
    
        writePullStats(stats);
        renderPullStats();
      }
    
      function renderPullStats() {
        if (!isFeatureEnabled('pullStats')) {
          document.getElementById('wm-pull-stats')?.remove();
          return;
        }
        if (!isPullsPage()) return;
    
        const info = document.getElementById('wm-pulls-info');
        if (!info?.parentElement) return;
    
        const stats = readPullStats();
        const key = RARITIES.map((rarity) => stats.counts[rarity]).join(':');
    
        let panel = document.getElementById('wm-pull-stats');
        if (panel?.dataset.wmStatsKey === key) return;
    
        if (!panel) {
          panel = document.createElement('section');
          panel.id = 'wm-pull-stats';
          panel.className = 'wm-pull-stats';
          info.insertAdjacentElement('afterend', panel);
        }
    
        panel.dataset.wmStatsKey = key;
    
        const head = document.createElement('div');
        head.className = 'wm-pull-stats-head';
    
        const title = document.createElement('strong');
        title.className = 'wm-pull-stats-title';
        title.textContent = 'Vos statistiques';
    
        const total = document.createElement('span');
        total.className = 'wm-pull-stats-total';
        total.textContent = `${stats.total} carte${stats.total > 1 ? 's' : ''}`;
    
        head.append(title, total);
    
        if (stats.total === 0) {
          const empty = document.createElement('div');
          empty.className = 'wm-pull-stats-note';
          empty.textContent = 'Aucune carte comptée pour le moment. Ouvrez un paquet pour commencer.';
    
          panel.replaceChildren(head, empty);
          return;
        }
    
        const rows = document.createElement('div');
        rows.className = 'wm-pull-stats-rows';
    
        for (const rarity of RARITIES) {
          const count = stats.counts[rarity];
          const percent = stats.total > 0 ? (count / stats.total) * 100 : 0;
    
          const row = document.createElement('div');
          row.className = 'wm-pull-stat-row';
          row.dataset.rarity = rarity.toLowerCase();
    
          const label = document.createElement('span');
          label.className = 'wm-pull-stat-label';
          label.textContent = rarity;
    
          const track = document.createElement('span');
          track.className = 'wm-pull-stat-track';
    
          if (count > 0) {
            const bar = document.createElement('span');
            bar.className = 'wm-pull-stat-bar';
            bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
            track.append(bar);
          }
    
          const share = document.createElement('span');
          share.className = 'wm-pull-stat-percent';
          share.textContent = `${percent.toLocaleString('fr-FR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1
          })} %`;
    
          const amount = document.createElement('span');
          amount.className = 'wm-pull-stat-count';
          amount.textContent = String(count);
    
          row.append(label, track, share, amount);
          rows.append(row);
        }
    
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'wm-pull-stats-reset';
        reset.textContent = 'Réinitialiser les statistiques';
        reset.addEventListener('click', () => {
          if (!confirm('Réinitialiser toutes les statistiques de tirage ?')) return;
          localStorage.removeItem(PULL_STATS_KEY);
          panel.dataset.wmStatsKey = '';
          renderPullStats();
        });
    
        panel.replaceChildren(head, rows, reset);
      }
    
    
      return { recordPullStats, renderPullStats };
    }
  };
})();
