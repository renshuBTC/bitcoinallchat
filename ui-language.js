/* Bundled interface copy: no translation engine or language-pack download. */
(() => {
  'use strict';
  window.BAC_UI_LANGUAGE?.dispose();
  const LOCALES=window.BAC_LOCALES||{en:{}};
  const SCOPES='.info,.dock,#ovl,.msgopts';
  const EXCLUDED='script,style,svg,canvas,code,pre,.txt,.qt,.pay,.reply-excerpt,#reply-excerpt,.att .nm,#m-pool,[translate="no"],[data-no-translate]';
  const ATTRS=['placeholder','title','aria-label'];
  const texts=new WeakMap(),attributes=new WeakMap(),formats=new WeakMap();
  let language='en',observer=null,timer=null,disposed=false;
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
  const patterns=Object.keys(LOCALES.en).filter(key=>key.includes('{')).map(key=>{
    const names=[],pieces=key.split(/(\{[a-z]+\})/g);
    const pattern=pieces.map(piece=>{
      if(/^\{[a-z]+\}$/.test(piece)){names.push(piece.slice(1,-1));return '(.{1,512}?)'}
      return piece.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&').replace(/\s+/g,'\\s+');
    }).join('');
    return {key,names,pattern:new RegExp('^'+pattern+'$','u')};
  });
  function t(value,code=language){
    if(typeof value!=='string'||value.length>4000)return value;
    if(code==='en'||!own(LOCALES,code))return value;
    const pack=own(LOCALES,code)?LOCALES[code]:LOCALES.en;
    const prefix=value.match(/^[\s·]*/)[0],suffix=value.match(/[\s·]*$/)[0];
    const core=value.slice(prefix.length,value.length-suffix.length);
    if(!core)return value;
    const normalized=core.replace(/\s+/g,' ');
    if(own(pack,normalized))return prefix+pack[normalized]+suffix;
    for(const {key,names,pattern} of patterns){
      const match=pattern.exec(core);if(!match)continue;
      const template=pack[key]||LOCALES.en[key],params=Object.fromEntries(names.map((name,i)=>[name,match[i+1]]));
      return prefix+template.replace(/\{([a-z]+)\}/g,(token,name)=>params[name]??token)+suffix;
    }
    // One transaction uses the same number template in bundled languages.
    const transaction=/^(\d[\d,.]*) transaction$/.exec(core);
    if(transaction&&code!=='en')return t(prefix+transaction[1]+' transactions'+suffix,code);
    return value;
  }
  const parent=node=>node.nodeType===1?node:node.parentElement;
  const inScope=node=>!!parent(node)?.closest(SCOPES);
  const excluded=node=>!!parent(node)?.closest(EXCLUDED);
  function entryFor(node,attribute){
    let map=attribute?attributes.get(node):texts;
    if(attribute&&!map){map=new Map();attributes.set(node,map)}
    const key=attribute||node,value=attribute?node.getAttribute(attribute):node.nodeValue;
    let entry=map.get(key);
    if(!entry){entry={node,attribute,source:value,applied:value};map.set(key,entry)}
    else if(value!==entry.applied){entry.source=value;entry.applied=value}
    return entry;
  }
  function write(entry,value){
    entry.applied=value;
    if(entry.attribute){if(entry.node.getAttribute(entry.attribute)!==value)entry.node.setAttribute(entry.attribute,value)}
    else if(entry.node.nodeValue!==value)entry.node.nodeValue=value;
  }
  function format(element,translated){
    const previous=formats.get(element);
    if(!translated){
      if(previous){
        for(const attr of ['lang','dir'])previous[attr]===null?element.removeAttribute(attr):element.setAttribute(attr,previous[attr]);
        element.style.textAlign=previous.align;element.style.unicodeBidi=previous.bidi;formats.delete(element);
      }
      return;
    }
    if(!previous)formats.set(element,{lang:element.getAttribute('lang'),dir:element.getAttribute('dir'),align:element.style.textAlign||'',bidi:element.style.unicodeBidi||''});
    element.setAttribute('lang',language);
    if(!element.children.length){element.setAttribute('dir','auto');element.style.textAlign='start';element.style.unicodeBidi='plaintext'}
  }
  function* nodes(){
    const roots=[...document.querySelectorAll(SCOPES)].filter(root=>!excluded(root)&&!root.parentElement?.closest(SCOPES));
    const stack=roots.reverse();
    while(stack.length){
      const node=stack.pop();
      if(node.nodeType===1){
        if(node.matches(EXCLUDED))continue;
        yield node;
        if(/^(?:INPUT|TEXTAREA|SELECT|OPTION)$/.test(node.tagName))continue;
        for(let i=node.childNodes.length-1;i>=0;i--)stack.push(node.childNodes[i]);
      }else if(node.nodeType===3)yield node;
    }
  }
  function refresh(){
    if(disposed)return;timer=null;
    for(const node of nodes()){
      if(node.nodeType===1){
        format(node,false);
        for(const attribute of ATTRS)if(node.hasAttribute(attribute)){
          const entry=entryFor(node,attribute),translated=t(entry.source);
          write(entry,translated);if(translated!==entry.source)format(node,true);
        }
      }else{
        const entry=entryFor(node),translated=t(entry.source);write(entry,translated);
        if(translated!==entry.source)format(parent(node),true);
      }
    }
  }
  function relevant(record){
    if(!inScope(record.target)||excluded(record.target)){
      return record.type==='childList'&&[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches(SCOPES)||node.querySelector(SCOPES)));
    }
    if(record.type==='characterData')return texts.get(record.target)?.applied!==record.target.nodeValue;
    if(record.type==='attributes')return attributes.get(record.target)?.get(record.attributeName)?.applied!==record.target.getAttribute(record.attributeName);
    return record.type==='childList';
  }
  function observe(){
    if(observer||typeof MutationObserver!=='function')return;
    observer=new MutationObserver(records=>{
      if(!disposed&&records.some(relevant)&&timer===null)timer=setTimeout(refresh,40);
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  }
  function setLanguage(code){
    language=own(LOCALES,code)?code:'en';disposed=false;
    document.documentElement.setAttribute('lang',language);observe();refresh();return language;
  }
  function dispose(){
    if(timer!==null)clearTimeout(timer);timer=null;observer?.disconnect();observer=null;
    language='en';refresh();disposed=true;document.documentElement.setAttribute('lang','en');
  }
  window.BAC_UI_LANGUAGE=Object.freeze({setLanguage,refresh,observe,dispose,t,getLanguage:()=>language});
})();
