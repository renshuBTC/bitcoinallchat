/* Only a validated display-language preference is persisted. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),engine=window.BAC_TRANSLATE,ui=window.BAC_UI_LANGUAGE;
  const modal=$('ovl'),select=$('language-select');
  if(!modal||!select||!engine||!ui)return;
  const names={off:'Original (No Translation)',ar:'العربية',bg:'Български',bn:'বাংলা',cs:'Čeština',da:'Dansk',
    de:'Deutsch',el:'Ελληνικά',en:'English',es:'Español',fi:'Suomi',fr:'Français',he:'עברית',hi:'हिन्दी',hr:'Hrvatski',
    hu:'Magyar',id:'Bahasa Indonesia',it:'Italiano',ja:'日本語',kn:'ಕನ್ನಡ',ko:'한국어',lt:'Lietuvių',mr:'मराठी',
    nl:'Nederlands',no:'Norsk',pl:'Polski',pt:'Português',ro:'Română',ru:'Русский',sk:'Slovenčina',sl:'Slovenščina',
    sv:'Svenska',ta:'தமிழ்',te:'తెలుగు',th:'ไทย',tr:'Türkçe',uk:'Українська',vi:'Tiếng Việt',zh:'简体中文','zh-Hant':'繁體中文'};
  const allowed=new Set(['off',...engine.supportedLanguages]);
  const baseLabels={translated:'Auto-translated',preparing:'Preparing translation…',enable:'Enable translation to download this language.',
    long:'Translation is limited to 5,000 characters. The original is shown.',
    unavailable:'Translation is unavailable for this language.',failed:'Translation could not be completed. The original is shown.'};
  let chosen='off',labelRun=0,returnFocus=null;
  try{const saved=localStorage.getItem('bac_language');if(allowed.has(saved))chosen=saved}catch{}
  for(const code of allowed){const option=document.createElement('option');option.value=code;option.textContent=names[code]||code;select.append(option)}
  select.value=chosen;

  function readyLabels(){
    const run=++labelRun,language=chosen;
    ui.refresh();
    Promise.all(Object.entries(baseLabels).map(async([key,value])=>[key,await engine.translateUI(value)]))
      .then(entries=>{if(run===labelRun&&language===chosen)engine.configure(chosen,{onStatus,labels:Object.fromEntries(entries)})})
      .catch(()=>{});
  }
  function onStatus(status){
    const progress=status.state==='preparing'&&Number.isFinite(status.progress)?' '+Math.round(status.progress*100)+'%':'';
    $('language-status').textContent=status.message+progress;
    const needsClick=status.state==='download-needed'||status.state==='error';
    $('language-enable').hidden=!needsClick;
    const notice=$('translation-notice'),button=$('translation-enable');
    notice.hidden=chosen==='off'||status.state==='ready'||status.state==='off';
    $('translation-notice-text').textContent=status.state==='unsupported'
      ?'On-device translation is unavailable in this browser.':status.message+progress;
    button.hidden=status.state==='preparing';
    button.textContent=status.state==='unsupported'?'Language':'Enable Translation';
    button.onclick=status.state==='unsupported'?open:enable;
    // The interface pair can be ready while a message-language pack still needs a download.
    if(['ready','error','download-needed'].includes(status.state))queueMicrotask(()=>{
      if(!['preparing','off','unsupported'].includes(engine.getState().state)&&chosen!=='off')readyLabels();
    });
  }
  function open(){
    returnFocus=document.activeElement;
    select.value=chosen;modal.classList.add('on');select.focus();
    onStatus(engine.getState());
  }
  function close(){modal.classList.remove('on');(returnFocus?.isConnected?returnFocus:$('languageb')).focus()}
  function enable(){
    // Call before any await: downloading native language packs needs a click.
    engine.enableFromGesture().catch(()=>{});
  }
  function apply(){
    if(!allowed.has(select.value))return;
    chosen=select.value;labelRun++;
    try{if(chosen==='off')localStorage.removeItem('bac_language');else localStorage.setItem('bac_language',chosen)}catch{}
    engine.configure(chosen,{onStatus});
    if(chosen!=='off')enable();
    ui.setLanguage(chosen);$('languageb').setAttribute('aria-pressed',String(chosen!=='off'));
    onStatus(engine.getState());
  }
  $('languageb').onclick=open;$('language-close').onclick=close;
  $('language-apply').onclick=apply;$('language-enable').onclick=enable;
  modal.addEventListener('click',event=>{if(event.target===modal)close()});
  document.addEventListener('keydown',event=>{
    if(!modal.classList.contains('on')||event.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return}
    if(event.key==='Tab'){
      const controls=[...modal.querySelectorAll('button,select')].filter(element=>!element.hidden&&!element.disabled);
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
  },true);
  engine.configure(chosen,{onStatus});ui.setLanguage(chosen);ui.observe();
  $('languageb').setAttribute('aria-pressed',String(chosen!=='off'));
  engine.observe($('thread'));onStatus(engine.getState());
})();
