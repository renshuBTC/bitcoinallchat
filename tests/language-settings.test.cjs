// Integrates the shipped settings, UI adapter and native-translation controller.
// Reuse the existing DOM double so restoration is exercised by the real UI adapter.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const fixture=fs.readFileSync(path.join(__dirname,'ui-language.test.cjs'),'utf8');
const fixtureEnd=fixture.indexOf('\ntest(');assert(fixtureEnd>0);
const createDOM=vm.runInNewContext(fixture.slice(0,fixtureEnd)+'\napp;', {require,__dirname,console});
const engineSource=fs.readFileSync(path.join(__dirname,'../translate.js'),'utf8');
const settingsSource=fs.readFileSync(path.join(__dirname,'../language-settings.js'),'utf8');
function runtime({saved,native=true,storageBlocked=false}={}){
  const a=createDOM(),doc=a.document,log=[],storage=new Map(),events=new Map();let gesture=false;
  if(saved!==undefined)storage.set('bac_language',saved);
  const Element=doc.body.constructor;
  Object.defineProperty(Element.prototype,'classList',{get(){return {contains:name=>this.className.split(/\s+/).includes(name),
    add:name=>{if(!this.className.split(/\s+/).includes(name))this.className=(this.className+' '+name).trim()},
    remove:name=>{this.className=this.className.split(/\s+/).filter(x=>x!==name).join(' ')}}}});
  Element.prototype.append=function(...nodes){for(const node of nodes)this.appendChild(node)};
  Element.prototype.focus=function(){doc.activeElement=this};
  Element.prototype.addEventListener=function(name,handler){this.listeners||=new Map();this.listeners.set(name,handler)};
  doc.createElement=tag=>new Element(tag);doc.addEventListener=(name,handler)=>events.set(name,handler);
  a.window.addEventListener=()=>{};a.window.removeEventListener=()=>{};
  if(native){
    a.window.LanguageDetector={availability:async()=> 'downloadable',create(){log.push(['detector-create',gesture]);return Promise.resolve({detect:async()=>[{detectedLanguage:'en',confidence:1}],destroy(){}})}};
    a.window.Translator={availability:async()=> 'downloadable',create(options){log.push(['pair-create',gesture,options.sourceLanguage,options.targetLanguage]);return Promise.resolve({translate:async text=>options.targetLanguage+': '+text,destroy(){}})}};
  }
  const scope=vm.createContext({window:a.window,document:doc,AbortController,DOMException,queueMicrotask,console,setTimeout,clearTimeout,
    localStorage:{getItem:key=>{if(storageBlocked)throw new Error('Storage blocked');return storage.get(key)||null},
      setItem:(key,value)=>{if(storageBlocked)throw new Error('Storage blocked');storage.set(key,value)},
      removeItem:key=>{if(storageBlocked)throw new Error('Storage blocked');storage.delete(key)}}});
  delete a.window.BAC_TRANSLATE;
  vm.runInContext(engineSource,scope,{filename:'shipped-translate.js'});const actual=a.window.BAC_TRANSLATE;
  a.window.BAC_TRANSLATE={...actual,configure(value,options){log.push(['configure',value]);return actual.configure(value,options)},
    enableFromGesture(){log.push(['enable',gesture]);return actual.enableFromGesture()}};
  const ui=a.window.BAC_UI_LANGUAGE;
  a.window.BAC_UI_LANGUAGE={...ui,setLanguage(value){log.push(['ui-language',value]);return ui.setLanguage(value)}};
  const info=a.add(doc.body,'aside',{className:'info'}),copy=a.add(info,'p',{text:'Messages on Bitcoin.'});
  const languageButton=a.add(info,'button',{id:'languageb',attrs:{title:'Language'}});
  const dock=a.add(doc.body,'div',{className:'dock'}),draft=a.add(dock,'textarea',{id:'q',value:'Unsent 中文 draft',attrs:{placeholder:'Write a message'}});
  const notice=a.add(dock,'div',{id:'translation-notice'});notice.hidden=true;
  a.add(notice,'span',{id:'translation-notice-text'});a.add(notice,'button',{id:'translation-enable',text:'Enable Translation'});
  const modal=a.add(doc.body,'div',{id:'ovl'});a.add(modal,'button',{id:'language-close',text:'Close'});
  const select=a.add(modal,'select',{id:'language-select',attrs:{translate:'no'}});
  a.add(modal,'div',{id:'language-status',attrs:{translate:'no'}});
  a.add(modal,'button',{id:'language-apply',text:'Apply Language'});
  const enable=a.add(modal,'button',{id:'language-enable',text:'Enable Translation'});enable.hidden=true;
  a.add(doc.body,'div',{id:'thread',className:'thread'});doc.activeElement=languageButton;
  vm.runInContext(settingsSource,scope,{filename:'shipped-language-settings.js'});
  const element=id=>doc.getElementById(id);
  function click(id){const node=element(id);node.focus();gesture=true;try{return node.onclick?.({target:node})}finally{gesture=false}}
  function key(options){const event={key:'Escape',prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...options};events.get('keydown')(event);return event}
  async function apply(code){select.value=code;click('language-apply');await a.flush()}
  function dispose(){actual.dispose();ui.dispose()}
  return {...a,actual,element,select,modal,copy,draft,languageButton,storage,log,click,key,apply,dispose};
}

test('Only allowlisted stored language codes are restored; native option names remain unchanged',async()=>{
  const invalid=runtime({saved:'__proto__'});assert.equal(invalid.select.value,'off');assert.equal(invalid.select.children.length,40);assert.equal(invalid.log.some(item=>item[0]==='enable'),false);invalid.dispose();
  const valid=runtime({saved:'zh-Hant'});assert.equal(valid.select.value,'zh-Hant');assert.equal(valid.storage.get('bac_language'),'zh-Hant');
  assert.equal(valid.select.children.find(option=>option.value==='zh-Hant').textContent,'繁體中文');assert.equal(valid.log.some(item=>item[0]==='enable'),false);valid.dispose();
});
test('Apply persists the selected code and creates models during the click before UI translation starts',async()=>{
  const a=runtime();a.log.length=0;a.select.value='ja';a.click('language-apply');
  assert.equal(a.storage.get('bac_language'),'ja');assert.deepEqual(a.log.slice(0,5),[['configure','ja'],['enable',true],['detector-create',true],['pair-create',true,'en','ja'],['ui-language','ja']]);
  await a.flush();assert.equal(a.copy.textContent,'ja: Messages on Bitcoin.');assert.equal(a.languageButton.getAttribute('aria-pressed'),'true');a.dispose();
});
test('Unsupported browsers show a language notice and retain the original interface',async()=>{
  const a=runtime({native:false});await a.apply('ar');assert.equal(a.actual.getState().state,'unsupported');
  assert.equal(a.copy.textContent,'Messages on Bitcoin.');assert.equal(a.element('translation-notice').hidden,false);
  assert.match(a.element('translation-notice-text').textContent,/unavailable in this browser/);assert.equal(a.element('translation-enable').textContent,'Language');
  a.click('translation-enable');assert(a.modal.classList.contains('on'));a.dispose();
});
test('Choosing Original restores translated text and placeholders without changing the draft',async()=>{
  const a=runtime();await a.apply('fr');assert.equal(a.copy.textContent,'fr: Messages on Bitcoin.');assert.equal(a.draft.getAttribute('placeholder'),'fr: Write a message');
  await a.apply('off');assert.equal(a.copy.textContent,'Messages on Bitcoin.');assert.equal(a.draft.getAttribute('placeholder'),'Write a message');assert.equal(a.draft.value,'Unsent 中文 draft');
  assert.equal(a.storage.has('bac_language'),false);assert.equal(a.languageButton.getAttribute('aria-pressed'),'false');assert.equal(a.element('translation-notice').hidden,true);a.dispose();
});
test('Escape closes the modal without applying an unconfirmed selection and restores focus',()=>{
  const a=runtime();a.click('languageb');assert(a.modal.classList.contains('on'));assert.equal(a.document.activeElement,a.select);a.select.value='ja';
  const composing=a.key({isComposing:true});assert(a.modal.classList.contains('on'));assert.equal(composing.prevented,false);
  const escaped=a.key({});assert.equal(a.modal.classList.contains('on'),false);assert.equal(a.document.activeElement,a.languageButton);assert(escaped.prevented&&escaped.stopped);assert.equal(a.storage.has('bac_language'),false);
  a.click('languageb');assert.equal(a.select.value,'off');a.dispose();
});
test('Modal Tab navigation wraps between enabled controls and excludes hidden download actions',()=>{
  const a=runtime();a.click('languageb');a.element('language-apply').focus();const forward=a.key({key:'Tab'});assert(forward.prevented);assert.equal(a.document.activeElement,a.element('language-close'));
  const backward=a.key({key:'Tab',shiftKey:true});assert(backward.prevented);assert.equal(a.document.activeElement,a.element('language-apply'));a.dispose();
});
test('Blocked browser storage does not prevent selecting or disabling translation',async()=>{
  const a=runtime({storageBlocked:true});await a.apply('ja');assert.equal(a.copy.textContent,'ja: Messages on Bitcoin.');await a.apply('off');assert.equal(a.copy.textContent,'Messages on Bitcoin.');a.dispose();
});
