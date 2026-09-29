const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const window = { addEventListener() {}, setInterval() {} };
const document = { addEventListener() {} };
const source = readFileSync(path.join(__dirname, '../features/price-ui.js'), 'utf8');
vm.runInNewContext(source, { window, document });

const priceUi = window.__wmAverageFeatures.priceUi.create({
  core: { cardMetaById: new Map(), idByTitle: new Map(), cacheMemory: new Map() },
  settings: { isEnabled: () => true }
});

test('un prix chargé indique sa fraîcheur et sa date de vérification', () => {
  const entry = {
    ok: true,
    averages: { R: 125 },
    fetchedAt: Date.now() - 2 * 60 * 60 * 1000 - 60 * 1000
  };

  const result = priceUi.getPricePresentation(entry, 'R');
  assert.equal(result.kind, 'priced');
  assert.equal(result.label, 'Moy. 125 W');
  assert.equal(result.age, 'il y a 2 h');
  assert.match(result.detail, /données vérifiées le/);
});

test('un prix d’une autre rareté ne remplace pas une absence de vente', () => {
  const entry = { ok: true, averages: { UR: 500 }, fetchedAt: Date.now() };

  assert.equal(priceUi.chooseAverage(entry, null, 'R'), null);
  const result = priceUi.getPricePresentation(entry, 'R');
  assert.equal(result.kind, 'empty');
  assert.equal(result.label, 'Aucune vente');
  assert.match(result.detail, /rareté R/);
});

test('une valeur nulle ne devient pas un prix de zéro', () => {
  const result = priceUi.getPricePresentation(
    { ok: true, averages: { R: null }, fetchedAt: Date.now() },
    'R'
  );
  assert.equal(result.kind, 'empty');
});

test('un chargement et une erreur ont des états distincts', () => {
  assert.equal(priceUi.getPricePresentation(null, 'R').kind, 'loading');
  const result = priceUi.getPricePresentation(
    { ok: false, averages: {}, fetchedAt: Date.now() },
    'R'
  );
  assert.equal(result.kind, 'error');
  assert.equal(result.label, 'Erreur de prix');
});

test('sans rareté connue, plusieurs prix ne sont pas présentés comme une vente absente', () => {
  const result = priceUi.getPricePresentation(
    { ok: true, averages: { R: 100, UR: 200 }, fetchedAt: Date.now() },
    null
  );
  assert.equal(result.kind, 'empty');
  assert.equal(result.label, 'Rareté inconnue');
});
