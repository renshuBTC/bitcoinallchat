const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('let TIP_POLLING='),html.indexOf('async function startApp(){'));
function app(){
  const h={target:'102',scans:[],fail:0,nodes:new Map()};
  const scope=vm.createContext({API:'https://example.test',TIP:100,busy:false,msgs:[],next:50,scanned:50,orCount:500,
    BLOCK_RETRY:new Set(),LOAD_FAILED:false,LOAD_PAUSED:false,
    $:id=>{if(!h.nodes.has(id))h.nodes.set(id,{});return h.nodes.get(id)},
    readBlockResource:async()=>h.target,scanBlock:async height=>{h.scans.push(height);if(height===h.fail)throw Error('offline');return [{height}];},
    atBottom:()=>true,yieldToBrowser:async()=>{},render(){},toBottom(){},updateJump(){},observeTop(){},
    loadInitial:async()=>{h.reloaded=true;}
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
  const h=app();let finish;h.scope.readBlockResource=()=>new Promise(r=>{finish=r;});
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
