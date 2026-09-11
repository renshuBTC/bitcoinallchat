const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
function declaration(name) {
  const start = html.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  assert.ok(start >= 0);
  for (let end = html.indexOf('}', start); end >= 0; end = html.indexOf('}', end + 1)) {
    const code = html.slice(start, end + 1);
    try { new vm.Script(code); return code; } catch {}
  }
  throw Error('Missing function ' + name);
}
function app() {
  const h = { events: [], status: '', draft: '' };
  const nodes = new Map(['q', 'wallet-xverse', 'wallet-disconnect'].map(id => [id, {focus() {h.focus = id;}}]));
  h.wallet = {id: 'xverse', name: 'Xverse', p: () => ({}), connect: async () => {h.events.push('connect');return {address:'bc1q-test'};}};
  h.scope = vm.createContext({
    ACTIVE_WALLET:null, WALLET_EPOCH:0, BUSY:false, MAXDATA:100000,
    $: id => nodes.get(id), esc: x => String(x), hint: x => {h.status=x;},
    drop: w => h.events.push('drop:' + w.id), refreshComp() {}, armFooter() {},
    detected: () => [h.wallet], hasDraft: () => !!h.draft.trim(), payload: () => h.draft,
    publish: (w, text) => h.events.push(['publish', w.id, text]),
  });
  vm.runInContext(html.split('\n').find(line => line.startsWith('const dropAll=')), h.scope);
  vm.runInContext(['connectOnly', 'send'].map(declaration).join('\n'), h.scope);
  h.disconnect = () => nodes.get('wallet-disconnect').onclick();
  return h;
}
test('connecting an empty composer only requests an account; typing later can use Enter', async () => {
  const h=app();await h.scope.connectOnly(h.wallet);
  assert.deepEqual(h.events,['connect']);assert.equal(h.scope.ACTIVE_WALLET,h.wallet);
  assert.match(h.status,/Connected to Xverse/);assert.equal(h.focus,'q');
  h.draft='Hello 世界';await h.scope.send();
  assert.deepEqual(h.events.at(-1),['publish','xverse','Hello 世界']);
});
test('wallet cancellation does not remember a selection or sign a transaction', async () => {
  const h=app();h.wallet.connect=async()=>{throw Error('User cancelled');};
  await h.scope.connectOnly(h.wallet);
  assert.equal(h.scope.ACTIVE_WALLET,null);assert.equal(h.status,'Cancelled');assert.equal(h.scope.BUSY,false);
  assert.deepEqual(h.events,[]);
});
test('disconnect affects only the chosen wallet and prevents Enter from publishing', async () => {
  const h=app();await h.scope.connectOnly(h.wallet);h.disconnect();
  assert.equal(h.scope.ACTIVE_WALLET,null);assert.equal(h.scope.WALLET_EPOCH,1);
  assert.deepEqual(h.events,['connect','drop:xverse']);
  h.draft='Draft retained';await h.scope.send();assert.equal(h.focus,'wallet-xverse');
  assert.equal(h.events.some(Array.isArray),false);
});
test('page exit during a pending connection cannot revive the session', async () => {
  const h=app();let resolve;h.wallet.connect=()=>new Promise(r=>{resolve=r;});
  const pending=h.scope.connectOnly(h.wallet);
  vm.runInContext('dropAll()',h.scope);resolve({address:'bc1q-test'});await pending;
  assert.equal(h.scope.ACTIVE_WALLET,null);assert.deepEqual(h.events,['drop:xverse']);assert.equal(h.scope.BUSY,false);
});
test('a second connect click while permission is pending is ignored', async () => {
  const h=app();let resolve,calls=0;h.wallet.connect=()=>{calls++;return new Promise(r=>{resolve=r;});};
  const pending=h.scope.connectOnly(h.wallet);await h.scope.connectOnly(h.wallet);
  assert.equal(calls,1);resolve({address:'bc1q-test'});await pending;
});
