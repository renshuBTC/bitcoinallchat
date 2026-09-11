// Minimal DOM doubles exercise bundled interface copy without a browser or translation service.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','ui-language.js'),'utf8');

const SAMPLE_COPY={
  'Messages on Bitcoin.':['Des messages sur Bitcoin.','رسائل على Bitcoin.'],
  'Bitcoin Price':['Prix du Bitcoin','سعر Bitcoin'],
  'OP_RETURN Seen':['OP_RETURN détectés','عمليات OP_RETURN المرصودة'],
  'Conversation (Latest 100 Messages)':['Conversation (100 derniers messages)','المحادثة (أحدث 100 رسالة)'],
  'Everything':['Tout','الكل'],
  'Write a message onto Bitcoin…':['Écrivez un message sur Bitcoin…','اكتب رسالة على Bitcoin…'],
  'The file above is what gets published':['Le fichier ci-dessus sera publié','الملف أعلاه هو ما سيُنشر'],
  'Attach a file or image':['Joindre un fichier ou une image','إرفاق ملف أو صورة'],
  'Publish onto Bitcoin':['Publier sur Bitcoin','النشر على Bitcoin'],
  'Sign With':['Signer avec','التوقيع باستخدام'],
  'Offline':['Hors ligne','دون اتصال'],
  'Remove':['Retirer','إزالة'],
  'Language':['Langue','اللغة'],
  'Display Language':['Langue d’affichage','لغة العرض'],
  'Close':['Fermer','إغلاق'],
  'Apply Language':['Appliquer la langue','تطبيق اللغة'],
  'Preparing…':['Préparation…','جارٍ التحضير…'],
  'Reading your coins…':['Vérification de vos fonds…','جارٍ التحقق من أموالك…'],
  'Reply':['Répondre','رد'],
  'Translate':['Traduire','ترجمة'],
  'Message options':['Options du message','خيارات الرسالة'],
  'Replying to {name}':['Réponse à {name}','الرد على {name}'],
  'Connecting to {wallet}…':['Connexion à {wallet}…','جارٍ الاتصال بـ {wallet}…'],
  'Connected to {wallet}.':['Connecté à {wallet}.','تم الاتصال بـ {wallet}.'],
  'Checked · {fee} to the miner, the rest back to you — confirm in {wallet}':['Vérifié · {fee} au mineur, le reste vous revient — confirmez dans {wallet}','تم التحقق · {fee} للمُعدّن، والباقي يُعاد إليك — أكّد في {wallet}'],
  '{name} exceeds the {n}-byte upload limit.':['{name} dépasse la limite de téléversement de {n} octets.','يتجاوز {name} حد الرفع البالغ {n} بايت.'],
  '{n} transactions':['{n} transactions','عدد المعاملات: {n}'],
  'In ~{n} minutes':['Dans environ {n} minutes','خلال نحو {n} دقيقة'],
  'Bitcoin price in USDT · Updated {time}':['Prix du Bitcoin en USDT · Mis à jour {time}','سعر Bitcoin بوحدة USDT · آخر تحديث {time}'],
  'Could not open offline signing: {reason}':['Impossible d’ouvrir la signature hors ligne : {reason}','تعذّر فتح التوقيع دون اتصال: {reason}']
};
function sampleLocales(){
  return {
    en:Object.fromEntries(Object.keys(SAMPLE_COPY).map(key=>[key,key])),
    fr:Object.fromEntries(Object.entries(SAMPLE_COPY).map(([key,values])=>[key,values[0]])),
    ar:Object.fromEntries(Object.entries(SAMPLE_COPY).map(([key,values])=>[key,values[1]]))
  };
}
function app(languages=sampleLocales()){
  const observers=new Set(),timers=new Map(),calls=[];let timerId=0,notifications=0,callbacks=0;
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
    notifications++;
    for(const observer of observers){
      if(!observer.root.contains(record.target))continue;
      if(record.type==='attributes'&&observer.options.attributeFilter&&!observer.options.attributeFilter.includes(record.attributeName))continue;
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
  document.createElement=tag=>new Element(tag);
  class Observer {
    constructor(callback){this.callback=callback;this.records=[];}
    observe(root,options){this.root=root;this.options=options;observers.add(this)}
    disconnect(){observers.delete(this);this.records=[];}
  }
  const forbidden=name=>(...args)=>{calls.push({name,args});throw Error(name+' must not run for bundled UI copy')};
  const window={BAC_LOCALES:languages,fetch:forbidden('fetch'),
    Translator:{create:forbidden('Translator.create'),availability:forbidden('Translator.availability')},
    LanguageDetector:{create:forbidden('LanguageDetector.create'),availability:forbidden('LanguageDetector.availability')},
    BAC_TRANSLATE:{translateUI:forbidden('old translation bridge')}};
  const context=vm.createContext({window,document,MutationObserver:Observer,fetch:window.fetch,
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
    for(let i=0;i<100;i++){
      for(const observer of observers){if(observer.records.length){callbacks++;observer.callback(observer.records.splice(0));}}
      if(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}
      await Promise.resolve();
      if(!timers.size&&[...observers].every(observer=>!observer.records.length))return;
    }
    throw Error('UI mutation observer did not settle');
  }
  async function language(code){const done=window.BAC_UI_LANGUAGE.setLanguage(code);await flush();await done;}
  return {window,document,api:window.BAC_UI_LANGUAGE,add,Text,Element,calls,flush,language,observers,timers,
    stats:()=>({notifications,callbacks,pending:timers.size+[...observers].reduce((n,observer)=>n+observer.records.length,0)})};
}

test('Bundled dictionaries translate exact keys and preserve separators without native or network operations',async()=>{
  const a=app();
  for(const code of ['fr','ar']){
    await a.language(code);
    for(const [key,translated] of Object.entries(a.window.BAC_LOCALES[code])){
      if(!key.includes('{'))assert.equal(a.api.t(key),translated,code+' '+key);
    }
    assert.equal(a.api.t('  · Messages on Bitcoin. \n'),'  · '+a.window.BAC_LOCALES[code]['Messages on Bitcoin.']+' \n');
    assert.equal(a.api.t('Messages  on\nBitcoin.'),a.window.BAC_LOCALES[code]['Messages on Bitcoin.']);
  }
  assert.equal(a.api.t('Messages on Bitcoin.','en'),'Messages on Bitcoin.');
  for(const text of ['Unknown text','Bitcoin AllChat','Xverse','UniSat','1,250 sats','BTC/USDT','https://mempool.space','f'.repeat(64)])assert.equal(a.api.t(text),text);
  assert.equal(a.api.t('x'.repeat(4001)),'x'.repeat(4001));
  assert.deepEqual(a.calls,[]);a.api.dispose();
});

test('All template placeholders retain literal names, wallets, fees, counts, times and reasons',async()=>{
  const a=app();await a.language('ar');
  const values={name:'RenshuBTC <script>$&</script>',wallet:'Xverse $1',fee:'1,250 sats',n:'100,000',time:'14:32 UTC',reason:'Refused: $& <img src=x>'};
  const fill=template=>template.replace(/\{([a-z]+)\}/g,(_token,name)=>values[name]);
  for(const [key,translation] of Object.entries(a.window.BAC_LOCALES.ar)){
    if(key.includes('{'))assert.equal(a.api.t(fill(key)),fill(translation),key);
  }
  assert.equal(a.api.t('1 transaction'),'عدد المعاملات: 1');
  assert.equal(a.api.t(' · Connecting to UniSat… '),' · جارٍ الاتصال بـ UniSat… ');
  assert.deepEqual(a.calls,[]);a.api.dispose();
});

test('Sidebar, dock, language modal and message options translate while all other content stays original',async()=>{
  const a=app(),info=a.add(a.document.body,'aside',{className:'info'}),dock=a.add(a.document.body,'div',{className:'dock'});
  const translated=[
    a.add(info,'p',{text:'Messages on Bitcoin.'}),
    a.add(dock,'button',{text:'Everything'}),
    a.add(a.add(a.document.body,'div',{id:'ovl'}),'h2',{text:'Display Language'}),
    a.add(a.add(a.document.body,'details',{className:'msgopts'}),'button',{text:'Reply'})
  ];
  // Known dictionary keys prove these are exclusions, not simply missing translations.
  const protectedNodes=[
    a.add(a.document.body,'p',{text:'Messages on Bitcoin.'}),
    a.add(a.add(a.document.body,'div',{id:'ovs'}),'p',{text:'Everything'}),
    a.add(a.add(a.document.body,'div',{id:'ovp'}),'h2',{text:'Offline'}),
    a.add(dock,'div',{className:'txt',text:'Messages on Bitcoin.'}),
    a.add(dock,'div',{className:'qt',text:'Reply'}),
    a.add(dock,'div',{className:'pay',text:'Everything'}),
    a.add(dock,'span',{id:'reply-excerpt',text:'Messages on Bitcoin.'}),
    a.add(dock,'span',{className:'reply-excerpt',text:'Messages on Bitcoin.'}),
    a.add(a.add(dock,'div',{className:'att'}),'span',{className:'nm',text:'Everything'}),
    a.add(info,'div',{id:'m-pool',text:'Messages on Bitcoin.'}),
    a.add(dock,'span',{text:'Reply',attrs:{translate:'no'}}),
    a.add(dock,'span',{text:'Reply',attrs:{'data-no-translate':''}}),
    ...['script','style','svg','canvas','code','pre'].map(tag=>a.add(dock,tag,{text:'Everything'}))
  ];
  const before=protectedNodes.map(node=>node.textContent);
  const thread=a.add(a.document.body,'div',{id:'thread'});
  const body=a.add(thread,'div',{className:'txt',text:'Messages on Bitcoin.'});
  const quote=a.add(thread,'div',{className:'qt',text:'Reply'});
  const draft=a.add(dock,'textarea',{value:'Everything',text:'Reply',attrs:{placeholder:'Write a message onto Bitcoin…'}});
  const select=a.add(a.document.getElementById('ovl'),'select',{attrs:{'aria-label':'Display Language'}});
  const option=a.add(select,'option',{text:'Reply',attrs:{value:'fr'}});
  await a.language('fr');
  assert.deepEqual(translated.map(node=>node.textContent),['Des messages sur Bitcoin.','Tout','Langue d’affichage','Répondre']);
  assert.deepEqual(protectedNodes.map(node=>node.textContent),before);
  assert.equal(body.textContent,'Messages on Bitcoin.');assert.equal(quote.textContent,'Reply');
  assert.equal(draft.value,'Everything');assert.equal(draft.textContent,'Reply');
  assert.equal(draft.getAttribute('placeholder'),'Écrivez un message sur Bitcoin…');
  assert.equal(select.getAttribute('aria-label'),'Langue d’affichage');assert.equal(option.textContent,'Reply');assert.equal(option.getAttribute('value'),'fr');
  assert.deepEqual(a.calls,[]);a.api.dispose();
});

test('RTL labels preserve wallet order, links and original element direction on restoration',async()=>{
  const a=app(),dock=a.add(a.document.body,'div',{className:'dock',attrs:{dir:'ltr'}});
  a.document.documentElement.setAttribute('dir','ltr');
  const wallets=a.add(dock,'span',{className:'wallets',attrs:{dir:'ltr'}});
  const sign=new a.Text('Sign With ');wallets.appendChild(sign);
  const xverse=a.add(wallets,'a',{text:'Xverse',attrs:{href:'https://www.xverse.app/download'}});
  const unisat=a.add(wallets,'a',{text:'UniSat',attrs:{href:'https://unisat.io/download'}});
  const offline=a.add(wallets,'button',{text:'Offline',attrs:{lang:'en-US',dir:'ltr'}});
  offline.style.textAlign='right';offline.style.unicodeBidi='isolate';
  await a.language('ar');
  assert.equal(sign.nodeValue,'التوقيع باستخدام ');assert.equal(offline.textContent,'دون اتصال');
  assert.equal(offline.getAttribute('dir'),'auto');assert.equal(offline.style.textAlign,'start');
  assert.equal(a.document.documentElement.getAttribute('lang'),'ar');
  assert.equal(a.document.documentElement.getAttribute('dir'),'ltr');assert.equal(dock.getAttribute('dir'),'ltr');assert.equal(wallets.getAttribute('dir'),'ltr');
  assert.deepEqual(wallets.children,[xverse,unisat,offline]);assert.equal(xverse.textContent,'Xverse');assert.equal(unisat.textContent,'UniSat');
  assert.equal(xverse.getAttribute('href'),'https://www.xverse.app/download');assert.equal(unisat.getAttribute('href'),'https://unisat.io/download');
  await a.language('en');
  assert.equal(sign.nodeValue,'Sign With ');assert.equal(offline.textContent,'Offline');
  assert.equal(offline.getAttribute('lang'),'en-US');assert.equal(offline.getAttribute('dir'),'ltr');assert.equal(offline.style.textAlign,'right');assert.equal(offline.style.unicodeBidi,'isolate');
  assert.equal(wallets.getAttribute('lang'),null);a.api.dispose();
});

test('Changing language and disabling it restore original text and accessible attributes exactly',async()=>{
  const a=app(),dock=a.add(a.document.body,'div',{className:'dock'});
  const paragraph=a.add(dock,'p',{text:'  Messages on Bitcoin.\n'});
  const input=a.add(dock,'textarea',{value:'Unsent 中文 draft',attrs:{placeholder:'Write a message onto Bitcoin…',title:'Attach a file or image','aria-label':'Publish onto Bitcoin'}});
  await a.language('fr');await a.language('ar');
  assert.equal(paragraph.textContent,'  رسائل على Bitcoin.\n');
  assert.equal(input.getAttribute('title'),'إرفاق ملف أو صورة');assert.equal(input.getAttribute('aria-label'),'النشر على Bitcoin');
  await a.language('off');
  assert.equal(a.api.getLanguage(),'en');assert.equal(paragraph.textContent,'  Messages on Bitcoin.\n');
  assert.equal(input.getAttribute('placeholder'),'Write a message onto Bitcoin…');assert.equal(input.getAttribute('title'),'Attach a file or image');assert.equal(input.getAttribute('aria-label'),'Publish onto Bitcoin');
  assert.equal(input.value,'Unsent 中文 draft');assert.equal(paragraph.getAttribute('lang'),null);assert.equal(paragraph.getAttribute('dir'),null);
  a.api.dispose();
});

test('Dynamic statuses, text-node updates and changed placeholders use their latest English source',async()=>{
  const a=app(),dock=a.add(a.document.body,'div',{className:'dock'});
  const hint=a.add(dock,'div',{text:'Preparing…'}),input=a.add(dock,'textarea',{attrs:{placeholder:'Write a message onto Bitcoin…'}});
  await a.language('fr');
  hint.textContent='Connecting to Xverse…';input.setAttribute('placeholder','The file above is what gets published');await a.flush();
  assert.equal(hint.textContent,'Connexion à Xverse…');assert.equal(input.getAttribute('placeholder'),'Le fichier ci-dessus sera publié');
  hint.childNodes[0].nodeValue='Connected to UniSat.';await a.flush();assert.equal(hint.textContent,'Connecté à UniSat.');
  await a.language('ar');assert.equal(hint.textContent,'تم الاتصال بـ UniSat.');
  await a.language('en');assert.equal(hint.textContent,'Connected to UniSat.');assert.equal(input.getAttribute('placeholder'),'The file above is what gets published');
  a.api.dispose();
});

test('New scoped roots and nested controls are translated once without a mutation self-loop',async()=>{
  const a=app();await a.language('fr');
  const modal=a.add(a.document.body,'div',{id:'ovl'}),heading=a.add(modal,'h2',{text:'Display Language'});
  const nested=a.add(modal,'div',{className:'dock'}),button=a.add(nested,'button',{text:'Apply Language'});
  await a.flush();assert.equal(heading.textContent,'Langue d’affichage');assert.equal(button.textContent,'Appliquer la langue');
  const settled=a.stats();assert.equal(settled.pending,0);assert.equal(a.observers.size,1);
  await a.flush();assert.deepEqual(a.stats(),settled);
  a.api.setLanguage('fr');await a.flush();assert.equal(a.observers.size,1);
  const stable=a.stats();await a.flush();assert.deepEqual(a.stats(),stable);
  a.api.dispose();assert.equal(heading.textContent,'Display Language');assert.equal(a.observers.size,0);assert.equal(a.timers.size,0);
  heading.textContent='Apply Language';await a.flush();assert.equal(heading.textContent,'Apply Language');
});

test('Unknown and prototype-named language codes fall back to English without changing prototypes',async()=>{
  const languages=sampleLocales();Object.setPrototypeOf(languages,{hidden:{'Reply':'Inherited value'}});
  const a=app(languages),dock=a.add(a.document.body,'div',{className:'dock'}),reply=a.add(dock,'button',{text:'Reply'});
  await a.language('fr');
  for(const code of ['__proto__','constructor','toString','hidden','<img src=x onerror=alert(1)>','xx',null,undefined]){
    await a.language(code);assert.equal(a.api.getLanguage(),'en');assert.equal(reply.textContent,'Reply');
    assert.equal(a.document.documentElement.getAttribute('lang'),'en');
  }
  assert.equal({}.polluted,undefined);assert.deepEqual(a.calls,[]);a.api.dispose();
});

test('HTML-like dictionary values and placeholder data remain literal text and attributes',async()=>{
  const languages=sampleLocales(),html='<img src=x onerror=alert(1)>';
  languages.fr['Reply']=html;languages.fr['Display Language']='<svg onload=alert(1)>Language</svg>';
  const a=app(languages),dock=a.add(a.document.body,'div',{className:'dock'});
  const reply=a.add(dock,'button',{text:'Reply'}),select=a.add(dock,'select',{attrs:{title:'Display Language'}});
  const hint=a.add(dock,'div',{text:'Replying to '+html});
  await a.language('fr');assert.equal(reply.textContent,html);assert.equal(reply.children.length,0);
  assert.equal(select.getAttribute('title'),'<svg onload=alert(1)>Language</svg>');
  assert.equal(hint.textContent,'Réponse à '+html);assert.equal(hint.children.length,0);
  assert.deepEqual(a.calls,[]);a.api.dispose();
});

test('Missing locale entries and oversized dynamic values retain their English source',async()=>{
  const languages=sampleLocales();delete languages.fr['Messages on Bitcoin.'];delete languages.fr['Connecting to {wallet}…'];
  const a=app(languages);await a.language('fr');
  assert.equal(a.api.t('Messages on Bitcoin.'),'Messages on Bitcoin.');
  assert.equal(a.api.t('Connecting to Xverse…'),'Connecting to Xverse…');
  const oversized='Replying to '+'A'.repeat(513);assert.equal(a.api.t(oversized),oversized);
  assert.equal(a.api.t('Unlisted status: Reply'),'Unlisted status: Reply');
  assert.deepEqual(a.calls,[]);a.api.dispose();
});
