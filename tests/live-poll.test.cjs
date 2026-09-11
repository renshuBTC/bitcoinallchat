const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('let TIP_POLLING='),html.indexOf('async function startApp(){'));
function app(){
  const h={target:'102',hash:'a'.repeat(64),scans:[],fail:0,nodes:new Map()};
  const scope=vm.createContext({API:'https://example.test',TIP:100,busy:false,msgs:[],next:50,scanned:50,orCount:500,
    BLOCK_RETRY:new Set(),LOAD_FAILED:false,LOAD_PAUSED:false,BLOCK_HASHES:new Map([[100,h.hash]]),BLOCK_PARENTS:new Map(),
    CHAIN_CHANGED:false,CHAIN_EPOCH:0,REPLY_CACHE:new Map(),REPLY_REQUESTS:new Map(),ALL_FIRST:'',ALL_NAV_RUN:0,ALL_COUNT:2000,ALL_PAGE_SIZE:2000,
    CHAT_FIRST:'',CHAT_COUNT:1000,CHAT_PAGE_SIZE:1000,CHAT_NAV_RUN:0,
    cleanTxid:value=>typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value)?value.toLowerCase():'',
    $:id=>{if(!h.nodes.has(id))h.nodes.set(id,{});return h.nodes.get(id)},
    readBlockResource:async url=>url.includes('/block-height/')?h.hash:h.target,scanBlock:async height=>{h.scans.push(height);if(height===h.fail)throw Error('offline');return [{height}];},
    atBottom:()=>true,yieldToBrowser:async()=>{},render(){},toBottom(){},updateJump(){},observeTop(){},
    resetHistorySearch(){h.historyReset=true;},
    loadInitial:async()=>{h.reloaded=true;},reindex:messages=>{h.indexed=messages;},
  });
  vm.runInContext(source+'\nTIP_READY=true;',scope);h.scope=scope;h.run=()=>scope.pollChainTip();return h;
}
test('a failed new block is retried instead of skipped',async()=>{
  const h=app();h.fail=102;await h.run();assert.equal(h.scope.TIP,101);
  h.fail=0;await h.run();assert.deepEqual(h.scans,[101,102,102]);assert.equal(h.scope.TIP,102);
  assert.equal(h.scope.msgs.length,2);
});
test('large tip gaps are processed in bounded batches',async()=>{
  const h=app();h.target='1000000';await h.run();assert.equal(h.scans.length,6);assert.equal(h.scope.TIP,106);
});
test('overlapping polls do not duplicate work',async()=>{
  const h=app();let finish;h.scope.readBlockResource=url=>url.includes('/block-height/')?Promise.resolve(h.hash):new Promise(r=>{finish=r;});
  const first=h.run();await h.run();finish('101');await first;assert.deepEqual(h.scans,[101]);
});
test('invalid tip responses do not enter a catch-up loop',async()=>{
  for(const value of ['123oops','Infinity','-1','9007199254740991']){
    const h=app();h.target=value;await h.run();assert.deepEqual(h.scans,[]);assert.equal(h.scope.TIP,100);
  }
});
test('a lower tip invalidates the old scanned range and reloads it',async()=>{
  const h=app();h.target='99';h.scope.msgs=[{height:100}];await h.run();
  assert.equal(h.scope.TIP,99);assert.equal(h.scope.msgs.length,0);assert.equal(h.reloaded,true);
});

test('a replacement block at the same height reloads the history and invalidates cached replies',async()=>{
  const h=app();h.target='100';h.hash='b'.repeat(64);h.scope.msgs=[{height:100}];
  h.scope.REPLY_CACHE.set('old',{});h.scope.REPLY_REQUESTS.set('pending',{});h.scope.ALL_FIRST='old page';
  await h.run();
  assert.equal(h.scope.TIP,100);assert.equal(h.reloaded,true);assert.equal(h.scope.msgs.length,0);
  assert.equal(h.scope.BLOCK_HASHES.size,0);assert.equal(h.scope.REPLY_CACHE.size,0);assert.equal(h.scope.REPLY_REQUESTS.size,0);
  assert.equal(h.scope.CHAIN_EPOCH,1);assert.equal(h.scope.ALL_FIRST,'');assert.equal(h.indexed.length,0);
});

test('a fork under a higher tip reloads instead of appending the new chain to old messages',async()=>{
  const h=app();h.hash='b'.repeat(64);await h.run();
  assert.equal(h.reloaded,true);assert.equal(h.scope.TIP,102);assert.equal(h.scope.next,102);assert.deepEqual(h.scans,[]);
});

test('an invalid confirmation hash leaves the current history intact for retry',async()=>{
  const h=app();h.hash='invalid/path';h.scope.msgs=[{height:100}];await h.run();
  assert.equal(h.reloaded,undefined);assert.equal(h.scope.TIP,100);assert.equal(h.scope.msgs.length,1);assert.deepEqual(h.scans,[]);
});

test('a conflicting neighboring scan triggers a reload even if the tip height has not changed',async()=>{
  const h=app();h.target='100';h.scope.CHAIN_CHANGED=true;await h.run();
  assert.equal(h.reloaded,true);assert.equal(h.scope.CHAIN_CHANGED,false);assert.equal(h.scope.CHAIN_EPOCH,1);
});
