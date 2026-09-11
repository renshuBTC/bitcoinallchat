// Direct source boundary tests; no wallet, network or QR dependency is invoked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const {webcrypto}=require('node:crypto');
const {deflateRawSync}=require('node:zlib');
function runtime(overrides={}){
  const scope=vm.createContext({Uint8Array,TextEncoder,crypto:webcrypto,atob,btoa,DecompressionStream,ReadableStream,setTimeout,clearTimeout,...overrides});
  const source=fs.readFileSync(path.join(__dirname,'..','post-src.js'),'utf8')
    .replace(/^import .*;\s*$/m,'').replace(/export \{[^}]*\};?/g,'').replace(/\bexport /g,'');
  vm.runInContext(source+'\nglobalThis.L={hexToBytes,decodeAddress,dataScript,vsize,select,buildPsbt,extract,bbqr,bbqrJoin};',scope);
  return scope.L;
}
const address='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const coin={txid:'12'.repeat(32),vout:0,value:1000000};
const bytes=x=>new Uint8Array(x);
const b=b=>Buffer.from(b);
function vi(n){if(n<253)return b([n]);const a=Buffer.alloc(3);a[0]=253;a.writeUInt16LE(n,1);return a}
const vb=x=>Buffer.concat([vi(x.length),b(x)]);
const map=entries=>Buffer.concat([...entries.flatMap(([k,v])=>[vb(k),vb(v)]),b([0])]);
async function fixture(){
  const L=runtime(),built=await L.buildPsbt({address,utxos:[{...coin,value:600},{...coin,txid:'34'.repeat(32),value:600}],message:'test',feeRate:3});
  const source=b(built.psbt);let p=7;const n=source[p++];const tx=source.subarray(p,p+n);
  const signature=b([2,9,0x30,6,2,1,1,2,1,1,1,33,2,...new Uint8Array(32)]);
  const make=(inputMaps,outputMaps=[[],[]])=>bytes(Buffer.concat([b([0x70,0x73,0x62,0x74,0xff]),map([[b([0]),tx]]),...inputMaps.map(map),...outputMaps.map(map)]));
  return {L,built,tx,signature,make};
}
test('Hex input rejects odd, malformed, non-string and oversized encodings',()=>{
  const L=runtime();assert.deepEqual(b(L.hexToBytes('00aB')),b([0,171]));
  for(const bad of ['a','zz','0x12',{},null,'0'.repeat(4000002)])assert.throws(()=>L.hexToBytes(bad),/encoding|hex/i);
});
test('Coin selection validates outpoints, amounts, duplicates and fee rates',()=>{
  const L=runtime();
  for(const value of [-1,0.5,NaN,'1000',2100000000000001])assert.throws(()=>L.select([{...coin,value}],3,10,'p2wpkh'));
  for(const change of [{txid:'bad'},{vout:-1},{vout:4294967296}])assert.throws(()=>L.select([{...coin,...change}],3,10,'p2wpkh'));
  assert.throws(()=>L.select([coin,coin],3,10,'p2wpkh'));
  for(const fee of [-1,0,NaN,Infinity,'3'])assert.throws(()=>L.select([coin],fee,10,'p2wpkh'));
  assert.throws(()=>L.select([coin],3,10,'unknown'));
});
test('The builder snapshots caller data and coin selection before address checksum awaits',async()=>{
  const L=runtime(),utxos=[{...coin}],message=bytes([65,66,67]);
  const pending=L.buildPsbt({address,utxos,message,feeRate:3});
  utxos[0].txid='34'.repeat(32);message.fill(90);
  const built=await pending;assert.equal(built.inputs[0].txid,coin.txid);
  assert.ok(b(built.psbt).includes(b([0x6a,3,65,66,67])));
});
test('Script overhead and complete transaction size are included in relay limits',async()=>{
  const L=runtime();assert.throws(()=>L.dataScript(new Uint8Array(100000)),/limit|large/i);
  await assert.rejects(L.buildPsbt({address,utxos:[coin],message:new Uint8Array(99400),feeRate:1}),/limit|large/i);
  const built=await L.buildPsbt({address,utxos:[coin],message:new Uint8Array(99000),feeRate:1});assert.ok(built.vbytes<=100000);
});
test('Taproot fee estimation includes the complete ALL-signature witness for every input',()=>{
  const L=runtime(),n=5,dataLen=20;
  const base=4+1+n*41+1+8+1+dataLen+43+4;
  assert.ok(L.vsize(n,'p2tr',dataLen,true)>=Math.ceil((base*4+2+n*67)/4));
});
test('PSBT extraction requires every input to be finalized and all maps to be complete',async()=>{
  const f=await fixture(),final=[[b([8]),f.signature]];
  const valid=f.make([final,final]);assert.ok(f.L.extract(valid));
  assert.throws(()=>f.L.extract(f.make([final,[]])),/signed|final/i);
  for(const malformed of [valid.slice(0,-1),bytes([...valid,0]),f.make([final,[...final,...final]])])assert.throws(()=>f.L.extract(malformed));
});
test('PSBT extraction rejects noncanonical lengths, invalid singleton fields and malformed witnesses',async()=>{
  const f=await fixture(),final=[[b([8]),f.signature]],valid=f.make([final,final]);
  assert.throws(()=>f.L.extract(bytes([...valid.slice(0,5),253,1,0,...valid.slice(6)])));
  assert.throws(()=>f.L.extract(f.make([[[b([8,0]),f.signature]],final])));
  assert.throws(()=>f.L.extract(f.make([[[b([8]),b([1,20,1])]],final])));
});
test('BBQr accepts reordered and identical duplicate frames without changing bytes',async()=>{
  const L=runtime(),data=bytes(Array.from({length:80},(_,i)=>i)),parts=L.bbqr(data,'T',16);
  assert.deepEqual(b((await L.bbqrJoin([...parts].reverse().concat(parts[0]))).raw),b(data));
});
test('BBQr rejects mixed headers, conflicting duplicate frames and invalid indexes',async()=>{
  const L=runtime(),parts=L.bbqr(new Uint8Array(30).fill(9),'P',16);
  const bad=[[],[parts[0].replace('B$2','B$Z')],['B$2P0000'],['B$2P0101AA'],['B$2P0100AB'],
    ['B$2P0200AA','B$2P0201AA'],['B$HP030000','B$HP03010011','B$HP030200'],
    [parts[0],parts[1].replace('B$2P','B$2T'),...parts.slice(2)],
    [...parts,parts[0].slice(0,-1)+'A']];
  for(const input of bad)await assert.rejects(L.bbqrJoin(input));
});
test('BBQr hex encoding is decoded as hex',async()=>{
  const L=runtime();assert.deepEqual(b((await L.bbqrJoin(['B$HT01000012ABFF'])).raw),b([0,18,171,255]));
});
test('BBQr encoding validates empty input and finite frame limits',()=>{
  const L=runtime();
  for(const size of [0,-8,NaN,Infinity,7,5000])assert.throws(()=>L.bbqr(bytes([1]),'P',size));
  assert.throws(()=>L.bbqr(new Uint8Array(6480),'P',8));
  assert.throws(()=>L.bbqr(new Uint8Array(),'P'));
});

function compressedFrames(L,data){return L.bbqr(bytes(deflateRawSync(data,{windowBits:10})),'T',16).map(p=>'B$Z'+p.slice(3))}
test('Compressed BBQr decodes native raw deflate and returns the exact original bytes',async()=>{
  const L=runtime(),data=b('Repeated transaction bytes 世界 '.repeat(50)),parts=compressedFrames(L,data);
  const result=await L.bbqrJoin([...parts].reverse());assert.equal(result.fileType,'T');assert.deepEqual(b(result.raw),data);
});
test('Compressed BBQr rejects malformed data, empty output and decompression bombs',async()=>{
  const L=runtime();
  await assert.rejects(L.bbqrJoin(['B$ZP0100AA']),/compress/i);
  await assert.rejects(L.bbqrJoin(compressedFrames(L,Buffer.alloc(0))),/no data/i);
  await assert.rejects(L.bbqrJoin(compressedFrames(L,Buffer.alloc(2000001))),/too large/i);
});
test('Compressed BBQr honours cancellation before and during native decoding',async()=>{
  const L=runtime(),parts=compressedFrames(L,Buffer.alloc(100000));
  const prior=new AbortController();prior.abort();await assert.rejects(L.bbqrJoin(parts,{signal:prior.signal}),/cancelled/);
  const current=new AbortController(),pending=L.bbqrJoin(parts,{signal:current.signal});current.abort();await assert.rejects(pending,/cancelled/);
});
test('Unsupported browsers and stalled decompression fail clearly without a live timer',async()=>{
  const ordinary=runtime(),parts=compressedFrames(ordinary,b('hello'));
  await assert.rejects(runtime({DecompressionStream:undefined}).bbqrJoin(parts),/browser cannot/);
  let timeout,cleared=false;
  const L=runtime({DecompressionStream:class {constructor(){return new TransformStream({transform:()=>new Promise(()=>{})})}},setTimeout:cb=>{timeout=cb;return 1},clearTimeout:id=>{assert.equal(id,1);cleared=true}});
  const pending=L.bbqrJoin(parts);timeout();await assert.rejects(pending,/too long/);assert.equal(cleared,true);
});
