/* Compact display-language menu; no network, model downloads or message translation. */
(() => {
  'use strict';
  window.BAC_LANGUAGE_SETTINGS?.dispose();
  const $=id=>document.getElementById(id),ui=window.BAC_UI_LANGUAGE;
  const button=$('languageb'),menu=$('language-menu');
  if(!button||!menu||!ui)return;
  const names={ar:'العربية',bg:'Български',bn:'বাংলা',cs:'Čeština',da:'Dansk',
    de:'Deutsch',el:'Ελληνικά',en:'English',es:'Español',fi:'Suomi',fr:'Français',he:'עברית',hi:'हिन्दी',hr:'Hrvatski',
    hu:'Magyar',id:'Bahasa Indonesia',it:'Italiano',ja:'日本語',kn:'ಕನ್ನಡ',ko:'한국어',lt:'Lietuvių',mr:'मराठी',
    nl:'Nederlands',no:'Norsk',pl:'Polski',pt:'Português',ro:'Română',ru:'Русский',sk:'Slovenčina',sl:'Slovenščina',
    sv:'Svenska',ta:'தமிழ்',te:'తెలుగు',th:'ไทย',tr:'Türkçe',uk:'Українська',vi:'Tiếng Việt',zh:'简体中文','zh-Hant':'繁體中文'};
  const allowed=new Set(Object.keys(window.BAC_LOCALES||{en:{}})),options=[];
  let chosen='en',active=0,typed='',typedAt=0;
  try{const saved=localStorage.getItem('bac_language');if(allowed.has(saved))chosen=saved}catch{}
  function position(){
    if(menu.hidden)return;
    const anchor=button.getBoundingClientRect(),above=Math.max(0,anchor.top-12),below=Math.max(0,window.innerHeight-anchor.bottom-12);
    const upward=above>=Math.min(160,below);
    menu.style.bottom=upward?'calc(100% + 10px)':'auto';menu.style.top=upward?'auto':'calc(100% + 10px)';
    menu.style.maxHeight=Math.max(40,Math.min(320,(upward?above:below)-10))+'px';
    menu.style.transform='';
    const rect=menu.getBoundingClientRect(),shift=rect.left<12?12-rect.left:Math.min(0,window.innerWidth-12-rect.right);
    if(shift)menu.style.transform='translateX('+Math.round(shift)+'px)';
  }
  function focusOption(index){
    if(!options.length)return;
    active=(index+options.length)%options.length;
    options.forEach((option,i)=>{option.tabIndex=i===active?0:-1});
    options[active].focus({preventScroll:true});options[active].scrollIntoView({block:'nearest'});
  }
  function close(restoreFocus=true){
    if(menu.hidden)return;
    menu.hidden=true;button.setAttribute('aria-expanded','false');typed='';typedAt=0;
    if(restoreFocus)button.focus({preventScroll:true});
  }
  function open(){
    if([...document.querySelectorAll('.ov')].some(overlay=>overlay.classList.contains('on')))return;
    for(const other of document.querySelectorAll('.msgopts[open]'))other.open=false;
    menu.hidden=false;button.setAttribute('aria-expanded','true');position();
    focusOption(Math.max(0,options.findIndex(option=>option.dataset.language===chosen)));
  }
  function paintChoice(){
    for(const option of options)option.setAttribute('aria-selected',String(option.dataset.language===chosen));
    button.setAttribute('aria-pressed',String(chosen!=='en'));
  }
  function choose(code){
    if(!allowed.has(code))return;
    chosen=code;
    try{if(chosen==='en')localStorage.removeItem('bac_language');else localStorage.setItem('bac_language',chosen)}catch{}
    paintChoice();ui.setLanguage(chosen);close();
    window.dispatchEvent(new Event('bac-language-change'));
  }
  menu.textContent='';
  for(const code of allowed){
    const option=document.createElement('button');option.type='button';option.className='language-option';
    option.setAttribute('role','option');option.setAttribute('lang',code);option.setAttribute('dir','auto');
    option.dataset.language=code;option.textContent=names[code]||code;option.tabIndex=-1;
    option.onclick=()=>choose(code);menu.append(option);options.push(option);
  }
  function onKey(event){
    if(event.isComposing||event.keyCode===229)return;
    if(menu.hidden){
      if(document.activeElement===button&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();open()}
      return;
    }
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return}
    if(event.key==='Tab'){close();return}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){close(false);return}
    const current=options.indexOf(document.activeElement);if(current>=0)active=current;
    const moves={ArrowDown:active+1,ArrowUp:active-1,Home:0,End:options.length-1};
    if(Object.prototype.hasOwnProperty.call(moves,event.key)){
      event.preventDefault();event.stopImmediatePropagation();focusOption(moves[event.key]);return;
    }
    if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key!==' '){
      event.preventDefault();event.stopImmediatePropagation();
      const now=Date.now(),letter=event.key.toLocaleLowerCase();
      typed=now-typedAt<700?typed+letter:letter;typedAt=now;
      const prefix=[...typed].every(char=>char===letter)?letter:typed;
      const match=options.findIndex((_,offset)=>options[(active+1+offset)%options.length].textContent.toLocaleLowerCase().startsWith(prefix));
      if(match>=0)focusOption(active+1+match);
    }
  }
  function outside(event){
    if(!menu.hidden&&!menu.contains(event.target)&&!button.contains(event.target))close(menu.contains(document.activeElement));
  }
  function dispose(){
    close(false);document.removeEventListener('keydown',onKey,true);document.removeEventListener('click',outside);
    window.removeEventListener('resize',position);button.onclick=null;
  }
  button.onclick=()=>menu.hidden?open():close();
  document.addEventListener('keydown',onKey,true);document.addEventListener('click',outside);
  window.addEventListener('resize',position);
  paintChoice();ui.setLanguage(chosen);
  window.BAC_LANGUAGE_SETTINGS=Object.freeze({close,dispose});
  window.dispatchEvent(new Event('bac-language-change'));
})();
