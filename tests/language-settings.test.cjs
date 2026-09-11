// Integrates the shipped language settings with the actual bundled-copy adapter.
// The shared DOM fixture supplies static dictionaries and traps native/network calls.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const fixture=fs.readFileSync(path.join(__dirname,'ui-language.test.cjs'),'utf8');
const fixtureEnd=fixture.indexOf('\ntest(');assert(fixtureEnd>0);
const {app:createDOM,sampleLocales}=vm.runInNewContext(fixture.slice(0,fixtureEnd)+'\n({app,sampleLocales});',{require,__dirname,console});
const settingsSource=fs.readFileSync(path.join(__dirname,'../language-settings.js'),'utf8');
function runtime({saved,native=true,storageBlocked=false,languages=sampleLocales()}={}){
  const a=createDOM(languages),doc=a.document,log=[],storage=new Map(),storageCalls=[],events=new Map(),changes=[];
  if(saved!==undefined)storage.set('bac_language',saved);
  const Element=doc.body.constructor;
  Object.defineProperty(Element.prototype,'classList',{get(){return {contains:name=>this.className.split(/\s+/).includes(name),
    add:name=>{if(!this.className.split(/\s+/).includes(name))this.className=(this.className+' '+name).trim()},
    remove:name=>{this.className=this.className.split(/\s+/).filter(value=>value!==name).join(' ')}}}});
  Element.prototype.append=function(...nodes){for(const node of nodes)this.appendChild(node)};
  Element.prototype.focus=function(){doc.activeElement=this};
  Element.prototype.addEventListener=function(name,handler){this.listeners||=new Map();this.listeners.set(name,handler)};
  doc.addEventListener=(name,handler)=>events.set(name,handler);
  if(!native){delete a.window.Translator;delete a.window.LanguageDetector;delete a.window.BAC_TRANSLATE}
  const ui=a.window.BAC_UI_LANGUAGE;
  a.window.BAC_UI_LANGUAGE={...ui,setLanguage(value){log.push(['ui-language',value]);return ui.setLanguage(value)}};
  const info=a.add(doc.body,'aside',{className:'info'}),copy=a.add(info,'p',{text:'Messages on Bitcoin.'});
  const languageButton=a.add(info,'button',{id:'languageb',attrs:{title:'Language'}});
  const dock=a.add(doc.body,'div',{className:'dock'});
  const draft=a.add(dock,'textarea',{id:'q',value:'Unsent 中文 draft',attrs:{placeholder:'Write a message onto Bitcoin…'}});
  const thread=a.add(doc.body,'div',{id:'thread'}),message=a.add(thread,'div',{className:'txt',text:'Messages on Bitcoin.'});
  const modal=a.add(doc.body,'div',{id:'ovl'});
  a.add(modal,'button',{id:'language-close',text:'Close'});
  const select=a.add(modal,'select',{id:'language-select',attrs:{translate:'no'}});
  a.add(modal,'div',{id:'language-status'});
  a.add(modal,'button',{id:'language-apply',text:'Apply Language'});
  doc.activeElement=languageButton;
  a.window.dispatchEvent=event=>{
    log.push(['dispatch',event.type]);changes.push({type:event.type,language:ui.getLanguage(),copy:copy.textContent,
      saved:storage.get('bac_language'),pressed:languageButton.getAttribute('aria-pressed')});return true;
  };
  class BrowserEvent{constructor(type){this.type=type}}
  const localStorage={
    getItem(key){storageCalls.push(['get',key]);if(storageBlocked)throw Error('Storage blocked');return storage.get(key)??null},
    setItem(key,value){storageCalls.push(['set',key,value]);if(storageBlocked)throw Error('Storage blocked');storage.set(key,value)},
    removeItem(key){storageCalls.push(['remove',key]);if(storageBlocked)throw Error('Storage blocked');storage.delete(key)}
  };
  vm.runInNewContext(settingsSource,{window:a.window,document:doc,localStorage,Event:BrowserEvent,fetch:a.window.fetch},{filename:'shipped-language-settings.js'});
  const element=id=>doc.getElementById(id);
  function click(id){const node=element(id);node.focus();return node.onclick?.({target:node})}
  function key(options={}){
    const event={key:'Escape',prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...options};
    events.get('keydown')(event);return event;
  }
  async function apply(code){select.value=code;click('language-apply');await a.flush()}
  function dispose(){ui.dispose()}
  return {...a,element,select,modal,copy,draft,message,languageButton,storage,storageCalls,log,changes,click,key,apply,dispose};
}

test('English is the default; legacy off and invalid or prototype-named preferences safely use English',()=>{
  for(const saved of [undefined,'off','__proto__','constructor','toString','xx','<img src=x>']){
    const a=runtime({saved});
    assert.equal(a.select.value,'en',String(saved));assert.equal(a.api.getLanguage(),'en');assert.equal(a.copy.textContent,'Messages on Bitcoin.');
    assert.equal(a.languageButton.getAttribute('aria-pressed'),'false');
    assert.deepEqual(Array.from(a.select.children,option=>option.value),['en','fr','ar']);
    assert.equal(a.select.children.some(option=>option.value==='off'),false);
    assert.equal(a.changes.length,1);assert.equal(a.changes[0].type,'bac-language-change');assert.equal(a.changes[0].language,'en');
    assert.equal(a.calls.length,0);a.dispose();
  }
});

test('Only bundled languages are offered and valid saved choices load with readable native language names',()=>{
  const languages=sampleLocales();
  languages['zh-Hant']={...languages.en,'Messages on Bitcoin.':'Bitcoin 上的訊息。'};
  Object.setPrototypeOf(languages,{inherited:{'Messages on Bitcoin.':'Must not be used'}});
  const a=runtime({saved:'zh-Hant',languages});
  assert.equal(a.select.value,'zh-Hant');assert.equal(a.api.getLanguage(),'zh-Hant');assert.equal(a.copy.textContent,'Bitcoin 上的訊息。');
  assert.equal(a.select.children.find(option=>option.value==='zh-Hant').textContent,'繁體中文');
  assert.equal(a.select.children.find(option=>option.value==='fr').textContent,'Français');
  assert.equal(a.select.children.find(option=>option.value==='ar').textContent,'العربية');
  assert.equal(a.select.children.some(option=>option.value==='inherited'),false);
  assert.equal(a.storage.get('bac_language'),'zh-Hant');assert.equal(a.languageButton.getAttribute('aria-pressed'),'true');
  assert.equal(a.changes[0].copy,'Bitcoin 上的訊息。');assert.equal(a.calls.length,0);a.dispose();
});

test('Apply saves the code and dispatches a change only after the interface and pressed state update',async()=>{
  const a=runtime();a.log.length=0;a.changes.length=0;
  await a.apply('fr');
  assert.equal(a.storage.get('bac_language'),'fr');assert.equal(a.copy.textContent,'Des messages sur Bitcoin.');
  assert.equal(a.draft.getAttribute('placeholder'),'Écrivez un message sur Bitcoin…');
  assert.equal(a.languageButton.getAttribute('aria-pressed'),'true');
  assert.deepEqual(a.log,[['ui-language','fr'],['dispatch','bac-language-change']]);
  assert.deepEqual(a.changes,[{type:'bac-language-change',language:'fr',copy:'Des messages sur Bitcoin.',saved:'fr',pressed:'true'}]);
  assert.equal(a.element('language-status').textContent,'Language saved.');
  assert(a.storageCalls.every(call=>call[1]==='bac_language'));assert.equal(a.calls.length,0);a.dispose();
});

test('Unconfirmed or manipulated select values cannot persist, change the interface or dispatch a change',async()=>{
  const a=runtime({saved:'fr'});a.changes.length=0;
  for(const code of ['__proto__','constructor','off','xx','<script>']){
    await a.apply(code);
    assert.equal(a.storage.get('bac_language'),'fr');assert.equal(a.api.getLanguage(),'fr');
    assert.equal(a.copy.textContent,'Des messages sur Bitcoin.');assert.equal(a.changes.length,0);
  }
  a.click('languageb');assert.equal(a.select.value,'fr');a.dispose();
});

test('Bundled languages apply without native support, language packs, translation notices or network requests',async()=>{
  const a=runtime({native:false});
  assert.equal(a.window.Translator,undefined);assert.equal(a.window.LanguageDetector,undefined);assert.equal(a.window.BAC_TRANSLATE,undefined);
  await a.apply('ar');assert.equal(a.copy.textContent,'رسائل على Bitcoin.');assert.equal(a.api.getLanguage(),'ar');
  assert.equal(a.element('translation-notice'),null);assert.equal(a.element('translation-enable'),null);assert.equal(a.element('language-enable'),null);
  assert.equal(a.message.textContent,'Messages on Bitcoin.');assert.equal(a.draft.value,'Unsent 中文 draft');
  assert.equal(a.calls.length,0);a.dispose();
});

test('Choosing English removes the saved preference and restores source text without changing messages or drafts',async()=>{
  const a=runtime();await a.apply('fr');assert.equal(a.copy.textContent,'Des messages sur Bitcoin.');
  await a.apply('en');
  assert.equal(a.copy.textContent,'Messages on Bitcoin.');assert.equal(a.draft.getAttribute('placeholder'),'Write a message onto Bitcoin…');
  assert.equal(a.draft.value,'Unsent 中文 draft');assert.equal(a.message.textContent,'Messages on Bitcoin.');
  assert.equal(a.storage.has('bac_language'),false);assert.equal(a.languageButton.getAttribute('aria-pressed'),'false');assert.equal(a.api.getLanguage(),'en');
  assert.deepEqual(a.changes.at(-1),{type:'bac-language-change',language:'en',copy:'Messages on Bitcoin.',saved:undefined,pressed:'false'});
  assert.equal(a.calls.length,0);a.dispose();
});

test('Blocked storage still permits immediate language switching and English restoration',async()=>{
  const a=runtime({saved:'fr',storageBlocked:true});assert.equal(a.select.value,'en');
  await a.apply('ar');assert.equal(a.copy.textContent,'رسائل على Bitcoin.');assert.equal(a.api.getLanguage(),'ar');
  await a.apply('en');assert.equal(a.copy.textContent,'Messages on Bitcoin.');assert.equal(a.api.getLanguage(),'en');
  assert.equal(a.draft.value,'Unsent 中文 draft');assert.equal(a.changes.length,3);assert.equal(a.calls.length,0);a.dispose();
});

test('Escape respects both IME signals, discards unconfirmed choices and restores focus',()=>{
  const a=runtime({saved:'fr'});a.click('languageb');assert(a.modal.classList.contains('on'));assert.equal(a.document.activeElement,a.select);
  a.select.value='ar';const composing=a.key({isComposing:true}),keyCode=a.key({keyCode:229});
  assert(a.modal.classList.contains('on'));assert.equal(composing.prevented,false);assert.equal(keyCode.prevented,false);
  const escaped=a.key();assert.equal(a.modal.classList.contains('on'),false);assert.equal(a.document.activeElement,a.languageButton);
  assert(escaped.prevented&&escaped.stopped);assert.equal(a.storage.get('bac_language'),'fr');assert.equal(a.api.getLanguage(),'fr');assert.equal(a.changes.length,1);
  a.click('languageb');assert.equal(a.select.value,'fr');a.click('language-close');assert.equal(a.document.activeElement,a.languageButton);
  const closed=a.key();assert.equal(closed.prevented,false);a.dispose();
});

test('Tab navigation wraps within enabled visible controls and ordinary focus movement remains unhandled',()=>{
  const a=runtime();a.click('languageb');
  const hidden=a.add(a.modal,'button',{text:'Hidden'});hidden.hidden=true;
  const disabled=a.add(a.modal,'button',{text:'Disabled'});disabled.disabled=true;
  a.element('language-apply').focus();const forward=a.key({key:'Tab'});assert(forward.prevented);assert.equal(a.document.activeElement,a.element('language-close'));
  const backward=a.key({key:'Tab',shiftKey:true});assert(backward.prevented);assert.equal(a.document.activeElement,a.element('language-apply'));
  a.select.focus();assert.equal(a.key({key:'Tab'}).prevented,false);assert.equal(a.key({key:'Tab',shiftKey:true}).prevented,false);
  a.dispose();
});

test('Only a backdrop click closes the dialog, and reopening restores the last applied language',async()=>{
  const a=runtime();a.click('languageb');await a.apply('ar');assert(a.modal.classList.contains('on'));
  a.modal.listeners.get('click')({target:a.select});assert(a.modal.classList.contains('on'));
  a.select.value='fr';a.modal.listeners.get('click')({target:a.modal});assert.equal(a.modal.classList.contains('on'),false);assert.equal(a.document.activeElement,a.languageButton);
  a.click('languageb');assert.equal(a.select.value,'ar');assert.equal(a.storage.get('bac_language'),'ar');assert.equal(a.changes.length,2);a.dispose();
});
