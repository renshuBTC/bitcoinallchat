/* On-device translation only. Originals, drafts and transaction data stay intact. */
(() => {
  'use strict';
  window.BAC_TRANSLATE?.dispose();

  const LANGUAGES=Object.freeze('ar bg bn cs da de el en es fi fr he hi hr hu id it ja kn ko lt mr nl no pl pt ro ru sk sl sv ta te th tr uk vi zh zh-Hant'.split(' '));
  const MAX_TEXT=5000,MAX_CACHE=200,MAX_CACHE_BYTES=2000000,MAX_SESSIONS=6,MAX_WORKERS=2,MAX_QUEUE=500;
  const MODEL_STALL_MS=90000,OPERATION_TIMEOUT_MS=20000;
  const MODEL_STALLED='Language download stalled. Try again in a supported desktop browser.';
  const OPERATION_STALLED='On-device translation stalled. Try again in a supported desktop browser.';
  const DEFAULT_LABELS={translated:'Auto-translated',enable:'Enable translation to download this language.',preparing:'Preparing translation…',
    long:'Translation is limited to 5,000 characters. The original is shown.',unavailable:'Translation is unavailable for this language.',
    failed:'Translation could not be completed. The original is shown.'};
  let target=null,generation=0,disposed=false,root=null,io=null,mo=null,observerVersion=0,refreshPending=false;
  let detector=null,detectorTask=null,detectorController=null,detectorNeeded=false,active=0,cacheBytes=0;
  let callback=null,labels={...DEFAULT_LABELS},lastError='',status={state:'off',message:'Translation is off.'};
  let deferredCount=0,deferredCursor=null,deferredRetryPending=false;
  let operationBlocked=false;
  const nodes=new Map(),cache=new Map(),sessions=new Map(),creating=new Map(),pendingPairs=new Map();
  const jobs=[],running=new Set(),uiPending=new Map();

  const supported=()=>typeof window.Translator?.create==='function'&&typeof window.Translator?.availability==='function'&&
    typeof window.LanguageDetector?.create==='function'&&typeof window.LanguageDetector?.availability==='function';
  function language(value){
    const text=String(value||'').trim();if(!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(text))return null;
    if(/^zh-(?:tw|hk|mo|hant)(?:-|$)/i.test(text))return 'zh-Hant';
    if(/^zh(?:-|$)/i.test(text))return 'zh';
    const base=text.split('-')[0].toLowerCase();return base==='nb'?'no':base;
  }
  function emit(state,message,extra={}){
    const next={state,message,...extra};if(JSON.stringify(next)===JSON.stringify(status))return;
    status=next;try{callback?.({...status})}catch{}
  }
  function neededPairKeys(){
    const keys=new Set();if(target&&target!=='en')keys.add('en>'+target);
    for(const info of nodes.values())if(info.visible){const key=info.pair||info.job?.pair;if(key)keys.add(key)}
    return keys;
  }
  function publish(){
    if(!target||disposed)return emit('off','Translation is off.');
    if(!supported())return emit('unsupported','On-device translation is unavailable in this browser.');
    if(detectorTask||creating.size)return emit('preparing','Preparing on-device translation.');
    if(lastError)return emit('error',lastError);
    if(detectorNeeded||[...neededPairKeys()].some(key=>pendingPairs.has(key)))return emit('download-needed','Enable translation to download the needed language packs.');
    emit('ready','On-device translation is ready.');
  }
  function putCache(key,value){
    const size=(key.length+(value.text?.length||0)+(value.source?.length||0))*2;
    if(size>MAX_CACHE_BYTES)return;
    if(cache.has(key)){cacheBytes-=cache.get(key).size;cache.delete(key)}
    cache.set(key,{value,size});cacheBytes+=size;
    while(cache.size>MAX_CACHE||cacheBytes>MAX_CACHE_BYTES){const first=cache.keys().next().value;cacheBytes-=cache.get(first).size;cache.delete(first)}
  }
  function getCache(key){const entry=cache.get(key);if(!entry)return null;cache.delete(key);cache.set(key,entry);return entry.value}
  const abortError=()=>new DOMException('Translation cancelled.','AbortError');
  function abortable(promise,signal){
    return new Promise((resolve,reject)=>{
      const finish=(fn,value)=>{signal.removeEventListener('abort',cancel);fn(value)};
      const cancel=()=>finish(reject,abortError());
      Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
      if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
    });
  }
  function createWithWatchdog(factory,controller,kind,token){
    return new Promise((resolve,reject)=>{
      let done=false,timer=null,progress=-1;
      const finish=(error,value)=>{
        if(done)return;done=true;clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);
        error?reject(error):resolve(value);
      };
      const cancel=()=>finish(abortError());
      const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{
        finish(new DOMException(MODEL_STALLED,'TimeoutError'));controller.abort();
      },MODEL_STALL_MS)};
      const advanced=value=>{if(done)return false;if(value>progress){progress=value;arm()}return true};
      if(controller.signal.aborted){cancel();return}
      controller.signal.addEventListener('abort',cancel,{once:true});arm();
      let attempt;try{attempt=factory(monitor(kind,token,advanced))}catch(error){attempt=Promise.reject(error)}
      Promise.resolve(attempt).then(value=>{
        if(done){try{value?.destroy?.()}catch{}return}finish(null,value);
      },error=>finish(error));
    });
  }
  async function operation(factory,signal){
    const controller=new AbortController();let timedOut=false;
    const cancel=()=>controller.abort();
    if(signal.aborted)throw abortError();signal.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},OPERATION_TIMEOUT_MS);
    try{return await abortable(factory(controller.signal),controller.signal)}
    catch(error){
      if(timedOut){operationBlocked=true;lastError=OPERATION_STALLED;publish();throw new DOMException(OPERATION_STALLED,'TimeoutError')}
      throw error;
    }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel)}
  }
  function current(job){return !disposed&&job.generation===generation&&!job.controller.signal.aborted&&target===job.target}
  function cacheSession(key,session){
    const entry={session,users:0};sessions.set(key,entry);trimSessions();return entry;
  }
  function trimSessions(){
    for(const [key,entry] of sessions){
      if(sessions.size<=MAX_SESSIONS)break;
      if(!entry.users){sessions.delete(key);try{entry.session.destroy()}catch{}}
    }
  }
  function touchSession(key){const entry=sessions.get(key);if(entry){sessions.delete(key);sessions.set(key,entry)}return entry}
  function monitor(kind,token,onProgress){return m=>m.addEventListener('downloadprogress',event=>{
    if(disposed||!target||(kind==='pair'&&token!==generation))return;
    const ratio=event.total?event.loaded/event.total:event.loaded;
    const progress=Math.max(0,Math.min(1,Number(ratio)||0));if(onProgress?.(progress)===false)return;
    emit('preparing','Downloading on-device language resources.',{progress});
  })}
  function wakeVisible(){
    if(disposed)return;
    for(const info of nodes.values())if(info.visible&&(info.state==='waiting'||info.state==='error')){info.state='idle';enqueueBubble(info)}
    pump();publish();
  }
  function createDetector(){
    if(detector)return Promise.resolve(detector);if(detectorTask)return detectorTask;
    detectorNeeded=false;const controller=new AbortController();detectorController=controller;
    const attempt=createWithWatchdog(monitor=>window.LanguageDetector.create({signal:controller.signal,monitor}),controller,'detector',generation);
    const task=Promise.resolve(attempt).then(value=>{
      if(disposed||controller.signal.aborted||detectorController!==controller){value.destroy?.();return null}detector=value;return value;
    }).catch(error=>{
      if(error.name==='TimeoutError'||(!controller.signal.aborted&&error.name!=='AbortError')){
        detectorNeeded=true;lastError=error.name==='NotAllowedError'?'':error.name==='TimeoutError'?MODEL_STALLED:'Language detection could not be prepared.';
      }return null;
    }).finally(()=>{if(detectorTask===task){detectorTask=null;wakeVisible()}});
    detectorTask=task;publish();return task;
  }
  async function getDetector(job){
    if(detector)return detector;if(detectorTask)return null;
    if(detectorNeeded)return null;
    const availability=await operation(()=>window.LanguageDetector.availability(),job.controller.signal);
    if(!current(job))throw abortError();
    if(availability==='unavailable')return null;
    if(availability==='available'){createDetector();return null}
    detectorNeeded=true;publish();return null;
  }
  function createPair(source,to){
    const key=source+'>'+to;if(sessions.has(key))return Promise.resolve(touchSession(key));if(creating.has(key))return creating.get(key).promise;
    const token=generation,controller=new AbortController();pendingPairs.delete(key);
    const attempt=createWithWatchdog(monitor=>window.Translator.create({sourceLanguage:source,targetLanguage:to,signal:controller.signal,monitor}),controller,'pair',token);
    const task={controller,promise:null};creating.set(key,task);
    task.promise=Promise.resolve(attempt).then(session=>{
      if(disposed||token!==generation||to!==target){session.destroy?.();return null}
      return cacheSession(key,session);
    }).catch(error=>{
      if(!disposed&&token===generation&&error.name!=='AbortError'){
        pendingPairs.set(key,{source,target:to});
        if(error.name!=='NotAllowedError')lastError=error.name==='TimeoutError'?MODEL_STALLED:error.name==='NotSupportedError'?'This language pair is unavailable.':'A language pack could not be prepared.';
      }return null;
    }).finally(()=>{if(creating.get(key)===task)creating.delete(key);wakeVisible()});
    publish();return task.promise;
  }
  async function getPair(source,job){
    const key=source+'>'+job.target;job.pair=key;
    const existing=touchSession(key);if(existing)return existing;
    if(creating.has(key))return job.info?null:abortable(creating.get(key).promise,job.controller.signal);
    if(pendingPairs.has(key))return null;
    const availability=await operation(()=>window.Translator.availability({sourceLanguage:source,targetLanguage:job.target}),job.controller.signal);
    if(!current(job))throw abortError();
    if(availability==='unavailable')return false;
    if(availability==='available'){
      const preparation=createPair(source,job.target);return job.info?null:abortable(preparation,job.controller.signal);
    }
    pendingPairs.set(key,{source,target:job.target});publish();return null;
  }
  async function translateText(job){
    const key=job.target+'\0'+(job.source||'auto')+'\0'+job.text,hit=getCache(key);if(hit)return hit;
    if(operationBlocked)return {kind:'error'};
    let source=job.source||job.info?.source;
    if(!source){
      const localDetector=await getDetector(job)||detector;
      if(!localDetector)return {kind:detectorNeeded||detectorTask?'waiting':'unavailable',waitingFor:'detector',preparing:!!detectorTask};
      const results=await operation(signal=>localDetector.detect(job.text,{signal}),job.controller.signal);
      if(!current(job))throw abortError();
      const best=Array.isArray(results)?results[0]:null;
      if(!best||Number(best.confidence)<0.65||best.detectedLanguage==='und'){
        const original={kind:'original'};putCache(key,original);return original;
      }
      source=language(best.detectedLanguage);if(!source)return {kind:'original'};
      // A pending language pack must not make the same row repeat language detection.
      if(job.info)job.info.source=source;
    }
    if(source===job.target){const original={kind:'original'};putCache(key,original);return original}
    const entry=await getPair(source,job);
    if(!entry){const pair=source+'>'+job.target;return {kind:entry===false?'unavailable':'waiting',pair,preparing:creating.has(pair)}}
    if(!current(job))throw abortError();entry.users++;
    try{
      const translated=await operation(signal=>entry.session.translate(job.text,{signal}),job.controller.signal);
      if(!current(job))throw abortError();
      if(typeof translated!=='string'||translated.length>MAX_TEXT*4)throw new Error('Invalid translation result');
      const result=translated.trim()&&translated!==job.text?{kind:'translated',text:translated,source}:{kind:'original'};
      putCache(key,result);return result;
    }finally{entry.users--;trimSessions()}
  }
  function pump(){
    if(disposed)return;
    retryDeferred();
    while(active<MAX_WORKERS&&jobs.length){
      const job=jobs.shift();
      retryDeferred();
      if(!current(job)||(job.info&&(!job.info.visible||job.info.job!==job||!root?.contains(job.info.node)))){finish(job,null);continue}
      active++;running.add(job);
      translateText(job).then(result=>finish(job,result),error=>finish(job,error.name==='AbortError'?null:{kind:'error'}))
        .finally(()=>{running.delete(job);active--;pump()});
    }
  }
  function retryDeferred(){
    if(disposed||!target||!deferredCount||jobs.length>=MAX_QUEUE)return;
    deferredCursor||=nodes.values();
    for(let checked=0;checked<100&&deferredCount&&jobs.length<MAX_QUEUE;checked++){
      const next=deferredCursor.next();if(next.done){deferredCursor=null;break}
      const info=next.value;if(info.state!=='deferred')continue;
      deferredCount--;info.state='idle';enqueueBubble(info,false);
    }
    if(deferredCount&&jobs.length<MAX_QUEUE&&!deferredRetryPending){
      deferredRetryPending=true;queueMicrotask(()=>{deferredRetryPending=false;pump()});
    }
  }
  function finish(job,result){
    if(job.info){
      const info=job.info;if(info.job!==job)return;info.job=null;
      if(!current(job)||!info.visible||info.text!==job.text)return;
      info.state=result?.kind==='waiting'?'waiting':result?.kind==='error'?'error':'complete';
      info.pair=result?.pair||'';info.result=result;if(result)renderOutput(info,result);
      // A preparation promise may finish between producing and applying the waiting result.
      if(result?.kind==='waiting'&&((result.waitingFor==='detector'&&detector)||(result.pair&&sessions.has(result.pair)))){info.state='idle';enqueueBubble(info)}
    }else{
      if(uiPending.get(job.key)===job)uiPending.delete(job.key);
      job.resolve(current(job)&&result?.kind==='translated'?result.text:job.text);
    }
    publish();
  }
  function removeOutput(info){info.output?.remove();info.output=null}
  function renderOutput(info,result){
    removeOutput(info);if(result.kind==='original'||!root?.contains(info.node))return;
    const box=document.createElement('div');box.className='translation';box.setAttribute('translate','no');
    if(result.kind==='translated'){
      const label=document.createElement('div');label.className='translation-label';label.textContent=labels.translated;
      const text=document.createElement('div');text.className='translation-text';text.dir='auto';text.lang=target;text.textContent=result.text;
      box.append(label,text);
    }else{
      const note=document.createElement('div');note.className='translation-status';
      note.textContent=result.kind==='long'?labels.long:result.kind==='waiting'?(result.preparing?labels.preparing:labels.enable):result.kind==='unavailable'?labels.unavailable:labels.failed;
      box.append(note);
    }
    info.node.insertAdjacentElement('afterend',box);info.output=box;
  }
  function eligible(node){
    const row=node.closest('.row');if(!row||node.classList.contains('mono')||node.closest('.translation,.qt')||row.hasAttribute('data-no-translate'))return false;
    if(row.dataset.kind&&!['talk','word'].includes(row.dataset.kind))return false;
    const text=node.textContent.trim();
    if(!text||!/[\p{L}]/u.test(text)||/^(?:BAC1:|OP_RETURN\b)/i.test(text)||/-----BEGIN [A-Z ]*(?:PGP|KEY|CERTIFICATE)/i.test(text))return false;
    if(/^(?:[a-f0-9]{32,}|(?:bc1|tb1)[a-z0-9]{11,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/i.test(text))return false;
    if(text.length<=MAX_TEXT&&/^[{\[]/.test(text)){try{JSON.parse(text);return false}catch{}}
    return true;
  }
  function enqueueBubble(info,start=true){
    if(!target||!supported()||!info.visible||info.job||info.state!=='idle'||!root?.contains(info.node))return;
    if(info.text.length>MAX_TEXT){info.state='complete';info.result={kind:'long'};renderOutput(info,info.result);return}
    if(jobs.length>=MAX_QUEUE){info.state='deferred';deferredCount++;return}
    const job={info,text:info.text,source:null,target,generation,controller:new AbortController()};info.job=job;jobs.push(job);if(start)pump();
  }
  function cancelInfo(info){if(info.state==='deferred')deferredCount--;if(info.job){info.job.controller.abort();info.job=null}info.state='idle';info.pair=''}
  function visibleFallback(info){const r=info.node.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<window.innerHeight}
  function refresh(){
    refreshPending=false;if(!root||disposed)return;
    const found=new Set(Array.from(root.querySelectorAll('.row .txt')).filter(eligible));
    for(const [node,info] of nodes)if(!found.has(node)){cancelInfo(info);removeOutput(info);io?.unobserve(node);nodes.delete(node)}
    for(const node of found){
      let info=nodes.get(node);const text=node.textContent.trim();
      if(!info){info={node,text,source:null,visible:false,state:'idle',job:null,output:null,pair:'',result:null};nodes.set(node,info);io?.observe(node)}
      else if(info.text!==text){cancelInfo(info);removeOutput(info);info.text=text;info.source=null;info.result=null}
      if(!io)info.visible=visibleFallback(info);
      enqueueBubble(info);
    }
    publish();
  }
  function scheduleRefresh(){if(!refreshPending&&!disposed){refreshPending=true;queueMicrotask(refresh)}}
  function contentMutation(mutation){
    const parent=mutation.target.nodeType===3?mutation.target.parentElement:mutation.target;
    if(parent?.closest?.('.translation'))return false;
    if(parent?.closest?.('.txt'))return true;
    return mutation.type==='childList'&&[...mutation.addedNodes,...mutation.removedNodes].some(node=>
      node.nodeType===1&&!node.classList?.contains('translation')&&(node.matches?.('.row,.txt')||node.querySelector?.('.row,.txt')));
  }
  function observe(nextRoot){
    if(disposed)return;
    io?.disconnect();mo?.disconnect();io=null;mo=null;const version=++observerVersion;
    if(root!==nextRoot){for(const info of nodes.values()){cancelInfo(info);removeOutput(info)}nodes.clear()}
    root=nextRoot||null;if(!root)return;
    if(typeof window.IntersectionObserver==='function')io=new window.IntersectionObserver(entries=>{
      if(version!==observerVersion||disposed)return;
      for(const entry of entries){const info=nodes.get(entry.target);if(!info)continue;
        info.visible=entry.isIntersecting;
        if(info.visible)enqueueBubble(info);else if(info.job||info.state==='deferred'){cancelInfo(info)}
      }
      publish();
    });
    if(typeof window.MutationObserver==='function'){
      mo=new window.MutationObserver(records=>{if(version===observerVersion&&records.some(contentMutation))scheduleRefresh()});
      mo.observe(root,{childList:true,characterData:true,subtree:true});
    }
    for(const info of nodes.values())io?.observe(info.node);refresh();
  }
  function cancelJobs(){
    for(const job of jobs.splice(0)){job.controller.abort();finish(job,null)}
    for(const job of running)job.controller.abort();
    for(const info of nodes.values()){cancelInfo(info);removeOutput(info);info.result=null}
    deferredCursor=null;
  }
  function clearPairs(){
    for(const task of creating.values())task.controller.abort();creating.clear();pendingPairs.clear();
    for(const entry of sessions.values())try{entry.session.destroy()}catch{}sessions.clear();
  }
  function configure(value,options={}){
    if(disposed)return {...status};
    if('onStatus' in options)callback=typeof options.onStatus==='function'?options.onStatus:null;
    labels={...DEFAULT_LABELS,...options.labels};
    const next=!value||value==='off'?null:language(value);
    if(next!==target){
      generation++;target=next;lastError='';operationBlocked=false;cancelJobs();clearPairs();
      if(!target){detectorController?.abort();try{detector?.destroy()}catch{}detector=null;detectorTask=null;detectorController=null;detectorNeeded=false}
    }
    else for(const info of nodes.values())if(info.result)renderOutput(info,info.result);
    publish();scheduleRefresh();return {...status};
  }
  function enableFromGesture(){
    if(!target||disposed||!supported()){publish();return Promise.resolve({...status})}
    lastError='';operationBlocked=false;const attempts=[];
    if(!detector)attempts.push(createDetector());
    const wanted=new Map();
    if(target!=='en')wanted.set('en>'+target,{source:'en',target});
    for(const key of neededPairKeys())if(pendingPairs.has(key))wanted.set(key,pendingPairs.get(key));
    let downloads=0;
    for(const [key,pair] of wanted)if(!sessions.has(key)&&!creating.has(key)&&downloads<2){downloads++;attempts.push(createPair(pair.source,pair.target))}
    for(const info of nodes.values())if(info.visible&&(info.state==='waiting'||info.state==='error')){info.state='idle';enqueueBubble(info)}
    publish();return Promise.allSettled(attempts).then(()=>({...status}));
  }
  function translateUI(value){
    const text=String(value??'');if(!target||target==='en'||disposed||!supported()||!text.trim()||text.length>MAX_TEXT)return Promise.resolve(text);
    const key=generation+'\0'+text,existing=uiPending.get(key);if(existing)return existing.promise;
    if(jobs.length>=MAX_QUEUE)return Promise.resolve(text);
    const job={key,text,source:'en',target,generation,controller:new AbortController(),resolve:null,promise:null};
    job.promise=new Promise(resolve=>{job.resolve=resolve});uiPending.set(key,job);jobs.push(job);pump();return job.promise;
  }
  function dispose(){
    if(disposed)return;disposed=true;generation++;target=null;observerVersion++;cancelJobs();clearPairs();
    detectorController?.abort();try{detector?.destroy()}catch{}detector=null;
    io?.disconnect();mo?.disconnect();nodes.clear();cache.clear();cacheBytes=0;root=null;
    window.removeEventListener('scroll',fallbackScroll);window.removeEventListener('resize',fallbackScroll);publish();
  }
  function fallbackScroll(){if(root&&!io)scheduleRefresh()}
  window.addEventListener('scroll',fallbackScroll,{passive:true});window.addEventListener('resize',fallbackScroll,{passive:true});
  window.BAC_TRANSLATE=Object.freeze({configure,enableFromGesture,translateUI,observe,dispose,
    supportedLanguages:LANGUAGES,getState:()=>({...status})});
})();
