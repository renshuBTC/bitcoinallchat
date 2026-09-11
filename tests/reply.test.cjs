// Exercises the actual page and shipped builder with a local DOM/network double.
// No wallet is connected, no private key is used, and nothing is broadcast.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {webcrypto} = require('node:crypto');

const root = path.basename(__dirname) === 'tests' ? path.join(__dirname, '..') : path.join(__dirname, 'bitcoinallchat');
const html = fs.readFileSync(process.argv[2] || path.join(root, 'index.html'), 'utf8');
const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
const bootStart = script.indexOf('/* ---------------- boot ---------------- */');
const bootEnd = script.indexOf('function armFooter()', bootStart);
assert.ok(bootStart >= 0 && bootEnd > bootStart, 'Identify the page boot before isolating it');
const isolatedScript = (script.slice(0, bootStart) + script.slice(bootEnd)).replace(/^blockClock\(\);\s*$/m, '');

const FIRST = 'a1'.repeat(32);
const SECOND = 'b2'.repeat(32);
const THIRD = 'c3'.repeat(32);
const target = {txid: FIRST, vout: 2};
const utf8 = text => new TextEncoder().encode(text);
const bytes = value => Buffer.from(value);
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=', 'base64'));

function runtime() {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const attrs = new Map();
    const el = {
      id, value: '', textContent: '', innerHTML: '', className: '', disabled: false,
      style: {}, dataset: {}, scrollHeight: 40,
      classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
        toggle(x, force) { if (force === undefined) force = !classes.has(x); force ? classes.add(x) : classes.delete(x); return force; }},
      setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key),
      removeAttribute: key => attrs.delete(key),
      addEventListener() {}, focus() {}, click() {}, appendChild() {}, remove() {},
      querySelectorAll: () => [], querySelector: () => null,
      getBoundingClientRect: () => ({top: 600, bottom: 640, left: 0, right: 640, height: 40, width: 640}),
    };
    elements.set(id, el); return el;
  }
  const document = {getElementById: element, createElement: () => element('new-' + elements.size),
    querySelector: selector => selector === '.dock-in' ? element('dock-in') : null,
    querySelectorAll: () => [], addEventListener() {},
    documentElement: element('documentElement'), head: {appendChild() {}}};
  const scope = vm.createContext({document, console, TextEncoder, TextDecoder, Uint8Array,
    ArrayBuffer, DataView, AbortController, crypto: webcrypto, atob, btoa, URL, innerHeight: 800,
    localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
    addEventListener() {}, setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1,
    fetch: async () => {throw new Error('Unexpected network request in reply test');},
  });
  scope.window = {addEventListener() {}, scrollTo() {}, scrollY: 0, innerHeight: 800};
  vm.runInContext(isolatedScript, scope, {filename: 'actual-page.js'});
  const evaluate = text => vm.runInContext(text, scope);
  function setDraft({text = '', file = null, reply = null}) {
    element('q').value = text;
    scope.testFile = file; scope.testReply = reply;
    evaluate('FILE=testFile;REPLY=testReply;BUSY=false;refreshComp();');
  }
  function setMessages(list, cached = []) {
    scope.testMessages = list; scope.testCache = cached;
    evaluate('REPLY_CACHE.clear();for(const m of testCache)REPLY_CACHE.set(m.txid+":"+m.vout,m);reindex(testMessages);');
  }
  return {scope, elements, element, evaluate, setDraft, setMessages};
}

function builder() {
  const scope = vm.createContext({window: {}, crypto: webcrypto, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, DataView, atob, btoa});
  vm.runInContext(fs.readFileSync(path.join(root, 'post.js'), 'utf8'), scope, {filename: 'shipped-post.js'});
  return scope.window.BTCPOST;
}

test('Reply format preserves Unicode bytes and a complete normalized output reference', () => {
  const app = runtime();
  const text = '我未来10个月内一定要拿到苏州户口！！！\nمرحبا بالعالم 👋';
  const encoded = app.scope.encodeReply(text, {txid: FIRST.toUpperCase(), vout: 0});
  assert.equal(new TextDecoder().decode(encoded), `BAC1:reply:${FIRST}:0\n${text}`);
  const decoded = app.scope.decodeReply(encoded);
  assert.equal(decoded.replyTo, FIRST); assert.equal(decoded.replyVout, 0);
  assert.deepEqual(bytes(decoded.body), bytes(utf8(text)));
  const classified = app.scope.classifyPayload(encoded);
  assert.equal(classified.kind, 'talk'); assert.equal(classified.text, text);
  assert.equal(classified.replyTo, FIRST); assert.equal(classified.replyVout, 0);
});

test('Plain payloads are unchanged and encoding copies input bytes', () => {
  const app = runtime();
  const original = new Uint8Array([0, 1, 127, 128, 255]);
  const encoded = app.scope.encodeReply(original, null);
  assert.deepEqual(bytes(encoded), bytes(original)); assert.notEqual(encoded, original);
  encoded[0] = 42; assert.equal(original[0], 0);
  const text = 'Hello, unchanged world!';
  const decoded = app.scope.decodeReply(utf8(text));
  assert.equal(decoded.replyTo, ''); assert.equal(decoded.replyVout, null);
  assert.deepEqual(bytes(decoded.body), bytes(utf8(text)));
  assert.equal(app.scope.classifyPayload(utf8(text)).text, text);
});

test('Reply images and arbitrary binary retain their original complete body', () => {
  const app = runtime();
  for (const data of [png, Uint8Array.from([0, 255, 254, 1, 128, 10, 13]), new Uint8Array(1800).fill(0xff)]) {
    const encoded = app.scope.encodeReply(data, target);
    const decoded = app.scope.decodeReply(encoded);
    assert.deepEqual(bytes(decoded.body), bytes(data));
    const classified = app.scope.classifyPayload(encoded);
    assert.equal(classified.replyTo, FIRST); assert.equal(classified.replyVout, 2);
    assert.equal(classified.kind, data === png ? 'img' : 'data');
    if (data === png) {
      assert.equal(classified.mime, 'image/png');
      assert.deepEqual(bytes(classified.imageBytes), bytes(png));
      assert.equal(classified.b64, undefined);
    }
  }
});

test('Only one reply envelope is stripped and both uint32 boundary indexes work', () => {
  const app = runtime();
  const inner = app.scope.encodeReply('nested-looking literal body', {txid: SECOND, vout: 1});
  const outer = app.scope.encodeReply(inner, {txid: FIRST, vout: 0xffffffff});
  const decoded = app.scope.decodeReply(outer);
  assert.equal(decoded.replyTo, FIRST); assert.equal(decoded.replyVout, 0xffffffff);
  assert.deepEqual(bytes(decoded.body), bytes(inner));
  const emptyWire = app.scope.encodeReply('', target);
  const empty = app.scope.decodeReply(emptyWire);
  assert.deepEqual(bytes(empty.body), bytes(emptyWire));
  assert.equal(empty.replyTo, ''); assert.equal(empty.replyVout, null);
});

test('Malformed or unsupported reply headers remain literal original payloads', () => {
  const app = runtime();
  const cases = [
    `BAC2:reply:${FIRST}:0\nhello`, `BAC1:Reply:${FIRST}:0\nhello`,
    `BAC1:reply:${FIRST.slice(1)}:0\nhello`, `BAC1:reply:${FIRST}0:0\nhello`,
    `BAC1:reply:${'g'.repeat(64)}:0\nhello`, `BAC1:reply:${FIRST}:0hello`,
    `BAC1:reply:${FIRST}:0\r\nhello`,
    ...['', '-1', '+1', '1.5', '1e3', ' 1', '1 ', '4294967296', '99999999999999999999'].map(v => `BAC1:reply:${FIRST}:${v}\nhello`),
  ];
  for (const text of cases) {
    const decoded = app.scope.decodeReply(utf8(text));
    assert.equal(decoded.replyTo, '', text); assert.equal(decoded.replyVout, null, text);
    assert.deepEqual(bytes(decoded.body), bytes(utf8(text)), text);
  }
});

test('Encoding rejects incomplete identifiers and invalid output indexes', () => {
  const app = runtime();
  const invalid = [
    ...['', FIRST.slice(0, 8), FIRST.slice(1), FIRST + '0', 'z'.repeat(64), null, 17].map(txid => ({txid, vout: 0})),
    ...[-1, 1.5, NaN, Infinity, 0x100000000, '1', null, undefined].map(vout => ({txid: FIRST, vout})),
    {}, [],
  ];
  for (const value of invalid) assert.throws(() => app.scope.encodeReply('hello', value), 'Invalid target was encoded');
});

test('OP_RETURN reader rejoins real builder pushes at opcode and chunk boundaries', () => {
  const app = runtime(), core = builder();
  for (const length of [1, 75, 76, 255, 256, 520, 521, 1040, 1800]) {
    const body = Uint8Array.from({length}, (_, i) => i % 256);
    const script = core.dataScript(body);
    assert.deepEqual(bytes(app.scope.readOpReturn(bytes(script).toString('hex'))), bytes(body));
  }
  assert.deepEqual(bytes(app.scope.readOpReturn('6a000141')), Buffer.from('A'));
  for (const malformed of ['', 'zz', '6a01f', '6a01gg', '6a02ff', '6a4c', '6a4d01', '6a4e010000', '6a51', '00140102']) {
    assert.equal(app.scope.readOpReturn(malformed), null, malformed);
  }
});

function u32(n) {const b = Buffer.alloc(4); b.writeUInt32LE(n); return b;}
function vi(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b;}
  return Buffer.concat([Buffer.from([0xfe]), u32(n)]);
}
function txOutput(value, script) {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value));
  return Buffer.concat([b, vi(script.length), bytes(script)]);
}
function fixtureBlock(outputScripts) {
  const tx = Buffer.concat([u32(2), vi(1), Buffer.alloc(32), u32(0xffffffff), vi(0), u32(0xffffffff),
    vi(outputScripts.length), ...outputScripts.map((script, i) => txOutput(i === 0 ? 1000 : 0, script)), u32(0)]);
  const block = Buffer.concat([Buffer.alloc(80), vi(1), tx]);
  return Uint8Array.from(block).buffer;
}

test('Raw block parsing and scanBlock preserve each OP_RETURN output index and reference', async () => {
  const app = runtime(), core = builder();
  const buffer = fixtureBlock([
    Uint8Array.from([0, 20, ...new Array(20).fill(7)]),
    core.dataScript(app.scope.encodeReply('Reply to an exact output', target)),
    core.dataScript(utf8('Another message from the same transaction')),
    core.dataScript(app.scope.encodeReply(png, {txid: SECOND, vout: 0})),
  ]);
  const parsed = app.scope.parseBlock(buffer);
  assert.deepEqual(Array.from(parsed.outs, o => o.vout), [1, 2, 3]);
  app.scope.fetch = async url => {
    if (String(url).endsWith('/block-height/123')) return {ok: true, text: async () => THIRD};
    if (String(url).endsWith('/raw')) return {ok: true, arrayBuffer: async () => buffer};
    if (String(url).endsWith('/block/' + THIRD)) return {ok: true, json: async () => ({timestamp: 1234567890})};
    throw new Error('Unexpected fixture URL: ' + url);
  };
  const found = await app.scope.scanBlock(123);
  assert.deepEqual(Array.from(found, m => m.vout), [1, 2, 3]);
  assert.equal(found[0].replyTo, FIRST); assert.equal(found[0].replyVout, 2);
  assert.equal(found[0].text, 'Reply to an exact output');
  assert.equal(found[2].kind, 'img'); assert.equal(found[2].replyTo, SECOND);
  assert.equal(new Set(found.map(m => m.txid)).size, 1);
});

test('Explicit replies resolve the exact output even for the same wallet and repeated text', () => {
  const app = runtime();
  const first = {txid: FIRST, vout: 0, text: 'Wrong output', pay: [7]};
  const second = {txid: FIRST, vout: 2, text: 'This repeated text is intentionally the same', pay: [7]};
  const reply = {txid: SECOND, vout: 1, text: second.text, pay: [7], replyTo: FIRST, replyVout: 2, ins: []};
  app.setMessages([first, second, reply]);
  assert.equal(app.scope.parentOf(reply), second);
  reply.replyVout = 0;
  assert.equal(app.scope.parentOf(reply), first);
});

test('Cached explicit parents work and missing explicit parents never fall back to spend inference', () => {
  const app = runtime();
  const cached = {txid: FIRST, vout: 2, text: 'Earlier than the loaded room', pay: [7]};
  const unrelated = {txid: THIRD, vout: 0, text: 'A wallet funding source', pay: [8]};
  const reply = {txid: SECOND, vout: 0, text: 'My response', pay: [9], replyTo: FIRST, replyVout: 2, ins: [THIRD]};
  app.setMessages([unrelated, reply], [cached]);
  assert.equal(app.scope.parentOf(reply), cached);
  app.setMessages([unrelated, reply]);
  assert.equal(app.scope.parentOf(reply), null);
  reply.replyVout = 4;
  app.setMessages([unrelated, reply], [cached]);
  assert.equal(app.scope.parentOf(reply), null);
});

test('Fetching an unloaded parent validates the transaction and chooses exactly the requested output', async () => {
  const app = runtime(), core = builder();
  let calls = 0;
  app.scope.fetch = async url => {
    calls++; assert.equal(url, `https://mempool.space/api/tx/${FIRST}`);
    return {ok: true, json: async () => ({txid: FIRST,
      vout: [{scriptpubkey: bytes(core.dataScript(utf8('Wrong output'))).toString('hex')},
        {scriptpubkey: '0014' + '00'.repeat(20)},
        {scriptpubkey: bytes(core.dataScript(utf8('The requested original message'))).toString('hex')}],
      status: {block_height: 123, block_time: 456}})};
  };
  const result = await app.scope.loadReplyParent(FIRST.toUpperCase(), 2);
  assert.equal(result.txid, FIRST); assert.equal(result.vout, 2);
  assert.equal(result.text, 'The requested original message'); assert.equal(result.height, 123);
  assert.equal(await app.scope.loadReplyParent(FIRST, 2), result); assert.equal(calls, 1);
  assert.equal(await app.scope.loadReplyParent(FIRST, 1), null, 'A paid output cannot become a message');
  assert.equal(await app.scope.loadReplyParent(FIRST, 7), null, 'Out-of-range output stays unavailable');
  const before = calls;
  assert.equal(await app.scope.loadReplyParent(FIRST.slice(0, 8), 2), null);
  assert.equal(await app.scope.loadReplyParent(FIRST, -1), null);
  assert.equal(calls, before, 'Invalid references make no network request');
  app.scope.fetch = async () => ({ok: true, json: async () => ({txid: THIRD,
    vout: [{scriptpubkey: bytes(core.dataScript(utf8('Mismatched transaction'))).toString('hex')} ]})});
  assert.equal(await app.scope.loadReplyParent(SECOND, 0), null);
  assert.equal(app.evaluate('REPLY_CACHE.has("' + SECOND + ':0")'), false);
});

test('Concurrent parent requests share a fetch and a temporary failure can be retried', async () => {
  const app = runtime(), core = builder();
  let calls = 0, release;
  app.scope.fetch = () => {calls++; return new Promise(resolve => {release = resolve;});};
  const first = app.scope.loadReplyParent(FIRST, 0);
  const second = app.scope.loadReplyParent(FIRST, 0);
  assert.equal(calls, 1);
  release({ok: false});
  assert.equal(await first, null); assert.equal(await second, null);
  app.scope.fetch = async () => {calls++; return {ok: true, json: async () => ({txid: FIRST,
    vout: [{scriptpubkey: bytes(core.dataScript(utf8('Original now available'))).toString('hex')} ]})};};
  assert.equal((await app.scope.loadReplyParent(FIRST, 0)).text, 'Original now available');
  assert.equal(calls, 2);
});

test('Legacy spend quotes retain same-wallet and repost exclusions', () => {
  const app = runtime();
  const parent = {txid: FIRST, vout: 0, text: 'A long original statement worth answering', pay: [7]};
  const reply = {txid: SECOND, vout: 0, text: 'A different response', pay: [8], ins: [FIRST]};
  app.setMessages([parent, reply]);
  assert.equal(app.scope.parentOf(reply), parent);
  reply.pay = [7]; assert.equal(app.scope.parentOf(reply), null);
  reply.pay = [8]; reply.text = parent.text; assert.equal(app.scope.parentOf(reply), null);
});

test('Composer includes envelope bytes in text and file limits', () => {
  const app = runtime();
  const max = app.evaluate('MAXDATA');
  const overhead = app.scope.encodeReply('', target).length;
  app.setDraft({text: 'x'.repeat(max - overhead), reply: target});
  assert.equal(app.evaluate('payload().length'), max); assert.equal(app.element('sendb').disabled, false);
  app.setDraft({text: 'x'.repeat(max - overhead + 1), reply: target});
  assert.equal(app.element('sendb').disabled, true);
  app.setDraft({text: 'x'.repeat(max)}); assert.equal(app.element('sendb').disabled, false);
  const file = {name: 'bytes.bin', type: 'application/octet-stream', bytes: new Uint8Array(max - overhead)};
  app.setDraft({file, reply: target});
  assert.equal(app.evaluate('payload().length'), max); assert.equal(app.element('sendb').disabled, false);
  app.setDraft({file: {...file, bytes: new Uint8Array(max - overhead + 1)}, reply: target});
  assert.equal(app.element('sendb').disabled, true);
});

test('Selecting a reply alone or with whitespace cannot open a signing route', async () => {
  const app = runtime();
  let footer = 0, signing = 0;
  app.scope.noteFooter = () => {footer++;}; app.scope.noteSigning = () => {signing++;};
  app.evaluate('armFooter=noteFooter;drawQR=noteSigning;');
  for (const text of ['', ' ', '\n\t']) {
    app.setDraft({text, reply: target});
    assert.equal(app.element('sendb').disabled, true);
    await app.scope.send(); app.scope.chooseWallet('__off');
  }
  assert.equal(footer, 0); assert.equal(signing, 0);
});

test('Draft cleanup clears the sent selection and preserves the complete draft if anything changed while signing', () => {
  const app = runtime();
  const file = {name: 'a.bin', type: 'application/octet-stream', bytes: new Uint8Array([1])};
  app.setDraft({text: 'sent text', file, reply: target});
  const draft = app.scope.captureDraft();
  assert.equal(draft.text, 'sent text'); assert.equal(draft.file, file); assert.equal(draft.reply, target);
  app.scope.clearSentDraft(draft);
  assert.equal(app.element('q').value, ''); assert.equal(app.evaluate('FILE'), null); assert.equal(app.evaluate('REPLY'), null);
  const otherFile = {...file, name: 'b.bin', bytes: new Uint8Array([2])};
  const otherReply = {txid: SECOND, vout: 0};
  app.setDraft({text: 'sent text', file, reply: target});
  const snapshot = app.scope.captureDraft();
  app.setDraft({text: 'new unsent text', file: otherFile, reply: otherReply});
  app.scope.clearSentDraft(snapshot);
  assert.equal(app.element('q').value, 'new unsent text');
  assert.equal(app.evaluate('FILE'), otherFile); assert.equal(app.evaluate('REPLY'), otherReply);
  app.setDraft({text: 'new unsent text', file, reply: target});
  app.scope.clearSentDraft(snapshot);
  assert.equal(app.element('q').value, 'new unsent text');
  assert.equal(app.evaluate('FILE'), file); assert.equal(app.evaluate('REPLY'), target);
});

test('Reply is the only menu action and preserves the draft when selected', () => {
  const app = runtime();
  const parent = {txid: FIRST, vout: 2, text: 'Original message', kind: 'talk', height: 1, time: 1};
  app.setMessages([parent]); app.setDraft({text: 'Keep this draft'});
  const menu = {open: true};
  const button = {dataset: {txid: FIRST, vout: '2'}, closest: () => menu};
  app.scope.document.querySelectorAll = selector => selector === '.reply-action' ? [button] : [];
  app.scope.bind(); button.onclick();
  assert.equal(menu.open, false);
  assert.equal(app.element('q').value, 'Keep this draft');
  assert.equal(app.element('reply-preview').hidden, false);
  assert.equal(app.element('reply-excerpt').textContent, parent.text);
  assert.equal(app.evaluate('REPLY.vout'), 2);
  const markup = app.scope.turn(parent, null);
  assert.match(markup, /class="reply-action"[^>]*>Reply<\/button>/);
  assert.doesNotMatch(markup, /Mark as Mine|Unmark|markmine/);
  app.scope.cancelReply();
  assert.equal(app.element('reply-preview').hidden, true);
  assert.equal(app.element('q').value, 'Keep this draft');
});

test('Loading an original updates replacement quote elements after the thread redraws', async () => {
  const app = runtime();
  function quote(name) {
    const el = app.element(name), title = app.element(name + '-name'), excerpt = app.element(name + '-text');
    el.dataset = {parent: FIRST, vout: '2'};
    el.querySelector = selector => selector === '.qn' ? title : excerpt;
    return {el, title, excerpt};
  }
  const first = quote('first-quote'), replacement = quote('replacement-quote');
  let visible = [first.el], complete;
  app.scope.document.querySelectorAll = selector => selector === '.qt[data-parent]' ? visible : [];
  app.scope.loadReplyParent = () => new Promise(resolve => {complete = resolve;});
  app.scope.bind();
  let prevented = false;
  const pending = first.el.onclick({preventDefault() {prevented = true;}});
  visible = [replacement.el];
  complete({txid: FIRST, vout: 2, text: 'Loaded original', kind: 'talk'});
  await pending;
  assert.equal(prevented, true);
  assert.equal(replacement.excerpt.textContent, 'Loaded original');
  assert.equal(replacement.title.textContent, FIRST.slice(0, 8));
  assert.equal(replacement.el.onclick, null);
});

test('Shipped builder and independent checker carry the full reply reference with only change as a paid output', async () => {
  const app = runtime(), core = builder();
  const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const utxos = [{txid: THIRD, vout: 0, value: 1000000}];
  const home = (await core.decodeAddress(address)).script;
  const sources = {script: home, coins: utxos.map(coin => ({...coin, script: home}))};
  for (const data of ['你好，Bitcoin! This is a reply.', png, new Uint8Array(1400).fill(0xa5)]) {
    const wire = app.scope.encodeReply(data, target);
    const built = await core.buildPsbt({address, publicKey: null, utxos, message: wire, feeRate: 2});
    assert.equal(app.scope.checkPsbt(built.psbt, wire, 2, built.fee, sources), built.fee);
    const transaction = app.scope.readPsbt(built.psbt);
    assert.equal(transaction.outs.length, 2);
    const messageOutputs = transaction.outs.filter(o => o.script[0] === 0x6a);
    const paidOutputs = transaction.outs.filter(o => o.value > 0);
    assert.equal(messageOutputs.length, 1); assert.equal(messageOutputs[0].value, 0);
    assert.deepEqual(bytes(app.scope.readOpReturn(bytes(messageOutputs[0].script).toString('hex'))), bytes(wire));
    assert.equal(paidOutputs.length, 1); assert.deepEqual(bytes(paidOutputs[0].script), bytes(home));
    assert.equal(paidOutputs[0].value + built.fee, 1000000);
    const body = typeof data === 'string' ? utf8(data) : data;
    assert.throws(() => app.scope.checkPsbt(built.psbt, body, 2, built.fee, sources), /message on the wire/);
    const other = app.scope.encodeReply(data, {txid: FIRST, vout: 3});
    assert.throws(() => app.scope.checkPsbt(built.psbt, other, 2, built.fee, sources), /message on the wire/);
    const plainBuilt = await core.buildPsbt({address, publicKey: null, utxos, message: body, feeRate: 2});
    assert.ok(built.fee > plainBuilt.fee, 'Reference bytes are included in the miner fee estimate');
  }
});
