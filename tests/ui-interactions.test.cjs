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
  const nodes=new Map(),listeners=new Map(),menus=[],effects=[];
  const state={running:false,canStart:true,floor:965818,ceiling:965919,coveredBlocks:2,totalBlocks:102,complete:false,paused:false,reason:'',phase:'blocks'};
  const document={activeElement:null,getElementById:id=>nodes.get(id),addEventListener:(name,handler)=>listeners.set(name,handler),
    querySelectorAll:selector=>selector==='.msgopts[open]'?menus.filter(menu=>menu.open):[]};
  class Element{
    constructor(id,tag='div'){this.id=id;this.tagName=tag.toUpperCase();this.children=[];this.value='';this.textContent='';this.isConnected=true;this.dataset={};this.hidden=false;this.disabled=false;this.open=false;
      const classes=new Set();this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};nodes.set(id,this)}
    focus(){document.activeElement=this}
    contains(node){return node===this||this.children.includes(node)}
    querySelector(selector){return selector==='summary'?this.children[0]:this.children.find(node=>node.classList.contains('it'))}
    querySelectorAll(selector){return selector==='input,button'?this.children.filter(node=>['INPUT','BUTTON'].includes(node.tagName)):this.children.filter(node=>node.classList.contains('it'))}
    get innerHTML(){return this._html||''}
    set innerHTML(value){
      this._html=value;for(const node of this.children)node.isConnected=false;this.children=[];
      for(const [,tag,id] of value.matchAll(/<(button|div)[^>]*class="it"[^>]*data-message="([^"]+)"/g)){
        const result=new Element(id+'-result',tag);result.classList.add('it');result.dataset.message=id;this.children.push(result);
      }
    }
  }
  for(const id of ['ovs','ovp','ovl','q','sq','sl','searchb','scl','search-history','search-earlier','search-latest','search-summary','search-coverage','search-floor','search-state'])new Element(id,['q','sq'].includes(id)?'input':['searchb','scl','search-history','search-earlier','search-latest'].includes(id)?'button':'div');
  nodes.get('ovs').children=['sq','scl','search-history','search-earlier','search-latest'].map(id=>nodes.get(id));
  const context=vm.createContext({document,ovs:nodes.get('ovs'),ovp:nodes.get('ovp'),$:id=>nodes.get(id),
    REPLY:null,msgs:[],scanned:2,speech:()=>true,messageKey:m=>m.txid+':'+(m.vout??0),hue:()=> '#123456',effects,
    SEARCH_FIRST:'',SEARCH_PAGE_QUERY:'',SEARCH_PAGE_MATCHES:[],SEARCH_PAGE_SIZE:80,
    searchHistoryState:()=>state,
    startHistorySearch:bootstrapOnly=>effects.push('start:'+(bootstrapOnly===true?'bootstrap':'blocks')),
    pauseHistorySearch:reason=>effects.push('pause:'+(reason||'paused')),
    window:{BAC_LANGUAGE_SETTINGS:{close:()=>effects.push('close-language')}},
    revealMessage:key=>effects.push('reveal:'+key),
    closeSheet:()=>effects.push('close-offline'),cancelReply:()=>effects.push('cancel-reply'),
    setTimeout:()=>1,console});
  context.searchMessages=()=>context.msgs;
  for(const name of ['openSearch','closeSearch','searchKey','fillSearch','esc','displayTime','searchTimeHTML','updateSearchControls','searchResultPage','earlierSearchResults','latestSearchResults'])vm.runInContext(declaration(name),context);
  for(const id of ['search-history','search-earlier','search-latest'])vm.runInContext(html.split('\n').find(line=>line.startsWith("$('"+id+"').onclick=")),context);
  const start=html.indexOf("document.addEventListener('keydown',e=>{",html.indexOf('/* ---- search palette ---- */'));
  const end=html.indexOf('function searchKey(',start);vm.runInContext(html.slice(start,end),context);
  function key(fields={}){const e={key:'Escape',prevented:false,preventDefault(){this.prevented=true},...fields};listeners.get('keydown')(e);return e}
  function menu(id){const element=new Element(id,'details'),summary=new Element(id+'-summary','summary');element.children.push(summary);element.open=true;menus.push(element);return element}
  return {context,document,nodes,effects,state,key,menu,click:target=>listeners.get('click')({target})};
}
test('Search opens with input focus, traps boundary Tab navigation, and restores the original focus on close',()=>{
  const a=search(),{nodes}=a;nodes.get('q').focus();a.context.openSearch();
  assert.equal(a.document.activeElement,nodes.get('sq'));assert(nodes.get('ovs').classList.contains('on'));
  const backward=a.key({key:'Tab',shiftKey:true});assert(backward.prevented);assert.equal(a.document.activeElement,nodes.get('search-history'));
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

test('Search results retain sender and block columns and show a numeric date plus the same time format as Everything',()=>{
  const a=search(),timestamp=1231006505,txid='a'.repeat(64);
  a.context.msgs=[{txid,vout:2,text:'Historical message',who:'sender',height:123,time:timestamp}];
  a.context.openSearch();const markup=a.nodes.get('sl').innerHTML;
  const expectedDate=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp*1000));
  assert.match(markup,/<span class="h"><span>sender<\/span><span>#123<\/span><\/span>/);
  assert(markup.includes('<time class="stmp" datetime="2009-01-03T18:15:05.000Z">'));
  assert(markup.includes(a.context.esc(expectedDate)));assert(markup.includes(a.context.esc(a.context.displayTime(timestamp))));
  assert.equal(a.nodes.get('sl').children[0].tagName,'BUTTON');
});
test('Missing or invalid timestamps show a placeholder without exceptions or invalid datetime attributes',()=>{
  const a=search();
  for(const value of [undefined,null,'',NaN,Infinity,-1,1.5,1e50,'<svg onload=alert(1)>',{valueOf(){throw Error('Must not coerce')}}]){
    assert.equal(a.context.searchTimeHTML(value),'<span class="stmp">—</span>');
  }
});
test('Date and time labels are escaped even if a formatter returns markup-like text',()=>{
  const a=search();a.context.searchTimeHTML.formatter={format:()=>'<img src=x>'};a.context.displayTime=()=>'<svg onload=alert(1)>';
  const markup=a.context.searchTimeHTML(1231006505);
  assert.match(markup,/&lt;img src=x&gt;/);assert.match(markup,/&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(markup,/<img|<svg/);assert.match(markup,/datetime="2009-01-03T18:15:05.000Z"/);
});

test('History controls distinguish bootstrap from explicit block scans and show actual coverage and pause states',()=>{
  const a=search();a.context.openSearch();
  assert.deepEqual(a.effects,['close-language','start:bootstrap']);
  assert.equal(a.nodes.get('search-coverage').textContent,'2 of 102 blocks searched');
  assert.equal(a.nodes.get('search-floor').textContent,'Back to block 965,818');
  assert.equal(a.nodes.get('search-state').textContent,'Search incomplete.');
  assert.match(a.nodes.get('sl').innerHTML,/No matching loaded messages\./);
  a.nodes.get('search-history').onclick({type:'click'});assert.equal(a.effects.at(-1),'start:blocks');
  a.state.running=true;a.state.phase='conversation';a.context.fillSearch();
  assert.equal(a.nodes.get('search-history').textContent,'Pause Search');assert.equal(a.nodes.get('search-state').textContent,'Preparing…');
  a.nodes.get('search-history').onclick();assert.equal(a.effects.at(-1),'pause:paused');
  a.state.running=false;a.state.paused=true;a.state.reason='paused';a.context.fillSearch();
  assert.equal(a.nodes.get('search-state').textContent,'Search paused.');
  a.state.reason='error';a.context.fillSearch();assert.equal(a.nodes.get('search-state').textContent,'Could not load earlier blocks. Try again.');
  a.state.reason='memory';a.context.fillSearch();assert.equal(a.nodes.get('search-state').textContent,'Search limit reached.');assert(a.nodes.get('search-history').disabled);
  a.state.reason='budget';a.context.fillSearch();assert(!a.nodes.get('search-history').disabled,'A bounded block batch can be resumed');
  a.state.reason='chain';a.state.canStart=false;a.context.fillSearch();
  assert.equal(a.nodes.get('search-state').textContent,'Preparing…');assert(a.nodes.get('search-history').disabled);
  a.state.canStart=true;
  a.state.reason='';a.state.complete=true;a.state.coveredBlocks=102;a.context.fillSearch();
  assert.equal(a.nodes.get('search-state').textContent,'Search complete for this range.');assert(a.nodes.get('search-history').disabled);
});

test('All 181 loaded results are reachable in bounded pages and a query resets to its newest page',()=>{
  const a=search();a.context.msgs=Array.from({length:181},(_,i)=>({txid:i.toString(16).padStart(64,'0'),height:965818+i,vout:0,text:'Message '+i}));
  a.context.openSearch();const seen=new Set();
  function collect(){for(const result of a.nodes.get('sl').children)seen.add(result.dataset.message);assert(a.nodes.get('sl').children.length<=80)}
  collect();assert.equal(a.nodes.get('search-summary').textContent,'Results 1–80 of 181');assert(a.nodes.get('search-latest').disabled);
  a.nodes.get('search-earlier').onclick();collect();assert.equal(a.nodes.get('search-summary').textContent,'Results 81–160 of 181');
  a.nodes.get('search-earlier').onclick();collect();assert(a.nodes.get('search-earlier').disabled);assert.equal(seen.size,181);
  a.nodes.get('search-latest').onclick();assert.equal(a.nodes.get('search-summary').textContent,'Results 1–80 of 181');
  a.nodes.get('sq').value='Message 180';a.context.fillSearch();assert.equal(a.nodes.get('sl').children.length,1);
  assert.equal(a.nodes.get('search-summary').textContent,'Results 1–1 of 1');assert(a.nodes.get('search-earlier').disabled);
  a.nodes.get('sq').value='No match';a.context.fillSearch();assert.equal(a.nodes.get('search-summary').textContent,'Results 0–0 of 0');
});

test('Progress refresh keeps keyboard focus on the same result and returns to search when its match disappears',()=>{
  const a=search(),first={txid:'a'.repeat(64),vout:0,text:'First match',height:965820};a.context.msgs=[first];
  a.context.openSearch();const old=a.nodes.get('sl').children[0];old.focus();
  a.context.msgs.push({txid:'b'.repeat(64),vout:0,text:'Second match',height:965821});a.context.fillSearch();
  assert.notEqual(a.document.activeElement,old);assert.equal(a.document.activeElement.dataset.message,first.txid+':0');
  assert(a.document.activeElement.isConnected);a.nodes.get('sq').value='Second';a.context.fillSearch();
  assert.equal(a.document.activeElement,a.nodes.get('sq'));
});
