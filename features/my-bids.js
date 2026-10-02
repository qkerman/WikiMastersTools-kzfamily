(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.myBids = {
    create(runtime) {
      const PAGE_ID = 'wm-my-bids-page';
      const NAV_ID = 'wm-my-bids-nav';
      const ROUTE_CLASS = 'wm-bids-route';
      const SETTING_KEY = 'myBids';

      const SOUND_KEY = 'wm_my_bids_sound_v1';
      const INCREMENT_KEY = 'wm_my_bids_increment_v1';
      const POLL_VISIBLE_MS = 7000;
      const POLL_HIDDEN_MS = 20000;
      const BALANCE_REFRESH_MS = 60 * 1000;

      const { readLocalValue, writeLocalValue } = runtime.core;
      const logic = runtime.myBidsLogic;
      const alerts = logic.createAlertTracker();

      const state = {
        bids: [],
        userId: null,
        balance: null,
        loaded: false,
        error: null,
        updatedAt: 0,
        soundOn: readLocalValue(SOUND_KEY) !== false,
        increment: normalizeIncrement(readLocalValue(INCREMENT_KEY)),
        pending: new Set(),
        rowErrors: new Map()
      };

      let running = false;
      let loading = false;
      let refreshQueued = false;
      let bidGeneration = 0;
      let pollTimer = null;
      let tickTimer = null;
      let balanceAt = 0;
      let audioContext = null;

      function normalizeIncrement(value) {
        const number = Math.floor(Number(value));
        return Number.isFinite(number) && number >= 1 ? Math.min(number, 1000000) : 1;
      }

      function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
      }

      const numberFormat = new Intl.NumberFormat('fr-FR');
      const formatAmount = (value) => `${numberFormat.format(value)} W`;

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

      function audioRunning() {
        return audioContext?.state === 'running';
      }

      function unlockAudio() {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          audioContext ||= new AudioCtx();
          if (audioContext.state === 'suspended') {
            audioContext.resume().then(updateSoundButton).catch(() => {});
          }
        } catch (error) {
          console.debug('[WM Average] audio indisponible', error);
        }
      }

      function playUrgentBeep() {
        if (!audioRunning()) return;

        const now = audioContext.currentTime;
        for (let index = 0; index < 3; index += 1) {
          const start = now + index * 0.16;
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.type = 'square';
          oscillator.frequency.setValueAtTime(index === 2 ? 1175 : 880, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.09, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.14);
        }
      }

      function checkAlerts() {
        const fresh = alerts.collect(state.bids, Date.now());
        if (fresh.length && state.soundOn) playUrgentBeep();
      }

      async function fetchBids() {
        const response = await fetch('/api/marketplace?page=1&limit=1&mine=1', {
          method: 'GET',
          credentials: 'include',
          headers: { accept: '*/*' }
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error('Session expirée, reconnecte-toi à WikiMasters.');
        }
        if (!response.ok) throw new Error(`Actualisation impossible (HTTP ${response.status}).`);

        return logic.extractBids(await response.json());
      }

      async function refreshBalance() {
        balanceAt = Date.now();

        try {
          const response = await fetch('/api/wikibidous', {
            method: 'GET',
            credentials: 'include',
            headers: { accept: '*/*' }
          });
          if (!response.ok) return;

          const balance = Number((await response.json())?.balance);
          if (Number.isFinite(balance)) {
            state.balance = balance;
            renderHeader();
          }
        } catch (_) {}
      }

      async function refresh() {
        if (loading) {
          refreshQueued = true;
          return;
        }
        loading = true;
        const generation = bidGeneration;

        try {
          const bids = await fetchBids();
          if (generation !== bidGeneration) return;
          state.bids = bids;
          state.userId = logic.parseUserIdFromCookies(document.cookie);
          state.error = null;
          state.loaded = true;
          state.updatedAt = Date.now();
          checkAlerts();

          if (Date.now() - balanceAt > BALANCE_REFRESH_MS) refreshBalance();
        } catch (error) {
          state.error = String(error?.message || error);
        } finally {
          loading = false;
          renderAll();
          if (refreshQueued) {
            refreshQueued = false;
            if (running) refresh();
          }
        }
      }

      async function placeBid(auctionId) {
        const bid = state.bids.find((item) => item.id === auctionId);
        if (!bid || state.pending.has(auctionId)) return;

        const amount = logic.nextBidAmount(bid, state.increment);
        state.pending.add(auctionId);
        state.rowErrors.delete(auctionId);
        renderList();

        try {
          const response = await fetch(`/api/marketplace/${encodeURIComponent(auctionId)}/bid`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
          });

          let json = null;
          try {
            json = await response.json();
          } catch (_) {}

          if (!response.ok) {
            state.rowErrors.set(
              auctionId,
              String(json?.error || json?.message || `Mise refusée (HTTP ${response.status}).`)
            );
          } else {
            bidGeneration += 1;
            state.bids = state.bids.map((item) =>
              item.id === auctionId
                ? logic.applyBidResult(item, json, amount, state.userId)
                : item
            );

            const balance = Number(json?.bidder_balance);
            if (Number.isFinite(balance)) state.balance = balance;
          }
        } catch (_) {
          state.rowErrors.set(auctionId, 'Erreur réseau, réessaie.');
        } finally {
          state.pending.delete(auctionId);
          renderAll();
          if (running) refresh();
        }
      }

      function pageContent() {
        return document.querySelector(`#${PAGE_ID} [data-role="page-content"]`);
      }

      function soundLabel() {
        if (!state.soundOn) return 'Son coupé';
        return audioRunning() ? 'Son activé' : 'Cliquer pour activer le son';
      }

      function updateSoundButton() {
        const button = document.querySelector(`#${PAGE_ID} [data-role="sound"]`);
        if (!button) return;
        button.textContent = soundLabel();
        button.classList.toggle('is-off', !state.soundOn);
        button.classList.toggle('is-blocked', state.soundOn && !audioRunning());
      }

      function buildHeader() {
        const header = el('div', 'wm-bids-head');
        header.dataset.role = 'header';

        const titleWrap = el('div', 'wm-bids-title');
        titleWrap.append(
          el('h1', null, 'Mes enchères'),
          el('p', 'wm-bids-sub', null)
        );
        titleWrap.lastChild.dataset.role = 'sub';

        const controls = el('div', 'wm-bids-controls');

        const balance = el('span', 'wm-bids-balance', null);
        balance.dataset.role = 'balance';

        const incrementLabel = el('label', 'wm-bids-increment', 'Surenchère +');
        const incrementInput = document.createElement('input');
        incrementInput.type = 'number';
        incrementInput.min = '1';
        incrementInput.step = '1';
        incrementInput.value = String(state.increment);
        incrementInput.setAttribute('aria-label', 'Incrément de surenchère en wikibidous');
        incrementInput.addEventListener('change', () => {
          state.increment = normalizeIncrement(incrementInput.value);
          incrementInput.value = String(state.increment);
          writeLocalValue(INCREMENT_KEY, state.increment);
          renderList();
        });
        incrementLabel.append(incrementInput);

        const sound = el('button', 'wm-bids-sound', soundLabel());
        sound.type = 'button';
        sound.dataset.role = 'sound';
        sound.addEventListener('click', () => {
          state.soundOn = !state.soundOn;
          writeLocalValue(SOUND_KEY, state.soundOn);
          if (state.soundOn) {
            unlockAudio();
            setTimeout(() => {
              playUrgentBeep();
              updateSoundButton();
            }, 120);
          }
          updateSoundButton();
        });

        controls.append(balance, incrementLabel, sound);
        header.append(titleWrap, controls);
        return header;
      }

      function renderHeader() {
        const balance = document.querySelector(`#${PAGE_ID} [data-role="balance"]`);
        if (balance) {
          balance.textContent = state.balance == null ? '' : `Solde : ${formatAmount(state.balance)}`;
        }

        const sub = document.querySelector(`#${PAGE_ID} [data-role="sub"]`);
        if (sub) {
          if (state.error) {
            sub.textContent = state.error;
            sub.classList.add('is-error');
          } else if (!state.loaded) {
            sub.textContent = 'Chargement…';
            sub.classList.remove('is-error');
          } else {
            const time = new Date(state.updatedAt).toLocaleTimeString('fr-FR');
            sub.textContent = `${state.bids.length} en cours, actualisé à ${time}`;
            sub.classList.remove('is-error');
          }
        }

        updateSoundButton();
      }

      function buildRow(bid) {
        const now = Date.now();
        const remaining = logic.remainingMs(bid, now);
        const status = logic.bidStatus(bid, state.userId);
        const nextAmount = logic.nextBidAmount(bid, state.increment);
        const pending = state.pending.has(bid.id);

        const row = el('li', 'wm-bids-row');
        row.dataset.auctionId = bid.id;
        row.classList.toggle('is-ended', remaining <= 0);
        row.classList.toggle('is-urgent', remaining > 0 && remaining <= 60000);

        const rarity = bid.snapshot_rarity || bid.card?.rarity || '';
        row.append(el('span', `wm-bids-rarity rarity-${rarity.toLowerCase()}`, rarity));

        const title = el('a', 'wm-bids-card', bid.card?.wikipedia_title || 'Carte');
        title.href = `/marketplace/${encodeURIComponent(bid.id)}`;

        const info = el('div', 'wm-bids-info');
        info.append(title);

        if (status === 'leading') info.append(el('span', 'wm-bids-badge is-leading', 'En tête'));
        else if (status === 'outbid') info.append(el('span', 'wm-bids-badge is-outbid', 'Dépassé'));

        const price = el('span', 'wm-bids-price', formatAmount(logic.currentPrice(bid)));

        const countdown = el('span', 'wm-bids-countdown', logic.formatRemaining(remaining));
        countdown.dataset.role = 'countdown';

        const button = el('button', 'wm-bids-bid', pending ? '…' : `+${state.increment}`);
        button.type = 'button';
        button.disabled = pending || remaining <= 0 || status === 'leading';
        button.title = status === 'leading'
          ? 'Tu es déjà en tête'
          : `Miser ${formatAmount(nextAmount)}`;
        button.setAttribute('aria-label', `Miser ${formatAmount(nextAmount)} sur ${bid.card?.wikipedia_title || 'cette carte'}`);
        button.addEventListener('click', () => placeBid(bid.id));

        row.append(info, price, countdown, button);

        const error = state.rowErrors.get(bid.id);
        if (error) {
          const message = el('div', 'wm-bids-row-error', error);
          message.setAttribute('role', 'alert');
          row.append(message);
        }

        return row;
      }

      function renderList() {
        const content = pageContent();
        if (!content) return;

        let list = content.querySelector('[data-role="list"]');
        if (!list) return;

        const sorted = logic.sortBids(state.bids, Date.now());
        list.replaceChildren(...sorted.map(buildRow));

        const empty = content.querySelector('[data-role="empty"]');
        if (empty) empty.hidden = !(state.loaded && !state.error && !sorted.length);
      }

      function renderAll() {
        renderHeader();
        renderList();
      }

      function buildContent() {
        const fragment = document.createDocumentFragment();

        const list = el('ul', 'wm-bids-list');
        list.dataset.role = 'list';

        const empty = el('p', 'wm-bids-empty', 'Vous n’êtes en lice sur aucune enchère.');
        empty.dataset.role = 'empty';
        empty.hidden = true;

        fragment.append(buildHeader(), list, empty);
        return fragment;
      }

      function tick() {
        const now = Date.now();

        for (const row of document.querySelectorAll(`#${PAGE_ID} .wm-bids-row`)) {
          const bid = state.bids.find((item) => item.id === row.dataset.auctionId);
          if (!bid) continue;

          const remaining = logic.remainingMs(bid, now);
          const countdown = row.querySelector('[data-role="countdown"]');
          if (countdown) countdown.textContent = logic.formatRemaining(remaining);

          row.classList.toggle('is-ended', remaining <= 0);
          row.classList.toggle('is-urgent', remaining > 0 && remaining <= 60000);
        }

        checkAlerts();
        updateSoundButton();
      }

      function schedulePoll() {
        clearTimeout(pollTimer);
        if (!running) return;

        pollTimer = setTimeout(async () => {
          await refresh();
          schedulePoll();
        }, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
      }

      function onVisibilityChange() {
        if (!running) return;
        if (!document.hidden) refresh();
        schedulePoll();
      }

      function start() {
        if (running) return;
        running = true;

        document.addEventListener('visibilitychange', onVisibilityChange);
        document.addEventListener('pointerdown', unlockAudio, true);
        document.addEventListener('keydown', unlockAudio, true);

        tickTimer = setInterval(tick, 1000);
        refresh();
        schedulePoll();
      }

      function stop() {
        if (!running) return;
        running = false;

        clearTimeout(pollTimer);
        clearInterval(tickTimer);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        document.removeEventListener('pointerdown', unlockAudio, true);
        document.removeEventListener('keydown', unlockAudio, true);
      }

      function ensurePage() {
        const enabled = runtime.settings.isEnabled(SETTING_KEY);

        if (!enabled && isBidsRoute()) {
          document.documentElement.classList.remove(ROUTE_CLASS);
          document.getElementById(PAGE_ID)?.remove();
          stop();
          location.replace('/marketplace');
          return;
        }

        const active = enabled && isBidsRoute();
        document.documentElement.classList.toggle(ROUTE_CLASS, active);

        if (!active) {
          stop();
          document.getElementById(PAGE_ID)?.remove();
          return;
        }

        const main = document.querySelector('main');
        if (!main) return;

        let page = document.getElementById(PAGE_ID);

        if (!page) {
          page = buildPage();
          main.append(page);
          page.querySelector('[data-role="page-content"]').append(buildContent());
          renderAll();
        } else if (page.parentElement !== main) {
          main.append(page);
        }

        start();
      }

      function render() {
        ensureNavLink();
        ensurePage();
      }

      return { render, isBidsPage };
    }
  };
})();
