(() => {
  const registry = typeof window !== 'undefined'
    ? (window.__wmAverageFeatures ||= {})
    : null;

  const ALERT_THRESHOLD_MS = 60 * 1000;
  const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function create() {
    // Seul user.id est lu : les jetons du cookie ne sont jamais exposés.
    function parseUserIdFromCookies(cookieString) {
      const chunks = new Map();

      for (const part of String(cookieString || '').split(';')) {
        const entry = part.trim();
        const separator = entry.indexOf('=');
        if (separator < 0) continue;

        const match = entry.slice(0, separator).match(/^sb-[a-z0-9]+-auth-token(?:\.(\d+))?$/i);
        if (!match) continue;

        chunks.set(match[1] === undefined ? 0 : Number(match[1]), entry.slice(separator + 1));
      }

      if (!chunks.size) return null;

      let raw = [...chunks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, value]) => value)
        .join('');

      try {
        raw = decodeURIComponent(raw);
      } catch (_) {}

      try {
        let json = raw;

        if (raw.startsWith('base64-')) {
          const base64 = raw.slice(7).replace(/-/g, '+').replace(/_/g, '/');
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          json = new TextDecoder().decode(bytes);
        }

        const id = JSON.parse(json)?.user?.id;
        return typeof id === 'string' && USER_ID_PATTERN.test(id) ? id : null;
      } catch (_) {
        return null;
      }
    }

    function extractBids(json) {
      if (!Array.isArray(json?.bidding)) return [];

      return json.bidding.filter((auction) =>
        auction &&
        typeof auction === 'object' &&
        auction.id &&
        (!auction.status || auction.status === 'active')
      );
    }

    function bidStatus(auction, userId) {
      if (!userId || !auction?.current_bidder_id) return 'unknown';
      return auction.current_bidder_id === userId ? 'leading' : 'outbid';
    }

    function currentPrice(auction) {
      for (const value of [
        auction?.effective_bid,
        auction?.current_bid,
        auction?.listing_base_amount,
        auction?.base_amount
      ]) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
      }

      return 0;
    }

    function nextBidAmount(auction) {
      const price = currentPrice(auction);

      if (auction?.current_bid == null) return price;
      return Math.ceil((price * 11) / 10);
    }

    function parseMinimumFromError(message) {
      const match = /minimum\s+(\d[\d\s\u00a0\u202f.,]*)\s*wikibidous/i.exec(String(message ?? ''));
      if (!match) return null;

      const minimum = Number(match[1].replace(/\D/g, ''));
      return Number.isInteger(minimum) && minimum > 0 ? minimum : null;
    }

    function remainingMs(auction, now) {
      const end = Date.parse(auction?.end_at);
      return Number.isFinite(end) ? end - now : 0;
    }

    function formatRemaining(ms) {
      if (!(ms > 0)) return 'Terminée';

      const total = Math.floor(ms / 1000);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;

      if (hours > 0) return `${hours}h ${minutes}m`;
      if (minutes > 0) return `${minutes}m ${seconds}s`;
      return `${seconds}s`;
    }

    function sortBids(list, now) {
      return [...list].sort((a, b) => {
        const remainingA = remainingMs(a, now);
        const remainingB = remainingMs(b, now);
        const endedA = remainingA <= 0;
        const endedB = remainingB <= 0;

        if (endedA !== endedB) return endedA ? 1 : -1;
        return remainingA - remainingB;
      });
    }

    function applyBidResult(auction, result, amount, userId) {
      const confirmed = Number(result?.current_bid);
      const price = Number.isFinite(confirmed) && confirmed > 0 ? confirmed : amount;

      return {
        ...auction,
        current_bid: price,
        effective_bid: price,
        current_bidder_id: userId || auction.current_bidder_id
      };
    }

    function createAlertTracker(thresholdMs = ALERT_THRESHOLD_MS) {
      const alerted = new Set();

      return {
        collect(bids, now) {
          const present = new Set();
          const fresh = [];

          for (const bid of bids) {
            present.add(bid.id);
            const remaining = remainingMs(bid, now);

            if (remaining > thresholdMs) {
              alerted.delete(bid.id);
            } else if (remaining > 0 && !alerted.has(bid.id)) {
              alerted.add(bid.id);
              fresh.push(bid.id);
            }
          }

          for (const id of [...alerted]) {
            if (!present.has(id)) alerted.delete(id);
          }

          return fresh;
        }
      };
    }

    return {
      parseUserIdFromCookies,
      extractBids,
      bidStatus,
      currentPrice,
      nextBidAmount,
      parseMinimumFromError,
      remainingMs,
      formatRemaining,
      sortBids,
      applyBidResult,
      createAlertTracker
    };
  }

  if (registry) registry.myBidsLogic = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})();
