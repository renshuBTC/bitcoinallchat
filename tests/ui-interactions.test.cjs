// Actual composer/search/menu functions with no wallet, browser, or network side effects.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async )?function '+name+'\\('));assert(start>=0,name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const text=html.slice(start,end+1);try{new vm.Script(text);return text}catch{}
  }
  throw Error('Function not found: '+name);
}
function search(){
  const nodes=new Map(),listeners=new Map(),globalListeners=new Map(),menus=[],effects=[],timers=new Map();let timerId=0;
  const state={running:false,canStart:true,floor:965818,ceiling:965919,coveredBlocks:2,totalBlocks:102,complete:false,paused:false,reason:'',phase:'blocks'};
  const document={activeElement:null,getElementById:id=>nodes.get(id),addEventListener:(name,handler)=>listeners.set(name,handler),
    querySelectorAll:selector=>selector==='.msgopts[open]'?menus.filter(menu=>menu.open):[]};
  class Element{
    constructor(id,tag='div'){Object.assign(this,{id,tagName:tag.toUpperCase(),children:[],value:'',textContent:'',isConnected:true,dataset:{},hidden:false,disabled:false,open:false,clientHeight:300,_scrollTop:0,handlers:new Map()});
      const classes=new Set();this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};nodes.set(id,this)}
    focus(){document.activeElement=this}
    contains(node){return node===this||this.children.some(child=>child.contains(node))}
    addEventListener(name,fn){this.handlers.set(name,fn)}
    emit(name,event={}){this.handlers.get(name)?.({target:this,...event})}
    querySelector(selector){return selector==='summary'?this.children[0]:this.children.find(node=>node.classList.contains('it'))}
    querySelectorAll(selector){const out=[];const walk=node=>{for(const child of node.children){if(selector==='.it'?child.classList.contains('it'):['INPUT','BUTTON'].includes(child.tagName)||child.id==='sl')out.push(child);walk(child)}};walk(this);return out}
    get scrollHeight(){return Math.max(70,this.children.length*50)}
    get scrollTop(){return Math.min(this._scrollTop,Math.max(0,this.scrollHeight-this.clientHeight))}
    set scrollTop(value){this._scrollTop=Math.max(0,Math.min(value,Math.max(0,this.scrollHeight-this.clientHeight)))}
    getBoundingClientRect(){const top=this.parentList?100+this.parentList.children.indexOf(this)*50-this.parentList.scrollTop:100;return {top,bottom:top+(this.parentList?50:this.clientHeight)}}
    get innerHTML(){return this._html||''}
    set innerHTML(value){this._html=value;for(const node of this.children)node.isConnected=false;this.children=[];
      for(const [,tag,id] of value.matchAll(/<(button|div)[^>]*class="it"[^>]*data-message="([^"]+)"/g)){
        const result=new Element(id+'-result',tag);result.classList.add('it');result.dataset.message=id;result.parentList=this;this.children.push(result);
      }
    }
  }
  for(const id of ['ovs','ovp','q','sq','sl','searchb','scl','search-notice'])new Element(id,['q','sq'].includes(id)?'input':['searchb','scl'].includes(id)?'button':'div');
  nodes.get('ovs').children=['sq','scl','sl'].map(id=>nodes.get(id));
  const context=vm.createContext({document,ovs:nodes.get('ovs'),ovp:nodes.get('ovp'),$:id=>nodes.get(id),
    REPLY:null,msgs:[],scanned:2,speech:()=>true,messageKey:m=>m.txid+':'+(m.vout??0),hue:()=> '#123456',effects,
    SEARCH_FIRST:'',SEARCH_PAGE_QUERY:'',SEARCH_PAGE_MATCHES:[],SEARCH_PAGE_SIZE:80,SEARCH_COUNT:80,
    SEARCH_QUERY_TIMER:null,SEARCH_QUERY_RUN:0,SEARCH_LAST_QUERY:'',SEARCH_PENDING:null,SEARCH_SCROLL_INTENT:0,SEARCH_SCROLL_Y:0,SEARCH_TOUCH_Y:null,SEARCH_RENDERED_PAGE:null,
    searchHistoryState:()=>state,
    startHistorySearch:bootstrapOnly=>{effects.push('start:'+(bootstrapOnly===true?'bootstrap':'blocks'));context.fillSearch();return Promise.resolve()},
    pauseHistorySearch:reason=>{effects.push('pause:'+(reason||'paused'));state.running=false;if(nodes.get('ovs').classList.contains('on'))context.fillSearch()},
    window:{BAC_LANGUAGE_SETTINGS:{close:()=>effects.push('close-language')}},addEventListener:(name,fn)=>globalListeners.set(name,fn),
    revealMessage:key=>effects.push('reveal:'+key),closeSheet:()=>effects.push('close-offline'),cancelReply:()=>effects.push('cancel-reply'),
    setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),console});
  context.searchMessages=()=>context.msgs;
  for(const name of ['openSearch','closeSearch','cancelSearchWork','queueSearchQuery','tryPendingSearch','captureSearchAnchor','noteSearchScroll','handleSearchScroll','searchKey','fillSearch','esc','displayTime','updateSearchNotice','searchResultPage','earlierSearchResults','newerSearchResults','latestSearchResults'])vm.runInContext(declaration(name),context);
  const start=html.indexOf("$('sq').oninput=",html.indexOf('/* ---- search palette ---- */'));
  const end=html.indexOf('function searchKey(',start);vm.runInContext(html.slice(start,end),context);
  function key(fields={}){const e={key:'Escape',prevented:false,preventDefault(){this.prevented=true},...fields};listeners.get('keydown')(e);return e}
  function menu(id){const element=new Element(id,'details'),summary=new Element(id+'-summary','summary');element.children.push(summary);element.open=true;menus.push(element);return element}
  function runTimers(){for(const [id,fn] of [...timers]){if(timers.delete(id))fn()}}
  return {context,document,nodes,effects,state,key,menu,timers,runTimers,pagehide:()=>globalListeners.get('pagehide')(),click:target=>listeners.get('click')({target})};
}

test('Search opens with input focus, traps boundary Tab navigation, and restores the original focus on close',()=>{
  const a=search(),{nodes}=a;nodes.get('q').focus();a.context.openSearch();
  assert.equal(a.document.activeElement,nodes.get('sq'));assert(nodes.get('ovs').classList.contains('on'));
  const backward=a.key({key:'Tab',shiftKey:true});assert(backward.prevented);assert.equal(a.document.activeElement,nodes.get('sl'));
  const forward=a.key({key:'Tab'});assert(forward.prevented);assert.equal(a.document.activeElement,nodes.get('sq'));
  a.key();assert.equal(a.document.activeElement,nodes.get('q'));assert(!nodes.get('ovs').classList.contains('on'));
  assert(!a.effects.includes('close-offline'),'Closing search must not invalidate unrelated offline signing');
});
test('Search shortcuts do not stack over signing, close the language menu and respect both composition forms',()=>{
  const a=search();
  a.nodes.get('ovp').classList.add('on');a.key({key:'k',ctrlKey:true});assert(!a.nodes.get('ovs').classList.contains('on'));a.nodes.get('ovp').classList.remove('on');
  for(const state of [{isComposing:true},{keyCode:229}]){assert(!a.key({key:'k',metaKey:true,...state}).prevented);assert(!a.nodes.get('ovs').classList.contains('on'))}
  a.key({key:'k',ctrlKey:true});assert(a.nodes.get('ovs').classList.contains('on'));assert(a.effects.includes('close-language'));
});
test('Escape closes a message menu before cancelling a reply and outside clicks dismiss open menus',()=>{
  const a=search(),first=a.menu('first');a.context.REPLY={txid:'a'};
  a.key();assert.equal(first.open,false);assert.equal(a.document.activeElement,first.children[0]);assert.equal(a.effects.length,0);
  a.key();assert.deepEqual(a.effects,['cancel-reply']);
  const second=a.menu('second'),third=a.menu('third');a.click(second.children[0]);assert(second.open);assert.equal(third.open,false);
  a.click(a.nodes.get('q'));assert.equal(second.open,false);
});
test('Search results are escaped native buttons that reveal the exact output even when its row is not in the DOM',()=>{
  const a=search(),txid='a'.repeat(64);
  a.context.msgs=[{txid,vout:7,text:'<img src=x onerror=alert(1)>',who:'sender',height:12}];
  a.nodes.get('q').focus();a.context.openSearch();const markup=a.nodes.get('sl').innerHTML,result=a.nodes.get('sl').children[0];
  assert.match(markup,/<button type="button" class="it"/);assert.match(markup,/&lt;img/);assert.doesNotMatch(markup,/<img src=x/);
  assert.equal(result.tagName,'BUTTON');result.onclick();assert.deepEqual(a.effects,['close-language','start:bootstrap','pause:closed','reveal:'+txid+':7']);assert.equal(a.document.activeElement,a.nodes.get('q'));
});
test('Jump to latest opens the latest window rather than stopping at the end of older history',()=>{
  const handler=html.split('\n').find(line=>line.startsWith("$('jump').onclick="));assert(handler);
  for(const [filter,expected] of [['talk','messages:true'],['all','payloads'],['liquid','scroll:true']]){
    const button={},calls=[];
    vm.runInNewContext(handler,{$:()=>button,filter,latestMessages:smooth=>calls.push('messages:'+smooth),
      latestPayloads:()=>calls.push('payloads'),toBottom:smooth=>calls.push('scroll:'+smooth)});
    button.onclick();assert.deepEqual(calls,[expected]);
  }
});

test('Search rows show only the transaction id and the message text',()=>{
  const a=search(),txid='a'.repeat(64);
  a.context.msgs=[{txid,vout:2,text:'Historical message',who:'sender',height:123,time:1231006505}];
  a.context.openSearch();const markup=a.nodes.get('sl').innerHTML;
  assert.match(markup,/<span class="txid">aaaaaaaa<\/span><span class="p" dir="auto">Historical message<\/span><\/button>/);
  assert.doesNotMatch(markup,/sender|class="d"|background:/);
  assert.doesNotMatch(markup,/class="h"|class="stmp"|<time/,'Block height and time no longer take width from the message');
  assert.equal(a.nodes.get('sl').children[0].tagName,'BUTTON');
});

function loadedMessages(count){return Array.from({length:count},(_,i)=>({txid:i.toString(16).padStart(64,'0'),vout:0,height:965818+i,text:'Message '+i}))}
const started=a=>a.effects.filter(value=>value.startsWith('start:'));
function edge(a,direction){const list=a.nodes.get('sl');list.scrollTop=direction>0?list.scrollHeight:0;list.emit('wheel',{deltaY:direction})}

test('Changing a nonempty query debounces one bounded scan, cancels bootstrap, and never chains scans after progress',()=>{
  const a=search();a.context.openSearch();a.state.running=true;a.state.phase='conversation';
  const input=a.nodes.get('sq');input.value='first';input.oninput({isComposing:false});
  assert.equal(a.state.running,false);assert.equal(a.timers.size,1);
  input.value='second';input.oninput({isComposing:false});assert.equal(a.timers.size,1);a.runTimers();
  assert.deepEqual(started(a),['start:bootstrap','start:blocks']);
  a.state.reason='budget';for(let i=0;i<5;i++)a.context.fillSearch();a.runTimers();
  assert.deepEqual(started(a),['start:bootstrap','start:blocks']);
  assert.equal(a.nodes.get('search-notice').hidden,true,'A paused batch does not add a busy summary panel');
  input.oninput({isComposing:false});assert.equal(a.timers.size,0,'Repeated normalized query has no new scan');
  input.value='third';input.oninput({isComposing:false});input.value='';input.oninput({isComposing:false});a.runTimers();
  assert.equal(started(a).length,2,'Clearing a query cancels its pending scan');
});

test('IME input waits until composition finishes and creates only one query request',()=>{
  const a=search();a.context.openSearch();const input=a.nodes.get('sq');input.value='你好';
  input.oninput({isComposing:true});assert.equal(a.timers.size,0);
  input.emit('compositionend');input.oninput({isComposing:false});assert.equal(a.timers.size,1);
  a.runTimers();assert.deepEqual(started(a),['start:bootstrap','start:blocks']);
});

test('Open and query intents wait for the initial tip and consume once even when start immediately renders progress',()=>{
  for(const withQuery of [false,true]){
    const a=search();a.state.canStart=false;a.context.openSearch();assert.equal(started(a).length,0);
    if(withQuery){a.nodes.get('sq').value='history';a.context.queueSearchQuery();a.runTimers()}
    assert.equal(started(a).length,0);assert(a.context.SEARCH_PENDING);
    a.state.canStart=true;a.context.fillSearch();a.context.fillSearch();
    assert.deepEqual(started(a),[withQuery?'start:blocks':'start:bootstrap']);assert.equal(a.context.SEARCH_PENDING,null);
  }
});

test('Closing or leaving the page cancels query timers, pending tip intents, and running history without discarding messages',()=>{
  for(const leave of ['close','pagehide']){
    const a=search();a.context.msgs=loadedMessages(3);a.context.openSearch();
    a.nodes.get('sq').value='Message';a.context.queueSearchQuery();a.state.running=true;
    if(leave==='close')a.context.closeSearch();else a.pagehide();
    assert.equal(a.timers.size,0);assert.equal(a.state.running,false);assert.equal(a.context.SEARCH_PENDING,null);
    const count=started(a).length;a.runTimers();a.context.fillSearch();assert.equal(started(a).length,count);assert.equal(a.context.msgs.length,3);
  }
});

test('Actual scroll intent reaches every result in overlapping 80-row windows and preserves the visible row position',()=>{
  const a=search();a.context.msgs=loadedMessages(181);a.context.openSearch();const list=a.nodes.get('sl'),seen=new Set();
  const collect=()=>{for(const row of list.children)seen.add(row.dataset.message);assert(list.children.length<=80)};
  collect();assert.equal(a.context.SEARCH_RENDERED_PAGE.start,101);assert.equal(a.context.SEARCH_RENDERED_PAGE.rows.length,80);
  while(a.context.SEARCH_RENDERED_PAGE.hasEarlier){
    list.scrollTop=list.scrollHeight;const anchor=a.context.captureSearchAnchor();list.emit('wheel',{deltaY:1});collect();
    const restored=list.children.find(row=>row.dataset.message===anchor.key);
    assert(restored);assert.equal(restored.getBoundingClientRect().top-list.getBoundingClientRect().top,anchor.offset);
  }
  assert.equal(seen.size,181);assert.deepEqual(started(a),['start:bootstrap']);
  while(a.context.SEARCH_RENDERED_PAGE.hasLatest)edge(a,-1);
  assert.equal(a.context.SEARCH_RENDERED_PAGE.start,101);
  a.nodes.get('sq').value='Message 180';a.context.queueSearchQuery();assert.equal(list.scrollTop,0);assert.equal(list.children.length,1);
});

test('Programmatic scrolling, progress renders, and gestures during an active request never create a scan loop',()=>{
  const a=search();a.context.msgs=loadedMessages(20);a.context.openSearch();const list=a.nodes.get('sl');
  list.scrollTop=list.scrollHeight;list.emit('scroll');assert.equal(started(a).length,1);
  edge(a,1);assert.deepEqual(started(a),['start:bootstrap','start:blocks']);
  for(let i=0;i<5;i++){list.emit('scroll');a.context.fillSearch()}
  assert.equal(started(a).length,2);
  a.state.running=true;edge(a,1);a.state.running=false;a.state.reason='budget';a.context.fillSearch();list.emit('scroll');
  assert.equal(started(a).length,2,'An old gesture cannot schedule the next batch');
  edge(a,1);assert.equal(started(a).length,3,'A fresh gesture can resume one bounded batch');
  a.state.reason='memory';a.context.fillSearch();edge(a,1);assert.equal(started(a).length,3);
  a.state.reason='';a.state.complete=true;a.context.fillSearch();edge(a,1);assert.equal(started(a).length,3);
});

test('Cached result windows stay scrollable during a background history scan without starting another request',()=>{
  const a=search();a.context.msgs=loadedMessages(181);a.context.openSearch();a.state.running=true;
  edge(a,1);assert.equal(a.context.SEARCH_RENDERED_PAGE.start,61);
  edge(a,-1);assert.equal(a.context.SEARCH_RENDERED_PAGE.start,101);
  while(a.context.SEARCH_RENDERED_PAGE.hasEarlier)edge(a,1);
  edge(a,1);assert.deepEqual(started(a),['start:bootstrap']);
  a.state.running=false;a.context.fillSearch();a.nodes.get('sl').emit('scroll');
  assert.deepEqual(started(a),['start:bootstrap'],'No deferred request is created when the active scan ends');
});

test('Keyboard and touch edge navigation work without action buttons and preserve native message activation',()=>{
  const a=search();a.context.msgs=loadedMessages(181);a.context.openSearch();const list=a.nodes.get('sl');
  list.scrollTop=list.scrollHeight;list.emit('keydown',{key:'PageDown'});assert.equal(a.context.SEARCH_RENDERED_PAGE.start,61);
  list.scrollTop=0;list.emit('keydown',{key:'PageUp'});assert.equal(a.context.SEARCH_RENDERED_PAGE.start,101);
  list.scrollTop=list.scrollHeight;list.emit('touchstart',{touches:[{clientY:200}]});list.emit('touchmove',{touches:[{clientY:100}]});
  assert.equal(a.context.SEARCH_RENDERED_PAGE.start,61);
  const before=a.context.SEARCH_RENDERED_PAGE.start;list.emit('keydown',{key:' ',target:list.children[0]});assert.equal(a.context.SEARCH_RENDERED_PAGE.start,before);
  assert.doesNotMatch(html,/(?:id="search-(?:history|earlier|latest)"|class="search-actions")/);
});

test('Progress refresh preserves keyboard focus and preview formatting reads only its bounded prefix',()=>{
  const a=search(),first=loadedMessages(1)[0];a.context.msgs=[first];a.context.openSearch();const old=a.nodes.get('sl').children[0];old.focus();
  a.context.msgs.push({...loadedMessages(2)[1],text:'Second'});a.context.fillSearch();
  assert.notEqual(a.document.activeElement,old);assert.equal(a.document.activeElement.dataset.message,first.txid+':0');
  a.context.msgs=[{...first,text:' '.repeat(1000000)+'Hidden tail'}];a.context.fillSearch();
  assert.doesNotMatch(a.nodes.get('sl').innerHTML,/Hidden tail/);assert.match(a.nodes.get('sl').innerHTML,/class="p" dir="auto"> <\/span>/);
});

test('Search has no summary panel and only shows needed loading, scoped empty or failure notices',()=>{
  const a=search();a.context.msgs=loadedMessages(2);a.context.openSearch();
  assert.doesNotMatch(html,/search-(?:summary|coverage|floor|state|tools)/);
  assert.equal(a.nodes.get('search-notice').hidden,true);
  a.state.running=true;a.context.fillSearch();assert.equal(a.nodes.get('search-notice').textContent,'Loading…');assert.equal(a.nodes.get('sl').children.length,2);
  a.context.msgs=[];a.context.fillSearch();assert.equal(a.nodes.get('sl').innerHTML,'','Loading must not falsely report no matches');
  a.state.running=false;a.context.fillSearch();assert.equal(a.nodes.get('search-notice').hidden,true);assert.match(a.nodes.get('sl').innerHTML,/No matching loaded messages\./);
  a.state.reason='error';a.context.fillSearch();assert.equal(a.nodes.get('search-notice').textContent,'Could not load earlier blocks. Scroll down to retry.');
  assert.equal(a.nodes.get('sl').innerHTML,'');
  a.state.reason='memory';a.context.fillSearch();assert.equal(a.nodes.get('search-notice').textContent,'Search limit reached.');
  a.state.reason='';a.state.complete=true;a.context.msgs=loadedMessages(2);a.context.fillSearch();assert.equal(a.nodes.get('search-notice').hidden,true);
});
