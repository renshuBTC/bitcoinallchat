const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),assert=require('node:assert/strict');
const root=path.basename(__dirname)==='tests'?path.join(__dirname,'..'):path.join(__dirname,'bitcoinallchat');
const html=fs.readFileSync(process.argv[2]||path.join(root,'index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\('));assert.ok(start>=0,name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const candidate=html.slice(start,end+1);try{new vm.Script(candidate);return candidate}catch{}
  }throw new Error('Cannot extract '+name);
}
function runtime(){
  const elements=new Map(),timers=new Map(),requests=[],rendered=[];let nextTimer=0;
  const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',style:{}});return elements.get(id)};
  const ctx=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,AbortController,
    API:'https://example.invalid',msgs:[],next:1000,busy:false,scanned:0,orCount:0,query:'',filter:'talk',
    document:{documentElement:{scrollHeight:100}},window:{scrollY:0,scrollTo(){}},$:el,
    setTimeout(fn,delay){const id=++nextTimer;if(delay===0)queueMicrotask(fn);else timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),
    render:()=>rendered.push(ctx.scanned),updateJump(){},syncReaderScroll(){},toBottom(){},atBottom:()=>true,
    speech:m=>m.kind==='talk',cleanTxid:value=>typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value)?value.toLowerCase():'',
    fetch:async url=>{requests.push(url);return {ok:true,headers:{get:()=>null},text:async()=>'a'.repeat(64),json:async()=>({timestamp:1}),arrayBuffer:async()=>new ArrayBuffer(81)}},
    parseBlock:()=>({outs:[],bytes:new Uint8Array(81),dv:new DataView(new ArrayBuffer(81)),total:0}),
    classifyPayload:()=>({kind:'talk',text:'hello world'}),
    txidOf:async(_,tx)=>String(tx.ver).padStart(64,'0'),inTxids:()=>[],
  });
  const start=html.indexOf('/* ---------------- scanning ---------------- */'),end=html.indexOf('/* ---------------- ui ---------------- */',start);
  assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end),ctx);
  return {ctx,evaluate:code=>vm.runInContext(code,ctx),requests,timers,elements,rendered};
}

test('scanBlock computes hash and input links once for all outputs of each transaction',async()=>{
  const app=runtime();let hashes=0,inputs=0;
  app.ctx.parseBlock=()=>({outs:Array.from({length:600},(_,i)=>({data:new Uint8Array([1]),vout:i,tx:{ver:i<300?4:800,bodyStart:9},pay:[]})),bytes:new Uint8Array(2),dv:new DataView(new ArrayBuffer(2)),total:600});
  app.ctx.txidOf=async(_,tx)=>{hashes++;return String(tx.ver).padStart(64,'0')};app.ctx.inTxids=()=>{inputs++;return []};
  const result=await app.ctx.scanBlock(42);
  assert.equal(result.length,600);assert.equal(hashes,2);assert.equal(inputs,2);assert.equal(app.ctx.scanned,1);assert.equal(app.ctx.orCount,600);
  assert.equal(result[0].txid,result[299].txid);assert.notEqual(result[299].txid,result[300].txid);
  assert.equal(app.timers.size,0);
});

test('block hash is validated before metadata or raw downloads',async()=>{
  const app=runtime();let calls=0;app.ctx.fetch=async()=>{calls++;return {ok:true,text:async()=>'unexpected/path'}};
  await assert.rejects(app.ctx.scanBlock(42),/Invalid block identifier/);assert.equal(calls,1);assert.equal(app.ctx.scanned,0);
});

test('neighboring block conflicts are rejected before their messages or counters are committed',async()=>{
  for(const setup of ["BLOCK_HASHES.set(42,'b'.repeat(64))","BLOCK_HASHES.set(41,'b'.repeat(64))","BLOCK_PARENTS.set(43,'b'.repeat(64))"]){
    const app=runtime();app.evaluate(setup);
    app.ctx.fetch=async()=>({ok:true,text:async()=>'a'.repeat(64),json:async()=>({timestamp:1,height:42,id:'a'.repeat(64),previousblockhash:'c'.repeat(64)}),arrayBuffer:async()=>new ArrayBuffer(81)});
    await assert.rejects(app.ctx.scanBlock(42),/chain changed/i);
    assert.equal(app.ctx.scanned,0);assert.equal(app.ctx.orCount,0);assert.equal(app.evaluate('CHAIN_CHANGED'),true);
  }
});

test('mismatched metadata and impossible timestamps cannot be attached to a requested block',async()=>{
  for(const metadata of [{timestamp:1,height:43},{timestamp:1,id:'b'.repeat(64)},{timestamp:0x100000000},{timestamp:1.5}]){
    const app=runtime();app.ctx.fetch=async()=>({ok:true,text:async()=>'a'.repeat(64),json:async()=>metadata,arrayBuffer:async()=>new ArrayBuffer(81)});
    await assert.rejects(app.ctx.scanBlock(42),/metadata mismatch|timestamp/i);assert.equal(app.ctx.scanned,0);
  }
});

test('raw reader rejects an excessive content length without reading its body',async()=>{
  const app=runtime();let read=false;app.ctx.fetch=async()=>({ok:true,headers:{get:()=>4000001},arrayBuffer:async()=>{read=true;return new ArrayBuffer(1)}});
  await assert.rejects(app.ctx.readBlockResource('test','raw'),/size limit/);assert.equal(read,false);assert.equal(app.timers.size,0);
});

test('streamed raw reader stops at the byte cap and cancels the stream',async()=>{
  const app=runtime();let reads=0,cancelled=false;
  app.ctx.fetch=async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(2100000)}},cancel:async()=>{cancelled=true}})}});
  await assert.rejects(app.ctx.readBlockResource('test','raw'),/size limit/);assert.equal(reads,2);assert.equal(cancelled,true);assert.equal(app.timers.size,0);
});

test('read timeout aborts stalled network requests and releases the timer',async()=>{
  const app=runtime();app.ctx.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  const pending=app.ctx.readBlockResource('test','raw');assert.equal(app.timers.size,1);
  [...app.timers.values()][0]();await assert.rejects(pending,/aborted/);assert.equal(app.timers.size,0);
});

test('startup renders the first block before wider background batches',async()=>{
  const app=runtime();let calls=0;
  app.ctx.scanBlock=async height=>{calls++;app.ctx.scanned++;return Array.from({length:30},(_,i)=>({kind:'talk',text:'hi '+i,height}))};
  await app.ctx.loadInitial();assert.equal(app.rendered[0],1);assert.ok(app.ctx.msgs.length>=100);assert.equal(calls,4);assert.equal(app.ctx.busy,false);
});

test('persistent startup errors pause after the first block rather than scanning the entire chain',async()=>{
  const app=runtime();let calls=0;app.ctx.scanBlock=async()=>{calls++;throw new Error('offline')};
  await app.ctx.loadInitial();assert.equal(calls,1);assert.equal(app.ctx.next,999);assert.equal(app.evaluate('LOAD_FAILED'),true);
  assert.deepEqual(Array.from(app.evaluate('BLOCK_RETRY')),[1000]);assert.equal(app.ctx.busy,false);
});

test('failed heights retry successfully without dropping or duplicating neighboring results',async()=>{
  const app=runtime();let failed=true;
  app.ctx.scanBlock=async height=>{if(height===999&&failed)throw new Error('temporary');return [{kind:'talk',height,text:String(height)}]};
  await app.ctx.loadBatch(3);assert.deepEqual(Array.from(app.ctx.msgs,m=>m.height),[998,1000]);
  failed=false;await app.ctx.loadBatch(1);assert.deepEqual(Array.from(app.ctx.msgs,m=>m.height),[998,999,1000]);
  assert.equal(app.evaluate('BLOCK_RETRY.size'),0);assert.equal(app.evaluate('LOAD_FAILED'),false);
});

test('Startup stops at its request budget while retaining earlier heights for later scrolling',async()=>{
  const app=runtime();let calls=0;app.ctx.scanBlock=async()=>{calls++;return []};
  await app.ctx.loadInitial();assert.equal(calls,260);assert.equal(app.evaluate('LOAD_ATTEMPTED'),260);
  assert.equal(app.ctx.next,740);assert.equal(app.ctx.busy,false);
});

test('initial and expanded text have finite DOM sizes without modifying the source message',()=>{
  const ctx=vm.createContext({String});vm.runInContext('const TEXT_PREVIEW_LIMIT=340,TEXT_EXPAND_LIMIT=100000;'+declaration('messageText'),ctx);
  const m={text:'<unsafe> '.repeat(30000)};const original=m.text;
  assert.equal(ctx.messageText(m).length,340);assert.equal(ctx.messageText(m,true).length,100000);assert.equal(m.text,original);
  assert.match(html,/\$\{esc\(messageText\(m\)\)\}/,'preview remains escaped in generated markup');
  assert.match(html,/t\.textContent=messageText\(m,expanded\)/,'expanded content is inserted as text');
  assert.match(html,/View Full Transaction/,'oversized full original remains reachable');
});

test('Reader edge markers and bounded conversation windows retain source records',()=>{
  const start=html.indexOf("if(filter==='all')"),end=html.indexOf('reindex(msgs)',start);
  assert.match(html.slice(start,end),/id="toploader"/);
  assert.match(html.slice(html.indexOf('function render(){'),html.indexOf('function bind(){')),/talk=page\.rows/);
  assert.match(html,/const CHAT_PAGE_SIZE=1000/);
});
