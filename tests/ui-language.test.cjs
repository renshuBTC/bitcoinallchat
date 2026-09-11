// Minimal DOM doubles exercise the real module without model downloads or a browser.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','ui-language.js'),'utf8');

function app(translator=async text=>'Français: '+text){
  const observers=new Set(),timers=new Map(),calls=[];let timerId=0;
  function simple(element,selector){
    if(selector.startsWith('#'))return element.id===selector.slice(1);
    if(selector.startsWith('.'))return element.className.split(/\s+/).includes(selector.slice(1));
    const attr=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if(attr)return attr[2]===undefined?element.hasAttribute(attr[1]):element.getAttribute(attr[1])===attr[2];
    return element.tagName.toLowerCase()===selector.toLowerCase();
  }
  function matches(element,selector){
    return selector.split(',').some(group=>{
      const parts=group.trim().split(/\s+/);let current=element;
      if(!simple(current,parts.pop()))return false;
      while(parts.length){
        const part=parts.pop();current=current.parentElement;
        while(current&&!simple(current,part))current=current.parentElement;
        if(!current)return false;
      }
      return true;
    });
  }
  function notify(record){
    for(const observer of observers){
      if(!observer.root.contains(record.target))continue;
      if(record.type==='attributes'&&!observer.options.attributeFilter.includes(record.attributeName))continue;
      observer.records.push(record);
    }
  }
  class Node {
    constructor(type){this.nodeType=type;this.parentNode=null;this.childNodes=[];}
    get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null}
    get isConnected(){let n=this;while(n.parentNode)n=n.parentNode;return n===document.body}
    contains(node){while(node){if(node===this)return true;node=node.parentNode}return false}
  }
  class Text extends Node {
    constructor(value){super(3);this.value=String(value);}
    get nodeValue(){return this.value}
    set nodeValue(value){value=String(value);if(value===this.value)return;this.value=value;notify({type:'characterData',target:this})}
    get textContent(){return this.value}
    set textContent(value){this.nodeValue=value}
  }
  class Element extends Node {
    constructor(tag){super(1);this.tagName=tag.toUpperCase();this.attrs=new Map();this.style={};this.value='';this.className='';this.id='';}
    get children(){return this.childNodes.filter(n=>n.nodeType===1)}
    get textContent(){return this.childNodes.map(n=>n.textContent).join('')}
    set textContent(value){
      for(const node of this.childNodes)node.parentNode=null;
      this.childNodes=[];
      if(value!==''){const node=new Text(value);node.parentNode=this;this.childNodes.push(node)}
      notify({type:'childList',target:this,addedNodes:this.childNodes.slice()});
    }
    set innerHTML(_value){throw Error('UI translation must never assign HTML')}
    appendChild(node){node.parentNode=this;this.childNodes.push(node);notify({type:'childList',target:this,addedNodes:[node]});return node}
    setAttribute(name,value){
      value=String(value);if(this.attrs.get(name)===value)return;
      this.attrs.set(name,value);notify({type:'attributes',target:this,attributeName:name});
    }
    getAttribute(name){return this.attrs.has(name)?this.attrs.get(name):null}
    hasAttribute(name){return this.attrs.has(name)}
    removeAttribute(name){if(this.attrs.delete(name))notify({type:'attributes',target:this,attributeName:name})}
    matches(selector){return matches(this,selector)}
    closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentElement}return null}
    querySelectorAll(selector){
      const out=[];const visit=node=>{for(const child of node.children){if(child.matches(selector))out.push(child);visit(child)}};visit(this);return out;
    }
    querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  }
  const document={body:new Element('body'),documentElement:new Element('html')};
  document.querySelectorAll=selector=>document.body.querySelectorAll(selector);
  document.getElementById=id=>document.body.querySelector('#'+id);
  class Observer {
    constructor(callback){this.callback=callback;this.records=[];}
    observe(root,options){this.root=root;this.options=options;observers.add(this)}
    disconnect(){observers.delete(this);this.records=[];}
  }
  const bridge={translateUI:async text=>{calls.push(text);return translator(text)}};
  const window={BAC_TRANSLATE:bridge};
  const context=vm.createContext({window,document,MutationObserver:Observer,
    setTimeout:callback=>{const id=++timerId;timers.set(id,callback);return id},
    clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source,context);
  function add(parent,tag,{text,id,className,attrs={},value}={}){
    const node=new Element(tag);node.id=id||'';node.className=className||'';
    for(const [name,content] of Object.entries(attrs))node.setAttribute(name,content);
    if(text!==undefined)node.textContent=text;if(value!==undefined)node.value=value;
    parent.appendChild(node);return node;
  }
  async function flush(){
    for(let i=0;i<500;i++){
      for(const observer of observers){if(observer.records.length)observer.callback(observer.records.splice(0));}
      if(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}
      await Promise.resolve();
    }
  }
  async function language(code){const done=window.BAC_UI_LANGUAGE.setLanguage(code);await flush();await done;}
  return {window,document,api:window.BAC_UI_LANGUAGE,bridge,add,Text,calls,flush,language,observers};
}

test('UI copy and accessible attributes translate while drafts, links and wallet order stay unchanged',async()=>{
  const a=app(),info=a.add(a.document.body,'aside',{className:'info'});
  const label=a.add(info,'p',{text:'Messages on Bitcoin.'});
  const brand=a.add(info,'div',{text:'Bitcoin AllChat'});
  const outside=a.add(a.document.body,'div',{id:'thread',text:'A public message remains original'});
  const dock=a.add(a.document.body,'div',{className:'dock'});
  const q=a.add(dock,'textarea',{id:'q',value:'My unsent 中文 draft',attrs:{placeholder:'Write a message onto Bitcoin…','aria-label':'Your message'}});
  const wallets=a.add(dock,'span',{className:'wallets',attrs:{dir:'ltr'}});
  wallets.appendChild(new a.Text('Sign With '));
  const wallet=a.add(wallets,'a',{text:'Xverse',attrs:{href:'https://www.xverse.app/download',title:'Sign with Xverse'}});
  const other=a.add(wallets,'a',{text:'UniSat'});
  const ovp=a.add(a.document.body,'div',{id:'ovp'});
  const sig=a.add(ovp,'textarea',{id:'sig',value:'70736274ffPRIVATE_INPUT',attrs:{placeholder:'Paste a signed transaction'}});
  await a.language('fr');
  assert.equal(label.textContent,'Français: Messages on Bitcoin.');
  assert.equal(label.getAttribute('dir'),'auto');
  assert.equal(q.getAttribute('placeholder'),'Français: Write a message onto Bitcoin…');
  assert.equal(q.getAttribute('aria-label'),'Français: Your message');
  assert.equal(q.value,'My unsent 中文 draft');assert.equal(sig.value,'70736274ffPRIVATE_INPUT');
  assert.equal(wallet.getAttribute('href'),'https://www.xverse.app/download');
  assert.equal(wallet.textContent,'Xverse');assert.equal(other.textContent,'UniSat');
  assert.equal(brand.textContent,'Bitcoin AllChat');
  assert.equal(wallets.getAttribute('dir'),'ltr');
  assert.deepEqual(wallets.children,[wallet,other]);
  assert.equal(outside.textContent,'A public message remains original');
  assert.equal(a.calls.some(text=>text.includes('PRIVATE_INPUT')||text.includes('My unsent')),false);
});

test('Protected brands, full identifiers, amounts, units and displayed URLs survive translation exactly',async()=>{
  const a=app(),root=a.add(a.document.body,'div',{className:'dock'});
  const txid='abcdef12'.repeat(8),address='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const original='Waiting for Xverse. 1,250 sats at 2 sat/vB. '+address+' '+address.toUpperCase()+' https://mempool.space/tx/'+txid;
  const hint=a.add(root,'div',{id:'hint',text:original});
  await a.language('fr');
  assert.equal(hint.textContent,'Français: '+original);
  assert.ok(a.calls.every(text=>!text.includes('Xverse')&&!text.includes(txid)&&!text.includes(address)&&!text.includes(address.toUpperCase())&&!text.includes('1,250')));
  assert.equal(hint.textContent.includes('__BAC_UI_KEEP_'),false);
});

test('Only allowlisted thread controls translate; metadata and original public content remain intact',async()=>{
  const a=app(),thread=a.add(a.document.body,'div',{className:'thread'});
  a.document.documentElement.setAttribute('dir','ltr');
  const body=a.add(thread,'div',{className:'txt',text:'Keep this public message unchanged'});
  const quote=a.add(thread,'a',{className:'qt',text:'Keep this quoted message unchanged'});
  const payload=a.add(thread,'div',{className:'pay'});
  const payloadText=a.add(payload,'span',{className:'more',text:'Keep this payload unchanged'});
  const metadata=a.add(thread,'div',{className:'mst'});
  const time=a.add(metadata,'span',{text:'2 minutes ago'});
  const address=a.add(metadata,'a',{text:'bc1qoriginaladdress'});
  const more=a.add(metadata,'button',{className:'more',text:'More'});
  const mine=a.add(metadata,'span',{className:'mine-label',text:'You'});
  const options=a.add(metadata,'details',{className:'msgopts'});
  const summary=a.add(options,'summary',{text:'⋯',attrs:{title:'Message options'}});
  const reply=a.add(options,'button',{className:'reply-action',text:'Reply'});
  const nav=a.add(thread,'nav',{className:'payload-nav',attrs:{'aria-label':'Payload pages'}});
  const next=a.add(nav,'button',{text:'Next'});
  const loader=a.add(thread,'div',{className:'toploader',text:'Loading earlier messages…'});
  await a.language('ar');
  assert.equal(a.document.documentElement.getAttribute('lang'),'ar');
  assert.equal(a.document.documentElement.getAttribute('dir'),'ltr');
  for(const [node,value] of [[body,'Keep this public message unchanged'],[quote,'Keep this quoted message unchanged'],[payloadText,'Keep this payload unchanged'],[time,'2 minutes ago'],[address,'bc1qoriginaladdress']])assert.equal(node.textContent,value);
  for(const [node,value] of [[more,'More'],[mine,'You'],[reply,'Reply'],[next,'Next'],[loader,'Loading earlier messages…']])assert.equal(node.textContent,'Français: '+value);
  assert.equal(summary.getAttribute('title'),'Français: Message options');
  assert.equal(nav.getAttribute('aria-label'),'Français: Payload pages');
  assert.equal(a.calls.some(text=>text.includes('Keep this')||text.includes('minutes ago')||text.includes('originaladdress')),false);
  await a.language('off');
  assert.equal(a.document.documentElement.getAttribute('lang'),'en');
  assert.equal(more.textContent,'More');
});

test('User quotes, search results, attachment names, pool names and native language choices stay original',async()=>{
  const a=app(),dock=a.add(a.document.body,'div',{className:'dock'});
  const reply=a.add(dock,'span',{id:'reply-excerpt',text:'Hello from the original user'});
  const replyName=a.add(dock,'span',{id:'reply-name',text:'Replying to RenshuBTC'});
  const att=a.add(dock,'div',{className:'att'});
  const filename=a.add(att,'span',{className:'nm',text:'My photo final.png'});
  const remove=a.add(att,'button',{text:'×',attrs:{title:'Remove attachment'}});
  const ovs=a.add(a.document.body,'div',{id:'ovs'});
  const result=a.add(ovs,'div',{className:'it',text:'A matching public message'});
  const ovl=a.add(a.document.body,'div',{id:'ovl'});
  const select=a.add(ovl,'select',{attrs:{'aria-label':'Choose language'}});
  const option=a.add(select,'option',{text:'日本語',attrs:{value:'ja'}});
  const pool=a.add(a.add(a.document.body,'aside',{className:'info'}),'div',{id:'m-pool',text:'SpiderPool'});
  await a.language('fr');
  assert.equal(reply.textContent,'Hello from the original user');
  assert.equal(replyName.textContent,'Français: Replying to RenshuBTC');
  assert.equal(filename.textContent,'My photo final.png');
  assert.equal(result.textContent,'A matching public message');
  assert.equal(option.textContent,'日本語');assert.equal(option.getAttribute('value'),'ja');
  assert.equal(pool.textContent,'SpiderPool');
  assert.equal(remove.getAttribute('title'),'Français: Remove attachment');
  assert.equal(select.getAttribute('aria-label'),'Français: Choose language');
});

test('New English status text and placeholders retranslate without observing their own writes forever',async()=>{
  const a=app(),dock=a.add(a.document.body,'div',{className:'dock'});
  const hint=a.add(dock,'div',{id:'hint',text:'Preparing…'});
  const input=a.add(dock,'textarea',{id:'q',attrs:{placeholder:'Write a message'}});
  await a.language('fr');
  hint.textContent='Reading your coins…';
  input.setAttribute('placeholder','The file above is what gets published');
  await a.flush();
  assert.equal(hint.textContent,'Français: Reading your coins…');
  assert.equal(input.getAttribute('placeholder'),'Français: The file above is what gets published');
  const count=a.calls.length;await a.flush();assert.equal(a.calls.length,count);
  await a.language('en');
  assert.equal(hint.textContent,'Reading your coins…');
  assert.equal(input.getAttribute('placeholder'),'The file above is what gets published');
  assert.equal(hint.getAttribute('dir'),null);assert.equal(hint.getAttribute('lang'),null);
});

test('Unsupported, unavailable and failed fragment fallbacks leave English and can retry on ready',async()=>{
  let mode='unavailable';
  const a=app(async text=>mode==='unavailable'?text:mode==='broken'?(text.includes('__BAC_UI_KEEP_')?'Lost protected content':text):'Traduit: '+text);
  const info=a.add(a.document.body,'aside',{className:'info'});
  const p=a.add(info,'p',{text:'Sign with Xverse'});
  await a.language('fr');assert.equal(p.textContent,'Sign with Xverse');
  mode='broken';let done=a.api.refresh();await a.flush();await done;
  assert.equal(p.textContent,'Sign with Xverse');
  mode='ready';done=a.api.refresh();await a.flush();await done;
  assert.equal(p.textContent,'Traduit: Sign with Xverse');
  await a.language('off');assert.equal(p.textContent,'Sign with Xverse');
});

test('Mangled model placeholders fall back to translated fragments with exact values and separators',async()=>{
  const translated=new Map([
    ['data from','数据来自'],['decoded in your browser','在您的浏览器中解码'],
    ['Use a burner wallet','请使用临时钱包'],['To the extent permitted by law','在法律允许的范围内'],
    ['and its creator accept no liability for Bitcoin losses','及其创建者对比特币损失不承担责任'],
    ['theft','盗窃'],['or security breaches','或安全漏洞'],
    ['Conversation','对话'],['Latest','最新'],['Messages','条消息'],['In','在'],['minutes','分钟'],
    ['transactions','笔交易'],['Seen','已见'],['Waiting for','正在等待'],['at','以'],
  ]);
  const a=app(async text=>text.includes('__BAC_UI_KEEP_')?text.replace(/__BAC_UI_KEEP_\d+__/g,'被错误翻译的标记'):translated.get(text)||text);
  const info=a.add(a.document.body,'aside',{className:'info'});
  const samples=[
    ['  OP_RETURN data from mempool.space, decoded in your browser.\n','  OP_RETURN 数据来自 mempool.space, 在您的浏览器中解码.\n'],
    ['Use a burner wallet. To the extent permitted by law, Bitcoin AllChat and its creator accept no liability for Bitcoin losses, theft, or security breaches.','请使用临时钱包. 在法律允许的范围内, Bitcoin AllChat 及其创建者对比特币损失不承担责任, 盗窃, 或安全漏洞.'],
    ['Conversation (Latest 100 Messages)','对话 (最新 100 条消息)'],
    ['In ~10 minutes','在 ~10 分钟'],['4,787 transactions','4,787 笔交易'],['OP_RETURN Seen','OP_RETURN 已见'],
    ['Waiting for Xverse at 2 sat/vB','正在等待 Xverse 以 2 sat/vB'],
  ];
  const labels=samples.map(([text])=>a.add(info,'p',{text}));
  await a.language('zh');
  samples.forEach(([,expected],i)=>assert.equal(labels[i].textContent,expected));
  assert.equal(a.calls.some(text=>text.includes('Xverse')||text.includes('Bitcoin AllChat')||text.includes('mempool.space')||text.includes('sat/vB')||text.includes('4,787')||text.includes('100')),false);
  const count=a.calls.length;await a.flush();assert.equal(a.calls.length,count);
  await a.language('off');samples.forEach(([original],i)=>assert.equal(labels[i].textContent,original));
});

test('Fragment fallbacks commit atomically, preserve source separators and stop after language changes',async()=>{
  const pending=[];
  const a=app(text=>new Promise(resolve=>pending.push({text,resolve})));
  const dock=a.add(a.document.body,'div',{className:'dock'});
  const label=a.add(dock,'span',{text:'Waiting for Xverse.'});
  a.api.setLanguage('fr');await a.flush();
  pending.shift().resolve('Placeholder mangled');await a.flush();
  assert.equal(pending[0].text,'Waiting for');assert.equal(label.textContent,'Waiting for Xverse.');
  a.api.setLanguage('ar');pending.shift().resolve('Ancienne traduction.');await a.flush();
  assert.equal(label.textContent,'Waiting for Xverse.');
  pending.shift().resolve('Placeholder mangled again');await a.flush();
  pending.shift().resolve('  جار الانتظار.  ');await a.flush();
  assert.equal(label.textContent,'جار الانتظار Xverse.');
});

test('A problematic or excessively fragmented fallback leaves the full original paragraph intact',async()=>{
  const a=app(async text=>text.includes('__BAC_UI_KEEP_')?'Bad placeholder translation':text==='Second'?null:'Traduction');
  const dock=a.add(a.document.body,'div',{className:'dock'});
  const paragraph=a.add(dock,'p',{text:'First 10 Second.'});
  const tooMany='Word 10 '.repeat(25);
  const bounded=a.add(dock,'p',{text:tooMany});
  await a.language('fr');
  assert.equal(paragraph.textContent,'First 10 Second.');
  assert.equal(bounded.textContent,tooMany);
  assert.ok(a.calls.length<=4);
});

test('Language changes and external English updates invalidate pending translations',async()=>{
  const pending=[];
  const a=app(text=>new Promise(resolve=>pending.push({text,resolve})));
  const root=a.add(a.document.body,'aside',{className:'info'});
  const label=a.add(root,'p',{text:'Preparing…'});
  a.api.setLanguage('fr');await a.flush();assert.equal(pending.length,1);
  a.api.setLanguage('ar');pending.shift().resolve('Old French result');await a.flush();
  assert.equal(label.textContent,'Preparing…');assert.equal(pending.length,1);
  label.textContent='Reading your coins…';
  pending.shift().resolve('Outdated Arabic status');await a.flush();
  assert.equal(label.textContent,'Reading your coins…');assert.equal(pending.length,1);
  pending.shift().resolve('الحالة الجديدة');await a.flush();
  assert.equal(label.textContent,'الحالة الجديدة');
  await a.language('en');assert.equal(label.textContent,'Reading your coins…');
});

test('New settings roots are observed and engine output is always inserted as literal text',async()=>{
  const a=app(async text=>'<img src=x onerror=alert(1)> '+text);
  await a.language('fr');
  const modal=a.add(a.document.body,'div',{id:'ovl'});
  const heading=a.add(modal,'h2',{text:'Language settings'});
  await a.flush();
  assert.equal(heading.children.length,0);
  assert.equal(heading.textContent,'<img src=x onerror=alert(1)> Language settings');
  const count=a.calls.length;await a.flush();assert.equal(a.calls.length,count);
  a.api.dispose();assert.equal(heading.textContent,'Language settings');
  heading.textContent='A later English setting';await a.flush();
  assert.equal(heading.textContent,'A later English setting');assert.equal(a.observers.size,0);
});

test('Translation work stays bounded even when many labels arrive together',async()=>{
  const pending=[];let current=0,peak=0;
  const a=app(text=>new Promise(resolve=>{current++;peak=Math.max(peak,current);pending.push(()=>{current--;resolve('T: '+text)})}));
  const info=a.add(a.document.body,'aside',{className:'info'});
  for(let i=0;i<12;i++)a.add(info,'p',{text:'Message label '+i});
  a.api.setLanguage('fr');await a.flush();assert.equal(pending.length,3);
  for(let step=0;step<12;step++){pending.shift()?.();await a.flush();}
  assert.ok(peak<=3);assert.equal(current,0);
  assert.ok(info.children.every(node=>node.textContent.startsWith('T: ')));
});
