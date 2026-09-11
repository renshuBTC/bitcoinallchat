const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer } = require('../scripts/serve.cjs');

test('The local preview serves only browser assets and rejects file and method probes', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html; charset=utf-8$/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await home.text(), /Bitcoin AllChat/);
  const head = await fetch(base + '/translate.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const target of ['/package.json', '/.env', '/.git/config', '/node_modules/esbuild/bin/esbuild', '/%2e%2e/package.json', '/index.html%00']) {
    const response = await fetch(base + target);
    assert.equal(response.status, 404, target);
    assert.equal(await response.text(), '');
  }
  const post = await fetch(base + '/', { method: 'POST', body: 'ignored' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
