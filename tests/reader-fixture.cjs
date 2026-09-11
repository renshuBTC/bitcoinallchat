const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const code=html.slice(start,end+1);try{new vm.Script(code);return code}catch{}
  }throw Error('Cannot extract '+name);
}
const messages=(count,start=0)=>Array.from({length:count},(_,i)=>({txid:(100000+start+i).toString(16).padStart(64,'0'),vout:i%3,
  height:500000+start+i,time:1700000000+i,text:'Message '+(start+i),kind:'talk'}));
function runtime(count=4500,filter='all'){
  const nodes=new Map(),loads=[],scrolls=[],timers=new Map();let rows=[],refreshes=0,scope,timer=0;
  const classes=()=>{const set=new Set();return {add:x=>set.add(x),remove:x=>set.delete(x),contains:x=>set.has(x),toggle(x,on){on?set.add(x):set.delete(x)}}};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',innerHTML:'',textContent:'',style:{},dataset:{},hidden:true,classList:classes(),
    setAttribute(k,v){this[k]=v},focus(){},querySelectorAll:()=>[],getBoundingClientRect:()=>({top:0,bottom:0})});return nodes.get(id)};
  const document={documentElement:{scrollHeight:1000},querySelectorAll:selector=>selector==='#thread .pay[id], #thread .row[id]'?rows:selector==='.vb'?buttons:[],
    querySelector:selector=>selector==='.ov.on'?[...nodes.values()].find(n=>n.id.startsWith('ov')&&n.classList.contains('on'))||null:null,
    getElementById:id=>id.startsWith('p-')||id.startsWith('m-')?rows.find(row=>row.id===id)||null:node(id)};
  const buttons=[node('talk-view'),node('all-view')];buttons[0].dataset.v='talk';buttons[1].dataset.v='all';
  const window={scrollY:0,innerHeight:600,scrollTo(x,y){const top=typeof x==='object'?x.top:y;window.scrollY=Math.max(0,Math.min(top,document.documentElement.scrollHeight-600));scrolls.push(window.scrollY)}};
  let output='';Object.defineProperty(node('thread'),'innerHTML',{get:()=>output,set(value){
    output=value;let top=180;rows=[];
    for(const match of value.matchAll(/<(?:div|article) class="(?:pay|row)[^"]*" id="([^"]+)" data-message="([^"]+)"/g)){
      const height=22+parseInt(match[2].slice(60,64),16)%4*3,absolute=top;top+=height;
      const row={id:match[1],dataset:{message:match[2]},classList:classes(),getBoundingClientRect:()=>({top:absolute-window.scrollY,bottom:absolute+height-window.scrollY,height}),
        scrollIntoView(){window.scrollTo(0,absolute-250)}};rows.push(row);
    }
    node('toploader').getBoundingClientRect=()=>({top:100-window.scrollY,bottom:170-window.scrollY});
    node('reader-bottom').getBoundingClientRect=()=>({top:top-window.scrollY,bottom:top+28-window.scrollY});
    document.documentElement.scrollHeight=top+400;window.scrollY=Math.min(window.scrollY,Math.max(0,document.documentElement.scrollHeight-600));
  }});
  scope=vm.createContext({msgs:messages(count),filter,query:'',TIP:966000,busy:false,next:100,scanned:10,
    LOAD_FAILED:false,BLOCK_RETRY:new Set(),LANES:3,document,window,innerHeight:600,$:node,
    counts(){},bind(){},reindex(){},speech:m=>m.kind==='talk'||m.kind==='pgp',shown:()=>count,
    refreshHistorySearch(){refreshes++},setTimeout(fn){const id=++timer;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),loadBatch:async n=>{loads.push(n);return {loaded:n,failed:0}}});
  for(const name of ['cleanTxid','validVout','messageKey','messageDomId','esc','messageExcerpt','displayTime'])vm.runInContext(declaration(name),scope);
  scope.searchMessages=()=>scope.msgs.filter(scope.speech);
  scope.turn=m=>`<article class="row" id="${scope.messageDomId(m)}" data-message="${scope.messageKey(m)}">${scope.esc(m.text)}</article>`;
  const start=html.indexOf('const ALL_PAGE_SIZE='),end=html.indexOf('function render(){',start);
  vm.runInContext(html.slice(start,end)+'\n'+['render','readerStatus','atBottom','toBottom','syncReaderScroll','updateJump','readerInputAllowed'].map(declaration).join('\n'),scope);
  scope.render();const evaluate=code=>vm.runInContext(code,scope);
  function position(index=0,offset=40){const row=rows[index];assert.ok(row,'visible row');window.scrollTo(0,window.scrollY+row.getBoundingClientRect().top-offset);scope.syncReaderScroll();return {id:row.id,top:row.getBoundingClientRect().top}}
  return {scope,node,loads,scrolls,buttons,document,window,timers,evaluate,position,key:scope.messageKey,rows:()=>rows,refreshes:()=>refreshes,html:()=>output,anchorTop:anchor=>document.getElementById(anchor.id)?.getBoundingClientRect().top};
}
module.exports={html,declaration,messages,runtime};
