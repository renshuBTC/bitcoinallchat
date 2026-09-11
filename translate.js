/* Message text leaves this page only when its Translate link is opened. */
(() => {
  'use strict';
  const CODES=new Set('ar bg bn cs da de el en es fi fr he hi hr hu id it ja kn ko lt mr nl no pl pt ro ru sk sl sv ta te th tr uk vi zh zh-Hant'.split(' '));
  function language(value){return CODES.has(value)?value:'en'}
  function url(text,code){
    if(typeof text!=='string'||!text.trim()||text.length>5000)return null;
    const target=language(code),link=new URL('https://translate.google.com/');
    link.searchParams.set('sl','auto');
    link.searchParams.set('tl',target==='zh'?'zh-CN':target==='zh-Hant'?'zh-TW':target);
    link.searchParams.set('text',text);link.searchParams.set('op','translate');
    return link.href.length<=8000?link.href:null;
  }
  window.BAC_MESSAGE_TRANSLATE=Object.freeze({url,language,supportedLanguages:Object.freeze([...CODES])});
})();
