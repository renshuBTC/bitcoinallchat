const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { test } = require('node:test');
const { applyIntegrity, MODULES } = require('../scripts/update-csp.cjs');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const hash = (algorithm, value) => crypto.createHash(algorithm).update(value).digest('base64');

test('The integrity updater refreshes the builder before hashing the inline script and pins every browser module', () => {
  const files = Object.fromEntries([...MODULES, 'post.js'].map(name => [name, '/* changed ' + name + ' */\n']));
  const updated = applyIntegrity(html, name => files[name]);
  for (const name of Object.keys(files)) assert.ok(updated.includes('sha384-' + hash('sha384', files[name])), name);
  for (const [, code] of updated.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    assert.ok(updated.includes("'sha256-" + hash('sha256', code) + "'"));
  }
  assert.equal(applyIntegrity(updated, name => files[name]), updated);
});
test('Missing script tags and a missing builder pin fail the build instead of silently leaving an unpinned asset', () => {
  const read = () => '// fixture\n';
  assert.throws(() => applyIntegrity(html.replace(/<script src="translate.js"[^>]*><\/script>/, ''), read), /translate.js/);
  assert.throws(() => applyIntegrity(html.replace(/s\.integrity='sha384-[^']+'/, ''), read), /builder integrity pin/);
});

test('Integrity pins hash served asset bytes exactly, including CRLF and trailing whitespace', () => {
  const files = Object.fromEntries([...MODULES, 'post.js'].map(name => [name, '/* ' + name + ' */\r\nvoid 0;  \r\n\r\n']));
  const updated = applyIntegrity(html, name => files[name]);
  for (const name of Object.keys(files)) {
    assert.ok(updated.includes('sha384-' + hash('sha384', files[name])), name);
    const normalized = files[name].replace(/\r\n/g, '\n').trimEnd() + '\n';
    assert.ok(!updated.includes('sha384-' + hash('sha384', normalized)), 'Must not pin bytes that were never written: ' + name);
  }
});
