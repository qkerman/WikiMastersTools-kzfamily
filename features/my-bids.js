(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.myBids = {
    create(runtime) {
      const PAGE_ID = 'wm-my-bids-page';
      const NAV_ID = 'wm-my-bids-nav';
      const ROUTE_CLASS = 'wm-bids-route';
      const SETTING_KEY = 'myBids';

      function isBidsRoute() {
        if (location.pathname !== '/marketplace') return false;
        try {
          return new URLSearchParams(location.search).get('wm') === 'bids';
        } catch (_) {
          return false;
        }
      }

      function isBidsPage() {
        return runtime.settings.isEnabled(SETTING_KEY) && isBidsRoute();
      }

      function ensureNavLink() {
        if (!runtime.settings.isEnabled(SETTING_KEY)) {
          document.getElementById(NAV_ID)?.remove();
          return;
        }

        let link = document.getElementById(NAV_ID);

        if (!link) {
          const anchor =
            document.querySelector('nav a[href="/marketplace"]') ||
            document.querySelector('nav a[href="/collection"]');

          if (!anchor?.parentElement) return;

          link = document.createElement('a');
          link.id = NAV_ID;
          link.href = '/marketplace?wm=bids';
          link.className = 'wm-family-nav flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200';

          const icon = document.createElement('span');
          icon.className = 'wm-family-nav-icon';
          icon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <polyline points="12 7 12 12 15.5 14"></polyline>
            </svg>`;

          const label = document.createElement('span');
          label.textContent = 'Mes enchères';

          link.append(icon, label);
          anchor.insertAdjacentElement('afterend', link);
        }

        link.classList.toggle('is-active', isBidsPage());
        if (isBidsPage()) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }

      function buildPage() {
        const page = document.createElement('section');
        page.id = PAGE_ID;
        page.className = 'wm-bids-page';

        const shell = document.createElement('div');
        shell.className = 'wm-bids-shell';

        const content = document.createElement('div');
        content.dataset.role = 'page-content';

        shell.append(content);
        page.append(shell);
        return page;
      }

      function ensurePage() {
        const enabled = runtime.settings.isEnabled(SETTING_KEY);

        if (!enabled && isBidsRoute()) {
          document.documentElement.classList.remove(ROUTE_CLASS);
          document.getElementById(PAGE_ID)?.remove();
          location.replace('/marketplace');
          return;
        }

        const active = enabled && isBidsRoute();
        document.documentElement.classList.toggle(ROUTE_CLASS, active);

        if (!active) {
          document.getElementById(PAGE_ID)?.remove();
          return;
        }

        const main = document.querySelector('main');
        if (!main) return;

        let page = document.getElementById(PAGE_ID);

        if (!page) {
          page = buildPage();
          main.append(page);
        } else if (page.parentElement !== main) {
          main.append(page);
        }
      }

      function render() {
        ensureNavLink();
        ensurePage();
      }

      return { render, isBidsPage };
    }
  };
})();
