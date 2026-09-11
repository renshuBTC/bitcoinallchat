// Tests the shipped URL helper and actual message options/bindings.
// No browser tab, wallet, model, or network request is opened.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'translate.js'),'utf8');
const html=fs.readFileSync(process.argv[2]||path.join(root,'index.html'),'utf8');
const FIRST='a1'.repeat(32),SECOND='b2'.repeat(32);

function declaration(name){
  const start=html.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(start>=0,'Missing actual function '+name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const code=html.slice(start,end+1);try{new vm.Script(code);return code}catch{}
  }
  throw new Error('Cannot extract '+name);
}
function runtime(){
  const effects=[];
  const forbidden=name=>(...args)=>{effects.push({name,args});throw new Error('Unexpected automatic '+name)};
  const window={open:forbidden('navigation'),fetch:forbidden('fetch'),
    navigator:{sendBeacon:forbidden('beacon')},addEventListener:forbidden('listener')};
  for(const name of ['Translator','LanguageDetector'])Object.defineProperty(window,name,{get:forbidden(name)});
  const scope=vm.createContext({window,URL,console,fetch:forbidden('fetch'),XMLHttpRequest:forbidden('XHR'),
    WebSocket:forbidden('WebSocket'),setTimeout:forbidden('timer'),setInterval:forbidden('timer'),
    document:{createElement:forbidden('DOM creation')},localStorage:{getItem:forbidden('storage read'),setItem:forbidden('storage write')}});
  vm.runInContext(source,scope,{filename:'shipped-translate.js'});
  return {scope,window,app:window.BAC_MESSAGE_TRANSLATE,effects};
}
function message(overrides={}){
  return {txid:FIRST,vout:0,kind:'talk',text:'An original Bitcoin message.',height:966496,time:1790000000,bytes:20,...overrides};
}
function link(txid=FIRST,vout=0){
  const details={open:true};
  return {dataset:{txid,vout:String(vout)},href:'',textContent:'A translated control or clipped preview',details,
    closest:selector=>{assert.equal(selector,'details');return details}};
}
function pageRuntime({messages=[message()],links=[],replies=[],language='en'}={}){
  const run=runtime(),hints=[],replyCalls=[];
  let selected=language;
  run.window.BAC_UI_LANGUAGE={getLanguage:()=>selected};
  Object.assign(run.scope,{BYMSG:new Map(),BYTX:new Map(),msgs:messages,query:'',
    document:{querySelectorAll:selector=>selector==='.translate-action'?links:selector==='.reply-action'?replies:[]},
    $:()=>null,hint:text=>hints.push(text),selectReply:(...args)=>replyCalls.push(args),
    isMine:()=>false,quoteHTML:()=>'',
  });
  for(const name of ['cleanTxid','validVout','messageKey','messageDomId','reindex'])vm.runInContext(declaration(name),run.scope);
  const start=html.indexOf('const NAMES='),end=html.indexOf('function turn(',start);
  assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end),run.scope);
  vm.runInContext(declaration('turn')+'\n'+declaration('bind'),run.scope);
  run.scope.reindex(messages);
  return {...run,hints,replyCalls,selectLanguage:code=>{selected=code}};
}
function click(anchor){let prevented=false;anchor.onclick({preventDefault(){prevented=true}});return prevented}

test('Loading the helper has no native-model, download, network, navigation, DOM, storage or timer effects',()=>{
  const run=runtime();assert.ok(run.app);assert.deepEqual(run.effects,[]);
  assert.equal(run.window.BAC_TRANSLATE,undefined);
  assert.equal(Object.isFrozen(run.app),true);assert.equal(Object.isFrozen(run.app.supportedLanguages),true);
});
test('All 39 supported targets produce HTTPS links to the exact trusted Google Translate host',()=>{
  const {app,effects}=runtime();assert.equal(app.supportedLanguages.length,39);
  assert.equal(new Set(app.supportedLanguages).size,39);
  for(const code of app.supportedLanguages){
    const parsed=new URL(app.url('Hello world',code));
    assert.equal(parsed.origin,'https://translate.google.com');assert.equal(parsed.pathname,'/');
    assert.equal(parsed.username,'');assert.equal(parsed.password,'');assert.equal(parsed.port,'');assert.equal(parsed.hash,'');
    assert.equal(parsed.searchParams.get('sl'),'auto');assert.equal(parsed.searchParams.get('op'),'translate');
    assert.equal(parsed.searchParams.get('tl'),code==='zh'?'zh-CN':code==='zh-Hant'?'zh-TW':code);
    assert.equal(app.language(code),code);
  }
  assert.deepEqual(effects,[]);
});
test('Chinese targets select simplified and traditional Chinese explicitly',()=>{
  const {app}=runtime();
  assert.equal(new URL(app.url('你好','zh')).searchParams.get('tl'),'zh-CN');
  assert.equal(new URL(app.url('你好','zh-Hant')).searchParams.get('tl'),'zh-TW');
});
test('Unknown, malformed and non-string target codes fall back to English without changing the host',()=>{
  const {app}=runtime();
  for(const code of [undefined,null,'','xx','EN','zh-CN','zh-TW','en&tl=ru','https://evil.example','javascript:alert(1)',{},7]){
    assert.equal(app.language(code),'en');const parsed=new URL(app.url('Original',code));
    assert.equal(parsed.origin,'https://translate.google.com');assert.equal(parsed.searchParams.get('tl'),'en');
  }
});
test('The complete original text survives URL encoding, including whitespace, Unicode and markup',()=>{
  const {app}=runtime();
  const original='  你好，Bitcoin! مرحبا 👋\nCafé e\u0301\t<script>alert("x")</script> & tl=ru + % # ?\r\n  ';
  const href=app.url(original,'de'),parsed=new URL(href);
  assert.equal(parsed.searchParams.get('text'),original);assert.equal(parsed.searchParams.get('tl'),'de');
  assert.equal(parsed.searchParams.getAll('text').length,1);assert.equal(parsed.searchParams.getAll('tl').length,1);
  assert.equal(href.includes('<script>'),false);assert.equal(href.includes('\n'),false);
});
test('Text that looks like a URL, query override or script remains only message data',()=>{
  const {app}=runtime();
  for(const text of ['https://evil.example/path?sl=evil&tl=evil','//evil.example','javascript:alert(1)','&text=changed&tl=ru#fragment']){
    const parsed=new URL(app.url(text,'fr'));
    assert.equal(parsed.origin,'https://translate.google.com');assert.equal(parsed.searchParams.get('text'),text);
    assert.equal(parsed.searchParams.get('tl'),'fr');assert.equal(parsed.hash,'');
  }
});
test('Empty, whitespace-only and non-string input has no translation URL',()=>{
  const {app}=runtime();
  for(const text of ['', ' \n\t\r\u00a0',undefined,null,42,{},['message'],new String('message')])assert.equal(app.url(text,'en'),null);
});
test('The source-text limit includes 5,000 characters and rejects 5,001',()=>{
  const {app}=runtime();const text='a'.repeat(5000);
  assert.equal(new URL(app.url(text,'en')).searchParams.get('text'),text);
  assert.equal(app.url(text+'a','en'),null);
});
test('Encoded links include the exact 8,000-character boundary and reject one character more',()=>{
  const {app}=runtime(),overhead=app.url('x','en').length-1;
  const euroCount=Math.floor((8000-overhead)/9),padding=8000-overhead-euroCount*9;
  const text='€'.repeat(euroCount)+'x'.repeat(padding);
  assert.ok(text.length<5000);const href=app.url(text,'en');assert.equal(href.length,8000);
  assert.equal(new URL(href).searchParams.get('text'),text);assert.equal(app.url(text+'x','en'),null);
});
test('Multibyte text can exceed the encoded URL limit even below the source-text limit',()=>{
  const {app}=runtime(),text='你'.repeat(1000);assert.ok(text.length<5000);assert.equal(app.url(text,'en'),null);
});
test('Actual text message options contain Reply and a safe Translate link',()=>{
  const run=pageRuntime(),markup=run.scope.turn(message(),null);
  assert.match(markup,/<button class="reply-action"[^>]*>Reply<\/button>/);
  const anchor=markup.match(/<a class="translate-action"([^>]*)>Translate<\/a>/);assert.ok(anchor);
  assert.match(anchor[1],/href="https:\/\/translate\.google\.com\/"/);
  assert.match(anchor[1],/target="_blank"/);assert.match(anchor[1],/rel="noopener noreferrer"/);
  assert.match(anchor[1],/referrerpolicy="no-referrer"/);assert.match(anchor[1],/opens a new tab/);
  assert.match(anchor[1],new RegExp('data-txid="'+FIRST+'"'));assert.match(anchor[1],/data-vout="0"/);
});
test('Blank text and invalid output references never render a Translate action',()=>{
  const run=pageRuntime();
  for(const candidate of [message({text:' \n\t'}),message({txid:FIRST.slice(0,8)}),message({vout:-1}),message({vout:undefined})]){
    assert.doesNotMatch(run.scope.turn(candidate,null),/class="translate-action"/);
  }
});
test('Message markup stays escaped and does not embed the original text into the Translate anchor',()=>{
  const run=pageRuntime(),text='<img src=x onerror="alert(1)"> & "message"';
  const markup=run.scope.turn(message({text}),null);
  assert.match(markup,/&lt;img/);assert.doesNotMatch(markup,/<img src=x/);
  const anchor=markup.match(/<a class="translate-action"[^>]*>/)?.[0];assert.ok(anchor);
  assert.doesNotMatch(anchor,/onerror|&lt;img|text=/);
});
test('Binding selects the exact transaction output and full original text rather than DOM previews',()=>{
  const original='Full original text: '+ 'a'.repeat(1000)+' END',a=link(FIRST,0),b=link(FIRST,1),c=link(SECOND,0);
  const run=pageRuntime({language:'it',links:[a,b,c],messages:[message({text:original}),message({vout:1,text:'Different output of the same transaction'}),message({txid:SECOND,text:'Different transaction'})]});
  run.scope.bind();
  assert.equal(new URL(a.href).searchParams.get('text'),original);
  assert.equal(new URL(b.href).searchParams.get('text'),'Different output of the same transaction');
  assert.equal(new URL(c.href).searchParams.get('text'),'Different transaction');
  assert.equal(new URL(a.href).searchParams.get('tl'),'it');assert.deepEqual(run.effects,[]);
});
test('Click refreshes the selected target language without opening a tab programmatically',()=>{
  const anchor=link(),run=pageRuntime({language:'de',links:[anchor]});run.scope.bind();
  assert.equal(new URL(anchor.href).searchParams.get('tl'),'de');
  for(const [language,target] of [['zh','zh-CN'],['zh-Hant','zh-TW'],['invalid','en']]){
    run.selectLanguage(language);anchor.details.open=true;
    assert.equal(click(anchor),false);assert.equal(new URL(anchor.href).searchParams.get('tl'),target);
    assert.equal(anchor.details.open,false);
  }
  assert.deepEqual(run.effects,[]);
});
test('A missing language adapter uses English and the original message',()=>{
  const anchor=link(),run=pageRuntime({links:[anchor]});delete run.window.BAC_UI_LANGUAGE;run.scope.bind();
  const parsed=new URL(anchor.href);assert.equal(parsed.searchParams.get('tl'),'en');assert.equal(parsed.searchParams.get('text'),message().text);
});
test('Over-limit messages retain originals and show the copy-to-translate hint instead of navigating',()=>{
  for(const text of ['a'.repeat(5001),'你'.repeat(1000)]){
    const anchor=link(),m=message({text}),run=pageRuntime({links:[anchor],messages:[m]});run.scope.bind();
    assert.equal(click(anchor),true);assert.equal(m.text,text);assert.equal(run.hints.length,1);
    assert.match(run.hints[0],/Copy its text/);assert.deepEqual(run.effects,[]);
  }
});
test('A missing message or absent URL helper blocks navigation gracefully',()=>{
  for(const missing of ['message','helper']){
    const anchor=link(),run=pageRuntime({links:[anchor],messages:missing==='message'?[]:[message()]});
    if(missing==='helper')delete run.window.BAC_MESSAGE_TRANSLATE;
    run.scope.bind();assert.equal(click(anchor),true);assert.equal(run.hints.length,1);assert.deepEqual(run.effects,[]);
  }
});
test('Reply binding continues to use its exact transaction and output index',()=>{
  const reply=link(SECOND,7),run=pageRuntime({replies:[reply]});run.scope.bind();reply.onclick();
  assert.deepEqual(run.replyCalls,[[SECOND,7]]);assert.equal(reply.details.open,false);
});
