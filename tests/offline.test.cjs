// Exercises the page's actual offline UI functions without a wallet or network.
// Run with node --test tests/*.test.cjs from the repository.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');

function declaration(name) {
  const start = html.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  assert.ok(start >= 0, 'Missing actual page function: ' + name);
  for (let end = html.indexOf('}', start); end >= 0; end = html.indexOf('}', end + 1)) {
    const candidate = html.slice(start, end + 1);
    try { new vm.Script(candidate); return candidate; } catch {}
  }
  throw new Error('Could not extract ' + name);
}

function environment(wallet = true) {
  const elements = new Map();
  const listeners = new Map();
  const intervalsCleared = [];
  const document = { activeElement: null,
    addEventListener(type, callback) { listeners.set(type, callback); },
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll() { return []; }
  };
  class Element {
    constructor(id = '', tag = 'div', attrs = '') {
      this.id = id;
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.value = '';
      this.isConnected = true;
      this._html = '';
      const classes = new Set();
      this.classList = {
        add(...names) { names.forEach(x => classes.add(x)); },
        remove(...names) { names.forEach(x => classes.delete(x)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const active = force === undefined ? !classes.has(name) : force;
          if (active) classes.add(name); else classes.delete(name);
          return active;
        }
      };
      for (const [, key, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
        this.attributes[key] = value;
        if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
      }
      if (id) elements.set(id, this);
    }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      if (this.failNextSet) { this.failNextSet = false; throw new Error('Offline dialog rendering failed'); }
      for (const child of this.children) {
        child.isConnected = false;
        if (child.id) elements.delete(child.id);
      }
      this.children = [];
      this._html = value;
      for (const [, tag, attrs] of value.matchAll(/<([\w]+)\b([^>]*)>/g)) {
        const id = attrs.match(/\bid="([^"]+)"/);
        const child = new Element(id ? id[1] : '', tag, attrs);
        this.children.push(child);
      }
    }
    get textContent() { return this._html.replace(/<[^>]*>/g, ''); }
    set textContent(value) { this._html = value; }
    querySelectorAll(selector) {
      if (selector === 'button') return this.children.filter(el => el.tagName === 'BUTTON');
      return this.children.filter(el => /BUTTON|INPUT|TEXTAREA/.test(el.tagName));
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    contains(el) { return this === el || this.children.includes(el); }
    focus() { document.activeElement = this; }
    click() { this.focus(); return this.onclick?.({ target: this, preventDefault() {} }); }
  }
  for (const id of ['ovs', 'ovp', 'pcard', 'hint', 'q', 'sendb']) new Element(id);
  const activeWallet = { id: 'testwallet', name: 'Test Wallet' };
  const ctx = vm.createContext({
    document,
    $: id => elements.get(id) || null,
    ovs: elements.get('ovs'), ovp: elements.get('ovp'), pcard: elements.get('pcard'),
    BUSY: false, FILE: null, WAL: [activeWallet], RATE: null,
    detected: () => wallet ? [activeWallet] : [],
    payload: () => 'Message for offline signing',
    armFooter() {}, publish() { throw new Error('A wallet must not be invoked by these tests'); },
    esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    clearInterval: id => intervalsCleared.push(id),
    setTimeout: fn => { fn(); return 1; },
    requestAnimationFrame: fn => { fn(); return 1; },
    TextEncoder,
    lib: async () => { throw new Error('Transaction builder unavailable'); },
    console
  });
  const statusStart = html.indexOf('function hint(');
  const statusEnd = html.indexOf('/* ------------------------------------------------------------------ pre-sign check', statusStart);
  const offlineStart = html.indexOf('let ANIM=');
  const offlineEnd = html.indexOf('function drawQR(', offlineStart);
  assert.ok(statusEnd > statusStart && offlineEnd > offlineStart);
  vm.runInContext(html.slice(statusStart, statusEnd), ctx);
  vm.runInContext(html.slice(offlineStart, offlineEnd), ctx);
  // Any state used by closeSheet is carried beside the real declarations.
  const modalStart = html.indexOf("const ovs=$('ovs')");
  const modalEnd = html.indexOf('function openSearch(', modalStart);
  if (modalStart >= 0 && modalEnd > modalStart) {
    const modalState = html.slice(modalStart, modalEnd).replace(/const ovs=[^;]*;/, '');
    vm.runInContext(modalState, ctx);
  }
  for (const name of ['openSearch', 'closeSearch', 'closeSheet', 'send', 'drawQR', 'buildQR']) {
    vm.runInContext(declaration(name), ctx);
  }
  const closeBindingsStart = html.indexOf('ovs.onclick=');
  const closeBindingsEnd = html.indexOf('function fillSearch(', closeBindingsStart);
  vm.runInContext(html.slice(closeBindingsStart, closeBindingsEnd), ctx);
  return { ctx, elements, document, listeners, intervalsCleared,
    async open() {
      await ctx.send();
      const button = wallet
        ? elements.get('hint').querySelectorAll('button').find(el => el.dataset.w === '__off')
        : elements.get('hoff');
      assert.ok(button, 'Offline option is presented');
      await button.click();
      return button;
    }
  };
}

for (const wallet of [true, false]) {
  test(`Offline click opens its form ${wallet ? 'with' : 'without'} an installed wallet`, async () => {
    const e = environment(wallet);
    await e.open();
    assert.ok(e.elements.get('ovp').classList.contains('on'), 'Offline sheet must be visible');
    assert.ok(e.elements.get('qa'), 'Spending address input exists');
    assert.ok(e.elements.get('qgo').onclick, 'Build action is connected');
    assert.equal(e.document.activeElement, e.elements.get('qa'), 'Address receives keyboard focus');
  });
}

test('Closing the sheet stops QR animation and camera tracks', async () => {
  const e = environment();
  await e.open();
  vm.runInContext('globalThis.cameraStopped=false; ANIM=41; CAM={getTracks:()=>[{stop(){globalThis.cameraStopped=true}}]};', e.ctx);
  await e.elements.get('pcl').click();
  assert.equal(e.elements.get('ovp').classList.contains('on'), false);
  assert.deepEqual(e.intervalsCleared, [41]);
  assert.equal(e.ctx.cameraStopped, true);
});

test('Backdrop and Escape close the sheet', async () => {
  const e = environment();
  await e.open();
  const ovp = e.elements.get('ovp');
  ovp.onclick({ target: ovp });
  assert.equal(ovp.classList.contains('on'), false);
  await e.open();
  e.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(ovp.classList.contains('on'), false);
});

test('Offline opening failure is visible instead of becoming a silent click', async () => {
  const e = environment();
  e.elements.get('pcard').failNextSet = true;
  await e.open();
  assert.match(e.elements.get('hint').textContent, /Offline dialog rendering failed/);
  assert.equal(e.elements.get('hint').classList.contains('bad'), true);
});

test('Reopening failure is visible even when a previous closed sheet has a status element', async () => {
  const e = environment();
  await e.open();
  await e.elements.get('pcl').click();
  e.elements.get('pcard').failNextSet = true;
  await e.open();
  assert.match(e.elements.get('hint').textContent, /Offline dialog rendering failed/);
  assert.equal(e.elements.get('hint').classList.contains('bad'), true);
});

test('Empty address displays a useful error within the open sheet', async () => {
  const e = environment();
  await e.open();
  await e.elements.get('qgo').click();
  assert.match(e.elements.get('st').textContent, /enter an address first/i);
});

test('Builder load rejection displays a useful error within the open sheet', async () => {
  const e = environment();
  await e.open();
  e.elements.get('qa').value = 'bc1qexample';
  await e.elements.get('qgo').click();
  assert.match(e.elements.get('st').textContent, /Transaction builder unavailable/);
});
