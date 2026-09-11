// Run the shipped reader against synthetic serialized blocks. No network or wallet.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const {webcrypto,createHash}=require('node:crypto');
const html=fs.readFileSync(process.env.BAC_PARSER_HTML||path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('/* ---------------- raw block parser ---------------- */');
const end=html.indexOf('/* ---------------- classification ---------------- */',start);
assert.ok(start>=0&&end>start);
function declaration(name){
  const begin=html.search(new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\('));
  assert.ok(begin>=0,'Missing page function: '+name);
  for(let finish=html.indexOf('}',begin);finish>=0;finish=html.indexOf('}',finish+1)){
    const source=html.slice(begin,finish+1);
    try{new vm.Script(source);return source}catch{}
  }
  throw Error('Could not extract '+name);
}
function runtime(){
  const scope=vm.createContext({Uint8Array,ArrayBuffer,DataView,crypto:webcrypto});
  vm.runInContext(html.slice(start,end)+'\n'+declaration('readOpReturn'),scope);
  return scope;
}
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b};
function vi(n){
  if(n<253)return Buffer.from([n]);
  if(n<=65535){const b=Buffer.alloc(3);b[0]=253;b.writeUInt16LE(n,1);return b}
  return Buffer.concat([Buffer.from([254]),u32(n)]);
}
const input=(byte,vout=0)=>Buffer.concat([Buffer.alloc(32,byte),u32(vout),vi(0),u32(0xffffffff)]);
const output=script=>Buffer.concat([Buffer.alloc(8),vi(script.length),script]);
const opret=text=>{const data=Buffer.from(text);return Buffer.concat([Buffer.from([0x6a]),vi(data.length),data])};
const ordinary=Buffer.from([0,20,...new Array(20).fill(7)]);
function transaction(scripts,{witness=false,inputs=[input(1)],witnessBytes=Buffer.from([1,3,1,2,3])}={}){
  const body=Buffer.concat([vi(inputs.length),...inputs,vi(scripts.length),...scripts.map(output)]);
  const stripped=Buffer.concat([u32(2),body,u32(0)]);
  const raw=witness?Buffer.concat([u32(2),Buffer.from([0,1]),body,...inputs.map(()=>witnessBytes),u32(0)]):stripped;
  return {raw,stripped};
}
const block=txs=>Buffer.concat([Buffer.alloc(80),vi(txs.length),...txs]);
const arrayBuffer=b=>Uint8Array.from(b).buffer;
const text=b=>Buffer.from(b).toString('utf8');

test('Block reader retains exact output indexes, normal pay scripts and transaction boundaries',()=>{
  const app=runtime(),tx=transaction([ordinary,opret('first message'),Buffer.from([0x6a,0x5d,1]),opret('last message')]);
  const raw=block([tx.raw]),parsed=app.parseBlock(arrayBuffer(raw));
  assert.equal(parsed.total,3);
  assert.deepEqual(Array.from(parsed.outs,o=>o.vout),[1,3]);
  assert.deepEqual(Array.from(parsed.outs,o=>text(o.data)),['first message','last message']);
  assert.equal(parsed.outs[0].pay.length,1);
  assert.deepEqual(Array.from(parsed.outs[0].pay),Array.from(parsed.outs[1].pay));
  assert.equal(parsed.outs[0].tx.ver,81);
  assert.equal(parsed.outs[0].tx.end,raw.length);
  assert.equal(parsed.outs[0].tx.lockStart,raw.length-4);
});

test('Legacy and SegWit provenance produces the expected non-witness transaction ID',async()=>{
  const app=runtime();
  for(const witness of [false,true]){
    const tx=transaction([ordinary,opret('transaction identity')],{witness});
    const raw=block([tx.raw]),parsed=app.parseBlock(arrayBuffer(raw)),o=parsed.outs[0];
    const expected=createHash('sha256').update(createHash('sha256').update(tx.stripped).digest()).digest().reverse().toString('hex');
    assert.equal(o.tx.sw,witness);
    assert.equal(await app.txidOf(parsed.bytes,o.tx),expected);
    assert.deepEqual(Array.from(app.inTxids(parsed.bytes,parsed.dv,o.tx.bodyStart,4)),['01'.repeat(32)]);
  }
});

test('A view into a larger byte buffer cannot shift the parser offsets',()=>{
  const app=runtime(),tx=transaction([opret('offset-safe data')]),raw=block([tx.raw]);
  const storage=Uint8Array.from(Buffer.concat([Buffer.alloc(7,9),raw,Buffer.alloc(11,8)]));
  const parsed=app.parseBlock(storage.subarray(7,7+raw.length));
  assert.equal(text(parsed.outs[0].data),'offset-safe data');
  assert.equal(parsed.dv.byteOffset,7);
  assert.equal(parsed.bytes.length,raw.length);
});

test('Every truncated prefix of a valid block is rejected, including a missing locktime',()=>{
  const app=runtime(),raw=block([transaction([opret('complete data')]).raw]);
  for(let length=0;length<raw.length;length++){
    assert.throws(()=>app.parseBlock(arrayBuffer(raw.subarray(0,length))),'Truncated length '+length+' was accepted');
  }
  assert.throws(()=>app.parseBlock(arrayBuffer(Buffer.concat([raw,Buffer.from([0])]))),/Unexpected|truncated|Invalid/i);
});

test('Unsafe or impossible length/count fields fail before iterating or accepting phantom bytes',()=>{
  const app=runtime(),script=opret('Hi');
  const beforeLength=Buffer.concat([Buffer.alloc(80),vi(1),u32(2),vi(1),input(1),vi(1),Buffer.alloc(8)]);
  for(const length of [Buffer.from([100]),Buffer.from([255,...new Array(8).fill(255)])]){
    const raw=Buffer.concat([beforeLength,length,script,u32(0)]);
    assert.throws(()=>app.parseBlock(arrayBuffer(raw)));
  }
  assert.throws(()=>app.parseBlock(arrayBuffer(Buffer.concat([Buffer.alloc(80),Buffer.from([255,...new Array(8).fill(255)])]))));
  assert.throws(()=>app.parseBlock(arrayBuffer(Buffer.concat([Buffer.alloc(80),vi(0)]))));
  assert.throws(()=>app.parseBlock(new ArrayBuffer(4000001)),/size/i);
});

test('Non-canonical CompactSize encodings and unknown/superfluous witness records are rejected',()=>{
  const app=runtime(),tx=transaction([opret('Hi')]);
  const noncanonical=Buffer.concat([Buffer.alloc(80),Buffer.from([0xfd,1,0]),tx.raw]);
  assert.throws(()=>app.parseBlock(arrayBuffer(noncanonical)),/canonical/i);
  const unknown=transaction([opret('Hi')],{witness:true});unknown.raw[5]=2;
  assert.throws(()=>app.parseBlock(arrayBuffer(block([unknown.raw]))),/witness/i);
  const empty=transaction([opret('Hi')],{witness:true,witnessBytes:Buffer.from([0])});
  assert.throws(()=>app.parseBlock(arrayBuffer(block([empty.raw]))),/witness/i);
});

test('Input ID extraction honors its limit and still validates the complete input list',()=>{
  const app=runtime(),tx=transaction([opret('Hi')],{inputs:[input(1,0),input(2,3)]});
  const p=app.parseBlock(arrayBuffer(block([tx.raw]))),body=p.outs[0].tx.bodyStart;
  assert.deepEqual(Array.from(app.inTxids(p.bytes,p.dv,body,1)),['01'.repeat(32)]);
  assert.deepEqual(Array.from(app.inTxids(p.bytes,p.dv,body,2)),['01'.repeat(32),'02'.repeat(32)]);
  assert.deepEqual(Array.from(app.inTxids(p.bytes,p.dv,body,0)),[]);
  assert.throws(()=>app.inTxids(p.bytes,p.dv,-1,4));
  assert.throws(()=>app.inTxids(p.bytes,p.dv,body,-1));
  assert.throws(()=>app.inTxids(Uint8Array.from([2,1,2,3]),null,0,0));
});

test('OP_RETURN reassembly supports every push width and ignores empty pushes',()=>{
  const app=runtime();
  const mixed='6a0001414c01424d0100434e010000004400';
  assert.equal(text(app.readOpReturn(mixed)),'ABCD');
  for(const malformed of ['',null,5,'6a','6a00','6a5d01','6a01f','6a01gg','6a02ff',
    '6a4c','6a4d01','6a4e010000','6a4effffffff','6a51','00140102']){
    assert.equal(app.readOpReturn(malformed),null,String(malformed));
  }
  assert.equal(app.readOpReturn('6a'+'00'.repeat(4000000)),null);
});

test('Malformed data pushes are skipped without losing other messages in a valid block',()=>{
  const app=runtime(),raw=block([transaction([ordinary,Buffer.from([0x6a,0x4d,1]),opret('still readable')]).raw]);
  const parsed=app.parseBlock(arrayBuffer(raw));
  assert.equal(parsed.total,2);
  assert.equal(parsed.outs.length,1);
  assert.equal(parsed.outs[0].vout,2);
  assert.equal(text(parsed.outs[0].data),'still readable');
});

test('A long sequence of empty pushes remains a single readable byte',()=>{
  const app=runtime(),script=Buffer.concat([Buffer.from([0x6a]),Buffer.alloc(100000),Buffer.from([1,65])]);
  assert.equal(text(app.readOpReturn(script.toString('hex'))),'A');
  const parsed=app.parseBlock(arrayBuffer(block([transaction([script]).raw])));
  assert.equal(parsed.outs.length,1);assert.equal(text(parsed.outs[0].data),'A');
});
