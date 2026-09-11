/* A bundled display language is the only setting saved by this module. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),ui=window.BAC_UI_LANGUAGE;
  const modal=$('ovl'),select=$('language-select');
  if(!modal||!select||!ui)return;
  const names={ar:'العربية',bg:'Български',bn:'বাংলা',cs:'Čeština',da:'Dansk',
    de:'Deutsch',el:'Ελληνικά',en:'English',es:'Español',fi:'Suomi',fr:'Français',he:'עברית',hi:'हिन्दी',hr:'Hrvatski',
    hu:'Magyar',id:'Bahasa Indonesia',it:'Italiano',ja:'日本語',kn:'ಕನ್ನಡ',ko:'한국어',lt:'Lietuvių',mr:'मराठी',
    nl:'Nederlands',no:'Norsk',pl:'Polski',pt:'Português',ro:'Română',ru:'Русский',sk:'Slovenčina',sl:'Slovenščina',
    sv:'Svenska',ta:'தமிழ்',te:'తెలుగు',th:'ไทย',tr:'Türkçe',uk:'Українська',vi:'Tiếng Việt',zh:'简体中文','zh-Hant':'繁體中文'};
  const allowed=new Set(Object.keys(window.BAC_LOCALES||{en:{}}));
  let chosen='en',returnFocus=null;
  try{const saved=localStorage.getItem('bac_language');if(allowed.has(saved))chosen=saved}catch{}
  for(const code of allowed){const option=document.createElement('option');option.value=code;option.textContent=names[code]||code;select.append(option)}
  select.value=chosen;
  function open(){
    returnFocus=document.activeElement;select.value=chosen;modal.classList.add('on');select.focus();
  }
  function close(){modal.classList.remove('on');(returnFocus?.isConnected?returnFocus:$('languageb')).focus()}
  function apply(){
    if(!allowed.has(select.value))return;
    chosen=select.value;
    try{if(chosen==='en')localStorage.removeItem('bac_language');else localStorage.setItem('bac_language',chosen)}catch{}
    $('language-status').textContent='Language saved.';
    ui.setLanguage(chosen);$('languageb').setAttribute('aria-pressed',String(chosen!=='en'));
    window.dispatchEvent(new Event('bac-language-change'));
  }
  $('languageb').onclick=open;$('language-close').onclick=close;$('language-apply').onclick=apply;
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
  ui.setLanguage(chosen);$('languageb').setAttribute('aria-pressed',String(chosen!=='en'));
  window.dispatchEvent(new Event('bac-language-change'));
})();
