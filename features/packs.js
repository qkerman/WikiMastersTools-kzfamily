(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.packs = {
    create(runtime) {
      const {
        PULL_RECAP_ENABLED_KEY, AUTO_OPEN_ENABLED_KEY, AUTO_OPEN_NEXT_AT_KEY,
        AUTO_OPEN_SESSION_KEY, AUTO_OPEN_MIN_DELAY, AUTO_OPEN_MAX_DELAY,
        ALL_COLLECTION_KEY, cacheMemory, isPullsPage, isLastPullCardVisible,
        normalizeTitle, readLocalValue, writeLocalValue, storageGet, storageSet,
        reportError, createSponsorNote
      } = runtime.core;
      const { formatAverage, chooseAverage } = runtime.priceUi;

      let pullRecapEnabled = runtime.settings.isEnabled('packRecap') && readLocalValue(PULL_RECAP_ENABLED_KEY) !== false;
      let activePackRecap = null;
      let packRecapDismissed = false;
      let openAllActive = false;
      let openAllRequestId = null;
      let openAllButton = null;
      let openAllSummaryCards = [];
      let openAllOpenedPacks = 0;
      let openAllError = null;
      let openAllRenderTimer = null;
      let openAllSummaryTitle = 'Cartes obtenues';
      let openAllSummaryOnClose = null;
      let openAllSummaryReloadOnClose = true;
      let autoOpenEnabled = runtime.settings.isEnabled('autoOpen') && readLocalValue(AUTO_OPEN_ENABLED_KEY) === true;
      let autoOpenTimer = null;
      let autoOpenRequestId = null;
      let autoOpenShowSummaryAfterCurrent = false;
      let autoOpenToggleInput = null;
      let autoOpenToggleLabel = null;

      if (!runtime.settings.isEnabled('autoOpen')) {
        writeLocalValue(AUTO_OPEN_ENABLED_KEY, false);
        localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
      }

      function lognormalSample(mu, sigma) {
        // Box-Muller sur loi normale, puis exponentielle => lognormale.
        let u = 0;
        let v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        return Math.exp(mu + sigma * z);
      }

      function humanDelay(muMs, sigma, minMs, maxMs, multiplier = 1) {
        const raw = lognormalSample(Math.log(muMs), sigma) * multiplier;
        return Math.min(maxMs, Math.max(minMs, raw));
      }

      // Active la case de confirmation de la façon la plus naturelle possible :
      // le focus arrive juste avant l'activation (pointeur ou Tab), et la cible
      // du clic varie — une partie des utilisateurs clique sur le libellé plutôt
      // que sur la case elle-même.
      function humanActivateCheckbox(checkbox) {
        const label = checkbox.closest('label');
        const target = (label && Math.random() < 0.25) ? label : checkbox;

        if (Math.random() < 0.96) {
          try { checkbox.focus({ preventScroll: true }); } catch (_) { /* noop */ }
        }

        target.click();
      }

      // Valide le bouton après activation de la case : focus d'abord, puis une
      // dernière hésitation avant le clic final.
      function humanConfirmButton(button) {
        if (!button.isConnected || button.disabled) return;

        if (Math.random() < 0.85) {
          try { button.focus({ preventScroll: true }); } catch (_) { /* noop */ }
        }

        const deliberationMs = humanDelay(650, 0.65, 180, 4200, uiResponseProfile.deliberation);
        setTimeout(() => {
          if (button.isConnected && !button.disabled) button.click();
        }, deliberationMs);
      }

      function isElementEffectivelyVisible(element) {
        if (!element?.isConnected) return false;
        if (document.visibilityState !== 'visible') return false;

        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;

        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return false;

        // Au moins partiellement dans le viewport.
        return rect.bottom > 0 && rect.right > 0 &&
          rect.top < window.innerHeight && rect.left < window.innerWidth;
      }

      // Attend qu'une condition soit vraie en sondant à intervalle irrégulier
      // pour éviter de surcharger le thread principal pendant les animations.
      function waitFor(condition, { timeoutMs = 15000, onDone } = {}) {
        const startedAt = Date.now();

        const probe = () => {
          if (condition()) {
            onDone(true);
            return;
          }

          if (Date.now() - startedAt > timeoutMs) {
            onDone(false);
            return;
          }

          setTimeout(probe, 90 + Math.random() * 160);
        };

        setTimeout(probe, 90 + Math.random() * 160);
      }

      function locatePendingConsent() {
        if (!isPullsPage()) return null;

        // Le widget de confirmation est toujours rendu dans le même conteneur que
        // le champ masqué « website » : c'est le repère structurel stable qu'on
        // utilise pour le retrouver, indépendamment du libellé affiché.
        for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
          if (checkbox.closest('.wm-pulls-tools')) continue;

          const block = checkbox.closest('label')?.parentElement;
          if (!block) continue;

          if (!block.querySelector('input[name="website"]')) continue;

          const button = block.querySelector('button');
          if (button) return { block, checkbox, button };
        }

        return null;
      }

      function restoreAcknowledgedConsent() {
        const verification = locatePendingConsent();
        if (!verification || acknowledgedChecks.has(verification.block)) return;

        acknowledgedChecks.add(verification.block);
        const { block, checkbox, button } = verification;

        // Séquence de restauration d'une préférence mémorisée :
        // 1. stabilisation de l'interface (bloc fraîchement monté) ~0.3 – 1.8 s
        // 2. relecture du libellé avant de cocher                  ~1.2 – 9 s (lognormal)
        // 3. restauration de l'état de la case (focus puis clic)
        // 4. délibération avant de valider                         ~0.2 – 4 s (lognormal)
        // 5. clic sur « Continuer »
        const settleMs = uiResponseProfile.settleDelay;
        const readingDelay = humanDelay(2400, 0.55, 1200, 9000, uiResponseProfile.responsePace);

        setTimeout(() => {
          // On ne restaure rien tant que le bloc n'est pas réellement visible et
          // que l'onglet n'a pas le focus (évite les interactions perdues).
          waitFor(() => isElementEffectivelyVisible(block), {
            onDone: (visible) => {
              if (!visible || !checkbox.isConnected) return;

              setTimeout(() => {
                if (!checkbox.isConnected) return;

                // Une petite distraction occasionnelle avant de confirmer —
                // notification, coup d'œil ailleurs — puis on s'y remet.
                const commit = () => {
                  if (!checkbox.isConnected) return;

                  if (!checkbox.checked) humanActivateCheckbox(checkbox);
                  humanConfirmButton(button);
                };

                if (Math.random() < 0.05) {
                  setTimeout(commit, humanDelay(6000, 0.6, 3000, 30000));
                } else {
                  commit();
                }
              }, readingDelay);
            }
          });
        }, settleMs);
      }

      function readAutoOpenSession() {
        const raw = readLocalValue(AUTO_OPEN_SESSION_KEY);

        return {
          startedAt: Number(raw?.startedAt) || Date.now(),
          openedPacks: Math.max(0, Number(raw?.openedPacks) || 0),
          runs: Math.max(0, Number(raw?.runs) || 0),
          cards: Array.isArray(raw?.cards) ? raw.cards.filter((card) => card?.id && card?.title) : [],
          errors: Array.isArray(raw?.errors) ? raw.errors.map(String).slice(-10) : []
        };
      }

      function writeAutoOpenSession(session) {
        writeLocalValue(AUTO_OPEN_SESSION_KEY, {
          startedAt: Number(session?.startedAt) || Date.now(),
          openedPacks: Math.max(0, Number(session?.openedPacks) || 0),
          runs: Math.max(0, Number(session?.runs) || 0),
          cards: Array.isArray(session?.cards) ? session.cards : [],
          errors: Array.isArray(session?.errors) ? session.errors.slice(-10) : []
        });
      }

      function resetAutoOpenSession() {
        const session = {
          startedAt: Date.now(),
          openedPacks: 0,
          runs: 0,
          cards: [],
          errors: []
        };
        writeAutoOpenSession(session);
        return session;
      }

      function randomAutoOpenDelay() {
        return Math.round(
          AUTO_OPEN_MIN_DELAY +
          Math.random() * (AUTO_OPEN_MAX_DELAY - AUTO_OPEN_MIN_DELAY)
        );
      }

      function clearAutoOpenTimer() {
        if (autoOpenTimer) {
          clearTimeout(autoOpenTimer);
          autoOpenTimer = null;
        }
      }

      function updateAutoOpenToggleUi() {
        if (autoOpenToggleInput) {
          autoOpenToggleInput.checked = autoOpenEnabled;
        }
        if (autoOpenToggleLabel) {
          autoOpenToggleLabel.classList.toggle('is-enabled', autoOpenEnabled);
        }
      }

      function scheduleNextAutoOpen({ keepExisting = true } = {}) {
        clearAutoOpenTimer();

        if (!runtime.settings.isEnabled('autoOpen')) {
          autoOpenEnabled = false;
          writeLocalValue(AUTO_OPEN_ENABLED_KEY, false);
          localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
          return;
        }

        if (!autoOpenEnabled) {
          localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
          return;
        }

        let nextAt = keepExisting ? Number(readLocalValue(AUTO_OPEN_NEXT_AT_KEY)) || 0 : 0;
        const now = Date.now();

        if (nextAt <= now) {
          nextAt = now + randomAutoOpenDelay();
          writeLocalValue(AUTO_OPEN_NEXT_AT_KEY, nextAt);
        }

        const delay = Math.max(1000, nextAt - now);

        autoOpenTimer = setTimeout(() => {
          autoOpenTimer = null;
          runAutomaticOpen().catch((error) => {
            reportError('ouverture automatique', error);
            if (autoOpenEnabled) scheduleNextAutoOpen({ keepExisting: false });
          });
        }, delay);
      }

      function appendAutomaticOpenResult(detail) {
        const session = readAutoOpenSession();
        const cards = Array.isArray(detail?.cards) ? detail.cards : [];
        const openedPacks = Math.max(0, Number(detail?.openedPacks) || 0);

        if (cards.length || openedPacks > 0) {
          session.cards.push(...cards);
          session.openedPacks += openedPacks;
          session.runs += 1;
        }

        if (!detail?.ok && detail?.error) {
          session.errors.push(String(detail.error));
        }

        writeAutoOpenSession(session);
        return session;
      }

      function showAutomaticOpenSummary() {
        const session = readAutoOpenSession();

        if (!session.cards.length) {
          localStorage.removeItem(AUTO_OPEN_SESSION_KEY);
          runtime.modalUi.showInfoModal(
            'Ouverture automatique',
            'Aucune carte n’a été ouverte automatiquement pendant cette session.'
          );
          return;
        }

        const error =
          session.errors.length > 0
            ? `${session.errors.length} cycle${session.errors.length > 1 ? 's' : ''} interrompu${session.errors.length > 1 ? 's' : ''} pendant la session.`
            : null;

        openOpenAllSummary(
          session.cards,
          session.openedPacks,
          error,
          {
            title: 'Récap ouverture automatique',
            reloadOnClose: false,
            onClose: () => {
              localStorage.removeItem(AUTO_OPEN_SESSION_KEY);
            }
          }
        );
      }

      function disableAutomaticOpening({ showSummary = true } = {}) {
        autoOpenEnabled = false;
        writeLocalValue(AUTO_OPEN_ENABLED_KEY, false);
        localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
        clearAutoOpenTimer();
        updateAutoOpenToggleUi();

        if (autoOpenRequestId && openAllActive && openAllRequestId === autoOpenRequestId) {
          autoOpenShowSummaryAfterCurrent = showSummary;
          return;
        }

        if (showSummary) {
          showAutomaticOpenSummary();
        }
      }

      function enableAutomaticOpening() {
        if (!runtime.settings.isEnabled('autoOpen')) return;
        autoOpenEnabled = true;
        writeLocalValue(AUTO_OPEN_ENABLED_KEY, true);
        resetAutoOpenSession();
        localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);
        autoOpenShowSummaryAfterCurrent = false;
        updateAutoOpenToggleUi();
        scheduleNextAutoOpen({ keepExisting: false });
      }

      function startOpenAllPacks({ automatic = false } = {}) {
        if (openAllActive) return false;

        openAllActive = true;
        openAllSummaryCards = [];
        openAllOpenedPacks = 0;
        openAllError = null;
        openAllRequestId = `${automatic ? 'auto-packs' : 'packs'}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (automatic) {
          autoOpenRequestId = openAllRequestId;
        }

        if (openAllButton?.isConnected) {
          openAllButton.disabled = true;
          openAllButton.textContent = automatic ? 'Auto ouverture…' : 'Ouverture…';
        }

        document.getElementById('wm-pack-recap')?.remove();
        document.getElementById('wm-open-all-overlay')?.remove();

        window.dispatchEvent(new CustomEvent('wm-average-open-all-packs', {
          detail: { requestId: openAllRequestId }
        }));

        return true;
      }

      async function runAutomaticOpen() {
        if (!autoOpenEnabled) return;

        localStorage.removeItem(AUTO_OPEN_NEXT_AT_KEY);

        if (openAllActive) {
          scheduleNextAutoOpen({ keepExisting: false });
          return;
        }

        const started = startOpenAllPacks({ automatic: true });
        if (!started && autoOpenEnabled) {
          scheduleNextAutoOpen({ keepExisting: false });
        }
      }

      function showAutoOpenHelp() {
        runtime.modalUi.showInfoModal(
          'Ouverture automatique',
          'Quand cette option est activée, l’extension attend aléatoirement entre 20 et 100 minutes puis utilise « Tout ouvrir » pour ouvrir tous les paquets disponibles. Les récaps intermédiaires restent masqués et le cycle recommence automatiquement. Quand vous désactivez l’option, un récapitulatif cumulé de toutes les cartes ouvertes automatiquement s’affiche. Les ouvertures sont espacées et aléatoires, il n\'y a aucune différence entre avoir cela activé et mettre un réveil toutes les x minutes, les requetes au serveur sont les mêmes. WikiMasters doit rester ouvert dans au moins un onglet pour que l’automatisation puisse s’exécuter.'
        );
      }

      function ensurePullsToolbar() {
        if (!isPullsPage() || document.getElementById('wm-pulls-info')) return;

        const h1 = [...document.querySelectorAll('h1')]
          .find((el) => normalizeTitle(el.textContent) === 'Ouvrir un paquet');
        if (!h1) return;

        const header = h1.parentElement;
        if (!header) return;
        header.classList.add('wm-pulls-header');

        const tools = document.createElement('div');
        tools.id = 'wm-pulls-tools';
        tools.className = 'wm-pulls-tools';

        if (runtime.settings.isEnabled('packRecap')) {
          const label = document.createElement('label');
          label.className = 'wm-pulls-toggle';
          label.title = 'Afficher le récapitulatif des prix après chaque paquet';

          const textWrap = document.createElement('span');
          textWrap.className = 'wm-pulls-toggle-text';
          const title = document.createElement('strong');
          title.textContent = 'Récap prix';
          textWrap.append(title);

          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = pullRecapEnabled;

          const track = document.createElement('span');
          track.className = 'wm-toggle-track';
          const knob = document.createElement('span');
          knob.className = 'wm-toggle-knob';
          track.append(knob);

          input.addEventListener('change', () => {
            pullRecapEnabled = input.checked;
            writeLocalValue(PULL_RECAP_ENABLED_KEY, pullRecapEnabled);
            label.classList.toggle('is-enabled', pullRecapEnabled);

            if (pullRecapEnabled) {
              packRecapDismissed = false;
              renderPackRecap();
            } else {
              document.getElementById('wm-pack-recap')?.remove();
            }
          });

          label.classList.toggle('is-enabled', pullRecapEnabled);
          label.append(textWrap, input, track);
          tools.append(label);
        }

        if (runtime.settings.isEnabled('autoOpen')) {
          const autoControl = document.createElement('span');
          autoControl.className = 'wm-auto-open-control';

          autoOpenToggleLabel = document.createElement('label');
          autoOpenToggleLabel.className = 'wm-pulls-toggle wm-auto-open-toggle';
          autoOpenToggleLabel.title = 'Ouvrir automatiquement tous les paquets à intervalles aléatoires';

          const autoTextWrap = document.createElement('span');
          autoTextWrap.className = 'wm-pulls-toggle-text';
          const autoTitle = document.createElement('strong');
          autoTitle.textContent = 'Ouvrir automatiquement';
          autoTextWrap.append(autoTitle);

          autoOpenToggleInput = document.createElement('input');
          autoOpenToggleInput.type = 'checkbox';
          autoOpenToggleInput.checked = autoOpenEnabled;

          const autoTrack = document.createElement('span');
          autoTrack.className = 'wm-toggle-track';
          const autoKnob = document.createElement('span');
          autoKnob.className = 'wm-toggle-knob';
          autoTrack.append(autoKnob);

          autoOpenToggleInput.addEventListener('change', () => {
            if (autoOpenToggleInput.checked) enableAutomaticOpening();
            else disableAutomaticOpening({ showSummary: true });
          });

          autoOpenToggleLabel.classList.toggle('is-enabled', autoOpenEnabled);
          autoOpenToggleLabel.append(autoTextWrap, autoOpenToggleInput, autoTrack);

          const helpButton = document.createElement('button');
          helpButton.type = 'button';
          helpButton.className = 'wm-auto-open-help';
          helpButton.textContent = '?';
          helpButton.title = 'Comment fonctionne l’ouverture automatique ?';
          helpButton.setAttribute('aria-label', 'Aide ouverture automatique');
          helpButton.addEventListener('click', showAutoOpenHelp);

          autoControl.append(autoOpenToggleLabel, helpButton);
          tools.append(autoControl);
        }

        if (tools.childElementCount > 0) {
          h1.insertAdjacentElement('afterend', tools);
        }

        const info = document.createElement('div');
        info.id = 'wm-pulls-info';
        info.className = 'wm-pulls-info';

        if (runtime.settings.isEnabled('openAll')) {
          openAllButton = document.createElement('button');
          openAllButton.type = 'button';
          openAllButton.className = 'wm-tool-button wm-open-all-button';
          openAllButton.textContent = openAllActive ? 'Ouverture…' : 'Tout ouvrir';
          openAllButton.disabled = openAllActive;
          openAllButton.title = 'Ouvrir tous les paquets disponibles sans afficher les animations';
          openAllButton.addEventListener('click', () => {
            handleOpenAllPacksClick().catch((error) => reportError('tout ouvrir', error));
          });
          info.append(openAllButton);
        }

        if (
          runtime.settings.isEnabled('packRecap') ||
          runtime.settings.isEnabled('openAll') ||
          runtime.settings.isEnabled('autoOpen')
        ) {
          const cacheNote = document.createElement('div');
          cacheNote.className = 'wm-pulls-cache-note';
          cacheNote.textContent = 'Les prix moyens utilisés par les outils sont conservés dans le cache local.';
          info.append(cacheNote, createSponsorNote());
        }

        const pageSubtitle = [...header.children].find((el) => el.tagName === 'P');
        if (pageSubtitle) pageSubtitle.insertAdjacentElement('afterend', info);
        else header.append(info);
      }

      function showOpenAllConfirmation() {
        return new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.className = 'wm-modal-overlay';

          const modal = document.createElement('div');
          modal.className = 'wm-modal wm-confirm-modal';

          const title = document.createElement('h2');
          title.textContent = 'Ouvrir tous les paquets ?';

          const text = document.createElement('p');
          text.textContent = 'Tous les paquets disponibles vont être ouverts immédiatement, sans animation. Cette action consomme les paquets.';

          const actions = document.createElement('div');
          actions.className = 'wm-modal-actions';

          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'wm-tool-button wm-secondary-button';
          cancel.textContent = 'Annuler';

          const confirm = document.createElement('button');
          confirm.type = 'button';
          confirm.className = 'wm-tool-button';
          confirm.textContent = 'Tout ouvrir';

          const close = (value) => {
            overlay.remove();
            resolve(value);
          };

          cancel.addEventListener('click', () => close(false));
          confirm.addEventListener('click', () => close(true));
          overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(false);
          });

          actions.append(cancel, confirm);
          modal.append(title, text, actions);
          overlay.append(modal);
          document.body.append(overlay);
        });
      }

      async function handleOpenAllPacksClick() {
        if (openAllActive) return;

        const confirmed = await showOpenAllConfirmation();
        if (!confirmed) return;

        startOpenAllPacks({ automatic: false });
      }

      function setOpenAllButtonProgress(openedPacks, packsRemaining = null) {
        if (!openAllButton) return;

        if (Number.isFinite(Number(packsRemaining))) {
          openAllButton.textContent = `Ouverts ${openedPacks} • reste ${Number(packsRemaining)}`;
        } else {
          openAllButton.textContent = `Ouverts ${openedPacks}`;
        }
      }

      function setOpenAllButtonWaiting(waitMs) {
        if (!openAllButton) return;
        const seconds = Math.max(1, Math.ceil(Number(waitMs || 0) / 1000));
        openAllButton.textContent = `Attente ${seconds}s…`;
      }

      function scheduleOpenAllSummaryRender() {
        if (openAllRenderTimer) return;

        openAllRenderTimer = setTimeout(() => {
          openAllRenderTimer = null;
          renderOpenAllSummary();
        }, 100);
      }

      function renderOpenAllSummary() {
        const overlay = document.getElementById('wm-open-all-overlay');
        if (!overlay || !openAllSummaryCards.length) return;

        const list = overlay.querySelector('.wm-open-all-list');
        const subtitle = overlay.querySelector('[data-role="subtitle"]');
        const footer = overlay.querySelector('[data-role="footer"]');
        if (!list || !subtitle || !footer) return;

        const rows = openAllSummaryCards.map((card, index) => {
          const entry = cacheMemory.get(card.id);
          const loaded = Boolean(entry);
          const average = entry ? chooseAverage(entry, null, card.rarity || null) : null;
          return { ...card, _originalIndex: index, loaded, average };
        });

        rows.sort((a, b) => {
          const aPrice = Number.isFinite(a.average) ? a.average : -Infinity;
          const bPrice = Number.isFinite(b.average) ? b.average : -Infinity;
          if (bPrice !== aPrice) return bPrice - aPrice;

          if (a.loaded !== b.loaded) return a.loaded ? 1 : -1;
          return a._originalIndex - b._originalIndex;
        });

        const loadedCount = rows.filter((row) => row.loaded).length;
        const pricedRows = rows.filter((row) => Number.isFinite(row.average));
        const total = pricedRows.reduce((sum, row) => sum + row.average, 0);

        subtitle.textContent =
          `${openAllOpenedPacks} paquet${openAllOpenedPacks > 1 ? 's' : ''} • ${rows.length} cartes • ${loadedCount}/${rows.length} prix chargés`;

        list.replaceChildren();
        const fragment = document.createDocumentFragment();

        rows.forEach((row, index) => {
          const item = document.createElement('div');
          item.className = 'wm-open-all-row';

          const rank = document.createElement('span');
          rank.className = 'wm-open-all-rank';
          rank.textContent = String(index + 1);

          const thumb = document.createElement('span');
          thumb.className = 'wm-open-all-thumb';
          if (row.imageUrl) {
            const img = document.createElement('img');
            img.src = row.imageUrl;
            img.alt = '';
            img.loading = 'lazy';
            thumb.append(img);
          }

          const info = document.createElement('span');
          info.className = 'wm-open-all-info';

          const name = document.createElement('strong');
          name.textContent = row.title;

          const meta = document.createElement('span');
          meta.textContent = row.rarity || '—';

          info.append(name, meta);

          const value = document.createElement('span');
          value.className = 'wm-open-all-price';

          if (!row.loaded) {
            value.classList.add('is-loading');
            const spinner = document.createElement('span');
            spinner.className = 'wm-average-spinner';
            value.append(spinner, document.createTextNode('…'));
          } else if (Number.isFinite(row.average)) {
            value.textContent = `${formatAverage(row.average)} W`;
          } else {
            value.textContent = '—';
            value.classList.add('is-empty');
          }

          item.append(rank, thumb, info, value);
          fragment.append(item);
        });

        list.append(fragment);

        if (loadedCount < rows.length) {
          footer.textContent = 'Chargement des prix moyens…';
        } else if (!pricedRows.length) {
          footer.textContent = 'Aucune carte n’a de prix moyen';
        } else {
          footer.textContent = `Total des prix moyens connus : ${formatAverage(total)} W`;
        }

        if (openAllError) {
          const error = document.createElement('div');
          error.className = 'wm-open-all-error';
          error.textContent = openAllError;
          footer.append(document.createElement('br'), error);
        }
      }

      function openOpenAllSummary(cards, openedPacks, error = null, options = {}) {
        document.getElementById('wm-open-all-overlay')?.remove();

        openAllSummaryCards = cards;
        openAllOpenedPacks = openedPacks;
        openAllError = error;
        openAllSummaryTitle = options.title || 'Cartes obtenues';
        openAllSummaryOnClose = typeof options.onClose === 'function' ? options.onClose : null;
        openAllSummaryReloadOnClose = options.reloadOnClose !== false;

        const overlay = document.createElement('div');
        overlay.id = 'wm-open-all-overlay';
        overlay.className = 'wm-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-modal wm-open-all-modal';

        const header = document.createElement('div');
        header.className = 'wm-open-all-header';

        const headingWrap = document.createElement('div');

        const title = document.createElement('h2');
        title.textContent = openAllSummaryTitle;

        const subtitle = document.createElement('p');
        subtitle.dataset.role = 'subtitle';

        headingWrap.append(title, subtitle);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'wm-ranking-close';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Fermer');

        const close = () => {
          overlay.remove();
          const onClose = openAllSummaryOnClose;
          const reloadOnClose = openAllSummaryReloadOnClose;

          openAllSummaryCards = [];
          openAllError = null;
          openAllSummaryTitle = 'Cartes obtenues';
          openAllSummaryOnClose = null;
          openAllSummaryReloadOnClose = true;

          try {
            onClose?.();
          } catch (error) {
            reportError('fermeture récap', error);
          }

          if (reloadOnClose) {
            location.reload();
          }
        };

        closeButton.addEventListener('click', close);

        header.append(headingWrap, closeButton);

        const list = document.createElement('div');
        list.className = 'wm-open-all-list';

        const footer = document.createElement('div');
        footer.className = 'wm-open-all-footer';
        footer.dataset.role = 'footer';

        modal.append(header, list, footer);
        overlay.append(modal);
        document.body.append(overlay);

        renderOpenAllSummary();
      }

      function mergePulledCardsIntoCollectionCache(cards) {
        const stored = storageGet(ALL_COLLECTION_KEY);
        const entry = stored[ALL_COLLECTION_KEY];
        if (!Array.isArray(entry?.cards) || !entry.cards.length) return;

        const byId = new Map(entry.cards.map((card) => [card.id, { ...card }]));
        const addedCounts = new Map();

        for (const card of cards) {
          addedCounts.set(card.id, (addedCounts.get(card.id) || 0) + 1);
          const existing = byId.get(card.id);
          if (!existing) {
            byId.set(card.id, { ...card, count: 0 });
          }
        }

        for (const [id, amount] of addedCounts) {
          const current = byId.get(id);
          current.count = (Number(current.count) || 0) + amount;
        }

        storageSet({
          [ALL_COLLECTION_KEY]: {
            ...entry,
            fetchedAt: Date.now(),
            cards: [...byId.values()]
          }
        });
      }

      function renderPackRecap() {
        const existing = document.getElementById('wm-pack-recap');

        if (
          !runtime.settings.isEnabled('packRecap') ||
          !isPullsPage() ||
          !pullRecapEnabled ||
          packRecapDismissed ||
          !activePackRecap?.cards?.length ||
          !isLastPullCardVisible()
        ) {
          existing?.remove();
          return;
        }

        const panel = existing || document.createElement('aside');
        panel.id = 'wm-pack-recap';
        panel.className = 'wm-pack-recap';
        panel.replaceChildren();

        const header = document.createElement('div');
        header.className = 'wm-pack-recap-header';

        const headingWrap = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = 'Prix moyens du paquet';

        const subtitle = document.createElement('span');
        const loaded = activePackRecap.cards.filter((card) => cacheMemory.has(card.id)).length;
        subtitle.textContent = `${loaded}/${activePackRecap.cards.length} chargées`;

        headingWrap.append(title, subtitle);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'wm-pack-recap-close';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Fermer le récap');
        close.addEventListener('click', () => {
          packRecapDismissed = true;
          panel.remove();
        });

        header.append(headingWrap, close);

        const list = document.createElement('div');
        list.className = 'wm-pack-recap-list';

        let total = 0;
        let priced = 0;

        for (const card of activePackRecap.cards) {
          const row = document.createElement('div');
          row.className = 'wm-pack-recap-row';

          const rarity = document.createElement('span');
          rarity.className = 'wm-pack-recap-rarity';
          rarity.textContent = card.rarity || '—';

          const name = document.createElement('span');
          name.className = 'wm-pack-recap-name';
          name.textContent = card.title;

          const value = document.createElement('span');
          value.className = 'wm-pack-recap-price';

          const cacheEntry = cacheMemory.get(card.id);
          if (!cacheEntry) {
            value.classList.add('is-loading');
            const spinner = document.createElement('span');
            spinner.className = 'wm-average-spinner';
            value.append(spinner, document.createTextNode('…'));
          } else {
            const average = chooseAverage(cacheEntry, null, card.rarity || null);
            if (Number.isFinite(average)) {
              total += average;
              priced += 1;
              value.textContent = `${formatAverage(average)} W`;
            } else {
              value.textContent = '—';
              value.classList.add('is-empty');
            }
          }

          row.append(rarity, name, value);
          list.append(row);
        }

        const footer = document.createElement('div');
        footer.className = 'wm-pack-recap-footer';

        if (loaded < activePackRecap.cards.length) {
          footer.textContent = 'Chargement des prix moyens…';
        } else if (priced === 0) {
          footer.textContent = 'Aucune carte n’a de prix moyen';
        } else {
          footer.textContent = `Total des prix moyens connus : ${formatAverage(total)} W`;
        }

        panel.append(header, list, footer);

        if (!existing) {
          document.body.append(panel);
        }
      }

      function handlePackOpened(cards) {
        if (!Array.isArray(cards) || !cards.length) return;

        runtime.pullStats.recordPullStats(cards);
        mergePulledCardsIntoCollectionCache(cards);

        if (!runtime.settings.isEnabled('packRecap')) return;

        activePackRecap = {
          openedAt: Date.now(),
          cards
        };
        packRecapDismissed = false;

        try {
          runtime.priceLoader.loadCacheForCards(cards);
          renderPackRecap();
        } catch (error) {
          reportError('paquet', error);
        }
      }


      document.addEventListener('click', (event) => {
        if (!isPullsPage() || !activePackRecap) return;

        const button = event.target?.closest?.('button');
        if (!button) return;

        // Dès que l'utilisateur valide le widget de confirmation, on masque le
        // récap du paquet précédent pour laisser la place à la suite.
        if (button.parentElement?.querySelector('input[name="website"]')) {
          packRecapDismissed = true;
          document.getElementById('wm-pack-recap')?.remove();
        }
      }, true);

      window.addEventListener('wm-average-open-all-packs-progress', (event) => {
        const detail = event.detail || {};
        if (!openAllActive || detail.requestId !== openAllRequestId) return;

        openAllOpenedPacks = Number(detail.openedPacks) || 0;

        if (detail.waiting) {
          setOpenAllButtonWaiting(detail.waitMs);
          return;
        }

        setOpenAllButtonProgress(openAllOpenedPacks, detail.packsRemaining);

        const packCards = Array.isArray(detail.cards) ? detail.cards : [];
        if (!packCards.length) return;

        runtime.pullStats.recordPullStats(packCards);
        openAllSummaryCards.push(...packCards);
        mergePulledCardsIntoCollectionCache(packCards);

        const uniquePackCards = [...new Map(packCards.map((card) => [card.id, card])).values()];
        try {
          runtime.priceLoader.loadCacheForCards(uniquePackCards);
        } catch (error) {
          reportError('prix pendant tout ouvrir', error);
        }
      });

      window.addEventListener('wm-average-open-all-packs-result', (event) => {
        const detail = event.detail || {};
        if (!openAllActive || detail.requestId !== openAllRequestId) return;

        const wasAutomatic = Boolean(autoOpenRequestId && detail.requestId === autoOpenRequestId);

        openAllActive = false;
        openAllRequestId = null;

        if (openAllButton?.isConnected) {
          openAllButton.disabled = false;
          openAllButton.textContent = 'Tout ouvrir';
        }

        const cards = Array.isArray(detail.cards) ? detail.cards : [];
        const openedPacks = Number(detail.openedPacks) || 0;

        if (wasAutomatic) {
          autoOpenRequestId = null;

          appendAutomaticOpenResult(detail);
          document.getElementById('wm-open-all-overlay')?.remove();
          document.getElementById('wm-pack-recap')?.remove();
          openAllSummaryCards = [];
          openAllError = null;

          if (autoOpenShowSummaryAfterCurrent || !autoOpenEnabled) {
            autoOpenShowSummaryAfterCurrent = false;
            showAutomaticOpenSummary();
          } else {
            scheduleNextAutoOpen({ keepExisting: false });
          }
          return;
        }

        if (!cards.length) {
          runtime.modalUi.showInfoModal(
            detail.ok ? 'Aucun paquet ouvert' : 'Ouverture impossible',
            detail.error || 'Aucun paquet disponible.'
          );
          return;
        }

        openOpenAllSummary(
          cards,
          openedPacks,
          detail.ok ? null : `Ouverture interrompue : ${detail.error || 'erreur inconnue'}`
        );
      });

      window.addEventListener('wm-average-pack-opened', (event) => {
        const cards = event.detail?.cards;
        if (!Array.isArray(cards) || !cards.length) return;
        handlePackOpened(cards);
      });


      function onPriceUpdated(id) {
        if (activePackRecap?.cards?.some((card) => card.id === id)) renderPackRecap();
        if (openAllSummaryCards.some((card) => card.id === id)) scheduleOpenAllSummaryRender();
      }

      function isAutoOpenEnabled() {
        return runtime.settings.isEnabled('autoOpen') && autoOpenEnabled;
      }

      return {
        ensurePullsToolbar, updateAutoOpenToggleUi, renderPackRecap,
        restoreAcknowledgedConsent, scheduleNextAutoOpen, onPriceUpdated,
        isAutoOpenEnabled
      };
    }
  };
})();
