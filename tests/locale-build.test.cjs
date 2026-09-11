const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test');
const { buildLocales } = require('../scripts/build-locales.cjs');

function fixture(t, dictionaries, codes = Object.keys(dictionaries)) {
  const base = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'bac-locales-'));
  fs.mkdirSync(path.join(root, 'locales'));
  t.after(() => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), base);
    assert(path.basename(target).startsWith('bac-locales-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'locales/index.json'), JSON.stringify(codes));
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    fs.writeFileSync(path.join(root, 'locales', code + '.json'), JSON.stringify(dictionary));
  }
  return root;
}

test('Locale builds reject primitive, null, array and empty source catalogs before producing a broken bundle', t => {
  for (const invalid of [true, 3, '', 'words', null, []]) {
    assert.throws(() => buildLocales(fixture(t, { en: invalid, fr: invalid })), /JSON object/);
  }
  assert.throws(() => buildLocales(fixture(t, { en: {}, fr: {} })), /must not be empty/);
});

test('Locale builds reject missing keys, altered placeholders and language-list/source mismatches', t => {
  const en = { 'Hello {name}': 'Hello {name}', 'Reply': 'Reply' };
  assert.throws(() => buildLocales(fixture(t, { en, fr: { Reply: 'Répondre' } })), /Incomplete language/);
  assert.throws(() => buildLocales(fixture(t, { en, fr: { 'Hello {name}': 'Bonjour {wallet}', Reply: 'Répondre' } })), /placeholders/);
  assert.throws(() => buildLocales(fixture(t, { en, fr: en }, ['en'])), /source files do not match/);
  assert.throws(() => buildLocales(fixture(t, { en }, ['en', '../secrets'])), /Invalid language list/);
});

test('Valid catalogs build deterministically and retain literal text, placeholders and immutable dictionaries', t => {
  const en = { 'Hello {name}': 'Hello {name}', Reply: 'Reply' };
  const fr = { Reply: '<strong>Répondre</strong>', 'Hello {name}': 'Bonjour {name}' };
  const root = fixture(t, { en, fr }), source = buildLocales(root), window = {};
  assert.equal(source, buildLocales(root));
  vm.runInNewContext(source, { window });
  assert.equal(window.BAC_LOCALES.fr.Reply, '<strong>Répondre</strong>');
  assert.equal(window.BAC_LOCALES.fr['Hello {name}'], 'Bonjour {name}');
  assert(Object.isFrozen(window.BAC_LOCALES));assert(Object.isFrozen(window.BAC_LOCALES.fr));
  assert.deepEqual(Object.keys(window.BAC_LOCALES.fr), Object.keys(en));
});
