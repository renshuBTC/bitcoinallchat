const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),assert=require('node:assert/strict');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'..','index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const code=html.slice(start,end+1);try{new vm.Script(code);return code}catch{}
  }throw new Error('Cannot extract '+name);
}
const messages=(count,start=0)=>Array.from({length:count},(_,i)=>({
  txid:(start+i+100000).toString(16).padStart(64,'0'),vout:0,
  height:start+i+500000,time:1000000+i,text:'payload '+(start+i),kind:'talk',
}));
function runtime(count=4500){
  const elements=new Map(),loads=[],renders=[],scrolls=[],observers=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',style:{}});return elements.get(id)};
  const scope=vm.createContext({console,msgs:messages(count),filter:'all',query:'',busy:false,next:100,scanned:10,
    LOAD_FAILED:false,LOAD_PAUSED:false,BLOCK_RETRY:new Set(),LANES:3,io:null,
    $:element,document:{querySelectorAll:()=>[],documentElement:{scrollHeight:100}},window:{scrollY:0,scrollTo(){}},
    counts(){},bind(){},reindex(){},speech:m=>m.kind==='talk',turn:m=>'<article>'+m.text+'</article>',
    toBottom:smooth=>scrolls.push(smooth),updateJump(){},shown:()=>100,
    IntersectionObserver:class{constructor(callback){observers.push(this);this.callback=callback}observe(){this.observed=true}disconnect(){this.disconnected=true}},
    loadOlder:async count=>loads.push(count),
  });
  for(const name of ['cleanTxid','validVout','messageKey','esc','messageExcerpt'])vm.runInContext(declaration(name),scope);
  const start=html.indexOf('const ALL_PAGE_SIZE='),end=html.indexOf('function render(){',start);
  assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end),scope);
  vm.runInContext(declaration('observeTop')+'\n'+declaration('render'),scope);
  const actual=scope.render;scope.render=()=>{actual();renders.push(element('thread').innerHTML)};
  const evaluate=s=>vm.runInContext(s,scope);
  const keys=()=>Array.from(scope.allPage().rows,m=>m.txid+':'+m.vout);
  return {scope,element,elements,loads,renders,scrolls,observers,evaluate,keys};
}
test('Latest payload page is bounded at 2,000 rows and both navigation controls are rendered',()=>{
  const app=runtime();app.scope.render();const page=app.scope.allPage();
  assert.equal(page.start,2500);assert.equal(page.end,4500);assert.equal(page.rows.length,2000);
  assert.equal((app.element('thread').innerHTML.match(/class="pay"/g)||[]).length,2000);
  assert.match(app.element('thread').innerHTML,/Earlier Payloads/);assert.match(app.element('thread').innerHTML,/Latest Payloads/);
  assert.match(app.element('thread').innerHTML,/2,501–4,500 of 4,500 loaded/);
});
test('Every loaded payload is reachable without extra network requests, including the partial oldest page',async()=>{
  const app=runtime(),seen=new Set(app.keys());
  await app.scope.earlierPayloads();assert.equal(app.scope.allPage().rows.length,2000);app.keys().forEach(k=>seen.add(k));
  await app.scope.earlierPayloads();assert.equal(app.scope.allPage().rows.length,500);app.keys().forEach(k=>seen.add(k));
  assert.equal(seen.size,4500);assert.deepEqual(app.loads,[]);
  app.scope.latestPayloads();assert.equal(app.scope.allPage().start,2500);assert.equal(app.scope.allPage().latest,true);
});
test('Already loaded pages remain navigable during background loading, without launching another fetch',async()=>{
  const app=runtime();app.scope.busy=true;
  assert.doesNotMatch(app.scope.allPageControls(app.scope.allPage()),/all-earlier" disabled/);
  await app.scope.earlierPayloads();assert.equal(app.scope.allPage().start,500);
  await app.scope.earlierPayloads();assert.equal(app.scope.allPage().start,0);
  assert.match(app.scope.allPageControls(app.scope.allPage()),/all-earlier" disabled/);
  await app.scope.earlierPayloads();assert.deepEqual(app.loads,[]);
});
test('Older pages retain their complete row set as live payloads append and other blocks prepend',async()=>{
  const app=runtime();await app.scope.earlierPayloads();const before=app.keys();
  app.scope.msgs.push(...messages(30,4500));app.scope.render();assert.deepEqual(app.keys(),before);
  app.scope.msgs=[...messages(100,-100),...app.scope.msgs];app.scope.render();assert.deepEqual(app.keys(),before);
  assert.match(app.element('thread').innerHTML,/This page stays in place/);
  app.scope.latestPayloads();assert.equal(app.scope.allPage().rows.at(-1).text,'payload 4529');
});
test('Latest page follows newly appended payloads while remaining bounded',()=>{
  const app=runtime();app.scope.msgs.push(...messages(3000,4500));app.scope.render();
  const page=app.scope.allPage();assert.equal(page.rows.length,2000);assert.equal(page.start,5500);assert.equal(page.rows.at(-1).text,'payload 7499');
});
test('A search resets paging to latest matches and earlier navigation covers all matching rows',async()=>{
  const app=runtime(9000);await app.scope.earlierPayloads();
  app.scope.msgs.forEach((m,i)=>{m.text=i%2?'match '+i:'other '+i});app.scope.query='match';app.scope.render();
  assert.equal(app.scope.allPage().latest,true);assert.equal(app.scope.allPage().matches.length,4500);
  const seen=new Set(app.keys());await app.scope.earlierPayloads();app.keys().forEach(k=>seen.add(k));
  await app.scope.earlierPayloads();app.keys().forEach(k=>seen.add(k));assert.equal(seen.size,4500);assert.deepEqual(app.loads,[]);
});
test('At the loaded edge, one click loads one batch and shows its earlier payloads',async()=>{
  const app=runtime(1000);app.scope.loadOlder=async count=>{app.loads.push(count);app.scope.msgs=[...messages(2500,-2500),...app.scope.msgs];app.scope.render()};
  await app.scope.earlierPayloads();const page=app.scope.allPage();
  assert.deepEqual(app.loads,[3]);assert.equal(page.rows.length,2000);assert.equal(page.rows[0].text,'payload -2000');assert.equal(page.rows.at(-1).text,'payload -1');
  await app.scope.earlierPayloads();assert.equal(app.scope.allPage().rows.length,500);assert.deepEqual(app.loads,[3]);
});
test('An empty fetched batch stops after one request and permits another explicit click',async()=>{
  const app=runtime(100);app.scope.loadOlder=async count=>{app.loads.push(count);app.scope.next-=count};
  await app.scope.earlierPayloads();assert.deepEqual(app.loads,[3]);assert.equal(app.scope.allPage().rows.length,100);
  await app.scope.earlierPayloads();assert.deepEqual(app.loads,[3,3]);
});
test('Empty search results can explicitly search older blocks without automatic loops',async()=>{
  const app=runtime(100);app.scope.query='needle';
  app.scope.loadOlder=async count=>{app.loads.push(count);const old=messages(1,-1);old[0].text='needle in an older block';app.scope.msgs=[...old,...app.scope.msgs]};
  await app.scope.earlierPayloads();assert.equal(app.scope.allPage().rows.length,1);assert.deepEqual(app.loads,[3]);
});
test('There is no fetch when the chain edge is exhausted, but failed heights remain retryable',async()=>{
  const app=runtime(100);app.scope.next=0;await app.scope.earlierPayloads();assert.deepEqual(app.loads,[]);
  app.scope.LOAD_FAILED=true;app.scope.LOAD_PAUSED=true;app.scope.BLOCK_RETRY.add(9);
  app.scope.loadOlder=async count=>{assert.equal(app.scope.LOAD_FAILED,false);assert.equal(app.scope.LOAD_PAUSED,false);app.loads.push(count)};
  await app.scope.earlierPayloads();assert.deepEqual(app.loads,[3]);
});
test('Repeated earlier clicks share no extra request and Latest can cancel the pending page move',async()=>{
  const app=runtime(100);let finish;
  app.scope.loadOlder=count=>{app.loads.push(count);return new Promise(r=>{finish=r})};
  const pending=app.scope.earlierPayloads();await app.scope.earlierPayloads();assert.deepEqual(app.loads,[3]);
  app.scope.latestPayloads();app.scope.msgs=[...messages(2500,-2500),...app.scope.msgs];finish();await pending;
  assert.equal(app.scope.allPage().latest,true);assert.equal(app.scope.allPage().rows.at(-1).text,'payload 99');
  assert.equal(app.evaluate('ALL_LOADING'),false);assert.doesNotMatch(app.element('thread').innerHTML,/Loading Earlier Payloads/);
});
test('Changing query or view during a request does not apply the old page selection or scroll the new view',async()=>{
  for(const changed of ['query','filter']){
    const app=runtime(100);let finish;app.scope.loadOlder=()=>new Promise(r=>{finish=r});
    const pending=app.scope.earlierPayloads();
    if(changed==='query')app.scope.query='none';else app.scope.filter='talk';
    const scrolls=app.scrolls.length;finish();await pending;assert.equal(app.scrolls.length,scrolls);
    assert.equal(app.evaluate('ALL_LOADING'),false);
    if(changed==='query')assert.equal(app.scope.allPage().rows.length,0);
  }
});
test('An unexpected loader rejection restores controls and offers an explicit retry',async()=>{
  const app=runtime(100);app.scope.loadOlder=async()=>{throw new Error('test offline')};
  await app.scope.earlierPayloads();assert.equal(app.evaluate('ALL_LOADING'),false);assert.equal(app.scope.LOAD_FAILED,true);
  assert.match(app.element('thread').innerHTML,/Earlier Payloads retries them/);
});
test('Everything disconnects any old top observer and cannot create an automatic loader',()=>{
  const app=runtime();let disconnected=0;app.scope.io={disconnect:()=>disconnected++};
  app.scope.observeTop();assert.equal(disconnected,1);assert.equal(app.observers.length,0);
  app.scope.filter='talk';app.scope.observeTop();assert.equal(app.observers.length,1);assert.equal(app.observers[0].observed,true);
  app.scope.filter='all';app.observers[0].callback([{isIntersecting:true}]);assert.deepEqual(app.loads,[]);
});
test('Conversation still renders all loaded conversation rows with its original top loader',()=>{
  const app=runtime(4500);app.scope.filter='talk';app.scope.render();
  assert.equal((app.element('thread').innerHTML.match(/<article>/g)||[]).length,4500);
  assert.doesNotMatch(app.element('thread').innerHTML,/Earlier Payloads/);assert.equal(app.observers.length,1);
});
test('Real event binding wires both copies of paging buttons',()=>{
  const app=runtime(),earlier=[{},{}],latest=[{},{}];
  app.scope.document.querySelectorAll=s=>s==='.all-earlier'?earlier:s==='.all-latest'?latest:[];
  vm.runInContext(declaration('bind'),app.scope);app.scope.bind();
  assert.ok(earlier.every(b=>b.onclick===app.scope.earlierPayloads));assert.ok(latest.every(b=>b.onclick===app.scope.latestPayloads));
});
test('Payload and reply previews normalize no more than the first 180 characters',()=>{
  const app=runtime(),text=' '.repeat(1000000)+'SHOULD NOT BE SCANNED';
  assert.equal(app.scope.payloadExcerpt({kind:'talk',text}),' ');
  assert.equal(app.scope.messageExcerpt({kind:'talk',text}),' ');
  assert.equal(app.scope.payloadExcerpt({kind:'data',hex:'a'.repeat(1000000)}).length,180);
  assert.equal(app.scope.payloadExcerpt({kind:'talk',text:'hello\n\tworld'}),'hello world');
});
test('Payload text and row attributes remain escaped in the bounded renderer',()=>{
  const app=runtime(1);app.scope.msgs[0].text='<img src=x onerror=alert(1)>';app.scope.render();
  assert.match(app.element('thread').innerHTML,/&lt;img/);assert.doesNotMatch(app.element('thread').innerHTML,/<img/);
});
