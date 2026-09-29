(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.cardExtras = {
    create(deps) {
      const { normalizeTitle, idByTitle, cardMetaById, imageResolver, isMarketplacePage, isFeatureEnabled } = deps;
      let cardExtrasObserver = null;
      let premiumPaletteObserver = null;
      const premiumPaletteJobs = new WeakMap();

      function isCollectionRoute() {
        return location.pathname === '/collection' || location.pathname.startsWith('/collection/');
      }

      function ensurePremiumPaletteObserver() {
        if (premiumPaletteObserver) return premiumPaletteObserver;

        premiumPaletteObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;

            const card = entry.target;
            premiumPaletteObserver.unobserve(card);

            const job = premiumPaletteJobs.get(card);
            premiumPaletteJobs.delete(card);
            job?.();
          }
        }, {
          root: null,
          rootMargin: '720px 0px',
          threshold: 0
        });

        return premiumPaletteObserver;
      }

      function schedulePremiumPalette(card, job) {
        if (!isCollectionRoute()) {
          job();
          return;
        }

        premiumPaletteJobs.set(card, job);
        ensurePremiumPaletteObserver().observe(card);
      }

      function wikipediaUrlFor(title, meta = null) {
        if (meta?.wikipediaUrl) return meta.wikipediaUrl;
        const normalized = normalizeTitle(title);
        if (!normalized) return null;
        return `https://fr.wikipedia.org/wiki/${encodeURIComponent(normalized.replace(/ /g, '_'))}`;
      }
    
      function ensureMarketplaceOwnedBadge(card) {
        const existing = card?.querySelector(':scope > .wm-owned-badge');

        if (!card || !isMarketplacePage()) {
          existing?.remove();
          return;
        }

        const source = [...card.querySelectorAll('span')].find((span) => (
          span.getAttribute('title') === 'Dans ta collection' ||
          normalizeTitle(span.textContent).toLocaleLowerCase('fr') === 'possédée'
        ));

        if (!source) {
          existing?.remove();
          return;
        }

        if (existing) return;

        const badge = document.createElement('span');
        badge.className = 'wm-owned-badge';
        badge.textContent = 'Possédée';
        badge.title = 'Dans ta collection';
        badge.setAttribute('aria-label', 'Possédée — dans ta collection');
        card.append(badge);
      }

      function ensureWikipediaButton(card) {
        if (!card || card.querySelector(':scope > .wm-wikipedia-card-button')) return;
    
        const h3 = card.querySelector('h3');
        const title = normalizeTitle(h3?.textContent);
        if (!title) return;
    
        const id = idByTitle.get(title);
        const meta = id ? cardMetaById.get(id) : null;
        const url = wikipediaUrlFor(title, meta);
        if (!url) return;
    
        const button = document.createElement('a');
        button.className = 'wm-wikipedia-card-button';
        button.href = url;
        button.target = '_blank';
        button.rel = 'noopener noreferrer';
        button.referrerPolicy = 'no-referrer';
        button.textContent = 'W';
        button.title = 'Ouvrir l’article Wikipédia';
        button.setAttribute('aria-label', `Ouvrir Wikipédia : ${title}`);
    
        const stop = (event) => event.stopPropagation();
        button.addEventListener('pointerdown', stop);
        button.addEventListener('mousedown', stop);
        button.addEventListener('click', stop);
    
        card.append(button);
      }
    
      function findMissingImagePlaceholder(card) {
        if (!card) return null;
    
        for (const img of card.querySelectorAll('img')) {
          if (img.classList.contains('wm-replaced-missing-image')) continue;
    
          const alt = normalizeTitle(img.getAttribute('alt')).toLocaleLowerCase('fr');
          const src = String(img.currentSrc || img.src || '');
    
          if (
            alt === 'wikimasters' ||
            /(?:%2f|\/)logo\.png/i.test(src)
          ) {
            return img;
          }
        }
    
        return null;
      }
    
      function applyResolvedMissingImage(card, placeholder, title, entry) {
        if (!card?.isConnected || !placeholder?.isConnected || !entry?.found || !entry.url) return;
    
        placeholder.classList.add('wm-replaced-missing-image');
        card.classList.add('wm-missing-image-fullart');

        const missingImageFrame = placeholder.parentElement;
        const missingImageHost = missingImageFrame?.parentElement;
        missingImageFrame?.classList.add('wm-missing-image-frame');
        missingImageHost?.classList.add('wm-missing-image-host');

        placeholder.dataset.wmOriginalSrc = placeholder.getAttribute('src') || '';
        placeholder.dataset.wmOriginalSrcset = placeholder.getAttribute('srcset') || '';
        placeholder.src = entry.url;
        placeholder.removeAttribute('srcset');
        placeholder.alt = title;
        placeholder.referrerPolicy = 'no-referrer';
    
        if (!card.querySelector(':scope > .wm-missing-image-credit')) {
          const credit = document.createElement('a');
          credit.className = 'wm-missing-image-credit';
          credit.target = '_blank';
          credit.rel = 'noopener noreferrer';
          credit.referrerPolicy = 'no-referrer';
          credit.textContent = entry.creditLabel || 'Image';
          credit.title = `Image ajoutée via ${entry.creditLabel || entry.source || 'fallback'}`;
          credit.href =
            entry.sourceUrl ||
            (entry.fileName
              ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(entry.fileName.replace(/ /g, '_'))}`
              : wikipediaUrlFor(title));
    
          const stop = (event) => event.stopPropagation();
          credit.addEventListener('pointerdown', stop);
          credit.addEventListener('click', stop);
          card.append(credit);
        }
      }
    
      function applyMissingImageTitleFallback(card, placeholder, title) {
        if (!card?.isConnected || !placeholder?.isConnected || !title) return;

        const existingFallback = card.querySelector(':scope > .wm-missing-title-art');
        if (
          existingFallback &&
          card.classList.contains('wm-missing-title-card') &&
          existingFallback.dataset.wmTitle === title
        ) {
          return;
        }

        const artLayer = placeholder.closest('div[class*="top-0"][class*="h-[45%]"]');

        card.classList.add('wm-missing-title-card');
        artLayer?.classList.add('wm-missing-title-layer');
        card.classList.remove('wm-art-auto-fill');
        card.style.setProperty('--wm-art-url', 'none');
        card.style.setProperty('--wm-art-scale', '1');
        card.style.setProperty('--wm-art-hover-scale', '1');

        // Le logo par défaut rendait la palette presque noire. Une carte sans
        // image reçoit donc une palette neutre dédiée, tandis que l'accent
        // continue de venir de sa rareté.
        card.style.setProperty('--wm-image-top-rgb', '34, 38, 48');
        card.style.setProperty('--wm-image-top-soft-rgb', '44, 49, 61');
        card.style.setProperty('--wm-image-mid-rgb', '22, 25, 33');
        card.style.setProperty('--wm-image-bottom-rgb', '10, 12, 17');
        card.style.setProperty('--wm-image-bottom-soft-rgb', '17, 20, 27');

        placeholder.classList.add('wm-missing-title-logo');

        const missingImageFrame = placeholder.parentElement;
        const missingImageHost = missingImageFrame?.parentElement;
        missingImageFrame?.classList.add('wm-missing-title-frame');
        missingImageHost?.classList.add('wm-missing-title-host');

        // Le fallback texte est ajouté directement à la carte, pas dans le
        // wrapper image du site. Cela évite toutes les règles génériques
        // `> div { ... !important }` qui écrasaient son positionnement/z-index.
        card.querySelector(':scope > .wm-missing-title-art')?.remove();
        artLayer?.querySelector(':scope > .wm-missing-title-art')?.remove();

        const fallback = document.createElement('div');
        fallback.className = 'wm-missing-title-art';
        fallback.dataset.wmTitle = title;
        fallback.setAttribute('aria-hidden', 'true');
        fallback.style.setProperty('position', 'absolute', 'important');
        fallback.style.setProperty('top', '0', 'important');
        fallback.style.setProperty('left', '0', 'important');
        fallback.style.setProperty('right', '0', 'important');
        fallback.style.setProperty('height', '59%', 'important');
        fallback.style.setProperty('z-index', '39', 'important');
        fallback.style.setProperty('display', 'flex', 'important');
        fallback.style.setProperty('align-items', 'center', 'important');
        fallback.style.setProperty('justify-content', 'center', 'important');
        fallback.style.setProperty('pointer-events', 'none', 'important');

        const titleEl = document.createElement('span');
        titleEl.className = 'wm-missing-title-art-text';

        const displayTitle = title.trim() || title;
        titleEl.textContent = displayTitle;

        titleEl.style.setProperty('position', 'relative', 'important');
        titleEl.style.setProperty('z-index', '1', 'important');
        titleEl.style.setProperty('color', 'var(--wm-accent)', 'important');

        fallback.append(titleEl);
        card.append(fallback);

        const fitMissingTitle = () => {
          if (!fallback.isConnected || !titleEl.isConnected) return;

          const fallbackStyle = getComputedStyle(fallback);
          const horizontalPadding =
            (parseFloat(fallbackStyle.paddingLeft) || 0) +
            (parseFloat(fallbackStyle.paddingRight) || 0);
          const verticalPadding =
            (parseFloat(fallbackStyle.paddingTop) || 0) +
            (parseFloat(fallbackStyle.paddingBottom) || 0);

          const availableWidth = Math.max(1, fallback.clientWidth - horizontalPadding);
          const availableHeight = Math.max(1, fallback.clientHeight - verticalPadding);
          const maxLines = 3;
          const minFontSize = 12;
          const maxFontSize = 42;

          titleEl.style.setProperty('width', '100%', 'important');
          titleEl.style.setProperty('max-width', '100%', 'important');
          titleEl.style.setProperty('white-space', 'normal', 'important');
          titleEl.style.setProperty('text-wrap', 'balance', 'important');
          titleEl.style.setProperty('overflow-wrap', 'normal', 'important');
          titleEl.style.setProperty('word-break', 'normal', 'important');

          const fits = (fontSize) => {
            titleEl.style.setProperty('font-size', `${fontSize}px`, 'important');

            const rect = titleEl.getBoundingClientRect();
            const lineHeight = fontSize * 0.98;
            const lineCount = Math.max(1, Math.round(rect.height / lineHeight));

            return (
              titleEl.scrollWidth <= availableWidth + 1 &&
              rect.height <= availableHeight + 1 &&
              lineCount <= maxLines
            );
          };

          let low = minFontSize;
          let high = maxFontSize;
          let best = minFontSize;

          for (let i = 0; i < 9; i += 1) {
            const candidate = (low + high) / 2;

            if (fits(candidate)) {
              best = candidate;
              low = candidate;
            } else {
              high = candidate;
            }
          }

          titleEl.style.setProperty('font-size', `${best.toFixed(2)}px`, 'important');
        };

        requestAnimationFrame(() => {
          fitMissingTitle();

          // La police heading peut finir de charger après le premier layout.
          document.fonts?.ready?.then(fitMissingTitle).catch(() => {});
        });
      }

      async function ensureMissingImageForCard(card) {
        if (!card?.isConnected) return;
        if (card.dataset.wmMissingImageLoading === '1') return;
    
        const placeholder = findMissingImagePlaceholder(card);
        if (!placeholder) return;
    
        const retryAt = Number(card.dataset.wmMissingImageRetryAt) || 0;
        if (retryAt > Date.now()) return;
    
        const title = normalizeTitle(card.querySelector('h3')?.textContent);
        if (!title) return;
    
        card.dataset.wmMissingImageLoading = '1';
    
        try {
          const entry = await imageResolver.resolveMissingImage(title);
    
          if (entry?.found) {
            applyResolvedMissingImage(card, placeholder, title, entry);
          } else {
            applyMissingImageTitleFallback(card, placeholder, title);
            card.dataset.wmMissingImageDone = '1';
          }
        } catch (error) {
          card.dataset.wmMissingImageRetryAt = String(Date.now() + 60 * 1000);
          console.debug('[WM Average] résolution image indisponible', title, error);
        } finally {
          delete card.dataset.wmMissingImageLoading;
        }
      }
    
      function ensureCardExtrasObserver() {
        if (cardExtrasObserver) return cardExtrasObserver;
    
        cardExtrasObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
    
            const card = entry.target;
            cardExtrasObserver.unobserve(card);
    
            ensureMissingImageForCard(card).catch((error) => {
              console.debug('[WM Average] image manquante', error);
            });
          }
        }, {
          root: null,
          rootMargin: '280px 0px',
          threshold: 0
        });
    
        return cardExtrasObserver;
      }
    
      function ensurePremiumCardFx(card) {
        if (!card || card.dataset.wmPremiumFx === '1') return;
    
        const artLayer = card.querySelector(
          ':scope > div[class*="top-0"][class*="h-[45%]"]'
        );
        const artImage = artLayer?.querySelector('img');
        if (!artLayer || !artImage) return;
    
        card.dataset.wmPremiumFx = '1';

        let premiumRevealed = false;
        let revealFallbackTimer = null;

        function revealPremiumCard() {
          if (premiumRevealed || !card.isConnected) return;
          premiumRevealed = true;

          if (revealFallbackTimer) {
            clearTimeout(revealFallbackTimer);
            revealFallbackTimer = null;
          }

          card.classList.add('wm-premium-card');
          card.dataset.wmPremiumReady = '1';
        }
    
        const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));
        const mixColors = (a, b, weight = 0.5) => a.map((value, index) => (
          clamp255(value * (1 - weight) + b[index] * weight)
        ));
        const mixWithBlack = (rgb, amount) => rgb.map((value) => (
          clamp255(value * (1 - amount))
        ));
        const colorDistance = (a, b) => Math.hypot(
          a[0] - b[0],
          a[1] - b[1],
          a[2] - b[2]
        );
    
        function averagePixels(data, width, height, testPixel) {
          let r = 0;
          let g = 0;
          let b = 0;
          let count = 0;
    
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              if (!testPixel(x, y, width, height)) continue;
              const i = (y * width + x) * 4;
              if (data[i + 3] < 180) continue;
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count += 1;
            }
          }
    
          if (!count) return [24, 28, 32];
          const mean = [r / count, g / count, b / count];
    
          r = 0;
          g = 0;
          b = 0;
          count = 0;
    
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              if (!testPixel(x, y, width, height)) continue;
              const i = (y * width + x) * 4;
              if (data[i + 3] < 180) continue;
              const pixel = [data[i], data[i + 1], data[i + 2]];
              if (colorDistance(pixel, mean) > 95) continue;
              r += pixel[0];
              g += pixel[1];
              b += pixel[2];
              count += 1;
            }
          }
    
          if (!count) return mean.map(clamp255);
          return [r / count, g / count, b / count].map(clamp255);
        }
    
        function applyImageFormat() {
          if (!artImage.naturalWidth || !artImage.naturalHeight) return;
    
          const ratio = artImage.naturalWidth / artImage.naturalHeight;
          card.classList.remove('wm-art-portrait', 'wm-art-square', 'wm-art-landscape', 'wm-art-auto-fill');
          delete card.dataset.wmArtBaseScale;
    
          if (ratio < 0.82) {
            card.classList.add('wm-art-portrait');
            card.dataset.wmArtFormat = 'portrait';
            card.style.setProperty('--wm-art-top', '8px');
            card.style.setProperty('--wm-art-scale', '1');
            card.style.setProperty('--wm-art-hover-scale', '1.02');
            card.style.setProperty('--wm-blur-y', '38%');
          } else if (ratio < 1.12) {
            card.classList.add('wm-art-square');
            card.dataset.wmArtFormat = 'square';
            card.style.setProperty('--wm-art-top', '26px');
            card.style.setProperty('--wm-art-scale', '1');
            card.style.setProperty('--wm-art-hover-scale', '1.018');
            card.style.setProperty('--wm-blur-y', '35%');
          } else {
            card.classList.add('wm-art-landscape');
            card.dataset.wmArtFormat = 'landscape';
            card.style.setProperty('--wm-art-top', '52px');
            card.style.setProperty('--wm-art-scale', '1');
            card.style.setProperty('--wm-art-hover-scale', '1.015');
            card.style.setProperty('--wm-blur-y', '32%');
          }
        }
    
        function applyImagePalette() {
          if (!artImage.naturalWidth || !artImage.naturalHeight) return;

          const paletteSrc = String(artImage.currentSrc || artImage.src || '');
          if (paletteSrc && card.dataset.wmPaletteSrc === paletteSrc) return;
    
          try {
            const canvas = document.createElement('canvas');
            const width = 96;
            const height = 72;
            canvas.width = width;
            canvas.height = height;
    
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return;
            context.drawImage(artImage, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height).data;

            const top = averagePixels(
              pixels,
              width,
              height,
              (x, y, w, h) => y < h * 0.30 && (x < w * 0.34 || x > w * 0.66)
            );
            const bottom = averagePixels(
              pixels,
              width,
              height,
              (x, y, w, h) => y > h * 0.68 && (x < w * 0.32 || x > w * 0.68)
            );
            const sides = averagePixels(
              pixels,
              width,
              height,
              (x, _y, w) => x < w * 0.16 || x > w * 0.84
            );
    
            const mid = mixColors(mixColors(top, bottom, 0.50), sides, 0.38);
            const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const topLuminance = luminance(top);
    
            let topBase;
            let topSoft;
    
            if (topLuminance >= 205) {
              topBase = mixColors(top, [255, 255, 255], 0.08);
              topSoft = mixColors(top, [255, 255, 255], 0.18);
            } else if (topLuminance >= 155) {
              topBase = mixWithBlack(top, 0.06);
              topSoft = mixColors(top, [255, 255, 255], 0.08);
            } else if (topLuminance >= 100) {
              topBase = mixWithBlack(top, 0.14);
              topSoft = mixWithBlack(top, 0.04);
            } else {
              topBase = mixWithBlack(top, 0.20);
              topSoft = mixWithBlack(top, 0.10);
            }
    
            const midDark = mixWithBlack(mid, 0.46);
            const bottomDark = mixWithBlack(bottom, 0.68);
            const bottomSoft = mixWithBlack(bottom, 0.50);
            const setRgb = (name, rgb) => card.style.setProperty(name, rgb.join(', '));
    
            setRgb('--wm-image-top-rgb', topBase);
            setRgb('--wm-image-top-soft-rgb', topSoft);
            setRgb('--wm-image-mid-rgb', midDark);
            setRgb('--wm-image-bottom-rgb', bottomDark);
            setRgb('--wm-image-bottom-soft-rgb', bottomSoft);

            if (paletteSrc) {
              card.dataset.wmPaletteSrc = paletteSrc;
            }
          } catch (error) {
            console.debug('[WM Average] palette image indisponible', error);
          }
        }
    
        function syncArtwork() {
          const src = String(artImage.currentSrc || artImage.src || '');
          if (src) {
            const escaped = src.replace(/["\\]/g, '\\$&');
            card.style.setProperty('--wm-art-url', `url("${escaped}")`);
          }
    
          applyImageFormat();
          schedulePremiumPalette(card, applyImagePalette);
          revealPremiumCard();
        }
    
        if (artImage.complete && artImage.naturalWidth) {
          syncArtwork();
        }

        artImage.addEventListener('load', syncArtwork);
        artImage.addEventListener('error', revealPremiumCard, { once: true });

        // Ne jamais laisser une carte bloquée sur le skeleton si l'image tarde
        // ou si le navigateur ne fournit pas ses dimensions immédiatement.
        if (!premiumRevealed) {
          revealFallbackTimer = setTimeout(revealPremiumCard, 2000);
        }
    
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (reduceMotion?.matches) return;
    
        let pointerFrame = 0;
        let pointerClientX = 0;
        let pointerClientY = 0;

        const resetPointer = () => {
          if (pointerFrame) {
            cancelAnimationFrame(pointerFrame);
            pointerFrame = 0;
          }

          card.style.setProperty('--wm-pointer-x', '50%');
          card.style.setProperty('--wm-pointer-y', '35%');
          card.style.setProperty('--wm-foil-x', '50%');
          card.style.setProperty('--wm-foil-y', '50%');
          card.style.setProperty('--wm-foil-angle', '112deg');
          card.style.setProperty('--wm-foil-shift-x', '50%');
          card.style.setProperty('--wm-foil-shift-y', '50%');
          card.style.setProperty('--wm-tilt-x', '0deg');
          card.style.setProperty('--wm-tilt-y', '0deg');
        };

        const renderPointer = () => {
          pointerFrame = 0;

          const rect = card.getBoundingClientRect();
          if (!rect.width || !rect.height) return;

          const x = Math.max(0, Math.min(1, (pointerClientX - rect.left) / rect.width));
          const y = Math.max(0, Math.min(1, (pointerClientY - rect.top) / rect.height));

          const tiltX = (x - 0.5) * 10;
          const tiltY = (0.5 - y) * 10;
          const foilX = 50 + (x - 0.5) * 92;
          const foilY = 50 + (y - 0.5) * 92;
          const foilAngle = 112 + (x - 0.5) * 34 - (y - 0.5) * 22;
          const foilShiftX = 50 + (x - 0.5) * 62;
          const foilShiftY = 50 + (y - 0.5) * 42;

          card.style.setProperty('--wm-pointer-x', `${(x * 100).toFixed(1)}%`);
          card.style.setProperty('--wm-pointer-y', `${(y * 100).toFixed(1)}%`);
          card.style.setProperty('--wm-foil-x', `${foilX.toFixed(1)}%`);
          card.style.setProperty('--wm-foil-y', `${foilY.toFixed(1)}%`);
          card.style.setProperty('--wm-foil-angle', `${foilAngle.toFixed(1)}deg`);
          card.style.setProperty('--wm-foil-shift-x', `${foilShiftX.toFixed(1)}%`);
          card.style.setProperty('--wm-foil-shift-y', `${foilShiftY.toFixed(1)}%`);
          card.style.setProperty('--wm-tilt-x', `${tiltX.toFixed(2)}deg`);
          card.style.setProperty('--wm-tilt-y', `${tiltY.toFixed(2)}deg`);
        };

        const updatePointer = (event) => {
          pointerClientX = event.clientX;
          pointerClientY = event.clientY;

          if (!pointerFrame) {
            pointerFrame = requestAnimationFrame(renderPointer);
          }
        };

        resetPointer();
        card.addEventListener('pointermove', updatePointer, { passive: true });
        card.addEventListener('pointerleave', resetPointer, { passive: true });
        card.addEventListener('pointercancel', resetPointer, { passive: true });
      }
    
      function createCardElement(meta, options = {}) {
        if (!meta?.id || !meta?.title) return null;

        const rarity = ['L', 'UR', 'SR', 'R', 'PC', 'C'].includes(meta.rarity)
          ? meta.rarity
          : 'C';

        const card = document.createElement('div');
        card.className = `wm-family-native-card relative overflow-hidden glow-${rarity.toLowerCase()}`;
        card.dataset.wmCardId = meta.id;

        const artLayer = document.createElement('div');
        artLayer.className = 'absolute top-0 left-0 right-0 h-[45%]';

        const artInner = document.createElement('div');
        artInner.className = 'relative w-full h-full';

        const image = document.createElement('img');
        image.alt = meta.imageUrl ? meta.title : 'WikiMasters';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        if (meta.imageUrl) {
          image.src = meta.imageUrl;
          image.crossOrigin = 'anonymous';
        } else {
          image.src = '/logo.png';
        }

        const oldFade = document.createElement('div');
        oldFade.className = 'absolute bottom-0 left-0 right-0 h-1/2';

        artInner.append(image, oldFade);
        artLayer.append(artInner);

        const textLayer = document.createElement('div');
        textLayer.className = 'absolute top-[45%] left-0 right-0 bottom-0 flex flex-col';

        const title = document.createElement('h3');
        title.textContent = meta.title;

        const description = document.createElement('p');
        description.textContent =
          String(meta.category || '').trim() ||
          String(meta.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120);

        const stats = document.createElement('div');
        stats.className = 'mt-auto';

        textLayer.append(title);
        if (description.textContent) textLayer.append(description);
        textLayer.append(stats);

        const rarityBadge = document.createElement('div');
        rarityBadge.className = 'absolute top-2 left-2';
        rarityBadge.textContent = rarity;

        if (options.owned === true) {
          const owned = document.createElement('span');
          owned.className = 'wm-family-possession-badge';
          owned.textContent = Number(options.ownedCount) > 1
            ? `✓ Possédée ×${Number(options.ownedCount)}`
            : '✓ Possédée';
          card.append(owned);
        } else if (options.owned === false) {
          const missing = document.createElement('span');
          missing.className = 'wm-family-possession-badge is-missing';
          missing.textContent = 'Manquante';
          card.append(missing);
        } else {
          const unchecked = document.createElement('span');
          unchecked.className = 'wm-family-possession-badge is-unchecked';
          unchecked.textContent = 'À vérifier';
          card.append(unchecked);
        }

        card.append(artLayer, textLayer, rarityBadge);
        return card;
      }

      function renderCardExtras() {
        const premiumEnabled = isFeatureEnabled('premiumCards');
        const wikipediaEnabled = isFeatureEnabled('wikipediaButtons');
        const missingImagesEnabled = isFeatureEnabled('missingImages');
        const observer = missingImagesEnabled ? ensureCardExtrasObserver() : null;
        const collectionRoute = isCollectionRoute();

        for (const card of document.querySelectorAll('div[class*="glow-"]')) {
          if (!card.querySelector('h3')) continue;

          card.classList.toggle('wm-collection-card', collectionRoute);

          if (premiumEnabled) {
            ensurePremiumCardFx(card);
            ensureMarketplaceOwnedBadge(card);
          } else {
            card.classList.remove('wm-premium-card');
            card.querySelector(':scope > .wm-owned-badge')?.remove();
            delete card.dataset.wmPremiumReady;
          }

          if (wikipediaEnabled) {
            ensureWikipediaButton(card);
          } else {
            card.querySelector(':scope > .wm-wikipedia-card-button')?.remove();
          }

          if (missingImagesEnabled) {
            const missingPlaceholder = findMissingImagePlaceholder(card);

            if (missingPlaceholder) {
              const missingTitle = normalizeTitle(card.querySelector('h3')?.textContent);

              if (card.dataset.wmMissingImageDone === '1') {
                // Auto-réparation : une carte peut déjà avoir été marquée "sans image"
                // avant l'ajout du fallback typographique. Tant que le logo WikiMasters
                // est encore présent, on force le rendu texte.
                applyMissingImageTitleFallback(card, missingPlaceholder, missingTitle);
              } else {
                observer?.observe(card);
              }
            }
          }
        }
      }
    
    
      return { renderCardExtras, createCardElement };
    }
  };
})();
