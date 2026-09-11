const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const code=html.slice(start,end+1);try{new vm.Script(code);return code}catch{}
  }throw Error('Cannot extract '+name);
}
const FLOOR=965818,SEED='c103de95817b43f2df635ec6f35ff126ca26a7c6d20570c4b01866b2b3e69a19';
const id=n=>n.toString(16).padStart(64,'0');
const message=(n,extra={})=>({kind:'talk',text:'Message '+n,txid:id(n),vout:0,height:FLOOR+n,time:1788719410+n,...extra});
const transaction=(n,extra={})=>({txid:id(n),status:{confirmed:true,block_height:FLOOR+n,block_time:1788719410+n},vout:[{scriptpubkey:'text:Message '+n}],...extra});
function runtime(span=70){
  const nodes=new Map(),requests=[],scans=[],renders=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',classList:{contains:()=>true}});return nodes.get(id)};
  const scope=vm.createContext({TIP:FLOOR+span-1,msgs:[],CHAIN_CHANGED:false,CHAIN_EPOCH:0,ROOM_HEIGHTS:new Set(),AbortController,
    API:'https://example.invalid',speech:m=>['talk','pgp','word'].includes(m.kind),$:node,
    readOpReturn:s=>typeof s==='string'&&s.startsWith('text:')?s.slice(5):null,
    classifyPayload:text=>({kind:'talk',text}),yieldToBrowser:async()=>{},
    readBlockResource:async(url,format,signal)=>{
      requests.push({url,format,signal});
      if(url.includes('/tx/'))return transaction(0,{txid:SEED,vout:[{scriptpubkey:'text:we are whitehats. contact us on chain'}]});
      return [];
    },
    scanBlock:async(height,options)=>{scans.push({height,options});return [message(height-FLOOR)]},
    fillSearch:()=>renders.push(scope.searchHistoryState()),
  });
  for(const name of ['cleanTxid','validVout','messageKey','searchKey'])vm.runInContext(declaration(name),scope);
  const start=html.indexOf('/* Explicit, cancellable history search.'),end=html.indexOf('/* ---------------- ui ---------------- */',start);
  assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end),scope);
  return {scope,node,requests,scans,renders,evaluate:code=>vm.runInContext(code,scope)};
}

test('Opening search discovers the verified transaction bytes without downloading raw history',async()=>{
  const h=runtime();await h.scope.startHistorySearch(true);
  assert.equal(h.scans.length,0);assert.equal(h.requests.length,2);
  assert.equal(h.requests[0].url,'https://example.invalid/tx/'+SEED);
  const seed=h.scope.searchMessages().find(m=>m.txid===SEED);
  assert.equal(seed.text,'we are whitehats. contact us on chain');assert.equal(seed.vout,0);assert.equal(seed.height,FLOOR);assert.equal(seed.time,1788719410);
  assert.equal(seed.who,undefined);assert.equal(h.scope.msgs.length,0);
  const state=h.scope.searchHistoryState();assert.equal(state.seedReady,true);assert.equal(state.coveredBlocks,0);assert.equal(state.complete,false);
});

test('Address discovery follows bounded cursors, deduplicates exact outputs, and never invents whole-block coverage',async()=>{
  const h=runtime();let pages=0;
  h.scope.readBlockResource=async url=>{
    if(url.includes('/tx/'))return transaction(0,{txid:SEED});
    pages++;return pages===1?Array.from({length:25},(_,n)=>transaction(n+1)): [transaction(25),transaction(26,{vout:[{scriptpubkey:'text:hello'},{scriptpubkey:'text:second output'}]})];
  };
  await h.scope.startHistorySearch(true);const rows=h.scope.searchMessages();
  assert.equal(pages,2);assert.equal(rows.length,28);assert.equal(rows.filter(m=>m.txid===id(26)).length,2);
  assert.equal(h.scope.searchHistoryState().coveredBlocks,0);assert.equal(h.scope.searchHistoryState().complete,false);
});

test('A continuous search is bounded to 60 blocks and resumes without refetching or losing results',async()=>{
  const h=runtime(65);await h.scope.startHistorySearch();
  let state=h.scope.searchHistoryState();assert.equal(h.scans.length,60);assert.equal(state.reason,'budget');assert.equal(state.complete,false);
  assert.ok(h.scans.every(s=>s.options.history===true));assert.equal(h.scope.msgs.length,0);
  const kept=h.scope.searchMessages().length;await h.scope.startHistorySearch();state=h.scope.searchHistoryState();
  assert.equal(h.scans.length,65);assert.equal(new Set(h.scans.map(s=>s.height)).size,65);
  assert.equal(state.complete,true);assert.equal(state.coveredBlocks,65);assert.equal(state.reason,'');assert.ok(h.scope.searchMessages().length>=kept);
  assert.ok(h.scans.every(s=>s.height>=FLOOR));
});

test('Normal-feed blocks count as covered without being downloaded again',async()=>{
  const h=runtime(4);h.scope.ROOM_HEIGHTS.add(FLOOR+3);h.scope.ROOM_HEIGHTS.add(FLOOR+2);
  h.scope.msgs=[message(3),message(2),message(40,{kind:'tag'})];
  await h.scope.startHistorySearch();assert.deepEqual(h.scans.map(s=>s.height),[FLOOR+1,FLOOR]);
  assert.equal(h.scope.searchHistoryState().coveredBlocks,4);assert.equal(h.scope.searchHistoryState().complete,true);
  assert.ok(h.scope.searchMessages().every(m=>m.kind==='talk'));
});

test('Paused in-flight reads abort and cannot publish stale data or move the retry cursor',async()=>{
  const h=runtime(2);await h.scope.startHistorySearch(true);let finish,signal;
  h.scope.scanBlock=(height,options)=>{signal=options.signal;return new Promise(resolve=>finish=()=>resolve([message(1)]))};
  const pending=h.scope.startHistorySearch();await Promise.resolve();
  h.scope.pauseHistorySearch();assert.equal(signal.aborted,true);finish();await pending;
  const state=h.scope.searchHistoryState();assert.equal(state.reason,'paused');assert.equal(state.coveredBlocks,0);assert.equal(state.nextHeight,FLOOR+1);
  assert.equal(h.scope.searchMessages().length,1);
});

test('A failed height remains retryable and cannot make incomplete coverage appear complete',async()=>{
  const h=runtime(3);let failed=true;
  h.scope.scanBlock=async height=>{h.scans.push({height});if(failed&&height===FLOOR+1)throw Error('offline');return [message(height-FLOOR)]};
  await h.scope.startHistorySearch();let state=h.scope.searchHistoryState();
  assert.equal(state.reason,'error');assert.equal(state.complete,false);assert.equal(state.nextHeight,FLOOR+1);
  failed=false;await h.scope.startHistorySearch();state=h.scope.searchHistoryState();
  assert.equal(state.complete,true);assert.deepEqual(h.scans.map(s=>s.height),[FLOOR+2,FLOOR+1,FLOOR+1,FLOOR]);
});

test('Memory limits reject a block atomically and preserve every already discovered record',async()=>{
  const h=runtime(2);await h.scope.startHistorySearch(true);h.evaluate('HISTORY_BYTES=HISTORY_MAX_BYTES-1024');
  const keys=h.scope.searchMessages().map(h.scope.messageKey);
  await h.scope.startHistorySearch();const state=h.scope.searchHistoryState();
  assert.equal(state.reason,'memory');assert.equal(state.coveredBlocks,0);assert.equal(state.nextHeight,FLOOR+1);
  assert.deepEqual(h.scope.searchMessages().map(h.scope.messageKey),keys);
});

test('Overlapping search windows keep every loaded result reachable in both directions',()=>{
  const h=runtime();const matches=Array.from({length:251},(_,n)=>message(n));h.scope.msgs=matches;
  h.scope.fillSearch=()=>h.scope.searchResultPage(h.scope.searchMessages());
  const older=new Set(),newer=new Set();let previous=null;
  for(;;){
    const page=h.scope.searchResultPage(matches);assert.ok(page.rows.length<=80);
    page.rows.forEach(row=>older.add(h.scope.messageKey(row)));
    if(previous){assert.ok(page.end<previous.end);assert.ok(page.end>previous.start,'Windows overlap to retain the visible row')}
    if(!page.hasEarlier)break;previous=page;h.scope.earlierSearchResults();
  }
  assert.equal(older.size,251);previous=null;
  for(;;){
    const page=h.scope.searchResultPage(matches);page.rows.forEach(row=>newer.add(h.scope.messageKey(row)));
    if(previous){assert.ok(page.start>previous.start);assert.ok(page.start<previous.end)}
    if(!page.hasLatest)break;previous=page;h.scope.newerSearchResults();
  }
  assert.equal(newer.size,251);assert.equal(h.scope.searchResultPage(matches).rows[0].txid,id(250));
  h.scope.earlierSearchResults();h.node('sq').value='different';assert.equal(h.scope.searchResultPage(matches).rows[0].txid,id(250));
});

test('A reorg cancels pending discovery and clears old-chain search state',async()=>{
  const h=runtime();let finish;h.scope.readBlockResource=()=>new Promise(resolve=>finish=resolve);
  const pending=h.scope.startHistorySearch(true);h.scope.CHAIN_EPOCH++;h.scope.resetHistorySearch();
  finish(transaction(0,{txid:SEED}));await pending;
  assert.equal(h.scope.searchMessages().length,0);assert.equal(h.scope.searchHistoryState().reason,'');assert.equal(h.scope.searchHistoryState().seedReady,false);
});

test('Malformed or unconfirmed bootstrap data cannot create manufactured historical messages',async()=>{
  for(const tx of [transaction(0),transaction(0,{txid:SEED,status:{confirmed:false}}),transaction(0,{txid:SEED,vout:[{scriptpubkey:'not an OP_RETURN'}]})]){
    const h=runtime();h.scope.readBlockResource=async()=>tx;await h.scope.startHistorySearch(true);
    assert.equal(h.scope.searchMessages().length,0);assert.equal(h.scope.searchHistoryState().reason,'error');assert.equal(h.scans.length,0);
  }
});

test('The address shortcut is capped even if every page is full, leaving raw history opt-in',async()=>{
  const h=runtime(500);let page=0;
  h.scope.readBlockResource=async url=>url.includes('/tx/')?transaction(0,{txid:SEED}):Array.from({length:25},(_,n)=>transaction(++page));
  await h.scope.startHistorySearch(true);
  assert.equal(h.scope.searchHistoryState().addressPages,16);assert.equal(h.scans.length,0);assert.equal(h.scope.searchHistoryState().coveredBlocks,0);
});

test('Memory pause survives reopening search and does not repeatedly refetch the rejected block',async()=>{
  const h=runtime(2);await h.scope.startHistorySearch(true);h.evaluate('HISTORY_BYTES=HISTORY_MAX_BYTES-1024');
  await h.scope.startHistorySearch();const scans=h.scans.length;
  h.scope.pauseHistorySearch('closed');
  await h.scope.startHistorySearch(true);await h.scope.startHistorySearch();
  assert.equal(h.scope.searchHistoryState().reason,'memory');assert.equal(h.scans.length,scans);
});
