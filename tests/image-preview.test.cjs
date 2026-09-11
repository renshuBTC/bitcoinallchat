const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const source=process.argv[2]||path.join(__dirname,path.basename(__dirname)==='tests'?'../index.html':'bitcoinallchat/index.html');
const html=fs.readFileSync(source,'utf8'),start=html.indexOf('/* Image headers are untrusted.'),end=html.indexOf('function trimPunctuation(',start);
assert(start>=0&&end>start,'Load the shipped image preview helpers');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=','base64');
const gif=Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b','hex');
function jpeg(w=1,h=1){const b=Buffer.from('ffd8ffe000040000ffc0000b080001000101011100ffd9','hex');b.writeUInt16BE(h,13);b.writeUInt16BE(w,15);return b}
function bmp(w=1,h=1,core=false){const b=Buffer.alloc(core?26:54);b.write('BM');b.writeUInt32LE(core?12:40,14);if(core){b.writeUInt16LE(w,18);b.writeUInt16LE(h,20)}else{b.writeInt32LE(w,18);b.writeInt32LE(h,22)}return b}
function chunk(tag,body){const b=Buffer.alloc(8+body.length+(body.length&1));b.write(tag);b.writeUInt32LE(body.length,4);body.copy(b,8);return b}
function webp(w=1,h=1,extended=false,lossy=false){let body;if(lossy){body=Buffer.alloc(10);Buffer.from([0x9d,1,0x2a]).copy(body,3);body.writeUInt16LE(w,6);body.writeUInt16LE(h,8)}else{body=Buffer.alloc(5);body[0]=0x2f;body.writeUInt32LE(((w-1)|((h-1)<<14))>>>0,1)}const chunks=[];if(extended){const x=Buffer.alloc(10);x.writeUIntLE(w-1,4,3);x.writeUIntLE(h-1,7,3);chunks.push(chunk('VP8X',x))}chunks.push(chunk(lossy?'VP8 ':'VP8L',body));const contents=Buffer.concat(chunks),header=Buffer.alloc(12);header.write('RIFF');header.writeUInt32LE(contents.length+4,4);header.write('WEBP',8);return Buffer.concat([header,contents])}
function runtime(){
  const created=[],scope=vm.createContext({Uint8Array,DataView,cleanTxid:s=>/^[a-f0-9]{64}$/.test(s)?s:'',document:{createElement(tag){const element={tag,replaceWith(other){this.replacement=other}};created.push(element);return element}},b64:bytes=>{scope.b64Calls++;return Buffer.from(bytes).toString('base64')}});
  scope.b64Calls=0;vm.runInContext(html.slice(start,end)+'\nglobalThis.app={imageDimensions,classifyImage,showImagePreview};',scope);return {...scope.app,scope,created};
}
const array=b=>new Uint8Array(b);
test('Common still-image headers produce bounded dimensions across all supported formats',()=>{
  const app=runtime();for(const [mime,data,w,h] of [['png',png,1,1],['gif',gif,1,1],['jpeg',jpeg(640,480),640,480],['bmp',bmp(320,-200),320,200],['bmp',bmp(10,20,true),10,20],['webp',webp(1024,768),1024,768],['webp',webp(640,480,true,true),640,480]])assert.deepEqual({...app.imageDimensions(array(data),'image/'+mime)},{width:w,height:h},mime);
});
test('Huge declared dimensions and excessive pixel products do not reach a browser decoder',()=>{
  const app=runtime(),hugePng=Buffer.from(png),hugeGif=Buffer.from(gif);hugePng.writeUInt32BE(100000,16);hugeGif.writeUInt16LE(65535,6);
  for(const [mime,data] of [['png',hugePng],['gif',hugeGif],['jpeg',jpeg(65535,65535)],['bmp',bmp(100000,100000)],['webp',webp(8193,1)],['webp',webp(5000,5000)]]){const m=app.classifyImage(array(data),'image/'+mime);assert(m.previewUnavailable,mime);assert.equal(m.imageBytes,undefined);const el={replaceWith(other){this.replacement=other}};app.showImagePreview(el,{...m,txid:'a'.repeat(64)});assert.equal(el.replacement.tag,'a');}
  assert.equal(app.scope.b64Calls,0);assert.equal(app.created.some(e=>e.tag==='img'),false);
});
test('Payloads beyond 100 kB retain only metadata and do not allocate base64',()=>{
  const app=runtime(),large=new Uint8Array(100001);large.set(png);const m=app.classifyImage(large,'image/png');
  assert.equal(m.bytes,100001);assert(m.previewUnavailable);assert.equal(m.imageBytes,undefined);assert.equal(m.b64,undefined);assert.equal(app.scope.b64Calls,0);
});
test('Safe image bytes are copied without retaining their large backing block or precomputing base64',()=>{
  const app=runtime(),block=new Uint8Array(4000000);block.set(png,500);const input=block.subarray(500,500+png.length),m=app.classifyImage(input,'image/png');
  assert.deepEqual(Buffer.from(m.imageBytes),png);assert.equal(m.imageBytes.buffer.byteLength,png.length);input[0]=0;assert.equal(m.imageBytes[0],137);assert.equal(m.b64,undefined);assert.equal(app.scope.b64Calls,0);
});
test('Truncated and malformed headers fail closed without throwing or looping',()=>{
  const app=runtime();for(const [mime,bytes] of [['png',png],['gif',gif],['jpeg',jpeg()],['bmp',bmp()],['webp',webp(1,1,true)]])for(let n=0;n<bytes.length;n++)assert.doesNotThrow(()=>app.imageDimensions(array(bytes.subarray(0,n)),'image/'+mime));
  const corrupt=Buffer.from(png);corrupt.writeUInt32BE(0xffffffff,8);assert.equal(app.imageDimensions(array(corrupt),'image/png'),null);
  const corruptWebp=webp();corruptWebp.writeUInt32LE(0xffffffff,16);assert.equal(app.imageDimensions(array(corruptWebp),'image/webp'),null);
  assert.equal(app.imageDimensions(array([0xff,0xd8,0xff,0xe0,0,0]),'image/jpeg'),null);
});
test('Animation and oversized GIF frames use the transaction fallback',()=>{
  const app=runtime(),frame=gif.subarray(19,gif.length-1),animatedGif=Buffer.concat([gif.subarray(0,gif.length-1),frame,Buffer.from([0x3b])]);
  const animatedPng=Buffer.concat([png.subarray(0,33),Buffer.from('000000086163544c000000020000000000000000','hex'),png.subarray(33)]);
  const animatedWebp=webp(1,1,true);animatedWebp[20]|=2;
  const bigFrame=Buffer.from(gif);bigFrame.writeUInt16LE(65535,24);
  for(const [mime,data] of [['png',animatedPng],['gif',animatedGif],['gif',bigFrame],['webp',animatedWebp]])assert.equal(app.imageDimensions(array(data),'image/'+mime),null,mime);
});
test('An extended WebP canvas cannot conceal a larger embedded frame',()=>{
  const app=runtime(),data=webp(4000,4000,true);data.writeUIntLE(0,24,3);data.writeUIntLE(0,27,3);assert.equal(app.imageDimensions(array(data),'image/webp'),null);
});
test('Conflicting duplicate PNG and JPEG dimensions are rejected before decoding',()=>{
  const app=runtime(),smallJpeg=jpeg(),largeJpeg=jpeg(65535,65535);
  const duplicateJpeg=Buffer.concat([smallJpeg.subarray(0,smallJpeg.length-2),largeJpeg.subarray(8)]);
  const duplicatePng=Buffer.concat([png.subarray(0,33),png.subarray(8,33),png.subarray(33)]);
  assert.equal(app.imageDimensions(array(duplicateJpeg),'image/jpeg'),null);assert.equal(app.imageDimensions(array(duplicatePng),'image/png'),null);
});
test('Show creates one lazy asynchronous image; decoding errors restore an accessible transaction link',()=>{
  const app=runtime(),m={...app.classifyImage(array(png),'image/png'),height:123,txid:'b'.repeat(64)},el={replaceWith(other){this.replacement=other}};
  app.showImagePreview(el,m);const img=el.replacement;assert.equal(img.tag,'img');assert.equal(img.width,1);assert.equal(img.height,1);assert.equal(img.decoding,'async');assert.equal(img.loading,'lazy');assert.equal(img.src,'data:image/png;base64,'+png.toString('base64'));assert.equal(app.scope.b64Calls,1);
  img.onerror();assert.equal(img.replacement.tag,'a');assert.equal(img.replacement.href,'https://mempool.space/tx/'+'b'.repeat(64));assert.equal(img.replacement.rel,'noopener');assert.equal(img.replacement.textContent,'Image · View Transaction');
});
test('UI only binds preview buttons and keeps unavailable images visibly linked to their originals',()=>{
  assert(html.includes("document.querySelectorAll('button.imh')"));assert(html.includes('m.previewUnavailable?`<a class="imh"'));assert(html.includes('height:auto;border-radius:9px'));assert(html.includes('if(mt) return classifyImage(bytes,mt);'));
  assert(html.includes('const mime=imgType(FILE.bytes),size=mime&&imageDimensions(FILE.bytes,mime);'),'Local attachment thumbnails must use the same dimension guard');
});
