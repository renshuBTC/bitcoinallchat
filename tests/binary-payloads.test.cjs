// The reader supports text only. Unsupported payloads retain short metadata in Everything.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function runtime(){
  const scope=vm.createContext({TextDecoder,TextEncoder,Uint8Array});
  const classifier=html.slice(html.indexOf('const dec=new TextDecoder'),html.indexOf('/* ---------------- render ---------------- */'));
  const words=html.slice(html.indexOf('const MARK='),html.indexOf('\nfunction reindex'));
  vm.runInContext(classifier+'\n'+words,scope);return scope;
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=','base64');
const gif=Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b','hex');
const jpeg=Buffer.from('ffd8ffe000040000ffc0000b080001000101011100ffd9','hex');
const bmp=Buffer.alloc(54);bmp.write('BM');bmp.writeUInt32LE(40,14);bmp.writeUInt32LE(1,18);bmp.writeUInt32LE(1,22);
const webp=Buffer.from('5249464616000000574542505650384c050000002f0000000000','hex');

test('Raster payloads are generic data with no retained image bytes or preview properties',()=>{
  const app=runtime();
  for(const bytes of [png,gif,jpeg,bmp,webp]){
    const message=app.classify(new Uint8Array(bytes));
    assert.equal(message.kind,'data');assert.equal(app.speech(message),false);assert.equal(message.text,'');
    assert.equal(message.bytes,bytes.length);assert.ok(message.hex.length<=81);
    assert.deepEqual(Object.keys(message).sort(),['bytes','hex','kind','text']);
  }
});

test('Large binary payloads retain a short summary without copying the underlying block',()=>{
  const app=runtime(),bytes=new Uint8Array(4000000);bytes.set(png,100);
  const message=app.classify(bytes.subarray(100));
  assert.equal(message.kind,'data');assert.equal(message.bytes,3999900);assert.ok(message.hex.length<=81);
  assert.ok(Object.values(message).every(value=>typeof value==='string'||typeof value==='number'));
});

test('Binary control bytes cannot masquerade as a mostly readable chat message',()=>{
  const app=runtime();
  for(const control of [0,1,8,11,12,14,31,127]){
    const bytes=new TextEncoder().encode('Hello Bitcoin community, this contains a binary byte.');bytes[25]=control;
    const message=app.classify(bytes);assert.equal(message.kind,'data');assert.equal(app.speech(message),false);
  }
});

test('Text line breaks, tabs, Unicode controls, emoji, and multilingual replies remain readable',()=>{
  const app=runtime();
  for(const text of ['Hello\tBitcoin\ncommunity\r\nagain','你好，世界！','سلام\u200cعلیکم','\u2067مرحبا\u2069','👋🌍']){
    const message=app.classify(new TextEncoder().encode(text));assert.equal(app.speech(message),true);assert.equal(message.text,text);
  }
});

test('Binary payloads never enter the history archive even when included beside text',()=>{
  const app=runtime(),found=[app.classify(png),app.classify(new TextEncoder().encode('Hello Bitcoin community!'))];
  assert.deepEqual(found.filter(app.speech).map(m=>m.text),['Hello Bitcoin community!']);
});
