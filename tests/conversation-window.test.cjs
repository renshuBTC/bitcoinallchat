const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const code=html.slice(start,end+1);try{new vm.Script(code);return code}catch{}
  }throw Error('Cannot extract '+name);
}
const messages=(count,start=0)=>Array.from({length:count},(_,i)=>({
  txid:(100000+start+i).toString(16).padStart(64,'0'),vout:i%3,
  kind:'talk',text:'Message '+(start+i),height:965875,time:1788751805,
}));
function runtime(count=3500){
  const nodes=new Map(),loads=[],scrolls=[],observers=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',style:{},dataset:{},attrs:{},
      classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this.attrs[k]=v},
      scrollIntoView:options=>scrolls.push({id,options})});return nodes.get(id);
  };
  const buttons=[node('talk-view'),node('all-view')];buttons[0].dataset.v='talk';buttons[1].dataset.v='all';
  const scope=vm.createContext({msgs:messages(count),filter:'talk',query:'',busy:false,next:100,scanned:1,
    LOAD_FAILED:false,LOAD_PAUSED:false,BLOCK_RETRY:new Set(),LANES:3,io:null,
    $:node,document:{documentElement:{scrollHeight:100},querySelectorAll:s=>s==='.vb'?buttons:[],
      getElementById:id=>id.startsWith('m-')&&!node('thread').innerHTML.includes('id="'+id+'"')?null:node(id)},
    window:{scrollY:0,scrollTo(){}},setTimeout(){return 1},
    counts(){},bind(){},reindex(){},speech:m=>m.kind==='talk',shown:()=>count,
    toBottom:smooth=>scrolls.push({bottom:true,smooth}),atBottom:()=>true,updateJump(){},
    IntersectionObserver:class{constructor(callback){this.callback=callback;observers.push(this)}observe(){}disconnect(){}},
    loadOlder:async n=>loads.push(n),
  });
  scope.searchMessages=()=>scope.msgs;
  for(const name of ['cleanTxid','validVout','messageKey','messageDomId','esc','displayTime','loadingRetryButton'])vm.runInContext(declaration(name),scope);
  scope.turn=m=>'<article id="'+scope.messageDomId(m)+'">'+scope.esc(m.text)+'</article>';
  const start=html.indexOf('const ALL_PAGE_SIZE='),end=html.indexOf('function render(){',start);
  vm.runInContext(html.slice(start,end)+'\n'+declaration('render')+'\n'+declaration('observeTop'),scope);
  return {scope,node,loads,scrolls,observers,buttons,evaluate:code=>vm.runInContext(code,scope),key:m=>scope.messageKey(m)};
}

test('A dense block draws at most 1,000 bubbles and every older loaded message remains reachable',async()=>{
  const app=runtime(20000),seen=new Set();app.scope.render();
  for(let page=0;page<20;page++){
    const current=app.scope.chatPage();assert.equal(current.rows.length,1000);
    assert.equal((app.node('thread').innerHTML.match(/<article/g)||[]).length,1000);
    current.rows.forEach(m=>seen.add(app.key(m)));
    if(page<19)await app.scope.earlierMessages();
  }
  assert.equal(seen.size,20000);assert.equal(app.scope.msgs.length,20000);assert.deepEqual(app.loads,[]);
  app.scope.latestMessages();assert.equal(app.scope.chatPage().rows.at(-1).text,'Message 19999');
});

test('Ordinary initial results below the window size keep their complete list without extra controls',()=>{
  const app=runtime(100);app.scope.render();
  assert.equal((app.node('thread').innerHTML.match(/<article/g)||[]).length,100);
  assert.doesNotMatch(app.node('thread').innerHTML,/chat-earlier|chat-latest/);
});

test('A historical search result outside normal payload retention reveals its exact output in the bounded room',()=>{
  const app=runtime(100),archived=messages(2,-1000);archived[1].txid=archived[0].txid;archived[1].vout=7;
  app.scope.searchMessages=()=>[...archived,...app.scope.msgs];
  app.scope.filter='all';const key=app.key(archived[1]);
  assert.equal(app.scope.revealMessage(key),true);assert.equal(app.scope.filter,'talk');
  assert.ok(app.node('thread').innerHTML.includes('id="'+app.scope.messageDomId(archived[1])+'"'));
  assert.equal(app.scope.msgs.length,100);assert.ok(app.scope.chatPage().rows.length<=1000);
});

test('Earlier windows stay anchored while live arrivals append and older blocks load',async()=>{
  const app=runtime();await app.scope.earlierMessages();const before=app.scope.chatPage().rows.map(app.key);
  app.scope.msgs.push(...messages(300,3500));app.scope.msgs=[...messages(200,-200),...app.scope.msgs];app.scope.render();
  assert.deepEqual(app.scope.chatPage().rows.map(app.key),before);
  app.scope.latestMessages();assert.equal(app.scope.chatPage().rows.at(-1).text,'Message 3799');
});

test('A quoted or searched parent outside the DOM reveals the exact message and updates the selected view',()=>{
  const app=runtime(),target=app.scope.msgs[7];app.scope.render();
  assert.equal(app.scope.document.getElementById(app.scope.messageDomId(target)),null);
  app.scope.filter='all';app.scope.query='does not match';
  assert.equal(app.scope.revealMessage(app.key(target)),true);
  assert.equal(app.scope.filter,'talk');assert.equal(app.scope.query,'');
  assert.ok(app.scope.chatPage().rows.some(m=>app.key(m)===app.key(target)));
  assert.ok(app.scrolls.some(s=>s.id===app.scope.messageDomId(target)));
  assert.equal(app.buttons[0].attrs['aria-pressed'],'true');assert.equal(app.buttons[1].attrs['aria-pressed'],'false');
});

test('At the loaded edge, one action fetches one batch and reveals its older messages',async()=>{
  const app=runtime(100);app.scope.loadOlder=async n=>{app.loads.push(n);app.scope.msgs=[...messages(2500,-2500),...app.scope.msgs];app.scope.render()};
  await app.scope.earlierMessages();const page=app.scope.chatPage();
  assert.deepEqual(app.loads,[3]);assert.equal(page.rows.length,1000);assert.equal(page.rows.at(-1).text,'Message -1');
});

test('Latest cancels an outstanding older-page move without duplicating its request',async()=>{
  const app=runtime(100);let finish;
  app.scope.loadOlder=()=>{app.loads.push(3);return new Promise(resolve=>{finish=resolve})};
  const pending=app.scope.earlierMessages();await app.scope.earlierMessages();app.scope.latestMessages();
  app.scope.msgs=[...messages(2500,-2500),...app.scope.msgs];finish();await pending;
  assert.deepEqual(app.loads,[3]);assert.equal(app.scope.chatPage().latest,true);assert.equal(app.scope.chatPage().rows.at(-1).text,'Message 99');
});

test('The top observer can navigate cached pages even when no older block can be fetched',async()=>{
  const app=runtime();app.scope.next=0;app.scope.render();assert.equal(app.observers.length,1);
  const before=app.scope.chatPage().start;app.observers[0].callback([{isIntersecting:true}]);await Promise.resolve();
  assert.equal(app.scope.chatPage().start,before-1000);assert.deepEqual(app.loads,[]);
});

test('Loading failure releases the controls and a later explicit action can retry',async()=>{
  const app=runtime(100);app.scope.loadOlder=async()=>{throw Error('network failed')};
  await app.scope.earlierMessages();assert.equal(app.scope.LOAD_FAILED,true);assert.equal(app.evaluate('CHAT_LOADING'),false);
  app.scope.loadOlder=async()=>{app.loads.push(3)};await app.scope.earlierMessages();assert.deepEqual(app.loads,[3]);assert.equal(app.scope.LOAD_FAILED,false);
});

test('Local quote links are wired to window-aware navigation instead of a missing DOM anchor',()=>{
  const app=runtime(),target=app.scope.msgs[8],link={dataset:{localMessage:app.key(target)}};
  app.scope.document.querySelectorAll=s=>s==='.qt[data-local-message]'?[link]:[];
  vm.runInContext(declaration('bind'),app.scope);app.scope.bind();let prevented=false;
  link.onclick({preventDefault(){prevented=true}});assert.equal(prevented,true);
  assert.ok(app.scope.chatPage().rows.some(m=>app.key(m)===app.key(target)));
});
