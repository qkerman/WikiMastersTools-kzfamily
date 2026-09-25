(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.compactMode = {
    create(deps) {
      const { COMPACT_MODE_KEY, readLocalValue, writeLocalValue, isCollectionPage, isGlobalCollectionPage } = deps;
      let compactModeEnabled = readLocalValue(COMPACT_MODE_KEY) === true;
      function compactEligiblePage() {
        return isCollectionPage() || isGlobalCollectionPage();
      }
    
      function applyCompactMode() {
        document.body?.classList.toggle(
          'wm-compact-mode',
          compactModeEnabled && compactEligiblePage()
        );
    
        for (const button of document.querySelectorAll('[data-wm-compact-button]')) {
          button.classList.toggle('is-enabled', compactModeEnabled);
          button.textContent = compactModeEnabled ? 'Compact ✓' : 'Compact';
          button.setAttribute('aria-pressed', compactModeEnabled ? 'true' : 'false');
        }
      }
    
      function makeCompactButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wm-tool-button wm-compact-button';
        button.dataset.wmCompactButton = '1';
        button.title = 'Réduire la taille des cartes pour en afficher davantage';
        button.addEventListener('click', () => {
          compactModeEnabled = !compactModeEnabled;
          writeLocalValue(COMPACT_MODE_KEY, compactModeEnabled);
          applyCompactMode();
        });
        return button;
      }
    
      function ensureCompactControl() {
        if (!compactEligiblePage()) {
          applyCompactMode();
          return;
        }
    
        if (isCollectionPage()) {
          const bar = document.getElementById('wm-tools-bar');
          if (bar && !bar.querySelector('[data-wm-compact-button]')) {
            const sponsor = bar.querySelector('.wm-sponsor-note');
            const button = makeCompactButton();
            if (sponsor) bar.insertBefore(button, sponsor);
            else bar.append(button);
          }
        } else if (isGlobalCollectionPage() && !document.getElementById('wm-global-compact-tools')) {
          const h1 = document.querySelector('main h1');
          if (h1) {
            const tools = document.createElement('div');
            tools.id = 'wm-global-compact-tools';
            tools.className = 'wm-compact-tools';
            tools.append(makeCompactButton());
            h1.parentElement?.insertAdjacentElement('afterend', tools);
          }
        }
    
        applyCompactMode();
      }
    
    
      return { compactEligiblePage, applyCompactMode, ensureCompactControl };
    }
  };
})();
