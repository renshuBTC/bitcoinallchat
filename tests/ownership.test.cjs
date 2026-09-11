// Uses the shipped ownership helpers and send functions with isolated storage,
// wallet, and network doubles. No transaction is signed or broadcast.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const htmlPath = process.argv[2] || (path.basename(__dirname) === 'tests'
  ? path.join(__dirname, '..', 'index.html')
  : path.join(__dirname, 'bitcoinallchat', 'index.html'));
const html = fs.readFileSync(htmlPath, 'utf8');
const id = n => n.toString(16).padStart(64, '0');
const FIRST = 'abcdef'.repeat(10) + 'abcd';
const SECOND = 'bcdefa'.repeat(10) + 'bcde';
const STORAGE_KEY = 'bac_sent_txids';

function declaration(name) {
  const start = html.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  assert.ok(start >= 0, 'Missing actual page function: ' + name);
  for (let end = html.indexOf('}', start); end >= 0; end = html.indexOf('}', end + 1)) {
    const candidate = html.slice(start, end + 1);
    try { new vm.Script(candidate); return candidate; } catch {}
  }
  throw new Error('Could not extract ' + name);
}

const helpersStart = html.indexOf('function cleanTxid(');
const helpersEnd = html.indexOf('/* ---------------- raw block parser ---------------- */', helpersStart);
const helpers = html.slice(helpersStart, helpersEnd);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart && helpers.includes('function cleanTxid('),
  'Ownership helpers must be present before the raw block parser');

function runtime(options = {}) {
  let saved = options.saved ?? null;
  let updates = 0;
  const writes = [];
  const elements = new Map([
    ['q', {value: 'yoyoyo'}],
    ['hint', {innerHTML: '', textContent: ''}],
    ['sig', {value: 'deadbeef'}],
  ]);
  const scope = vm.createContext({
    localStorage: options.storage || {
      getItem(key) {
        assert.equal(key, STORAGE_KEY);
        if (options.readFails) throw new Error('Storage unavailable');
        return saved;
      },
      setItem(key, value) {
        assert.equal(key, STORAGE_KEY);
        if (options.writeFails) throw new Error('Storage quota exceeded');
        saved = value; writes.push(value);
      },
    },
    document: options.document || {querySelectorAll: () => []},
    $: name => elements.get(name),
    updateOwnBubbles: () => {updates++;},
    parentOf: () => null,
    TextEncoder, TextDecoder, console,
  });
  vm.runInContext(helpers, scope);
  // Storage/render tests do not need to mirror the page's DOM structure.
  // A separate DOM test below executes the real updater.
  scope.notePaint = () => {updates++;};
  vm.runInContext('updateOwnBubbles = () => notePaint();', scope);
  const rendererStart = html.indexOf('const NAMES=');
  const rendererEnd = html.indexOf('function turn(', rendererStart);
  vm.runInContext(html.slice(rendererStart, rendererEnd), scope);
  vm.runInContext(declaration('turn'), scope);
  return { scope, elements, writes,
    get saved() { return saved; },
    get updates() { return updates; },
    own() { return Array.from(vm.runInContext('OWN', scope)); },
  };
}

test('Only complete transaction IDs can identify owned messages', () => {
  const app = runtime();
  assert.equal(app.scope.cleanTxid(FIRST.toUpperCase()), FIRST);
  for (const invalid of ['', FIRST.slice(0, 8), FIRST.slice(1), FIRST + '0', 'z'.repeat(64), null, undefined, 42, {}, []]) {
    assert.equal(app.scope.cleanTxid(invalid), '', 'Invalid identifier was accepted');
    assert.equal(app.scope.isMine(invalid), false);
  }
});

test('Stored IDs are normalized, validated, and deduplicated', () => {
  const app = runtime({saved: JSON.stringify([FIRST, FIRST.toUpperCase(), SECOND, FIRST.slice(0, 8), null, 7])});
  assert.deepEqual(new Set(app.own()), new Set([FIRST, SECOND]));
  assert.equal(app.scope.isMine(FIRST.toUpperCase()), true);
});

test('Missing, malformed, or wrongly shaped stored data never breaks initialization', () => {
  for (const saved of [null, '', '{bad json', '{}', 'null', '7', '"hello"']) {
    assert.deepEqual(runtime({saved}).own(), []);
  }
  assert.deepEqual(runtime({readFails: true}).own(), []);
});

test('Loading stored history retains the newest 1,000 valid IDs', () => {
  const ids = Array.from({length: 1003}, (_, index) => id(index + 1));
  const app = runtime({saved: JSON.stringify(ids)});
  assert.equal(app.own().length, 1000);
  assert.equal(app.scope.isMine(ids[2]), false);
  assert.equal(app.scope.isMine(ids[3]), true);
  assert.equal(app.scope.isMine(ids.at(-1)), true);
});

test('Marking a message persists it and updates existing bubbles', () => {
  const app = runtime();
  app.scope.markMine(FIRST.toUpperCase());
  assert.equal(app.scope.isMine(FIRST), true);
  assert.deepEqual(JSON.parse(app.saved), [FIRST]);
  assert.ok(app.updates > 0);
  const reloaded = runtime({saved: app.saved});
  assert.equal(reloaded.scope.isMine(FIRST), true);
});

test('Duplicate marks do not duplicate history and invalid marks add nothing', () => {
  const app = runtime();
  app.scope.markMine(FIRST);
  app.scope.markMine(FIRST.toUpperCase());
  for (const invalid of [FIRST.slice(0, 8), '', null, 'invalid']) app.scope.markMine(invalid);
  assert.deepEqual(app.own(), [FIRST]);
  assert.deepEqual(JSON.parse(app.saved), [FIRST]);
});

test('Adding beyond the history limit evicts the oldest ID', () => {
  const ids = Array.from({length: 1000}, (_, index) => id(index + 1));
  const app = runtime({saved: JSON.stringify(ids)});
  app.scope.markMine(FIRST);
  assert.equal(app.own().length, 1000);
  assert.equal(app.scope.isMine(ids[0]), false);
  assert.equal(app.scope.isMine(ids[1]), true);
  assert.equal(app.scope.isMine(FIRST), true);
  assert.equal(JSON.parse(app.saved).length, 1000);
});

test('Unmarking removes only the selected transaction and persists the change', () => {
  const app = runtime({saved: JSON.stringify([FIRST, SECOND])});
  app.scope.markMine(FIRST.toUpperCase(), false);
  assert.equal(app.scope.isMine(FIRST), false);
  assert.equal(app.scope.isMine(SECOND), true);
  assert.deepEqual(JSON.parse(app.saved), [SECOND]);
  assert.ok(app.updates > 0);
});

test('Storage failures preserve usable in-memory ownership', () => {
  const app = runtime({readFails: true, writeFails: true});
  assert.doesNotThrow(() => app.scope.markMine(FIRST));
  assert.equal(app.scope.isMine(FIRST), true);
  assert.ok(app.updates > 0);
  assert.doesNotThrow(() => app.scope.markMine(FIRST, false));
  assert.equal(app.scope.isMine(FIRST), false);
});

function sharedStorage(ids = []) {
  return {
    saved: JSON.stringify(ids), readFails: false, writeFails: false,
    getItem(key) {
      assert.equal(key, STORAGE_KEY);
      if (this.readFails) throw new Error('Storage unavailable');
      return this.saved;
    },
    setItem(key, value) {
      assert.equal(key, STORAGE_KEY);
      if (this.writeFails) throw new Error('Storage quota exceeded');
      this.saved = value;
    },
  };
}

test('A second tab preserves messages marked by the first tab before making its own edit', () => {
  const storage = sharedStorage();
  const first = runtime({storage}), second = runtime({storage});
  first.scope.markMine(FIRST);
  second.scope.markMine(SECOND);
  assert.deepEqual(new Set(JSON.parse(storage.saved)), new Set([FIRST, SECOND]));
  assert.equal(second.scope.isMine(FIRST), true);
  first.scope.syncOwn({key: STORAGE_KEY});
  assert.equal(first.scope.isMine(SECOND), true);
});

test('A stale tab cannot resurrect a message that another tab unmarked', () => {
  const storage = sharedStorage([FIRST, SECOND]);
  const first = runtime({storage}), second = runtime({storage});
  first.scope.markMine(FIRST, false);
  second.scope.markMine(id(3));
  assert.deepEqual(new Set(JSON.parse(storage.saved)), new Set([SECOND, id(3)]));
  assert.equal(second.scope.isMine(FIRST), false);
});

test('Storage events synchronize additions, removals, and clearing of ownership', () => {
  const storage = sharedStorage([FIRST]);
  const app = runtime({storage});
  storage.saved = JSON.stringify([FIRST, SECOND]);
  app.scope.syncOwn({key: STORAGE_KEY});
  assert.equal(app.scope.isMine(SECOND), true);
  storage.saved = JSON.stringify([SECOND]);
  app.scope.syncOwn({key: STORAGE_KEY});
  assert.equal(app.scope.isMine(FIRST), false);
  assert.equal(app.scope.isMine(SECOND), true);
  storage.saved = null;
  app.scope.syncOwn({key: null});
  assert.deepEqual(app.own(), []);
  assert.equal(app.updates, 3);
});

test('Unrelated storage events do not change ownership or repaint bubbles', () => {
  const storage = sharedStorage([FIRST]);
  const app = runtime({storage});
  storage.saved = JSON.stringify([SECOND]);
  app.scope.syncOwn({key: 'bac_theme'});
  assert.equal(app.scope.isMine(FIRST), true);
  assert.equal(app.scope.isMine(SECOND), false);
  assert.equal(app.updates, 0);
});

test('The shipped storage-event listener invokes ownership synchronization', () => {
  const storage = sharedStorage();
  const app = runtime({storage});
  let listener;
  app.scope.addEventListener = (type, callback) => {if (type === 'storage') listener = callback;};
  const binding = html.split('\n').find(line => /addEventListener\(['"]storage['"]/.test(line));
  assert.ok(binding, 'Storage listener is installed by the page');
  vm.runInContext(binding, app.scope);
  assert.equal(typeof listener, 'function');
  storage.saved = JSON.stringify([FIRST]);
  listener({key: STORAGE_KEY});
  assert.equal(app.scope.isMine(FIRST), true);
});

test('An unsaved mark survives synchronization and persists with later remote additions', () => {
  const storage = sharedStorage();
  const app = runtime({storage});
  storage.writeFails = true;
  app.scope.markMine(FIRST);
  assert.equal(app.scope.isMine(FIRST), true);
  storage.saved = JSON.stringify([SECOND]);
  app.scope.syncOwn({key: STORAGE_KEY});
  assert.deepEqual(new Set(app.own()), new Set([FIRST, SECOND]));
  storage.writeFails = false;
  app.scope.markMine(id(3));
  assert.deepEqual(new Set(JSON.parse(storage.saved)), new Set([FIRST, SECOND, id(3)]));
  storage.saved = JSON.stringify([SECOND]);
  app.scope.syncOwn({key: STORAGE_KEY});
  assert.deepEqual(app.own(), [SECOND], 'Successfully saved pending edits are not replayed after a remote removal');
});

test('An unsaved removal survives synchronization and is written when storage recovers', () => {
  const storage = sharedStorage([FIRST, SECOND]);
  const app = runtime({storage});
  storage.writeFails = true;
  app.scope.markMine(FIRST, false);
  storage.saved = JSON.stringify([FIRST, SECOND, id(3)]);
  app.scope.syncOwn({key: STORAGE_KEY});
  assert.equal(app.scope.isMine(FIRST), false);
  assert.equal(app.scope.isMine(id(3)), true);
  storage.writeFails = false;
  app.scope.markMine(id(4));
  assert.deepEqual(new Set(JSON.parse(storage.saved)), new Set([SECOND, id(3), id(4)]));
});

test('Pending changes retain the existing history when both reading and writing storage fail', () => {
  const storage = sharedStorage([FIRST]);
  const app = runtime({storage});
  storage.readFails = storage.writeFails = true;
  app.scope.markMine(SECOND);
  app.scope.markMine(FIRST, false);
  app.scope.syncOwn({key: STORAGE_KEY});
  assert.deepEqual(app.own(), [SECOND]);
  storage.readFails = storage.writeFails = false;
  storage.saved = JSON.stringify([FIRST, id(3)]);
  app.scope.markMine(id(4));
  assert.deepEqual(new Set(JSON.parse(storage.saved)), new Set([SECOND, id(3), id(4)]));
});

function message(txid, extra = {}) {
  return {txid, text: 'yoyoyo', kind: 'talk', height: 966496, time: 1790000000, ins: [], pay: [1], ...extra};
}
function rowIsOwned(markup) {
  const classes = [...markup.matchAll(/\bclass="([^"]*)"/g)].map(match => match[1].split(/\s+/));
  const row = classes.find(value => value.includes('row'));
  assert.ok(row, 'Renderer produced a message row');
  return row.includes('own');
}

test('A marked full transaction ID renders an own-message bubble', () => {
  const app = runtime({saved: JSON.stringify([FIRST])});
  assert.equal(rowIsOwned(app.scope.turn(message(FIRST), null)), true);
  assert.equal(rowIsOwned(app.scope.turn(message(SECOND), null)), false);
});

test('Matching text, sender label, payment scripts, input links, or a me flag cannot imply ownership', () => {
  const app = runtime({saved: JSON.stringify([FIRST])});
  for (const txid of [SECOND, FIRST.slice(0, 8), '']) {
    const candidate = message(txid, {who: 'You', me: true, ins: [FIRST], pay: [1]});
    assert.equal(rowIsOwned(app.scope.turn(candidate, message(FIRST, {who: 'You'}))), false);
  }
});

test('Unmarking also removes the own-message style on the next render', () => {
  const app = runtime({saved: JSON.stringify([FIRST])});
  app.scope.markMine(FIRST, false);
  assert.equal(rowIsOwned(app.scope.turn(message(FIRST), null)), false);
});

test('Existing bubbles and menu labels update in place when marked and unmarked', () => {
  function row(txid, incomplete = false) {
    const classes = new Set(['row', 'own']);
    const label = {hidden: false};
    const button = {textContent: ''};
    return {dataset: {txid}, label, button,
      classList: {
        toggle(name, active) {if (active) classes.add(name); else classes.delete(name);},
        contains(name) {return classes.has(name);},
      },
      querySelector(selector) {return incomplete ? null : selector === '.mine-label' ? label : button;},
    };
  }
  const rows = [row(FIRST), row(SECOND), row(FIRST.slice(0, 8)), row(FIRST, true)];
  const app = runtime({document: {querySelectorAll: () => rows}});
  vm.runInContext(declaration('updateOwnBubbles'), app.scope);
  assert.doesNotThrow(() => app.scope.markMine(FIRST));
  assert.equal(rows[0].classList.contains('own'), true);
  assert.equal(rows[0].label.hidden, false);
  assert.match(rows[0].button.textContent, /Unmark/i);
  assert.equal(rows[1].classList.contains('own'), false);
  assert.equal(rows[1].label.hidden, true);
  assert.match(rows[1].button.textContent, /^Mark as Mine$/i);
  assert.equal(rows[2].classList.contains('own'), false);
  assert.equal(rows[3].classList.contains('own'), true);
  app.scope.markMine(FIRST, false);
  assert.equal(rows[0].classList.contains('own'), false);
  assert.equal(rows[0].label.hidden, true);
  assert.match(rows[0].button.textContent, /^Mark as Mine$/i);
});

test('The message menu toggles only its selected transaction and closes afterwards', () => {
  const menu = {open: true};
  const button = {dataset: {txid: FIRST}, closest: () => menu};
  const app = runtime({
    saved: JSON.stringify([SECOND]),
    document: {querySelectorAll: selector => selector === '.markmine' ? [button] : []},
  });
  vm.runInContext(declaration('bind'), app.scope);
  app.scope.bind();
  button.onclick();
  assert.equal(app.scope.isMine(FIRST), true);
  assert.equal(app.scope.isMine(SECOND), true);
  assert.equal(menu.open, false);
  menu.open = true;
  button.onclick();
  assert.equal(app.scope.isMine(FIRST), false);
  assert.equal(app.scope.isMine(SECOND), true);
  assert.equal(menu.open, false);
});

function sendingRuntime(options = {}) {
  const app = runtime(options);
  const events = [];
  const L = {
    buildPsbt: async () => ({type: 'p2wpkh', psbt: new Uint8Array([1]), fee: 100, vbytes: 100, inputs: [{}]}),
    extract: () => {events.push('extract'); return 'deadbeef';},
    hexToBytes: () => new Uint8Array([1]),
    b64dec: () => {if (options.parseFails) throw new Error('Malformed signed result'); return new Uint8Array([1]);},
  };
  const wallet = {
    name: 'Test Wallet', id: 'test', p: () => ({}),
    connect: async () => {
      if (options.connectFails) throw new Error('Wallet connection cancelled');
      return {address: 'test-wallet-address', publicKey: 'test-public-key'};
    },
    sign: async () => {
      events.push('sign');
      if (options.signFails) throw new Error('Signature rejected');
      return options.fallback ? {psbt: new Uint8Array([1])} : {txid: FIRST};
    },
  };
  Object.assign(app.scope, {
    BUSY: false, FILE: null, RATE: 3,
    refreshComp: () => {}, drawAtt: () => {},
    hint: text => {app.elements.get('hint').textContent = text;},
    setst: text => {events.push(['status', text]);},
    fail: error => {events.push(['error', error.message]);},
    sats: value => value + ' sats',
    lib: async () => L,
    getUtxos: async () => [{txid: SECOND, vout: 0, value: 10000}],
    checkPsbt: () => {events.push('checked'); return 100;},
    push: async () => {
      events.push('push');
      if (options.pushFails) throw new Error('Broadcast rejected');
      return FIRST;
    },
    drop: () => {events.push('disconnected');},
    setTimeout: () => 1,
  });
  vm.runInContext(declaration('publish') + '\n' + declaration('broadcastPasted'), app.scope);
  return {...app, app, events, L, wallet};
}

for (const fallback of [false, true]) {
  test(`Successful ${fallback ? 'signed-PSBT broadcast' : 'wallet broadcast'} remembers the returned transaction`, async () => {
    const run = sendingRuntime({fallback});
    await run.scope.publish(run.wallet, 'yoyoyo');
    assert.equal(run.scope.isMine(FIRST), true);
    assert.deepEqual(JSON.parse(run.app.saved), [FIRST]);
    assert.ok(run.events.indexOf('checked') < run.events.indexOf('sign'));
    assert.equal(run.events.includes('push'), fallback);
    assert.ok(run.events.includes('disconnected'));
  });
}

for (const [label, flags] of [
  ['wallet connection', {connectFails: true}],
  ['wallet signing', {signFails: true}],
  ['fallback broadcasting', {fallback: true, pushFails: true}],
]) {
  test(`A failure during ${label} does not mark the unsent message`, async () => {
    const run = sendingRuntime(flags);
    await run.scope.publish(run.wallet, 'yoyoyo');
    assert.deepEqual(run.own(), []);
    assert.equal(run.app.saved, null);
  });
}

test('Successful offline broadcasting remembers its returned transaction', async () => {
  const run = sendingRuntime();
  await run.scope.broadcastPasted(run.L);
  assert.equal(run.scope.isMine(FIRST), true);
  assert.deepEqual(JSON.parse(run.app.saved), [FIRST]);
});

test('Rejected offline broadcasting does not mark a transaction', async () => {
  const run = sendingRuntime({pushFails: true});
  await run.scope.broadcastPasted(run.L);
  assert.deepEqual(run.own(), []);
  assert.equal(run.app.saved, null);
});

test('Invalid signed input does not broadcast or mark a transaction', async () => {
  const run = sendingRuntime({parseFails: true});
  run.elements.get('sig').value = 'not-a-valid-signed-psbt';
  await run.scope.broadcastPasted(run.L);
  assert.equal(run.events.includes('push'), false);
  assert.deepEqual(run.own(), []);
});

test('Storage errors do not turn a successful send into a signing failure', async () => {
  const run = sendingRuntime({writeFails: true});
  await run.scope.publish(run.wallet, 'yoyoyo');
  assert.equal(run.scope.isMine(FIRST), true);
  assert.match(run.elements.get('hint').textContent, /^Sent\./);
});
