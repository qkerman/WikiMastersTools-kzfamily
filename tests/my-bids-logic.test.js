const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../features/my-bids-logic.js');

const logic = create();
const NOW = Date.parse('2026-10-02T08:00:00Z');
const USER = '06bcbd09-e357-4b96-a738-0483b189a3a2';
const OTHER = 'd3f19870-9c93-40ea-8845-7dd49354be61';

function auction(overrides = {}) {
  return {
    id: 'a1',
    status: 'active',
    current_bid: 10,
    effective_bid: 10,
    base_amount: 5,
    current_bidder_id: USER,
    end_at: new Date(NOW + 5 * 60 * 1000).toISOString(),
    ...overrides
  };
}

function cookieFor(payload, { chunks = 1 } = {}) {
  const encoded = 'base64-' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  if (chunks === 1) return `sb-abcdef-auth-token=${encoded}`;
  const size = Math.ceil(encoded.length / chunks);
  const parts = [];
  for (let i = 0; i < chunks; i += 1) {
    parts.push(`sb-abcdef-auth-token.${i}=${encoded.slice(i * size, (i + 1) * size)}`);
  }
  return parts.reverse().join('; ');
}

test('parseUserIdFromCookies lit user.id dans un cookie en un morceau', () => {
  const cookie = `theme=dark; ${cookieFor({ user: { id: USER }, access_token: 'x' })}; other=1`;
  assert.equal(logic.parseUserIdFromCookies(cookie), USER);
});

test('parseUserIdFromCookies recolle les morceaux .0 .1 dans l\'ordre', () => {
  const cookie = cookieFor({ user: { id: USER }, access_token: 'x'.repeat(200) }, { chunks: 2 });
  assert.equal(logic.parseUserIdFromCookies(cookie), USER);
});

test('parseUserIdFromCookies renvoie null si absent, illisible ou sans user.id', () => {
  assert.equal(logic.parseUserIdFromCookies(''), null);
  assert.equal(logic.parseUserIdFromCookies('a=1; b=2'), null);
  assert.equal(logic.parseUserIdFromCookies('sb-abcdef-auth-token=base64-@@@'), null);
  assert.equal(logic.parseUserIdFromCookies(cookieFor({ user: {} })), null);
  assert.equal(logic.parseUserIdFromCookies(cookieFor({ user: { id: 'pas-un-uuid' } })), null);
  assert.equal(logic.parseUserIdFromCookies(undefined), null);
});

test('extractBids tolère une réponse invalide', () => {
  assert.deepEqual(logic.extractBids(null), []);
  assert.deepEqual(logic.extractBids({}), []);
  assert.deepEqual(logic.extractBids({ bidding: 'oops' }), []);
});

test('extractBids garde les enchères actives avec un id', () => {
  const json = {
    bidding: [
      auction({ id: 'ok' }),
      auction({ id: undefined }),
      auction({ id: 'fini', status: 'settled' }),
      null
    ]
  };
  assert.deepEqual(logic.extractBids(json).map((a) => a.id), ['ok']);
});

test('bidStatus', () => {
  assert.equal(logic.bidStatus(auction(), USER), 'leading');
  assert.equal(logic.bidStatus(auction({ current_bidder_id: OTHER }), USER), 'outbid');
  assert.equal(logic.bidStatus(auction(), null), 'unknown');
  assert.equal(logic.bidStatus(auction({ current_bidder_id: null }), USER), 'unknown');
});

test('currentPrice suit l\'ordre effective_bid, current_bid, listing_base_amount, base_amount', () => {
  assert.equal(logic.currentPrice({ effective_bid: 30, current_bid: 20, base_amount: 5 }), 30);
  assert.equal(logic.currentPrice({ effective_bid: null, current_bid: 20, base_amount: 5 }), 20);
  assert.equal(logic.currentPrice({ listing_base_amount: 7, base_amount: 5 }), 7);
  assert.equal(logic.currentPrice({ base_amount: 5 }), 5);
  assert.equal(logic.currentPrice({}), 0);
});

test('nextBidAmount mise le minimum du site : mise courante + 10 % arrondi au supérieur', () => {
  const cases = [[1000, 1100], [100, 110], [300, 330], [700, 770], [10, 11], [5, 6], [6, 7], [111, 123], [123, 136], [40, 44]];
  for (const [current, expected] of cases) {
    assert.equal(logic.nextBidAmount(auction({ current_bid: current, effective_bid: current })), expected, `${current}`);
  }
});

test('nextBidAmount mise la mise de départ si personne n\'a misé', () => {
  const fresh = auction({ current_bid: null, effective_bid: 50, base_amount: 50 });
  assert.equal(logic.nextBidAmount(fresh), 50);
});

test('parseMinimumFromError lit le minimum du message du site', () => {
  assert.equal(logic.parseMinimumFromError('Mise trop basse (minimum 1100 wikibidous)'), 1100);
  assert.equal(logic.parseMinimumFromError('Mise trop basse (minimum 1 100 wikibidous)'), 1100);
  assert.equal(logic.parseMinimumFromError('Mise trop basse (minimum 1\u00a0100 wikibidous)'), 1100);
  assert.equal(logic.parseMinimumFromError('Mise trop basse (minimum 1\u202f100 wikibidous)'), 1100);
  assert.equal(logic.parseMinimumFromError('Mise trop basse (minimum 1.100 wikibidous)'), 1100);
});

test('parseMinimumFromError renvoie null pour les autres messages', () => {
  assert.equal(logic.parseMinimumFromError('Erreur réseau'), null);
  assert.equal(logic.parseMinimumFromError(''), null);
  assert.equal(logic.parseMinimumFromError(undefined), null);
  assert.equal(logic.parseMinimumFromError(null), null);
  assert.equal(logic.parseMinimumFromError('minimum 0 wikibidous'), null);
});

test('remainingMs et end_at invalide', () => {
  assert.equal(logic.remainingMs(auction(), NOW), 5 * 60 * 1000);
  assert.equal(logic.remainingMs(auction({ end_at: 'n/a' }), NOW), 0);
  assert.equal(logic.remainingMs(auction({ end_at: undefined }), NOW), 0);
  assert.equal(logic.remainingMs(auction({ end_at: new Date(NOW - 1000).toISOString() }), NOW), -1000);
});

test('formatRemaining', () => {
  assert.equal(logic.formatRemaining(0), 'Terminée');
  assert.equal(logic.formatRemaining(-5), 'Terminée');
  assert.equal(logic.formatRemaining(45 * 1000), '45s');
  assert.equal(logic.formatRemaining((59 * 60 + 47) * 1000), '59m 47s');
  assert.equal(logic.formatRemaining((5 * 3600 + 59 * 60 + 10) * 1000), '5h 59m');
});

test('sortBids : fin imminente d\'abord, terminées à la fin, sans muter l\'entrée', () => {
  const list = [
    auction({ id: 'tard', end_at: new Date(NOW + 600000).toISOString() }),
    auction({ id: 'fini', end_at: new Date(NOW - 1000).toISOString() }),
    auction({ id: 'bientot', end_at: new Date(NOW + 30000).toISOString() })
  ];
  const sorted = logic.sortBids(list, NOW);
  assert.deepEqual(sorted.map((a) => a.id), ['bientot', 'tard', 'fini']);
  assert.deepEqual(list.map((a) => a.id), ['tard', 'fini', 'bientot']);
});

test('applyBidResult met à jour la mise et le meneur', () => {
  const before = auction({ current_bid: 10, effective_bid: 10, current_bidder_id: OTHER });
  const after = logic.applyBidResult(before, { current_bid: 14 }, 13, USER);
  assert.equal(after.current_bid, 14);
  assert.equal(after.effective_bid, 14);
  assert.equal(after.current_bidder_id, USER);
  assert.equal(before.current_bid, 10);
});

test('applyBidResult retombe sur le montant misé si la réponse n\'a pas current_bid', () => {
  const after = logic.applyBidResult(auction({ current_bidder_id: OTHER }), {}, 13, USER);
  assert.equal(after.current_bid, 13);
});

test('applyBidResult garde le meneur existant si l\'id utilisateur est inconnu', () => {
  const after = logic.applyBidResult(auction({ current_bidder_id: OTHER }), {}, 13, null);
  assert.equal(after.current_bidder_id, OTHER);
});

test('alertTracker sonne une seule fois quand une enchère passe sous 60 s', () => {
  const tracker = logic.createAlertTracker();
  const list = (ms) => [auction({ id: 'x', end_at: new Date(NOW + ms).toISOString() })];

  assert.deepEqual(tracker.collect(list(120000), NOW), []);
  assert.deepEqual(tracker.collect(list(59000), NOW), ['x']);
  assert.deepEqual(tracker.collect(list(58000), NOW), []);
  assert.deepEqual(tracker.collect(list(1000), NOW), []);
});

test('alertTracker sonne dès la première lecture si l\'enchère est déjà sous 60 s', () => {
  const tracker = logic.createAlertTracker();
  const bids = [auction({ id: 'x', end_at: new Date(NOW + 20000).toISOString() })];
  assert.deepEqual(tracker.collect(bids, NOW), ['x']);
});

test('alertTracker ignore les enchères terminées ou à date invalide', () => {
  const tracker = logic.createAlertTracker();
  const bids = [
    auction({ id: 'fini', end_at: new Date(NOW - 5000).toISOString() }),
    auction({ id: 'invalide', end_at: 'n/a' })
  ];
  assert.deepEqual(tracker.collect(bids, NOW), []);
});

test('alertTracker resonne si la fin est repoussée au-delà de 60 s puis repasse dessous', () => {
  const tracker = logic.createAlertTracker();
  const list = (ms) => [auction({ id: 'x', end_at: new Date(NOW + ms).toISOString() })];

  assert.deepEqual(tracker.collect(list(30000), NOW), ['x']);
  assert.deepEqual(tracker.collect(list(180000), NOW), []);
  assert.deepEqual(tracker.collect(list(30000), NOW), ['x']);
});

test('alertTracker oublie les enchères qui ont disparu de la liste', () => {
  const tracker = logic.createAlertTracker();
  const bid = auction({ id: 'x', end_at: new Date(NOW + 30000).toISOString() });

  assert.deepEqual(tracker.collect([bid], NOW), ['x']);
  assert.deepEqual(tracker.collect([], NOW), []);
  assert.deepEqual(tracker.collect([bid], NOW), ['x']);
});
