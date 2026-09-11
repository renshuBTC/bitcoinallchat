const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const context={window:{},URL};
for(const name of ['locales.js','translate.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);
const locales=context.window.BAC_LOCALES,keys=Object.keys(locales.en);
const slots=value=>(value.match(/\{[^}]+\}/g)||[]).sort();
test('Every selectable language has complete nonempty interface copy and preserves dynamic fields',()=>{
  assert.equal(Object.keys(locales).length,39);
  assert.deepEqual(Object.keys(locales).sort(),Array.from(context.window.BAC_MESSAGE_TRANSLATE.supportedLanguages).sort());
  assert.ok(keys.length>=75);
  for(const [code,copy] of Object.entries(locales)){
    assert.deepEqual(Object.keys(copy),keys,code);
    for(const key of keys){
      assert.equal(typeof copy[key],'string',code+key);assert.ok(copy[key].trim(),code+key);
      assert.deepEqual(slots(copy[key]),slots(key),code+key);
      for(const name of ['Bitcoin AllChat','OP_RETURN','mempool.space','Google Translate','USDT'])if(key.includes(name))assert.ok(copy[key].includes(name),code+key+name);
    }
  }
});
test('Shipped templates translate through the actual adapter without changing names, prices, times or error details',()=>{
  const fixture=fs.readFileSync(path.join(__dirname,'ui-language.test.cjs'),'utf8');
  const {app}=vm.runInNewContext(fixture.slice(0,fixture.indexOf('\ntest('))+'\n({app});',{require,__dirname,console});
  const a=app(locales);
  const examples={wallet:'Xverse',fee:'0.00001234 BTC',name:'report-中文.txt',n:'1,234',time:'23:06:45',reason:'Error 31: exact original'};
  const fill=key=>key.replace(/\{([a-z]+)\}/g,(_,name)=>examples[name]);
  for(const [code,copy] of Object.entries(locales)){
    for(const key of keys){
      const expected=code==='en'?fill(key):fill(copy[key]);
      assert.equal(a.api.t(fill(key),code),expected,code+': '+key);
    }
  }
  assert.equal(a.calls.length,0);
});
