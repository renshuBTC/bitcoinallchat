// Exercises the shipped compact menu with the real bundled-copy adapter and no browser/network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const fixture=fs.readFileSync(path.join(__dirname,'ui-language.test.cjs'),'utf8');
const end=fixture.indexOf('\ntest(');assert(end>0);
const {app:createDOM,sampleLocales}=vm.runInNewContext(fixture.slice(0,end)+'\n({app,sampleLocales});',{require,__dirname,console});
const source=fs.readFileSync(path.join(__dirname,'../language-settings.js'),'utf8');
function runtime({saved,storageBlocked=false,native=true,languages=sampleLocales()}={}){
  const a=createDOM(languages),doc=a.document,storage=new Map(),events=new Map(),windowEvents=new Map(),changes=[],storageCalls=[];
  if(saved!==undefined)storage.set('bac_language',saved);
  const Element=doc.body.constructor;
  Object.defineProperty(Element.prototype,'classList',{get(){return {contains:name=>this.className.split(/\s+/).includes(name),
    add:name=>{this.className=(this.className+' '+name).trim()},remove:name=>{this.className=this.className.split(/\s+/).filter(x=>x!==name).join(' ')}}}});
  Element.prototype.append=function(...nodes){for(const node of nodes)this.appendChild(node)};
  Element.prototype.focus=function(){doc.activeElement=this};
  Element.prototype.scrollIntoView=function(){this.scrolled=true};
  Element.prototype.getBoundingClientRect=function(){return this.rect||{left:100,right:320,top:300,bottom:600}};
  doc.addEventListener=(name,handler)=>events.set(name,handler);
  doc.removeEventListener=(name,handler)=>{if(events.get(name)===handler)events.delete(name)};
  a.window.addEventListener=(name,handler)=>windowEvents.set(name,handler);
  a.window.removeEventListener=(name,handler)=>{if(windowEvents.get(name)===handler)windowEvents.delete(name)};
  a.window.innerWidth=390;a.window.innerHeight=700;
  if(!native){delete a.window.Translator;delete a.window.LanguageDetector;delete a.window.BAC_TRANSLATE}
  const info=a.add(doc.body,'aside',{className:'info'}),copy=a.add(info,'p',{text:'Messages on Bitcoin.'});
  const dock=a.add(doc.body,'div',{className:'dock'}),draft=a.add(dock,'textarea',{value:'Unsent 中文 draft',attrs:{placeholder:'Write a message onto Bitcoin…'}});
  const controls=a.add(dock,'div',{className:'language-control'});
  const button=a.add(controls,'button',{id:'languageb',attrs:{title:'Language','aria-expanded':'false','aria-haspopup':'listbox'}});
  button.rect={left:290,right:320,top:600,bottom:630};
  const menu=a.add(controls,'div',{id:'language-menu',className:'language-menu',attrs:{role:'listbox',translate:'no'}});menu.hidden=true;
  const message=a.add(a.add(doc.body,'div',{id:'thread'}),'div',{className:'txt',text:'Messages on Bitcoin.'});
  const overlay=a.add(doc.body,'div',{className:'ov'}),messageMenu=a.add(doc.body,'details',{className:'msgopts'});messageMenu.open=false;
  // The production selector has native [open] support; mirror it for this fixture's property.
  const queryAll=doc.querySelectorAll;doc.querySelectorAll=selector=>selector==='.msgopts[open]'?[messageMenu].filter(node=>node.open):queryAll(selector);
  const ui=a.api;doc.activeElement=button;
  a.window.dispatchEvent=event=>{changes.push({type:event.type,language:ui.getLanguage(),copy:copy.textContent,
    saved:storage.get('bac_language'),pressed:button.getAttribute('aria-pressed')});return true};
  class BrowserEvent{constructor(type){this.type=type}}
  const localStorage={
    getItem(key){storageCalls.push(['get',key]);if(storageBlocked)throw Error('Blocked');return storage.get(key)??null},
    setItem(key,value){storageCalls.push(['set',key,value]);if(storageBlocked)throw Error('Blocked');storage.set(key,value)},
    removeItem(key){storageCalls.push(['remove',key]);if(storageBlocked)throw Error('Blocked');storage.delete(key)}
  };
  vm.runInNewContext(source,{window:a.window,document:doc,localStorage,Event:BrowserEvent,fetch:a.window.fetch});
  const option=code=>menu.children.find(node=>node.dataset.language===code);
  function open(){button.focus();button.onclick()}
  function key(fields={}){
    const event={key:'Escape',prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...fields};
    events.get('keydown')?.(event);return event;
  }
  async function choose(code){if(menu.hidden)open();const node=option(code);node.focus();node.onclick();await a.flush()}
  function outside(target){events.get('click')?.({target})}
  function dispose(){a.window.BAC_LANGUAGE_SETTINGS.dispose();ui.dispose()}
  return {...a,copy,draft,message,button,menu,overlay,messageMenu,storage,storageCalls,changes,events,windowEvents,option,open,key,choose,outside,dispose};
}

test('Default English, legacy off and invalid/prototype preferences use only bundled language choices',()=>{
  for(const saved of [undefined,'off','__proto__','constructor','toString','xx','<img src=x>']){
    const a=runtime({saved});assert.equal(a.api.getLanguage(),'en');assert.equal(a.copy.textContent,'Messages on Bitcoin.');assert(a.menu.hidden);
    assert.deepEqual(Array.from(a.menu.children,node=>node.dataset.language),['en','fr','ar']);
    assert.equal(a.option('en').getAttribute('aria-selected'),'true');assert.equal(a.button.getAttribute('aria-pressed'),'false');
    assert.equal(a.changes.length,1);assert.equal(a.changes[0].type,'bac-language-change');assert.equal(a.calls.length,0);a.dispose();
  }
});
test('Saved choices use native names and open with the current option focused and selected',()=>{
  const languages=sampleLocales();languages['zh-Hant']={...languages.en,'Messages on Bitcoin.':'Bitcoin 上的訊息。'};
  Object.setPrototypeOf(languages,{hidden:{}});const a=runtime({saved:'zh-Hant',languages});
  assert.equal(a.copy.textContent,'Bitcoin 上的訊息。');assert.equal(a.option('zh-Hant').textContent,'繁體中文');
  assert.equal(a.option('fr').textContent,'Français');assert.equal(a.option('ar').textContent,'العربية');assert.equal(a.option('hidden'),undefined);
  a.open();assert(!a.menu.hidden);assert.equal(a.button.getAttribute('aria-expanded'),'true');assert.equal(a.document.activeElement,a.option('zh-Hant'));
  assert.equal(a.option('zh-Hant').getAttribute('aria-selected'),'true');assert.equal(a.option('zh-Hant').tabIndex,0);a.dispose();
});
test('Choosing a language applies immediately, persists, closes the menu and dispatches after updating the UI',async()=>{
  const a=runtime();a.changes.length=0;await a.choose('fr');
  assert.equal(a.copy.textContent,'Des messages sur Bitcoin.');assert.equal(a.draft.getAttribute('placeholder'),'Écrivez un message sur Bitcoin…');
  assert(a.menu.hidden);assert.equal(a.document.activeElement,a.button);assert.equal(a.storage.get('bac_language'),'fr');
  assert.deepEqual(a.changes,[{type:'bac-language-change',language:'fr',copy:'Des messages sur Bitcoin.',saved:'fr',pressed:'true'}]);
  assert.equal(a.document.getElementById('language-apply'),null);assert.equal(a.document.getElementById('ovl'),null);
  assert.equal(a.option('fr').getAttribute('aria-selected'),'true');assert.equal(a.option('en').getAttribute('aria-selected'),'false');
  assert(a.storageCalls.every(call=>call[1]==='bac_language'));assert.equal(a.calls.length,0);a.dispose();
});
test('English restores original UI and removes the preference without changing public messages or drafts',async()=>{
  const a=runtime();await a.choose('ar');await a.choose('en');
  assert.equal(a.copy.textContent,'Messages on Bitcoin.');assert.equal(a.draft.getAttribute('placeholder'),'Write a message onto Bitcoin…');
  assert.equal(a.draft.value,'Unsent 中文 draft');assert.equal(a.message.textContent,'Messages on Bitcoin.');
  assert.equal(a.storage.has('bac_language'),false);assert.equal(a.button.getAttribute('aria-pressed'),'false');assert.equal(a.calls.length,0);a.dispose();
});
test('Blocked storage and browsers without native AI still support immediate language changes',async()=>{
  const a=runtime({saved:'fr',storageBlocked:true,native:false});assert.equal(a.api.getLanguage(),'en');
  await a.choose('ar');assert.equal(a.copy.textContent,'رسائل على Bitcoin.');await a.choose('en');assert.equal(a.copy.textContent,'Messages on Bitcoin.');
  assert.equal(a.window.Translator,undefined);assert.equal(a.window.LanguageDetector,undefined);assert.equal(a.calls.length,0);a.dispose();
});
test('Arrow keys, Home and End move focus without applying a language until an option is chosen',()=>{
  const a=runtime();a.button.focus();assert(a.key({key:'ArrowDown'}).prevented);assert.equal(a.document.activeElement,a.option('en'));
  a.key({key:'ArrowDown'});assert.equal(a.document.activeElement,a.option('fr'));
  a.key({key:'End'});assert.equal(a.document.activeElement,a.option('ar'));a.key({key:'ArrowDown'});assert.equal(a.document.activeElement,a.option('en'));
  a.key({key:'ArrowUp'});assert.equal(a.document.activeElement,a.option('ar'));a.key({key:'Home'});assert.equal(a.document.activeElement,a.option('en'));
  assert.equal(a.api.getLanguage(),'en');assert.equal(a.changes.length,1);assert.equal(a.menu.children.filter(node=>node.tabIndex===0).length,1);a.dispose();
});
test('Typeahead supports native language names while leaving the chosen language unchanged',()=>{
  const a=runtime();a.open();const event=a.key({key:'f'});assert(event.prevented&&event.stopped);assert.equal(a.document.activeElement,a.option('fr'));
  a.key({key:'r'});assert.equal(a.document.activeElement,a.option('fr'));assert.equal(a.api.getLanguage(),'en');a.dispose();
});
test('Escape and Tab close the menu and restore focus while both IME forms are ignored',()=>{
  const a=runtime();a.open();assert.equal(a.key({isComposing:true}).prevented,false);assert.equal(a.key({keyCode:229}).prevented,false);assert(!a.menu.hidden);
  const escaped=a.key();assert(escaped.prevented&&escaped.stopped);assert(a.menu.hidden);assert.equal(a.document.activeElement,a.button);
  a.open();const tab=a.key({key:'Tab'});assert.equal(tab.prevented,false);assert(a.menu.hidden);assert.equal(a.document.activeElement,a.button);assert.equal(a.changes.length,1);a.dispose();
});
test('Outside clicks dismiss the menu without stealing focus from a clicked control',()=>{
  const a=runtime();a.open();a.outside(a.menu.children[0]);assert(!a.menu.hidden);
  a.outside(a.document.body);assert(a.menu.hidden);assert.equal(a.document.activeElement,a.button);
  a.open();a.draft.focus();a.outside(a.draft);assert(a.menu.hidden);assert.equal(a.document.activeElement,a.draft);a.dispose();
});
test('The menu cannot stack over an overlay, closes other message menus and yields to the search shortcut',()=>{
  const a=runtime();a.overlay.classList.add('on');a.open();assert(a.menu.hidden);a.overlay.classList.remove('on');
  a.messageMenu.open=true;a.open();assert(!a.menu.hidden);assert.equal(a.messageMenu.open,false);
  const shortcut=a.key({key:'k',ctrlKey:true});assert(a.menu.hidden);assert.equal(shortcut.prevented,false);a.dispose();
});
test('Positioning keeps the compact menu within viewport edges and uses available vertical space',()=>{
  const a=runtime();a.menu.rect={left:-40,right:180,top:280,bottom:600};a.open();assert.equal(a.menu.style.transform,'translateX(52px)');
  assert.equal(a.menu.style.bottom,'calc(100% + 10px)');assert.equal(a.menu.style.maxHeight,'320px');
  a.button.rect={left:290,right:320,top:20,bottom:50};a.windowEvents.get('resize')();assert.equal(a.menu.style.top,'calc(100% + 10px)');assert.equal(a.menu.style.bottom,'auto');
  a.dispose();
});
test('Disposing an open menu releases listeners and closes the menu',()=>{
  const a=runtime();a.open();a.dispose();assert(a.menu.hidden);assert.equal(a.events.size,0);assert.equal(a.windowEvents.size,0);assert.equal(a.button.onclick,null);
});
