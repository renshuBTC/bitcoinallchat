// Runs the shipped controller with small DOM and native-model doubles; no network or model download.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../translate.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function fakeClock(){
  let now=0,id=0;const timers=new Map();
  return {setTimeout(fn,delay){const key=++id;timers.set(key,{fn,at:now+delay});return key},clearTimeout(key){timers.delete(key)},
    advance(ms){const end=now+ms;for(;;){let next=null;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn()}now=end},
    get pending(){return timers.size}};
}
function runtime(options={}){
  const intersections=[],mutations=[],calls={detect:[],translate:[],create:[],detectorCreate:0,active:0,maxActive:0},sessions=[],statuses=[];
  let gesture=false;
  function notify(record){for(const observer of mutations)if(observer.connected&&observer.root.contains(record.target))observer.callback([record])}
  class Element{
    constructor(tag='div',classes=''){this.tagName=tag.toUpperCase();this.nodeType=1;this.className=classes;this.children=[];this.parentElement=null;this.dataset={};this.attrs={};this._text='';this.visible=true;this.classList={contains:name=>this.className.split(/\s+/).includes(name)}}
    set textContent(value){this._text=String(value);const removed=[...this.children];this.children=[];for(const child of removed)child.parentElement=null;notify({type:'childList',target:this,addedNodes:[],removedNodes:removed})}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
    setAttribute(name,value){this.attrs[name]=String(value)}
    hasAttribute(name){return name in this.attrs}
    append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);notify({type:'childList',target:this,addedNodes:[child],removedNodes:[]})}}
    remove(){if(!this.parentElement)return;const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;notify({type:'childList',target:parent,addedNodes:[],removedNodes:[this]})}
    insertAdjacentElement(position,child){assert.equal(position,'afterend');const parent=this.parentElement;child.remove();child.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,child);notify({type:'childList',target:parent,addedNodes:[child],removedNodes:[]})}
    matches(selector){return selector.split(',').some(s=>s.trim().startsWith('.')&&this.classList.contains(s.trim().slice(1)))}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null}
    contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false}
    querySelectorAll(selector){const output=[];for(const child of this.children){if(selector==='.row .txt'?child.matches('.txt')&&child.closest('.row'):child.matches(selector))output.push(child);output.push(...child.querySelectorAll(selector))}return output}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null}
    getBoundingClientRect(){return {width:500,height:40,top:this.visible?0:2000,bottom:this.visible?40:2040}}
  }
  class IntersectionObserver{
    constructor(callback){this.callback=callback;this.targets=new Set();this.connected=true;intersections.push(this)}
    observe(node){this.targets.add(node)}unobserve(node){this.targets.delete(node)}disconnect(){this.connected=false;this.targets.clear()}
  }
  class MutationObserver{
    constructor(callback){this.callback=callback;this.connected=true;mutations.push(this)}
    observe(root){this.root=root;this.connected=true}disconnect(){this.connected=false}
  }
  function detectLanguage(text){return text.startsWith('Bonjour')?'fr':text.startsWith('Hola')?'es':/[\u4e00-\u9fff]/.test(text)?'zh':'en'}
  function makeSession({sourceLanguage:from,targetLanguage:to}){
    const session={destroyed:false,destroy(){this.destroyed=true},translate(text,{signal}={}){
      calls.translate.push({text,from,to});calls.active++;calls.maxActive=Math.max(calls.maxActive,calls.active);
      const result=options.translate?options.translate(text,{from,to,signal}):Promise.resolve(to+': '+text);
      return Promise.resolve(result).finally(()=>{calls.active--});
    }};sessions.push(session);return session;
  }
  const detector={destroyed:false,destroy(){this.destroyed=true},detect(text,{signal}={}){calls.detect.push(text);return Promise.resolve(options.detect?options.detect(text,signal):[{detectedLanguage:detectLanguage(text),confidence:0.99}])}};
  const window={innerHeight:800,IntersectionObserver,MutationObserver,addEventListener(){},removeEventListener(){}};
  if(options.native!==false){
    window.LanguageDetector={availability:async()=>options.detectorAvailability||'available',create(config){calls.detectorCreate++;return options.createDetector?options.createDetector(config,detector):Promise.resolve(detector)}};
    window.Translator={availability:async pair=>options.availability?options.availability(pair):'available',create(config){calls.create.push({...config,gesture});return options.create?options.create(config,makeSession):Promise.resolve(makeSession(config))}};
  }
  const scope=vm.createContext({window,document:{createElement:tag=>new Element(tag)},AbortController,DOMException,queueMicrotask,console,
    setTimeout:options.clock?.setTimeout||setTimeout,clearTimeout:options.clock?.clearTimeout||clearTimeout,
    fetch(){throw new Error('Translation must never use a network service')}});
  vm.runInContext(source,scope,{filename:'shipped-translate.js'});const app=window.BAC_TRANSLATE,root=new Element();
  function row(text,kind='talk',classes='txt'){const row=new Element('div','row'),bubble=new Element('div','bub'),txt=new Element('div',classes);row.dataset.kind=kind;txt.textContent=text;bubble.append(txt);row.append(bubble);root.append(row);return {row,bubble,txt}}
  function show(txt,visible=true){txt.visible=visible;for(const observer of intersections)if(observer.connected&&observer.targets.has(txt))observer.callback([{target:txt,isIntersecting:visible}])}
  function configure(target,extra={}){return app.configure(target,{onStatus:value=>statuses.push(value),...extra})}
  function enable(){gesture=true;try{return app.enableFromGesture()}finally{gesture=false}}
  return {app,root,row,show,configure,enable,calls,sessions,detector,statuses,intersections,mutations,Element};
}

test('Unsupported browsers retain originals and expose all 39 suggested language codes',async()=>{
  const r=runtime({native:false});assert.equal(r.app.supportedLanguages.length,39);r.configure('zh-CN');
  assert.equal(r.app.getState().state,'unsupported');assert.equal(await r.app.translateUI('Conversation'),'Conversation');
  await r.enable();assert.equal(r.calls.create.length,0);r.app.dispose();
});
test('A direct gesture prepares only the detector and selected English UI pair',async()=>{
  const r=runtime({availability:()=> 'downloadable',detectorAvailability:'downloadable'});r.configure('ja');await r.enable();
  assert.equal(r.calls.detectorCreate,1);assert.deepEqual(r.calls.create.map(c=>[c.sourceLanguage,c.targetLanguage,c.gesture]),[['en','ja',true]]);
  assert.equal(await r.app.translateUI('Conversation'),'ja: Conversation');assert.equal(r.calls.create.length,1);r.app.dispose();
});
test('Detector preparation does not occupy either translation worker or delay ready UI translation',async()=>{
  for(const mode of ['gesture','automatic']){
    const gate=deferred(),r=runtime({createDetector:()=>gate.promise}),a=r.row('Bonjour first'),b=r.row('Bonjour second');
    r.configure('ja');const enabling=mode==='gesture'?r.enable():null;
    await tick();r.app.observe(r.root);r.show(a.txt);r.show(b.txt);await tick();
    assert.equal(r.calls.detect.length,0);assert.equal(a.bubble.querySelector('.translation-status').textContent,'Preparing translation…');
    const translated=r.app.translateUI('Conversation');await tick();assert.equal(await translated,'ja: Conversation',mode);
    assert.equal(r.calls.translate.length,1);assert.equal(r.calls.detectorCreate,1);
    gate.resolve(r.detector);if(enabling)await enabling;await tick();
    assert.equal(a.bubble.querySelector('.translation-text').textContent,'ja: Bonjour first',mode);
    assert.equal(b.bubble.querySelector('.translation-text').textContent,'ja: Bonjour second',mode);
    assert.equal(r.calls.detect.length,2);assert(r.calls.maxActive<=2);r.app.dispose();
  }
});
test('A preparing chat pair frees both workers for a ready UI pair and resumes visible messages when ready',async()=>{
  for(const mode of ['gesture','automatic']){
    const gate=deferred();let config,makeSession;
    const r=runtime({availability:()=>mode==='gesture'?'downloadable':'available',create:(options,make)=>{
      if(options.sourceLanguage==='fr'){config=options;makeSession=make;return gate.promise}return Promise.resolve(make(options));
    }}),a=r.row('Bonjour first'),b=r.row('Bonjour second');
    r.configure('ja');await r.enable();r.app.observe(r.root);r.show(a.txt);r.show(b.txt);await tick();
    const enabling=mode==='gesture'?r.enable():null;await tick();
    assert.equal(r.calls.create.filter(call=>call.sourceLanguage==='fr').length,1,mode);
    for(const item of [a,b])assert.equal(item.bubble.querySelector('.translation-status').textContent,'Preparing translation…',mode);
    const translated=r.app.translateUI('Conversation');await tick();assert.equal(await translated,'ja: Conversation',mode);
    assert.equal(r.calls.translate.length,1,mode);
    gate.resolve(makeSession(config));if(enabling)await enabling;await tick();
    assert.equal(a.bubble.querySelector('.translation-text').textContent,'ja: Bonjour first',mode);
    assert.equal(b.bubble.querySelector('.translation-text').textContent,'ja: Bonjour second',mode);
    assert.equal(r.calls.translate.length,3,mode);assert(r.calls.maxActive<=2);r.app.dispose();
  }
});
test('Only visible message text is translated, originals remain, and output markup stays literal',async()=>{
  const r=runtime({translate:()=>Promise.resolve('<img src=x onerror=alert(1)>')}),a=r.row('Bonjour tout le monde'),b=r.row('Bonjour caché');
  r.configure('en');r.app.observe(r.root);await tick();assert.equal(r.calls.detect.length,0);
  r.show(a.txt);await tick();assert.equal(r.calls.detect.length,1);assert.equal(r.calls.translate.length,1);
  assert.equal(a.txt.textContent,'Bonjour tout le monde');assert.equal(a.bubble.querySelectorAll('.translation').length,1);
  assert.equal(a.bubble.querySelector('.translation-label').textContent,'Auto-translated');
  assert.equal(a.bubble.querySelector('.translation-text').textContent,'<img src=x onerror=alert(1)>');assert.equal(a.bubble.querySelector('.translation-text').children.length,0);
  assert.equal(a.bubble.querySelector('.translation-text').dir,'auto');assert.equal(b.bubble.querySelector('.translation'),null);r.app.dispose();
});
test('New chat language packs wait for a gesture instead of silently downloading all pairs',async()=>{
  const r=runtime({availability:()=> 'downloadable'}),a=r.row('Bonjour tout le monde');r.configure('ja');await r.enable();r.app.observe(r.root);r.show(a.txt);await tick();
  assert.equal(r.calls.create.length,1);assert.equal(r.app.getState().state,'download-needed');assert(a.bubble.querySelector('.translation-status'));
  await r.enable();await tick();assert.deepEqual(r.calls.create.map(c=>[c.sourceLanguage,c.targetLanguage,c.gesture]),[['en','ja',true],['fr','ja',true]]);
  assert.equal(a.bubble.querySelector('.translation-text').textContent,'ja: Bonjour tout le monde');r.app.dispose();
});
test('Pending offscreen pairs do not leave a misleading download prompt',async()=>{
  const r=runtime({availability:()=> 'downloadable'}),a=r.row('Bonjour tout le monde');r.configure('en');await r.enable();r.app.observe(r.root);r.show(a.txt);await tick();assert.equal(r.app.getState().state,'download-needed');
  r.show(a.txt,false);assert.equal(r.app.getState().state,'ready');await r.enable();assert.equal(r.calls.create.length,0);r.app.dispose();
});
test('A rejected detector activation waits for a real gesture instead of retrying for every row',async()=>{
  let allow=false;const r=runtime({createDetector:(config,detector)=>allow?Promise.resolve(detector):Promise.reject(new DOMException('Click required','NotAllowedError'))});
  r.configure('en');const rows=Array.from({length:10},(_,i)=>r.row('Bonjour '+i));r.app.observe(r.root);for(const item of rows)r.show(item.txt);await tick();
  assert.equal(r.calls.detectorCreate,1);assert.equal(r.app.getState().state,'download-needed');allow=true;await r.enable();await tick();assert.equal(r.calls.detectorCreate,2);assert.equal(r.calls.translate.length,10);r.app.dispose();
});
test('More text mutations replace the translation and enforce the 5,000-character input limit',async()=>{
  const r=runtime(),a=r.row('Bonjour court');r.configure('en');r.app.observe(r.root);r.show(a.txt);await tick();
  a.txt.textContent='Bonjour '+ 'a'.repeat(5000);await tick();assert.equal(r.calls.translate.length,1);assert.match(a.bubble.querySelector('.translation-status').textContent,/5,000/);assert.equal(a.bubble.querySelector('.translation-label'),null);
  a.txt.textContent='Bonjour texte développé';await tick();assert.equal(r.calls.translate.length,2);assert.equal(a.bubble.querySelectorAll('.translation').length,1);assert.equal(a.bubble.querySelector('.translation-text').textContent,'en: Bonjour texte développé');
  a.txt.textContent='Hola texto cambiado';await tick();assert.equal(r.calls.translate.at(-1).from,'es');assert(r.calls.detect.includes('Hola texto cambiado'));r.app.dispose();
});
test('PGP, protocol objects, hashes, attachments and drafts never reach either native model',async()=>{
  const r=runtime(),rows=[r.row('Bonjour signed message','pgp','txt mono'),r.row('{"message":"Bonjour"}','tag'),r.row('a'.repeat(64)),r.row('BAC1:reply:untrusted'),r.row('Bonjour file name','img')];
  const draft=new r.Element('textarea','txt');draft.textContent='Bonjour private draft';r.root.append(draft);
  r.configure('en');r.app.observe(r.root);for(const item of rows)r.show(item.txt);await tick();assert.equal(r.calls.detect.length,0);assert.equal(r.calls.translate.length,0);r.app.dispose();
});
test('Low-confidence detection and source equal to target retain the original without a translated label',async()=>{
  const r=runtime({detect:text=>[{detectedLanguage:'en',confidence:text==='Hello'?0.99:0.3}]}),a=r.row('Hello'),b=r.row('Ambiguous');r.configure('en');r.app.observe(r.root);r.show(a.txt);r.show(b.txt);await tick();
  assert.equal(r.calls.translate.length,0);assert.equal(a.bubble.querySelector('.translation'),null);assert.equal(b.bubble.querySelector('.translation'),null);r.app.dispose();
});
test('UI and bubble work share a maximum of two simultaneous translation calls',async()=>{
  const gates=[];const r=runtime({translate:()=>{const gate=deferred();gates.push(gate);return gate.promise}});r.configure('ja');await r.enable();
  const promises=Array.from({length:8},(_,i)=>r.app.translateUI('Control '+i));const a=r.row('Hello visitor');r.app.observe(r.root);r.show(a.txt);await tick();assert.equal(r.calls.active,2);
  let resolved=0;while(resolved<9){const batch=gates.slice(resolved);assert(batch.length);for(const gate of batch)gate.resolve('Translated');resolved+=batch.length;await tick()}
  await Promise.all(promises);assert.equal(r.calls.maxActive,2);assert.equal(r.calls.translate.length,9);r.app.dispose();
});
test('Visible messages deferred by a full queue run when capacity returns without another observer event',async()=>{
  const gates=[],r=runtime({translate:()=>{const gate=deferred();gates.push(gate);return gate.promise}});r.configure('ja');await r.enable();
  const pending=Array.from({length:502},(_,i)=>r.app.translateUI('Pending interface text '+i));
  // More than one deferred-scan batch of older offscreen rows must not lose the visible row.
  for(let i=0;i<250;i++)r.row('Bonjour offscreen '+i);
  const a=r.row('Bonjour deferred while full'),removed=r.row('Bonjour removed while full'),hidden=r.row('Bonjour hidden while full');
  r.app.observe(r.root);r.show(a.txt);r.show(removed.txt);r.show(hidden.txt);removed.row.remove();r.show(hidden.txt,false);
  await tick();assert.equal(r.calls.translate.length,2);
  let completed=0;
  while(completed<503){const batch=gates.slice(completed);assert(batch.length,'Work should progress after capacity is released');for(const gate of batch)gate.resolve('Translated');completed+=batch.length;await tick()}
  await Promise.all(pending);await tick();assert.equal(r.calls.detect.filter(text=>text==='Bonjour deferred while full').length,1);
  assert(!r.calls.detect.includes('Bonjour removed while full'));assert(!r.calls.detect.includes('Bonjour hidden while full'));
  assert.equal(a.bubble.querySelectorAll('.translation').length,1);assert.equal(r.calls.maxActive,2);r.app.dispose();
});
test('Repeated observe calls do not create duplicate workers or live observers',async()=>{
  const gate=deferred(),r=runtime({translate:()=>gate.promise}),a=r.row('Bonjour unique');r.configure('en');
  for(let i=0;i<12;i++){r.app.observe(r.root);r.show(a.txt)}await tick();assert.equal(r.calls.translate.length,1);
  assert.equal(r.intersections.filter(o=>o.connected).length,1);assert.equal(r.mutations.filter(o=>o.connected).length,1);
  gate.resolve('Hello unique');await tick();assert.equal(a.bubble.querySelectorAll('.translation').length,1);r.app.dispose();
});
test('Language changes cancel UI and bubble results from the previous generation',async()=>{
  const gates=[],r=runtime({translate:()=>{const gate=deferred();gates.push(gate);return gate.promise}}),a=r.row('Bonjour monde');r.configure('de');await r.enable();r.app.observe(r.root);r.show(a.txt);
  const oldUI=r.app.translateUI('Conversation');await tick();assert.equal(gates.length,2);r.configure('ja');await r.enable();await tick();
  gates[0].resolve('STALE');gates[1].resolve('STALE');assert.equal(await oldUI,'Conversation');await tick();assert(!a.bubble.textContent.includes('STALE'));
  for(const gate of gates.slice(2))gate.resolve('NEW');await tick();assert(!a.bubble.textContent.includes('STALE'));r.app.dispose();
});
test('Removing rows prevents pending results from being attached after rerender',async()=>{
  const gate=deferred(),r=runtime({translate:()=>gate.promise}),a=r.row('Bonjour removed');r.configure('en');r.app.observe(r.root);r.show(a.txt);await tick();a.row.remove();r.app.observe(r.root);gate.resolve('Hello removed');await tick();
  assert.equal(a.bubble.querySelector('.translation'),null);assert.equal(r.root.querySelector('.translation'),null);r.app.dispose();
});
test('The shared translation LRU evicts beyond 200 entries and reuses recent entries',async()=>{
  const r=runtime();r.configure('ja');await r.enable();for(let i=0;i<210;i++)await r.app.translateUI('Control '+i);
  assert.equal(r.calls.translate.length,210);await r.app.translateUI('Control 209');assert.equal(r.calls.translate.length,210);
  await r.app.translateUI('Control 0');assert.equal(r.calls.translate.length,211);r.app.dispose();
});
test('The cache also evicts by its 2 MB text budget before reaching 200 entries',async()=>{
  const r=runtime({translate:()=>Promise.resolve('z'.repeat(20000))});r.configure('ja');await r.enable();
  const text=i=>String(i).padStart(3,'0')+'a'.repeat(4997);for(let i=0;i<70;i++)await r.app.translateUI(text(i));
  assert.equal(r.calls.translate.length,70);await r.app.translateUI(text(69));assert.equal(r.calls.translate.length,70);
  await r.app.translateUI(text(0));assert.equal(r.calls.translate.length,71);r.app.dispose();
});
test('Unused pair sessions are bounded and dispose releases all native sessions',async()=>{
  const r=runtime({detect:text=>[{detectedLanguage:text.slice(0,2),confidence:1}]});r.configure('en');r.app.observe(r.root);
  for(const code of ['fr','es','de','it','ja','ko','ru','ar']){const a=r.row(code+' message');r.app.observe(r.root);r.show(a.txt);await tick()}
  assert.equal(r.calls.create.length,8);assert(r.sessions.filter(s=>!s.destroyed).length<=6);r.app.dispose();assert(r.sessions.every(s=>s.destroyed));assert(r.detector.destroyed);
});
test('Turning translation off aborts pending detector downloads and ignores late completion',async()=>{
  const gate=deferred();let signal;const r=runtime({createDetector:config=>{signal=config.signal;return gate.promise}});r.configure('en');const enabling=r.enable();r.configure('off');assert(signal.aborted);
  gate.resolve(r.detector);await enabling;await tick();assert(r.detector.destroyed);assert.equal(r.app.getState().state,'off');r.app.dispose();
});
test('Cancelled model progress cannot change the off state or a newly enabled generation',async()=>{
  for(const kind of ['detector','pair']){
    const clock=fakeClock(),gate=deferred();let progress,signal,first=true;
    const blocked=config=>{signal=config.signal;config.monitor({addEventListener(_name,callback){progress=callback}});return gate.promise};
    const r=runtime({clock,createDetector:(config,detector)=>kind==='detector'&&first?(first=false,blocked(config)):Promise.resolve(detector),
      create:(config,make)=>kind==='pair'&&first?(first=false,blocked(config)):Promise.resolve(make(config))});
    r.configure('ja');const enabling=r.enable();await tick();progress({loaded:0.1,total:1});
    r.configure('off');await enabling;assert(signal.aborted);assert.equal(clock.pending,0);
    const offCount=r.statuses.length;progress({loaded:0.3,total:1});assert.equal(r.statuses.length,offCount);assert.equal(r.app.getState().state,'off');
    r.configure('de');await r.enable();await tick();assert.equal(r.app.getState().state,'ready');
    const readyCount=r.statuses.length;progress({loaded:0.8,total:1});assert.equal(r.statuses.length,readyCount,kind);assert.equal(clock.pending,0);
    const late={destroyed:false,destroy(){this.destroyed=true}};gate.resolve(late);await tick();assert(late.destroyed);
    assert.equal(await r.app.translateUI('Conversation'),'de: Conversation');r.app.dispose();assert.equal(clock.pending,0);
  }
});
test('Oversized native output is rejected without changing original text',async()=>{
  const r=runtime({translate:()=>Promise.resolve('x'.repeat(20001))}),a=r.row('Bonjour safe');r.configure('en');r.app.observe(r.root);r.show(a.txt);await tick();
  assert.equal(a.txt.textContent,'Bonjour safe');assert(a.bubble.querySelector('.translation-status'));assert.equal(a.bubble.querySelector('.translation-label'),null);r.app.dispose();
});
test('A stalled detector download fails after 90 seconds, destroys late results and waits for an explicit retry',async()=>{
  const clock=fakeClock(),gate=deferred();let signal,progress,stalled=true;
  const r=runtime({clock,createDetector:(config,detector)=>{signal=config.signal;config.monitor({addEventListener(_name,callback){progress=callback}});return stalled?gate.promise:Promise.resolve(detector)}});
  r.configure('en');const enabling=r.enable();clock.advance(89999);assert.equal(r.app.getState().state,'preparing');clock.advance(1);await enabling;await tick();
  assert(signal.aborted);assert.equal(r.app.getState().state,'error');assert.match(r.app.getState().message,/Language download stalled/);
  const errorCount=r.statuses.length;progress({loaded:0.9,total:1});assert.equal(r.statuses.length,errorCount);assert.equal(clock.pending,0);
  const a=r.row('Bonjour after stall');r.app.observe(r.root);r.show(a.txt);await tick();assert.equal(r.calls.detectorCreate,1);
  const late={destroyed:false,destroy(){this.destroyed=true}};gate.resolve(late);await tick();assert(late.destroyed);
  stalled=false;await r.enable();await tick();assert.equal(r.calls.detectorCreate,2);assert.equal(r.app.getState().state,'ready');r.app.dispose();assert.equal(clock.pending,0);
});
test('Increasing download progress extends the watchdog without limiting a healthy multi-minute download',async()=>{
  const clock=fakeClock(),gate=deferred();let progress,config,sessionFactory;
  const r=runtime({clock,create:(options,make)=>{config=options;sessionFactory=make;options.monitor({addEventListener(name,callback){assert.equal(name,'downloadprogress');progress=callback}});return gate.promise}});
  r.configure('ja');const enabling=r.enable();await tick();progress({loaded:0,total:1});
  for(const loaded of [0.2,0.4,0.6,0.8]){clock.advance(60000);progress({loaded,total:1});await tick();assert.equal(r.app.getState().state,'preparing');assert(!config.signal.aborted)}
  gate.resolve(sessionFactory(config));await enabling;await tick();assert.equal(r.app.getState().state,'ready');assert.equal(clock.pending,0);
  const readyCount=r.statuses.length;progress({loaded:1,total:1});assert.equal(r.statuses.length,readyCount);assert.equal(clock.pending,0);r.app.dispose();
});
test('Repeated zero progress cannot postpone a stalled pair forever or trigger automatic retries',async()=>{
  const clock=fakeClock(),gate=deferred();let progress,config,sessionFactory;
  const r=runtime({clock,create:(options,make)=>{config=options;sessionFactory=make;options.monitor({addEventListener(_name,callback){progress=callback}});return gate.promise}});
  r.configure('ja');const enabling=r.enable();await tick();progress({loaded:0,total:1});clock.advance(60000);progress({loaded:0,total:1});clock.advance(30000);await enabling;await tick();
  assert(config.signal.aborted);assert.equal(r.app.getState().state,'error');assert.match(r.app.getState().message,/download stalled/);
  assert.equal(await r.app.translateUI('Conversation'),'Conversation');assert.equal(await r.app.translateUI('Everything'),'Everything');assert.equal(r.calls.create.length,1);
  progress({loaded:0.9,total:1});assert.equal(r.app.getState().state,'error');const late=sessionFactory(config);gate.resolve(late);await tick();assert(late.destroyed);r.app.dispose();assert.equal(clock.pending,0);
});
test('A 20-second translation stall aborts the operation and pauses uncached work until explicit retry',async()=>{
  const clock=fakeClock();let stalled=true,signal;
  const r=runtime({clock,translate:(text,options)=>{signal=options.signal;return stalled?new Promise(()=>{}):Promise.resolve('Recovered: '+text)}});
  r.configure('ja');await r.enable();const pending=r.app.translateUI('Conversation');await tick();clock.advance(19999);assert(!signal.aborted);clock.advance(1);await tick();
  assert.equal(await pending,'Conversation');assert(signal.aborted);assert.equal(r.app.getState().state,'error');assert.match(r.app.getState().message,/translation stalled/);
  assert.equal(await r.app.translateUI('Another control'),'Another control');assert.equal(r.calls.translate.length,1);
  stalled=false;await r.enable();assert.equal(await r.app.translateUI('Conversation'),'Recovered: Conversation');assert.equal(r.calls.translate.length,2);r.app.dispose();assert.equal(clock.pending,0);
});
test('A 20-second detection stall keeps the original and does not repeat for every visible row',async()=>{
  const clock=fakeClock();let signal;const r=runtime({clock,detect:(_text,passedSignal)=>{signal=passedSignal;return new Promise(()=>{})}}),a=r.row('Bonjour stalled');
  r.configure('en');await r.enable();r.app.observe(r.root);r.show(a.txt);await tick();clock.advance(20000);await tick();assert(signal.aborted);assert.equal(a.txt.textContent,'Bonjour stalled');assert(a.bubble.querySelector('.translation-status'));
  const b=r.row('Bonjour second');r.app.observe(r.root);r.show(b.txt);await tick();assert.equal(r.calls.detect.length,1);assert.equal(r.app.getState().state,'error');r.app.dispose();assert.equal(clock.pending,0);
});
