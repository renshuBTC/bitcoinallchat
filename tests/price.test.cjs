const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

// Read the production functions; all clock, network, DOM, and timer effects are fake.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('/* ---------------- live market price ---------------- */');
const end = html.indexOf('/* ---------------- pinned ---------------- */', start);
assert.ok(start >= 0 && end > start, 'production price section exists');
const source = html.slice(start, end);

function harness() {
  const h = { now: 1800000000000, el: { textContent: '…', title: '' }, timers: new Map(), requests: [], sockets: [], events: new Map(), failSocket: false };
  let nextTimer = 1;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [h.now])); }
    static now() { return h.now; }
  }
  class Socket {
    constructor(url) {
      if (h.failSocket) throw new Error('connection unavailable');
      this.url = url; this.closed = 0; h.sockets.push(this);
    }
    close() { this.closed++; if (this.onclose) this.onclose({}); }
    emit(value) { if (this.onmessage) this.onmessage({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
  }
  const timer = (kind, callback, delay) => { const id = nextTimer++; h.timers.set(id, { kind, callback, delay }); return id; };
  const context = vm.createContext({
    Date: Clock, Math: Object.assign(Object.create(Math), { random: () => 0 }),
    WebSocket: Socket, AbortController, console,
    $: id => { assert.equal(id, 's-price'); return h.el; },
    setTimeout: (fn, delay) => timer('timeout', fn, delay),
    clearTimeout: id => h.timers.delete(id),
    setInterval: (fn, delay) => timer('interval', fn, delay),
    clearInterval: id => h.timers.delete(id),
    addEventListener: (name, handler) => h.events.set(name, handler),
    fetch: (url, options) => new Promise((resolve, reject) => {
      const request = { url, options, resolve, reject, settled: false };
      h.requests.push(request);
      options.signal.addEventListener('abort', () => { if (!request.settled) reject(new Error('aborted')); });
    }),
  });
  vm.runInContext(source, context);
  h.eval = code => vm.runInContext(code, context);
  h.advance = ms => { h.now += ms; };
  h.flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  h.respond = async (index, data, ok = true) => {
    const request = h.requests[index]; assert.ok(request, 'request exists');
    request.settled = true; request.resolve({ ok, status: ok ? 200 : 503, json: async () => data });
    await h.flush();
  };
  h.fail = async index => { h.requests[index].settled = true; h.requests[index].reject(new Error('offline')); await h.flush(); };
  h.runTimer = id => { const t = h.timers.get(id); assert.ok(t); if (t.kind === 'timeout') h.timers.delete(id); h.advance(t.delay); t.callback(); };
  h.stream = (price, event = h.now, socket = h.sockets.at(-1)) => socket.emit({ e: '24hrMiniTicker', s: 'BTCUSDT', E: event, c: price });
  h.text = price => '$' + Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return h;
}

test('accepts positive numeric quotes and rejects invalid values without changing the display', () => {
  const h = harness();
  for (const value of ['77773.55000000', 80000.125]) {
    assert.equal(h.eval(`paintBitcoinPrice(${JSON.stringify(value)})`), true);
    assert.equal(h.el.textContent, h.text(value));
  }
  const shown = h.el.textContent;
  for (const expr of ['null', 'undefined', 'true', 'false', '{}', '[]', "''", "' '", "'invalid'", 'NaN', 'Infinity', '-Infinity', '0', '-1', "'0'"]) {
    assert.equal(h.eval(`paintBitcoinPrice(${expr})`), false, expr);
    assert.equal(h.el.textContent, shown, expr);
  }
});

test('stream rejects malformed events, wrong symbols, wrong types, duplicate and older event times', () => {
  const h = harness(); h.eval('startBitcoinPrice()');
  h.stream('78000'); const shown = h.el.textContent, initial = h.now;
  const bad = [
    '{', 'null', { e: '24hrMiniTicker', s: 'ETHUSDT', E: initial + 1, c: '1' },
    { e: 'trade', s: 'BTCUSDT', E: initial + 1, c: '1' },
    { e: '24hrMiniTicker', s: 'BTCUSDT', E: String(initial + 1), c: '1' },
    { e: '24hrMiniTicker', s: 'BTCUSDT', E: initial - 1, c: '1' },
    { e: '24hrMiniTicker', s: 'BTCUSDT', E: initial, c: '1' },
    { e: '24hrMiniTicker', s: 'BTCUSDT', E: initial + 1, c: null },
  ];
  for (const event of bad) { h.sockets[0].emit(event); assert.equal(h.el.textContent, shown); }
  h.stream('78001', initial + 2); assert.equal(h.el.textContent, h.text(78001));
  h.eval('stopBitcoinPrice()');
});

test('a slow REST response cannot overwrite a newer streamed quote', async () => {
  const h = harness(); h.eval('startBitcoinPrice()'); h.stream('79000');
  await h.respond(0, { symbol: 'BTCUSDT', price: '77000' });
  assert.equal(h.el.textContent, h.text(79000));
  h.eval('stopBitcoinPrice()');
});

test('REST validates successful status, symbol, and price; failed requests can be retried', async () => {
  const h = harness(); h.eval('PRICE_STOPPED=false');
  const bad = [ [{ symbol: 'BTCUSDT', price: '77000' }, false], [{ symbol: 'ETHUSDT', price: '1' }, true], [{ symbol: 'BTCUSDT', price: null }, true] ];
  for (const [data, ok] of bad) { h.eval('pollBitcoinPrice()'); await h.respond(h.requests.length - 1, data, ok); assert.equal(h.el.textContent, '…'); }
  h.eval('pollBitcoinPrice()'); await h.fail(h.requests.length - 1); assert.equal(h.el.textContent, '…');
  h.eval('pollBitcoinPrice()'); await h.respond(h.requests.length - 1, { symbol: 'BTCUSDT', price: '78000' });
  assert.equal(h.el.textContent, h.text(78000));
});

test('only one REST request can be pending and timeout clears the in-flight guard', async () => {
  const h = harness(); h.eval('PRICE_STOPPED=false;pollBitcoinPrice();pollBitcoinPrice()');
  assert.equal(h.requests.length, 1);
  const abortTimer = [...h.timers].find(([, t]) => t.delay === 10000)[0]; h.runTimer(abortTimer); await h.flush();
  assert.equal(h.eval('PRICE_FETCHING'), false);
  h.eval('pollBitcoinPrice()'); assert.equal(h.requests.length, 2);
});

test('reconnection has one timer, exponential backoff, and a 30 second cap', () => {
  const h = harness(); h.failSocket = true; h.eval('PRICE_STOPPED=false;connectBitcoinPrice()');
  for (const expected of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const id = h.eval('PRICE_RECONNECT'); assert.equal(h.timers.get(id).delay, expected);
    h.eval('reconnectBitcoinPrice();reconnectBitcoinPrice()'); assert.equal(h.eval('PRICE_RECONNECT'), id);
    assert.equal(h.timers.size, 1); h.runTimer(id);
  }
  h.eval('stopBitcoinPrice()'); assert.equal(h.timers.size, 0);
});

test('socket failures schedule only one reconnect and a valid quote resets backoff', () => {
  const h = harness(); h.eval('PRICE_STOPPED=false;connectBitcoinPrice()');
  const socket = h.sockets[0]; socket.onerror(); socket.onclose();
  const reconnect = h.eval('PRICE_RECONNECT'); assert.ok(reconnect); assert.equal(h.timers.size, 1);
  h.runTimer(reconnect); h.eval('PRICE_BACKOFF=30000'); h.stream('78100');
  assert.equal(h.eval('PRICE_BACKOFF'), 1000);
  h.eval('stopBitcoinPrice()');
});

test('start is idempotent and stop closes sockets and clears recurring and reconnect timers', async () => {
  const h = harness(); h.eval('startBitcoinPrice();startBitcoinPrice()');
  assert.equal(h.requests.length, 1); assert.equal(h.sockets.length, 1);
  assert.equal([...h.timers.values()].filter(t => t.kind === 'interval').length, 1);
  await h.respond(0, { symbol: 'BTCUSDT', price: '78000' });
  h.eval('stopBitcoinPrice();stopBitcoinPrice()');
  assert.equal(h.sockets[0].closed, 1); assert.equal(h.timers.size, 0);
  h.stream('1', h.now + 1, h.sockets[0]); assert.equal(h.el.textContent, h.text(78000));
  h.eval('reconnectBitcoinPrice();pollBitcoinPrice()'); assert.equal(h.timers.size, 0); assert.equal(h.requests.length, 1);
  assert.equal(typeof h.events.get('pagehide'), 'function'); assert.equal(typeof h.events.get('pageshow'), 'function');
});

test('pending REST success after stop cannot update the UI', async () => {
  const h = harness(); h.eval('startBitcoinPrice();stopBitcoinPrice()');
  await h.respond(0, { symbol: 'BTCUSDT', price: '78000' });
  assert.equal(h.el.textContent, '…'); assert.equal(h.timers.size, 0);
});

test('stale prices become unavailable while failed REST calls remain retryable', async () => {
  const h = harness(); h.eval('startBitcoinPrice()'); await h.fail(0);
  h.stream('78000'); h.advance(91000); h.eval('refreshBitcoinPrice()');
  assert.equal(h.el.textContent, 'Unavailable'); assert.match(h.el.title, /retrying/i);
  assert.equal(h.requests.length, 2); await h.fail(1);
  h.advance(30000); h.eval('refreshBitcoinPrice()'); assert.equal(h.requests.length, 3);
  await h.respond(2, { symbol: 'BTCUSDT', price: '78050' }); assert.equal(h.el.textContent, h.text(78050));
  h.eval('stopBitcoinPrice()');
});

test('successful REST fallback must not keep a silent WebSocket alive forever', async () => {
  const h = harness(); h.eval('startBitcoinPrice()'); h.stream('78000'); await h.respond(0, { symbol: 'BTCUSDT', price: '77900' });
  const silentSocket = h.sockets[0];
  h.advance(30000); h.eval('refreshBitcoinPrice()'); await h.respond(1, { symbol: 'BTCUSDT', price: '78001' });
  h.advance(30000); h.eval('refreshBitcoinPrice()');
  assert.ok(silentSocket.closed > 0, 'socket with no events for 60s must reconnect despite fresh fallback quotes');
  h.eval('stopBitcoinPrice()');
});
