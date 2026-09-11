const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\('));assert.ok(start>=0,name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const source=html.slice(start,end+1);try{new vm.Script(source);return source}catch{}
  }throw Error('Cannot extract '+name);
}
function runtime(){
  const timers=new Map();let timer=0;
  const scope=vm.createContext({TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,AbortController,
    crypto:webcrypto,btoa,API:'https://example.invalid',query:'',isMine:()=>false,CHAIN_CHANGED:false,CHAIN_EPOCH:0,
    setTimeout(fn){const id=++timer;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),
    fetch:async()=>{throw Error('Unexpected network request')},
  });
  const from=html.indexOf('/* ---------------- raw block parser ---------------- */');
  const to=html.indexOf('function counts(){');
  vm.runInContext(declaration('cleanTxid')+'\n'+html.slice(from,to)+'\n'+declaration('readBlockResource'),scope);
  return {scope,timers,evaluate:code=>vm.runInContext(code,scope)};
}
const FIRST='ab'.repeat(32),SECOND='cd'.repeat(32),THIRD='ef'.repeat(32);
const message=(txid,vout,text)=>({txid,vout,text,kind:'talk',height:123,time:1700000000,pay:[]});

test('Reply-parent reads reject oversized responses before parsing and remain retryable',async()=>{
  const {scope,evaluate,timers}=runtime();let reads=0;
  scope.fetch=async()=>({ok:true,headers:{get:()=>1000001},json:async()=>{reads++;return {txid:FIRST,vout:[{scriptpubkey:'6a026869'}]}}});
  assert.equal(await scope.loadReplyParent(FIRST,0),null);assert.equal(reads,0);
  assert.equal(evaluate('REPLY_REQUESTS.size'),0);assert.equal(evaluate('REPLY_CACHE.size'),0);assert.equal(timers.size,0);
  scope.fetch=async()=>({ok:true,json:async()=>({txid:FIRST,vout:[{scriptpubkey:'6a026869'}]})});
  assert.equal((await scope.loadReplyParent(FIRST,0)).text,'hi');
});

test('A stalled original-message fetch times out and releases its in-flight slot',async()=>{
  const {scope,evaluate,timers}=runtime();
  scope.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));
  const pending=scope.loadReplyParent(FIRST,0);
  assert.equal(timers.size,1);[...timers.values()][0]();
  assert.equal(await pending,null);assert.equal(timers.size,0);assert.equal(evaluate('REPLY_REQUESTS.size'),0);
});

test('An old-chain reply fetch cannot populate the new cache or delete a replacement request',async()=>{
  const {scope,evaluate}=runtime();const requests=[];
  scope.fetch=()=>new Promise(resolve=>requests.push(resolve));
  const old=scope.loadReplyParent(FIRST,0);
  scope.CHAIN_EPOCH++;evaluate('REPLY_REQUESTS.clear();');
  const fresh=scope.loadReplyParent(FIRST,0);
  const response=text=>({ok:true,json:async()=>({txid:FIRST,vout:[{scriptpubkey:'6a'+Buffer.from(text).length.toString(16).padStart(2,'0')+Buffer.from(text).toString('hex')}]})});
  requests[0](response('old'));assert.equal(await old,null);
  assert.equal(evaluate('REPLY_REQUESTS.size'),1);assert.equal(evaluate('REPLY_CACHE.size'),0);
  requests[1](response('new'));assert.equal((await fresh).text,'new');assert.equal(evaluate('REPLY_REQUESTS.size'),0);
});

test('Oversized streams abort promptly even if cancellation never resolves',async()=>{
  const {scope,timers}=runtime();let cancelled=false,signal;
  scope.fetch=async(_,options)=>{signal=options.signal;return {ok:true,body:{getReader:()=>({
    read:async()=>({done:false,value:new Uint8Array(600000)}),
    cancel:()=>{cancelled=true;return new Promise(()=>{})},releaseLock(){},
  })}}};
  let watchdog;
  try{
    await assert.rejects(Promise.race([scope.readBlockResource('test','json'),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('cancellation stalled')),200)})]),/size limit/);
  }finally{clearTimeout(watchdog)}
  assert.equal(cancelled,true);assert.equal(signal.aborted,true);assert.equal(timers.size,0);
});

test('Tiny streamed chunks reconstruct only the received bytes without padding',async()=>{
  const {scope}=runtime();const expected=Buffer.from('{"text":"你好 مرحبا"}');let i=0;
  scope.fetch=async()=>({ok:true,body:{getReader:()=>({read:async()=>i<expected.length?{done:false,value:expected.subarray(i,++i)}:{done:true},releaseLock(){}})}});
  assert.equal((await scope.readBlockResource('test','json')).text,'你好 مرحبا');
  i=0;assert.deepEqual(Buffer.from(await scope.readBlockResource('test','raw')),expected);
});

test('A caller can abort a history read immediately without waiting for its network timeout',async()=>{
  const {scope,timers}=runtime();const controller=new AbortController();let signal;
  scope.fetch=(_,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))))};
  const pending=scope.readBlockResource('test','raw',controller.signal);controller.abort();
  await assert.rejects(pending,/cancelled/);assert.equal(signal.aborted,true);assert.equal(timers.size,0);
  let fetched=false;scope.fetch=async()=>{fetched=true};
  await assert.rejects(scope.readBlockResource('test','raw',controller.signal),/cancelled/);assert.equal(fetched,false);
});

test('Shared-output comparison reads input arrays linearly and reuses its index',()=>{
  const {scope}=runtime();let reads=0;const count=1000;
  const right=new Proxy(Array.from({length:count},(_,i)=>i+count),{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}});
  const left=Array.from({length:count},(_,i)=>i);
  assert.equal(scope.sameWallet({pay:left},{pay:right}),false);assert.ok(reads<=count+1,reads+' indexed reads');
  assert.equal(scope.sameWallet({pay:[count]},{pay:right}),true);assert.ok(reads<=count+1,'reuses index across message outputs');
});

test('An inferred spend quote skips ambiguous transactions while an exact reply still resolves',()=>{
  const {scope}=runtime();
  const a=message(FIRST,0,'first message'),b=message(FIRST,2,'second message'),reply=message(SECOND,0,'the answer');
  reply.ins=[FIRST];scope.reindex([a,b,reply]);assert.equal(scope.parentOf(reply),null);
  reply.replyTo=FIRST;reply.replyVout=2;assert.equal(scope.parentOf(reply),b);assert.doesNotMatch(scope.quoteHTML(reply),/Possible reply/);
  delete reply.replyTo;delete reply.replyVout;
  const unambiguous=message(THIRD,0,'a distinct message');reply.ins=[FIRST,THIRD];scope.reindex([a,b,unambiguous,reply]);
  assert.equal(scope.parentOf(reply),unambiguous);assert.match(scope.quoteHTML(reply),/Possible reply ·/);
});

test('Cached word and repost classification follows subsequent source-text changes',()=>{
  const {scope}=runtime(),word={kind:'word',text:'hello'};
  assert.equal(scope.speech(word),true);word.text='ordi';assert.equal(scope.speech(word),false);
  const a={text:'A sufficiently long original message'},b={text:'A sufficiently long original message again'};
  assert.equal(scope.repost(a,b),true);b.text='A different answer';assert.equal(scope.repost(a,b),false);
});

test('Text and quote payloads remain escaped even when they contain active HTML syntax',()=>{
  const {scope}=runtime(),payload='<img src=x onerror=alert(1)><script>alert(2)</script>';
  const parent=message(FIRST,0,payload),reply=message(SECOND,1,payload);reply.replyTo=FIRST;reply.replyVout=0;
  scope.reindex([parent,reply]);const rendered=scope.turn(reply,null);
  assert.ok(rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(rendered.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));
  assert.equal(rendered.includes('<img src=x'),false);
  assert.equal(rendered.includes('<script>'),false);
});

test('Thousands of row timestamps reuse locale formatters without changing their display',()=>{
  const {scope}=runtime();let constructed=0;
  scope.Intl={DateTimeFormat:function(...args){constructed++;return new Intl.DateTimeFormat(...args)}};
  const timestamp=1700000000,date=new Date(timestamp*1000);
  assert.equal(scope.displayTime(timestamp),date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}));
  assert.equal(scope.displayTime(timestamp,true),date.toLocaleDateString(undefined,{month:'long',day:'numeric'}));
  for(let i=0;i<2000;i++){scope.displayTime(timestamp+i);scope.displayTime(timestamp+i,true)}
  assert.equal(constructed,2);assert.equal(scope.displayTime(Infinity),'Unknown time');
});
