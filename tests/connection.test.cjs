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
  const nodes = new Map(['q', 'wallet-xverse', 'wallet-disconnect', 'signing-options'].map(id => [id, {hidden:id==='signing-options',focus() {h.focus = id;}}]));
  h.nodes=nodes;
  h.wallet = {id: 'xverse', name: 'Xverse', p: () => ({}), connect: async () => {h.events.push('connect');return {address:'bc1q-test'};}};
  h.scope = vm.createContext({
    ACTIVE_WALLET:null, WALLET_EPOCH:0, BUSY:false, MAXDATA:100000,
    $: id => nodes.get(id), esc: x => String(x), hint: x => {h.status=x;},
    drop: w => h.events.push('drop:' + w.id), refreshComp() {}, placeJump() {},
    detected: () => h.available, hasDraft: () => !!h.draft.trim(), payload: () => h.draft,
    publish: (w, text) => h.events.push(['publish', w.id, text]),
  });
  vm.runInContext(html.split('\n').find(line => line.startsWith('const dropAll=')), h.scope);
  h.available=[h.wallet];
  vm.runInContext(['armFooter', 'connectOnly', 'send'].map(declaration).join('\n'), h.scope);
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
test('disconnect affects only the chosen wallet and a later Enter starts a fresh installed-wallet flow', async () => {
  const h=app();await h.scope.connectOnly(h.wallet);h.disconnect();
  assert.equal(h.scope.ACTIVE_WALLET,null);assert.equal(h.scope.WALLET_EPOCH,1);
  assert.deepEqual(h.events,['connect','drop:xverse']);
  assert.equal(h.events.some(Array.isArray),false);
  h.draft='Draft retained';await h.scope.send();
  assert.deepEqual(h.events.at(-1),['publish','xverse','Draft retained']);
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

test('Signing choices and burner note start hidden together and remain visible after a valid send',async()=>{
  const row=html.match(/<div class="dfr" id="signing-options"[^>]*>[\s\S]*?<\/div>/)?.[0];
  assert.ok(row);assert.match(row,/ hidden>/);assert.match(row,/Sign With/);assert.match(row,/Burner wallet/);
  assert.match(html,/\.dockfoot \.dfr\[hidden\]\{display:none\}/);
  const h=app();assert.equal(h.nodes.get('signing-options').hidden,true);
  h.draft='Hello';await h.scope.send();assert.equal(h.nodes.get('signing-options').hidden,false);
  assert.deepEqual(h.events,[['publish','xverse','Hello']]);
  h.draft='';await h.scope.send();assert.equal(h.nodes.get('signing-options').hidden,false);
  assert.equal(h.events.length,1);
});

test('Empty, whitespace, oversized and busy drafts cannot reveal choices or start a wallet flow',async()=>{
  for(const draft of ['', ' \n\t', 'x'.repeat(100001)]){
    const h=app();h.draft=draft;await h.scope.send();h.scope.armFooter();
    assert.equal(h.nodes.get('signing-options').hidden,true);assert.deepEqual(h.events,[]);
  }
  const h=app();h.draft='Hello';h.scope.BUSY=true;await h.scope.send();h.scope.armFooter();
  assert.equal(h.nodes.get('signing-options').hidden,true);assert.deepEqual(h.events,[]);
});

test('Without an installed wallet, Send reveals download and offline choices without connecting',async()=>{
  const h=app();h.available=[];h.draft='Hello';await h.scope.send();
  assert.equal(h.nodes.get('signing-options').hidden,false);assert.equal(h.focus,'wallet-xverse');
  assert.deepEqual(h.events,[]);
});

test('Actual provider detection chooses Xverse before UniSat, while active UniSat remains preferred',async()=>{
  for(const active of [false,true]){
    const h=app();h.scope.window={XverseProviders:{BitcoinProvider:{}},unisat:{}};
    const start=html.indexOf('const WAL='),end=html.indexOf('let BUSY=',start);
    vm.runInContext(html.slice(start,end),h.scope);
    const installed=vm.runInContext('detected()',h.scope);
    assert.deepEqual(Array.from(installed,w=>w.id),['xverse','unisat']);
    if(active)h.scope.ACTIVE_WALLET=installed[1];
    h.draft='Hello';await h.scope.send();assert.deepEqual(h.events,[['publish',active?'unisat':'xverse','Hello']]);
  }
});

test('A disappeared active provider cannot block the remaining installed provider',async()=>{
  const h=app();h.scope.ACTIVE_WALLET={id:'unisat'};h.draft='Hello';await h.scope.send();
  assert.equal(h.scope.ACTIVE_WALLET,null);assert.deepEqual(h.events,[['publish','xverse','Hello']]);
});
