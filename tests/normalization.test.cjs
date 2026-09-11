const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(process.env.BAC_NORMALIZATION_HTML||path.join(__dirname,'..','index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('function\\s+'+name+'\\s*\\('));
  assert.ok(start>=0,'Missing page function: '+name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const source=html.slice(start,end+1);
    try{new vm.Script(source);return source}catch{}
  }
  throw Error('Could not extract '+name);
}
function runtime(){
  const scope=vm.createContext({});
  const wordKey=html.split('\n').find(line=>line.startsWith('const wordKey='));
  assert.ok(wordKey,'Missing wordKey');
  vm.runInContext(declaration('trimPunctuation')+'\n'+wordKey+'\n'+declaration('searchKey')+
    '\nglobalThis.keys={wordKey,searchKey};',scope);
  return {scope,...scope.keys};
}

test('Ordinary NFC/NFD search keys still match Latin, Hangul and vocalized scripts',()=>{
  const app=runtime();
  for(const text of ['CAFÉ','été','가나다','שָׁלוֹם','سَلَام','நமஸ்காரம்']){
    assert.equal(app.searchKey(text.normalize('NFC')),app.searchKey(text.normalize('NFD')),text);
  }
  assert.equal(app.searchKey('CAFÉ'),'café');
  assert.equal(app.searchKey(null),'');
});

test('ASCII marker keys do not normalize even extremely long combining sequences',()=>{
  const app=runtime();
  vm.runInContext("String.prototype.normalize=function(){throw new Error('Marker lookup must not normalize')}",app.scope);
  assert.equal(app.wordKey('«o\u200drdi!»'),'ordi');
  assert.equal(app.wordKey('\u2067CNTRPRTY\u2069'),'cntrprty');
  const text='A'+'\u0315\u0300'.repeat(20000);
  assert.equal(app.wordKey(text),'a'+text.slice(1));
});

test('Search never gives native NFC an oversized combining-mark run',()=>{
  const app=runtime();
  vm.runInContext([
    'const nativeNormalize=String.prototype.normalize;',
    'String.prototype.normalize=function(form){',
    '  for(const run of String(this).matchAll(/\\p{M}+/gu)){',
    "    if(run[0].length>64)throw new Error('Unbounded combining run reached native NFC');",
    '  }',
    '  return nativeNormalize.call(this,form);',
    '};',
  ].join('\n'),app.scope);
  const marks='\u0315\u0300'.repeat(20000);
  const text='Cafe\u0301 a'+marks+' \u1100\u1161 FIN';
  const key=app.searchKey(text);
  assert.ok(key.startsWith('café a'));
  assert.ok(key.endsWith(' 가 fin'));
  assert.ok(key.includes('a'+marks),'Exceptional marks remain searchable instead of being discarded');
  assert.equal(text,'Cafe\u0301 a'+marks+' \u1100\u1161 FIN','The original message remains intact');
});

test('Normal-sized combining runs still get canonical normalization',()=>{
  const app=runtime(),text='a'+'\u0315\u0300'.repeat(32);
  assert.equal(app.searchKey(text),text.normalize('NFC').toLowerCase());
});

test('Long messages retain searchable suffixes and normal accents around exceptional runs',()=>{
  const app=runtime(),marks='\u0315\u0300'.repeat(500);
  const text='x'.repeat(200000)+' Café '+marks+' DE\u0301JA\u0300';
  const key=app.searchKey(text);
  assert.ok(key.includes(app.searchKey('Café')));
  assert.ok(key.endsWith(app.searchKey('déjà')));
  assert.equal(key.slice(0,200000),'x'.repeat(200000));
  assert.ok(key.includes(marks));
});
