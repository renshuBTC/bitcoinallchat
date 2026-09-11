/* UI translation shares the on-device engine. Original UI strings stay in weak maps. */
(() => {
  'use strict';
  window.BAC_UI_LANGUAGE?.dispose();
  const SCOPES='.info,.dock,#ovp,#ovs,#ovl,.thread .more,.thread .mine-label,.thread .reply-action,.thread .msgopts summary,.thread .fulltext,.thread .payload-nav,.thread .toploader';
  const EXCLUDED='script,style,svg,canvas,code,pre,.it,.txt,.qt,.pay,.reply-excerpt,#reply-excerpt,.att .nm,#m-pool,[translate="no"],[data-no-translate]';
  const ATTRS=['placeholder','title','aria-label'];
  const MAX_TEXT=4000,MAX_OUTPUT=12000,MAX_SEGMENTS=24,MAX_JOBS=160,MAX_VISITED=3000,WORKERS=3,DEBOUNCE=60;
  const texts=new WeakMap(),attributes=new WeakMap(),formats=new WeakMap();
  let language='en',generation=0,observer=null,timer=null,running=false,rescan=false,disposed=false;
  let idle=Promise.resolve(),settle=null;

  const active=()=>language!=='off'&&!/^en(?:-|$)/i.test(language);
  const parent=node=>node.nodeType===1?node:node.parentElement;
  const inScope=node=>!!parent(node)?.closest(SCOPES);
  const excluded=node=>!!parent(node)?.closest(EXCLUDED);
  const currentValue=entry=>entry.attribute?entry.node.getAttribute(entry.attribute):entry.node.nodeValue;
  function sourceEntry(node,attribute){
    let map=attribute?attributes.get(node):texts;
    if(attribute&&!map){map=new Map();attributes.set(node,map)}
    const key=attribute||node,value=attribute?node.getAttribute(attribute):node.nodeValue;
    let entry=map.get(key);
    if(!entry){entry={node,attribute,source:value,applied:value,version:0,attempt:-1,target:''};map.set(key,entry)}
    else if(value!==entry.applied){
      entry.source=value;entry.applied=value;entry.version++;entry.attempt=-1;entry.target='';
    }
    return entry;
  }
  function write(entry,value){
    entry.applied=value;
    if(entry.attribute){
      if(value===null)entry.node.removeAttribute(entry.attribute);
      else if(entry.node.getAttribute(entry.attribute)!==value)entry.node.setAttribute(entry.attribute,value);
    }else if(entry.node.nodeValue!==value)entry.node.nodeValue=value;
  }
  function format(element){
    if(!element||element.nodeType!==1)return;
    let original=formats.get(element);
    if(!original){
      original={lang:element.getAttribute('lang'),dir:element.getAttribute('dir'),
        align:element.style.textAlign||'',bidi:element.style.unicodeBidi||'',setDir:false};
      formats.set(element,original);
    }
    element.setAttribute('lang',language);
    /* A mixed container can be a flex row. Changing its dir would reorder wallets. */
    if(!element.children.length){
      element.setAttribute('dir','auto');
      element.style.textAlign='start';element.style.unicodeBidi='plaintext';original.setDir=true;
    }
  }
  function restoreFormat(element){
    const original=formats.get(element);if(!original)return;
    if(original.lang===null)element.removeAttribute('lang');else element.setAttribute('lang',original.lang);
    if(original.setDir){
      if(original.dir===null)element.removeAttribute('dir');else element.setAttribute('dir',original.dir);
      element.style.textAlign=original.align;element.style.unicodeBidi=original.bidi;
    }
    formats.delete(element);
  }
  function* nodes(){
    const roots=[...document.querySelectorAll(SCOPES)].filter(root=>!excluded(root)&&!root.parentElement?.closest(SCOPES));
    const stack=roots.reverse();let visited=0;
    while(stack.length&&visited++<MAX_VISITED){
      const node=stack.pop();
      if(node.nodeType===1){
        if(node.matches(EXCLUDED))continue;
        yield node;
        /* Form values, signed bytes and native language-option names are not UI copy. */
        if(/^(?:INPUT|TEXTAREA|SELECT|OPTION)$/.test(node.tagName))continue;
        for(let i=node.childNodes.length-1;i>=0;i--)stack.push(node.childNodes[i]);
      }else if(node.nodeType===3)yield node;
    }
  }
  function restore(){
    for(const node of nodes()){
      if(node.nodeType===1){
        restoreFormat(node);
        for(const attribute of ATTRS){
          const entry=attributes.get(node)?.get(attribute);if(!entry)continue;
          sourceEntry(node,attribute);write(entry,entry.source);entry.target='';entry.attempt=-1;
        }
      }else{
        const entry=texts.get(node);if(!entry)continue;
        sourceEntry(node);write(entry,entry.source);entry.target='';entry.attempt=-1;
      }
    }
  }

  function preservedNames(){
    const names=[];
    for(const node of document.querySelectorAll('.att .nm')){
      const name=node.textContent;if(name&&name.length<=512)names.push(name);
      if(names.length===16)break;
    }
    const reply=document.getElementById('reply-name')?.textContent||'';
    if(reply.startsWith('Replying to ')&&reply.length<600)names.push(reply.slice(12));
    return names;
  }
  function protect(value,names){
    if(typeof value!=='string'||value.length>MAX_TEXT||value.includes('__BAC_UI_KEEP_'))return null;
    const core=value.trim();if(!core)return null;
    const leading=value.slice(0,value.indexOf(core)),trailing=value.slice(value.indexOf(core)+core.length);
    const ranges=[],add=(start,end)=>{if(end>start)ranges.push([start,end])};
    const patterns=[
      /https?:\/\/[^\s<>"'…]+|www\.[^\s<>"'…]+/gi,
      /Bitcoin AllChat|Xverse|UniSat|mempool\.space|OP_RETURN|PSBT|BBQr|UTF-8|\bQR\b/g,
      /\bbc1[a-z0-9]+(?:…)?|\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/gi,
      /\b[0-9a-f]{8,64}(?:…|\.\.\.)?\b/gi,
      /@[A-Za-z0-9_]+/g,
      /[$€£¥₿]?[+-]?\d[\d,]*(?:\.\d+)?(?:\s*(?:BTC|USDT|USD|sat\/vB|sats?|vB|[kKMGT]?B|%))?/g,
      /\b(?:BTC|USDT|USD|sat\/vB|sats?|vB|kB|KB|MB|GB|B)\b/g,
      /“[^”]*”/g,
    ];
    for(const pattern of patterns)for(const match of core.matchAll(pattern))add(match.index,match.index+match[0].length);
    for(const name of names){
      let start=0,count=0;
      while(name&&count++<16){const at=core.indexOf(name,start);if(at<0)break;add(at,at+name.length);start=at+name.length}
    }
    ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);
    const merged=[];
    for(const range of ranges){
      const last=merged[merged.length-1];
      if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push(range.slice());
    }
    const saved=[];let source='',unprotected='',at=0;
    for(const [start,end] of merged){
      const piece=core.slice(at,start);source+=piece;unprotected+=piece;
      source+='__BAC_UI_KEEP_'+saved.length+'__';saved.push(core.slice(start,end));at=end;
    }
    source+=core.slice(at);unprotected+=core.slice(at);
    if(!/\p{L}/u.test(unprotected)||source.length>4900)return null;
    return {source,fallback(){
      /* Some local models translate the placeholders themselves. In that case,
         translate only word groups; punctuation and protected values never enter the model. */
      const parts=[leading];let count=0,position=0;
      const gap=text=>{
        let offset=0;
        for(const match of text.matchAll(/[\p{L}\p{M}]+(?:[ \t]+[\p{L}\p{M}]+)*/gu)){
          if(++count>MAX_SEGMENTS)return false;
          parts.push(text.slice(offset,match.index),{source:match[0]});offset=match.index+match[0].length;
        }
        parts.push(text.slice(offset));return true;
      };
      for(const [start,end] of merged){
        if(!gap(core.slice(position,start)))return null;
        parts.push(core.slice(start,end));position=end;
      }
      if(!gap(core.slice(position)))return null;
      parts.push(trailing);return parts;
    },restore(result){
      if(typeof result!=='string'||!result.trim()||result.length>MAX_OUTPUT)return null;
      for(let i=0;i<saved.length;i++){
        const token='__BAC_UI_KEEP_'+i+'__';
        if(result.split(token).length!==2)return null;
      }
      let invalid=false;
      result=result.replace(/__BAC_UI_KEEP_(\d+)__/g,(token,index)=>{
        if(Number(index)>=saved.length){invalid=true;return token}return saved[Number(index)];
      });
      return invalid||result.includes('__BAC_UI_KEEP_')?null:leading+result+trailing;
    }};
  }
  function gather(epoch){
    const jobs=[],names=preservedNames();
    const consider=entry=>{
      if(entry.source===null||entry.attempt===epoch||
        (entry.target===language&&entry.applied!==entry.source))return;
      const prepared=protect(entry.source,names);
      entry.attempt=epoch;
      if(prepared)jobs.push({entry,prepared,version:entry.version,epoch,target:language});
    };
    for(const node of nodes()){
      if(node.nodeType===1){
        for(const attribute of ATTRS)if(node.hasAttribute(attribute)||attributes.get(node)?.has(attribute))consider(sourceEntry(node,attribute));
      }else consider(sourceEntry(node));
      if(jobs.length>=MAX_JOBS)return {jobs,more:true};
    }
    return {jobs,more:false};
  }
  async function translate(job){
    const {entry,prepared,version,epoch,target}=job;
    const valid=()=>!disposed&&epoch===generation&&target===language&&entry.version===version&&entry.node.isConnected;
    const unchanged=()=>{
      if(!valid())return false;
      if(currentValue(entry)===entry.applied)return true;
      schedule(false);return false;
    };
    if(!valid())return;
    let result;
    try{result=await window.BAC_TRANSLATE?.translateUI(prepared.source)}catch{return}
    if(!unchanged()||result===prepared.source)return;
    let output=prepared.restore(result),retry=false;
    if(output===null){
      const parts=prepared.fallback();if(!parts)return;
      let assembled='';
      for(const part of parts){
        if(!unchanged())return;
        if(typeof part==='string'){assembled+=part;continue}
        let translated;
        try{translated=await window.BAC_TRANSLATE?.translateUI(part.source)}catch{return}
        if(!unchanged()||typeof translated!=='string'||translated.length>MAX_OUTPUT||translated.includes('__BAC_UI_KEEP_'))return;
        /* Models sometimes add sentence punctuation to a fragment; keep the source separators. */
        translated=translated.replace(/^[\p{P}\p{S}\s]+/u,'').replace(/[\p{P}\p{S}\s]+$/u,'');
        if(!translated||/[\r\n]/.test(translated))return;
        retry=retry||translated===part.source;assembled+=translated;
        if(assembled.length>MAX_OUTPUT)return;
      }
      output=assembled;
    }
    if(!unchanged()||output.length>MAX_OUTPUT||output===entry.source)return; // Retry on an explicit refresh when the engine becomes ready.
    write(entry,output);entry.target=retry?'':target;format(parent(entry.node));
  }
  async function pump(){
    timer=null;if(running||disposed)return;
    running=true;
    try{
      while(rescan&&!disposed){
        rescan=false;
        if(!active()){restore();break}
        const epoch=generation,{jobs,more}=gather(epoch);if(more)rescan=true;
        let next=0;
        const worker=async()=>{while(next<jobs.length){const job=jobs[next++];await translate(job)}};
        await Promise.all(Array.from({length:Math.min(WORKERS,jobs.length)},worker));
      }
    }finally{
      running=false;
      if(rescan&&!disposed)schedule(false);
      else {const done=settle;settle=null;done?.()}
    }
  }
  function schedule(force){
    if(disposed)return Promise.resolve();
    if(force)generation++;
    rescan=true;
    if(!settle)idle=new Promise(resolve=>{settle=resolve});
    if(!running&&!timer)timer=setTimeout(pump,DEBOUNCE);
    return idle;
  }
  function relevant(record){
    if(record.type==='childList'){
      if(inScope(record.target)&&!excluded(record.target))return true;
      return [...record.addedNodes].some(node=>node.nodeType===1&&(node.matches(SCOPES)||node.querySelector(SCOPES)));
    }
    if(!inScope(record.target)||excluded(record.target))return false;
    if(record.type==='characterData'){
      const entry=texts.get(record.target);return !entry||record.target.nodeValue!==entry.applied;
    }
    const entry=attributes.get(record.target)?.get(record.attributeName);
    return !entry||record.target.getAttribute(record.attributeName)!==entry.applied;
  }
  function observe(){
    disposed=false;
    if(!observer&&typeof MutationObserver==='function'&&document.body){
      observer=new MutationObserver(records=>{
        if(records.length>500||records.some(relevant))schedule(false);
      });
      observer.observe(document.body,{subtree:true,childList:true,characterData:true,
        attributes:true,attributeFilter:ATTRS});
    }
  }
  function setLanguage(code){
    const next=String(code||'en').trim().toLowerCase();
    const target=next==='off'||/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/.test(next)?next:'en';
    observe();
    if(target!==language){generation++;restore();language=target}
    document.documentElement.setAttribute('lang',language==='off'?'en':language);
    if(!active())restore();
    return schedule(true);
  }
  function refresh(){return schedule(true)}
  function dispose(){
    generation++;observer?.disconnect();observer=null;
    if(timer)clearTimeout(timer);timer=null;rescan=false;
    restore();language='en';disposed=true;
    document.documentElement.setAttribute('lang','en');
    const done=settle;settle=null;done?.();
  }
  window.BAC_UI_LANGUAGE=Object.freeze({setLanguage,refresh,observe,dispose});
})();
