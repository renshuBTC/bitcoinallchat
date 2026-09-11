// Transaction safety tests use the shipped builder, synthetic UTXOs/signatures,
// and local network/wallet doubles. They never connect, sign, or broadcast.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const {webcrypto,createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(process.argv[2]||path.join(root,'index.html'),'utf8');
function declaration(name){
  const start=html.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(start>=0,'Missing actual function '+name);
  for(let end=html.indexOf('}',start);end>=0;end=html.indexOf('}',end+1)){
    const text=html.slice(start,end+1);try{new vm.Script(text);return text}catch{}
  }
  throw new Error('Cannot extract '+name);
}
const start=html.indexOf('const hx='),end=html.indexOf('async function send(){',start);
const source=html.slice(start,end);
const TXID='a1'.repeat(32),OUTPOINT='c3'.repeat(32);
const pubkey=Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798','hex');
const signature=Buffer.from('300602010102010101','hex');
const text='A checked message with a reply reference.';
const bytes=x=>new Uint8Array(x);
const hex=x=>Buffer.from(x).toString('hex');
const uint32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b};
const uint64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b};
function vi(n){if(n<253)return Buffer.from([n]);if(n<=65535){const b=Buffer.alloc(3);b[0]=253;b.writeUInt16LE(n,1);return b}return Buffer.concat([Buffer.from([254]),uint32(n)])}
const vb=b=>Buffer.concat([vi(b.length),Buffer.from(b)]);
function serialize(tx,{witness=false}={}){
  return Buffer.concat([uint32(tx.version),...(witness?[Buffer.from([0,1])]:[]),vi(tx.ins.length),
    ...tx.ins.flatMap(i=>[Buffer.from(i.txid,'hex'),uint32(i.vout),vb(i.scriptSig||[]),uint32(i.sequence)]),
    vi(tx.outs.length),...tx.outs.flatMap(o=>[uint64(o.value),vb(o.script)]),
    ...(witness?tx.ins.flatMap(i=>[vi(i.witness.length),...i.witness.map(vb)]):[]),uint32(tx.locktime)]);
}
function psbt(parsed,{tx=parsed.tx,maps=parsed.ins.map(i=>i.map)}={}){
  const map=m=>Buffer.concat([...m.flatMap(([k,v])=>[vb(k),vb(v)]),Buffer.from([0])]);
  return bytes(Buffer.concat([Buffer.from('70736274ff','hex'),map([[Buffer.from([0]),serialize(tx)]]),...maps.map(map),...tx.outs.map((_,i)=>map(parsed.outputMaps[i]||[]))]));
}
function cloneTx(t){return {version:t.version,locktime:t.locktime,ins:t.ins.map(i=>({...i,scriptSig:bytes(i.scriptSig),witness:i.witness.map(bytes)})),outs:t.outs.map(o=>({...o,script:bytes(o.script)}))}}
function runtime(){
  const scope=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,crypto:webcrypto,atob,btoa,window:{},AbortController,DecompressionStream,ReadableStream,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(root,'post.js'),'utf8'),scope);
  const L=scope.window.BTCPOST;
  vm.runInContext(declaration('cleanTxid')+'\n'+source,scope);
  return {scope,L};
}
async function fixture(options={}){
  const run=runtime();
  const build=await run.L.buildPsbt({address:'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',publicKey:hex(pubkey),
    utxos:options.twoInputs?[{txid:OUTPOINT,vout:0,value:600},{txid:'b2'.repeat(32),vout:1,value:600}]:[{txid:OUTPOINT,vout:0,value:1000000}],
    message:text,feeRate:3});
  const parsed=run.scope.readPsbt(build.psbt);
  const tx=cloneTx(parsed.tx);tx.ins.forEach(i=>{i.witness=[bytes(signature),bytes(pubkey)]});
  const partial=psbt(parsed,{maps:parsed.ins.map(i=>[...i.map,[bytes(Buffer.concat([Buffer.from([2]),pubkey])),bytes(signature)]])});
  const final=psbt(parsed,{maps:parsed.ins.map(i=>[...i.map,[bytes([8]),bytes(Buffer.concat([vi(2),vb(signature),vb(pubkey)]))]])});
  return {...run,build,parsed,tx,partial,final,raw:hex(serialize(tx,{witness:true}))};
}
test('Full transaction IDs normalize and all malformed/non-string IDs fail closed',()=>{
  const {scope}=runtime();assert.equal(scope.requiredTxid(TXID.toUpperCase()),TXID);
  for(const id of ['',TXID.slice(1),TXID+'0','g'.repeat(64),null,{},'\"><img src=x onerror=alert(1)>'])assert.throws(()=>scope.requiredTxid(id),/valid transaction ID/);
});
test('A real builder PSBT passes the independent pre-sign checker and matching final transaction check',async()=>{
  const f=await fixture();assert.equal(f.scope.checkPsbt(f.build.psbt,new TextEncoder().encode(text),3,f.build.fee,{script:f.parsed.ins[0].script,coins:f.parsed.ins.map(i=>({txid:hex(Buffer.from(i.txid,'hex').reverse()),vout:i.vout,value:i.value,script:i.script}))}),f.build.fee);
  assert.equal(f.scope.checkSignedTx(f.raw.toUpperCase(),f.build.psbt),f.raw);
});
test('Finalized and partial native SegWit PSBTs produce the same checked raw transaction',async()=>{
  const f=await fixture();
  assert.equal(f.scope.signedPsbtHex(f.final,f.build.psbt,f.L),f.raw);
  assert.equal(f.scope.signedPsbtHex(f.partial,f.build.psbt,f.L),f.raw);
});
test('Taproot key-path partial signatures are finalized with DEFAULT or ALL, not weaker sighashes',async()=>{
  const f=await fixture(),home=bytes([0x51,32,...new Uint8Array(32).fill(7)]),tx=cloneTx(f.parsed.tx);
  tx.outs[1].script=home;
  const inputMaps=f.parsed.ins.map(i=>i.map.map(([k,v])=>[k,k[0]===1?bytes(Buffer.concat([uint64(i.value),vb(home)])):v]));
  const expected=psbt(f.parsed,{tx,maps:inputMaps});
  for(const sig of [bytes(new Uint8Array(64).fill(9)),bytes([...new Uint8Array(64).fill(9),1])]){
    const signed=psbt(f.parsed,{tx,maps:inputMaps.map(m=>[...m,[bytes([0x13]),sig]])});
    assert.equal(f.scope.rawTx(f.scope.transactionBytes(f.scope.signedPsbtHex(signed,expected,f.L))).ins[0].witness.length,1);
  }
  const weak=psbt(f.parsed,{tx,maps:inputMaps.map(m=>[...m,[bytes([0x13]),bytes([...new Uint8Array(64).fill(9),0x82])]])});
  assert.throws(()=>f.scope.signedPsbtHex(weak,expected,f.L),/complete transaction/);
});
for(const [label,change] of [
  ['message',t=>{t.outs[0].script[t.outs[0].script.length-1]^=1}],
  ['change destination',t=>{t.outs[1].script[5]^=1}],
  ['change amount and fee',t=>{t.outs[1].value--}],
  ['input transaction',t=>{t.ins[0].txid='dd'.repeat(32)}],
  ['input output index',t=>{t.ins[0].vout++}],
  ['sequence',t=>{t.ins[0].sequence--}],
  ['version',t=>{t.version++}],
  ['locktime',t=>{t.locktime++}],
  ['extra output',t=>{t.outs.push({...t.outs[1],value:1})}],
])test('Rejects a signed transaction with changed '+label,async()=>{
  const f=await fixture(),tx=cloneTx(f.tx);change(tx);
  assert.throws(()=>f.scope.checkSignedTx(hex(serialize(tx,{witness:true})),f.build.psbt),/does not match/);
  tx.ins.forEach(i=>{i.witness=[]});
  const signed=psbt(f.parsed,{tx,maps:f.parsed.ins.map(i=>[...i.map,[bytes(Buffer.concat([Buffer.from([2]),pubkey])),bytes(signature)]])});
  assert.throws(()=>f.scope.signedPsbtHex(signed,f.build.psbt,f.L),/does not match/);
});
test('Unsigned, partially signed, ambiguous and weak-sighash results never pass',async()=>{
  const f=await fixture({twoInputs:true});assert.equal(f.parsed.ins.length,2);
  const incomplete=cloneTx(f.tx);incomplete.ins[1].witness=[];
  assert.throws(()=>f.scope.checkSignedTx(hex(serialize(incomplete,{witness:true})),f.build.psbt),/complete signature/);
  assert.throws(()=>f.scope.signedPsbtHex(f.build.psbt,f.build.psbt,f.L),/complete signature/);
  const weak=cloneTx(f.tx);weak.ins[0].witness[0][signature.length-1]=0x81;
  assert.throws(()=>f.scope.checkSignedTx(hex(serialize(weak,{witness:true})),f.build.psbt),/complete signature/);
  const duplicate=psbt(f.parsed,{maps:f.parsed.ins.map(i=>[...i.map,i.map[0]])});
  assert.throws(()=>f.scope.readPsbt(duplicate),/Duplicate/);
});
test('Strict parsing rejects truncation, appended data, invalid hex and noncanonical lengths',async()=>{
  const f=await fixture();
  for(const input of ['', 'a', 'zz',f.raw+'00',f.raw.slice(0,-2)])assert.throws(()=>f.scope.checkSignedTx(input,f.build.psbt));
  for(const input of [bytes(f.build.psbt.slice(0,-1)),bytes([...f.build.psbt,0])])assert.throws(()=>f.scope.readPsbt(input));
  const malformed=bytes([...f.build.psbt.slice(0,5),0xfd,1,0,...f.build.psbt.slice(6)]);
  assert.throws(()=>f.scope.readPsbt(malformed),/Non-canonical/);
  assert.throws(()=>f.scope.checkSignedTx(f.raw),/Prepare/);
});
async function sending(options={}){
  const f=await fixture(),events=[],elements=new Map([['sig',{value:f.raw}],['hint',{textContent:''}]]);
  const snapshot={text,reply:null};
  Object.assign(f.scope,{BUSY:false,WALLET_EPOCH:0,ACTIVE_WALLET:null,RATE:3,API:'https://example.invalid',
    OFFLINE_RUN:1,OFFLINE_SENDING:false,OFFLINE_DECODING:null,ovp:{classList:{contains:()=>true}},
    $:id=>elements.get(id),captureDraft:()=>snapshot,clearSentDraft:d=>{assert.equal(d,snapshot);events.push('clear')},
    refreshComp(){},hint:(s,bad)=>events.push(['hint',s,bad]),setst:s=>events.push(['status',s]),fail:e=>events.push(['error',e.message]),
    esc:s=>String(s).replace(/[<>&"']/g,c=>'&#'+c.charCodeAt(0)+';'),sats:n=>n+' sats',setTimeout(){},
    lib:async()=>f.L,getUtxos:async()=>[{txid:OUTPOINT,vout:0,value:1000000}],preparePsbt:async()=>({...f.build,psbt:bytes(f.build.psbt)}),
    push:async raw=>{events.push(['push',raw]);return options.badTxid?'\"><img src=x onerror=alert(1)>':TXID},
    markMine:id=>events.push(['mine',id]),drop(){},
  });
  vm.runInContext(declaration('publish')+'\n'+declaration('broadcastPasted'),f.scope);
  const wallet={name:'Test',id:'test',p:()=>({}),connect:async()=>({address:'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',publicKey:hex(pubkey)}),
    sign:async(_p,expected)=>{events.push('sign');if(options.closeDuringSign)f.scope.WALLET_EPOCH++;
      if(options.mutateExpected)expected.fill(0);
      if(options.txidOnly)return {txid:TXID};
      if(options.mismatch){const changed=cloneTx(f.parsed.tx);changed.outs[1].value--;return{psbt:psbt(f.parsed,{tx:changed,maps:f.scope.readPsbt(f.final).ins.map(i=>i.map)})}}
      return {psbt:f.partial};}};
  return {...f,events,elements,snapshot,wallet};
}
test('Publish verifies the returned signed PSBT before broadcast and remembers only checked success',async()=>{
  const f=await sending({mutateExpected:true});await f.scope.publish(f.wallet,text);
  assert.ok(f.events.includes('sign'));assert.deepEqual(f.events.find(e=>Array.isArray(e)&&e[0]==='push'),['push',f.raw]);
  assert.deepEqual(f.events.find(e=>Array.isArray(e)&&e[0]==='mine'),['mine',TXID]);assert.ok(f.events.includes('clear'));
});
for(const options of [{txidOnly:true},{mismatch:true},{closeDuringSign:true}])test('Publish refuses unchecked or expired wallet result '+JSON.stringify(options),async()=>{
  const f=await sending(options);await f.scope.publish(f.wallet,text);
  assert.equal(f.events.some(e=>Array.isArray(e)&&['push','mine'].includes(e[0])),false);
  assert.equal(f.events.includes('clear'),false);assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='hint'&&e[2]));
});
test('Offline raw, base64 PSBT, hex PSBT and BBQr signed results must match the prepared snapshot',async()=>{
  const f=await sending();
  for(const value of [f.raw,f.L.b64enc(f.partial),hex(f.final),f.L.bbqr(f.final,'P').join('\n')]){
    f.events.length=0;f.elements.get('sig').value=value;
    await f.scope.broadcastPasted(f.L,f.snapshot,f.build.psbt);
    assert.deepEqual(f.events.find(e=>Array.isArray(e)&&e[0]==='push'),['push',f.raw]);assert.ok(f.events.includes('clear'));
  }
});
test('Offline wrong transaction, absent preparation or incomplete signature cannot broadcast',async()=>{
  const f=await sending(),changed=cloneTx(f.tx);changed.outs[1].value--;
  for(const [value,expected] of [[hex(serialize(changed,{witness:true})),f.build.psbt],[f.raw,undefined],[f.L.b64enc(f.build.psbt),f.build.psbt]]){
    f.events.length=0;f.elements.get('sig').value=value;await f.scope.broadcastPasted(f.L,f.snapshot,expected);
    assert.equal(f.events.some(e=>Array.isArray(e)&&['push','mine'].includes(e[0])),false);assert.equal(f.events.includes('clear'),false);
  }
});
test('Malformed response IDs cannot enter success HTML or ownership after publish/offline push doubles',async()=>{
  for(const offline of [false,true]){
    const f=await sending({badTxid:true});
    if(offline)await f.scope.broadcastPasted(f.L,f.snapshot,f.build.psbt);else await f.scope.publish(f.wallet,text);
    assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='mine'),false);assert.equal(f.events.includes('clear'),false);
    assert.equal(f.events.some(e=>Array.isArray(e)&&/Sent\.|<img/.test(e[1])),false);
  }
});
test('The actual network push validates successful response bodies',async()=>{
  const f=await fixture(),id=await f.scope.transactionId(f.raw);
  Object.assign(f.scope,{API:'https://example.invalid',fetch:async()=>({ok:true,text:async()=>id.toUpperCase()})});
  vm.runInContext(declaration('push'),f.scope);assert.equal(await f.scope.push(f.raw),id);
  f.scope.fetch=async()=>({ok:true,text:async()=>'<img src=x onerror=alert(1)>'});
  await assert.rejects(f.scope.push(f.raw),/valid transaction ID/);
  f.scope.fetch=async()=>({ok:true,text:async()=>TXID});
  await assert.rejects(f.scope.push(f.raw),/different transaction ID/);
});

test('Network submission checks the session again after asynchronous transaction hashing',async()=>{
  const f=await fixture();let fetches=0;
  Object.assign(f.scope,{API:'https://example.invalid',fetch:async()=>{fetches++;throw Error('must not submit')}});
  vm.runInContext(declaration('push'),f.scope);
  await assert.rejects(f.scope.push(f.raw,()=>false),/session closed/);assert.equal(fetches,0);
});

test('Oversized offline paste is rejected before decoding or broadcasting',async()=>{
  const f=await sending();f.elements.get('sig').value=' '.repeat(4000001);
  await f.scope.broadcastPasted(f.L,f.snapshot,f.build.psbt);
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='push'),false);
  assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='error'&&/too large/.test(e[1])));
});

test('Closing offline signing aborts pending decoding and cannot broadcast stale results',async()=>{
  const f=await sending();f.elements.get('sig').value='B$2P0100AA';let cancelled=false;
  Object.assign(f.scope,{OFFLINE_BUILDING:false,stopAnim(){}});vm.runInContext(declaration('invalidateOffline'),f.scope);
  const L={...f.L,bbqrJoin:(_parts,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(Error('Offline decoding cancelled'))},{once:true}))};
  const pending=f.scope.broadcastPasted(L,f.snapshot,f.build.psbt);f.scope.invalidateOffline();await pending;
  assert.equal(cancelled,true);assert.equal(f.scope.OFFLINE_SENDING,false);assert.equal(f.scope.OFFLINE_DECODING,null);
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='push'),false);
});

test('An epoch change while asynchronous QR decoding finishes prevents broadcast',async()=>{
  const f=await sending();f.elements.get('sig').value='B$2P0100AA';let finish;
  const L={...f.L,bbqrJoin:()=>new Promise(resolve=>{finish=resolve})};
  const pending=f.scope.broadcastPasted(L,f.snapshot,f.build.psbt);f.scope.WALLET_EPOCH++;
  finish({fileType:'T',raw:f.scope.transactionBytes(f.raw)});await pending;
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='push'),false);assert.equal(f.scope.OFFLINE_DECODING,null);
});

test('Builder loading shares a pending request and can retry after failure',async()=>{
  const scripts=[],scope=vm.createContext({Promise,window:{},LIB:null,LIB_LOADING:null,document:{createElement:()=>({}),head:{appendChild:s=>scripts.push(s)}}});
  vm.runInContext(declaration('lib'),scope);
  const first=scope.lib(),same=scope.lib();assert.equal(first,same);assert.equal(scripts.length,1);
  scripts[0].onerror();await assert.rejects(first,/load/);
  const retry=scope.lib();assert.equal(scripts.length,2);scope.window.BTCPOST={test:true};scripts[1].onload();
  assert.equal(await retry,scope.window.BTCPOST);assert.equal(await scope.lib(),scope.window.BTCPOST);
});
test('All wallet adapters request signatures only and never call provider broadcast',async()=>{
  const f=await fixture();
  vm.runInContext(html.slice(html.indexOf('const WAL=['),html.indexOf('const detected='))+'\nglobalThis.adapters=WAL;',f.scope);
  for(const adapter of f.scope.adapters){
    const provider={signPsbt:async()=>hex(f.final),pushPsbt:async()=>{throw new Error('Provider broadcast must not run')},
      signPSBT:async()=>f.final,request:async(method,params)=>{assert.equal(method,'signPsbt');assert.equal(params.broadcast,false);return{result:{psbt:f.L.b64enc(f.partial),hex:hex(f.partial)}}}};
    const result=await adapter.sign(provider,f.build.psbt,'address',[0],f.L);assert.ok(result.psbt);assert.equal(result.txid,undefined);
  }
});

test('Xverse cancellation never retries a different connection method',async()=>{
  const f=runtime();vm.runInContext(html.slice(html.indexOf('const WAL=['),html.indexOf('const detected='))+'\nglobalThis.adapter=WAL.find(w=>w.id==="xverse");',f.scope);
  for(const returned of [false,true]){
    const calls=[],provider={request:async(method,params)=>{calls.push(method);assert.equal(params.network,'Mainnet');const error={code:4001,message:'User rejected request'};if(returned)return {error};throw Object.assign(new Error(error.message),error)}};
    await assert.rejects(f.scope.adapter.connect(provider),/rejected/);assert.deepEqual(calls,['wallet_connect']);
  }
});

test('UniSat rejects non-Bitcoin chains even when they share mainnet address encoding',async()=>{
  const f=runtime();vm.runInContext(html.slice(html.indexOf('const WAL=['),html.indexOf('const detected='))+'\nglobalThis.adapter=WAL.find(w=>w.id==="unisat");',f.scope);
  for(const name of ['FRACTAL_BITCOIN_MAINNET','BITCOIN_TESTNET',undefined]){
    await assert.rejects(f.scope.adapter.connect({requestAccounts:async()=>['bc1q-test'],getPublicKey:async()=>hex(pubkey),getChain:async()=>({enum:name})}),/Bitcoin mainnet/);
  }
  await assert.rejects(f.scope.adapter.check({getChain:async()=>({enum:'BITCOIN_MAINNET'}),getAccounts:async()=>['bc1q-other']},'bc1q-test'),/account changed/);
  await f.scope.adapter.check({getChain:async()=>({enum:'BITCOIN_MAINNET'}),getAccounts:async()=>['bc1q-test']},'bc1q-test');
});

test('A changed account or closed session during the final account check cannot trigger signing',async()=>{
  for(const changed of [false,true]){
    const f=await sending();f.wallet.check=async()=>{if(changed)throw Error('Wallet account changed');f.scope.WALLET_EPOCH++};
    await f.scope.publish(f.wallet,text);
    assert.equal(f.events.includes('sign'),false);assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='push'),false);
  }
});

test('No-change remainder fees still pass the independent fee ceiling',async()=>{
  const f=runtime(),build=await f.L.buildPsbt({address:'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',utxos:[{txid:OUTPOINT,vout:0,value:600}],message:text,feeRate:3});
  assert.equal(build.change,0);const parsed=f.scope.readPsbt(build.psbt),source=parsed.ins[0];
  assert.equal(f.scope.checkPsbt(build.psbt,new TextEncoder().encode(text),3,build.fee,{script:source.script,coins:[{txid:OUTPOINT,vout:0,value:600,script:source.script}]}),600);
});

test('Untrusted error objects are displayed safely and release the busy state',async()=>{
  const f=await sending();f.wallet.connect=async()=>{throw {message:{reason:'denied'}}};
  await f.scope.publish(f.wallet,text);
  assert.equal(f.scope.BUSY,false);assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='hint'&&e[2]));
  assert.equal(f.events.includes('sign'),false);
});

test('UTXO loading accepts only bounded arrays with explicitly confirmed entries',async()=>{
  const f=runtime();Object.assign(f.scope,{API:'https://example.invalid'});vm.runInContext(declaration('getUtxos'),f.scope);
  for(const outputs of [{utxos:[]},new Array(10001)]){
    f.scope.fetch=async()=>({ok:true,json:async()=>outputs});await assert.rejects(f.scope.getUtxos('address'),/unspent-output response/);
  }
  f.scope.fetch=async()=>({ok:true,json:async()=>[null,{status:{confirmed:'true'}},{status:{confirmed:false}},{txid:TXID,status:{confirmed:true}}]});
  const result=await f.scope.getUtxos('address');assert.equal(result.length,1);assert.equal(result[0].txid,TXID);
});

test('Transaction response limits are enforced during streaming and close the reader',async()=>{
  const f=runtime();let signal,cancelled=false,released=false,reads=0;
  f.scope.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,body:{getReader:()=>({
    read:async()=>({done:false,value:bytes(reads++?[4,5]:[1,2,3])}),
    cancel:async()=>{cancelled=true},releaseLock:()=>{released=true}
  })}}};
  await assert.rejects(f.scope.transactionRequest('https://example.invalid',{},'text',4),/size limit/);
  assert.equal(reads,2);assert.equal(cancelled,true);assert.equal(released,true);assert.equal(signal.aborted,true);
  let consumed=false;f.scope.fetch=async()=>({ok:true,headers:{get:()=> '99999999'},text:async()=>{consumed=true;return ''}});
  await assert.rejects(f.scope.transactionRequest('https://example.invalid',{},'text',4),/size limit/);assert.equal(consumed,false);
});

test('Transaction request timeouts release state and never retry an uncertain broadcast',async()=>{
  for(const post of [false,true]){
    const f=runtime();let timeout,calls=0,cleared=false;
    Object.assign(f.scope,{setTimeout:callback=>{timeout=callback;return 1},clearTimeout:()=>{cleared=true},
      fetch:async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))}});
    const pending=f.scope.transactionRequest('https://example.invalid',post?{method:'POST'}:{});timeout();
    await assert.rejects(pending,post?/check your wallet before retrying/:/timed out/);assert.equal(calls,1);assert.equal(cleared,true);
  }
});

test('Xverse falls back only for an unsupported method and never selects an ordinal-only account',async()=>{
  const f=runtime();vm.runInContext(html.slice(html.indexOf('const WAL=['),html.indexOf('const detected='))+'\nglobalThis.adapter=WAL.find(w=>w.id==="xverse");',f.scope);
  const calls=[],provider={request:async method=>{calls.push(method);return method==='wallet_connect'?{error:{code:-32601,message:'Method not found'}}:{result:[{purpose:'payment',address:'bc1q-test'}]}}};
  assert.equal((await f.scope.adapter.connect(provider)).address,'bc1q-test');assert.deepEqual(calls,['wallet_connect','getAccounts']);
  await assert.rejects(f.scope.adapter.connect({request:async()=>({result:{addresses:[{purpose:'ordinals',address:'bc1p-test'}]}})}),/payment address/);
});

test('Independent fee check rejects excessive fee hidden inside the previous 50,000-sat allowance',async()=>{
  const f=await fixture(),tx=cloneTx(f.parsed.tx);tx.outs[1].value-=1000;
  const changed=psbt(f.parsed,{tx});
  const sources={script:f.parsed.ins[0].script,coins:f.parsed.ins.map(i=>({txid:hex(Buffer.from(i.txid,'hex').reverse()),vout:i.vout,value:i.value,script:i.script}))};
  assert.throws(()=>f.scope.checkPsbt(changed,new TextEncoder().encode(text),3,f.build.fee+1000,sources),/far more/);
});

async function fundingFixture(address='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'){
  const f=runtime(),decoded=await f.L.decodeAddress(address);
  const tx={version:2,locktime:0,ins:[{txid:'00'.repeat(32),vout:0xffffffff,scriptSig:bytes([1,1]),sequence:0xffffffff,witness:[]}],outs:[{value:1000000,script:decoded.script}]};
  const raw=hex(serialize(tx));
  const txid=createHash('sha256').update(createHash('sha256').update(Buffer.from(raw,'hex')).digest()).digest().reverse().toString('hex');
  const args={address,publicKey:hex(pubkey),message:text,feeRate:3,utxos:[{txid,vout:0,value:1000000}]};
  const fetches=[];
  Object.assign(f.scope,{API:'https://example.invalid',fetch:async url=>{fetches.push(url);assert.equal(url,'https://example.invalid/tx/'+txid+'/hex');return{ok:true,text:async()=>raw}}});
  return {...f,args,raw,txid,tx,fetches};
}
test('Independent script encoding matches known native SegWit and legacy addresses',async()=>{
  for(const address of ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4','1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH']){
    const f=await fundingFixture(address);assert.equal(await f.scope.scriptAddress(f.tx.outs[0].script),address);
  }
  const f=runtime(),script=bytes([0x51,32,...new Uint8Array(32).fill(7)]);
  const address=await f.scope.scriptAddress(script);
  assert.deepEqual(Buffer.from((await f.L.decodeAddress(address)).script),Buffer.from(script));
});
test('Funding transaction IDs exclude SegWit witness and preserve script signatures',async()=>{
  const f=await fundingFixture();assert.equal(await f.scope.transactionId(f.raw),f.txid);
  f.tx.ins[0].witness=[bytes([1,2,3])];
  assert.equal(await f.scope.transactionId(hex(serialize(f.tx,{witness:true}))),f.txid);
});
for(const address of ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4','1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'])test('Preparation verifies funding before a single successful build for '+address,async()=>{
  const f=await fundingFixture(address);let calls=0;
  const L={...f.L,buildPsbt:async args=>{calls++;assert.equal(args.prevTx[f.txid],f.raw);return f.L.buildPsbt(args)}};
  const b=await f.scope.preparePsbt(L,f.args);assert.equal(calls,1);assert.equal(f.fetches.length,1);
  assert.equal(b.inputs[0].txid,f.txid);assert.equal(b.type,address.startsWith('1')?'p2pkh':'p2wpkh');
  const parsed=f.scope.readPsbt(b.psbt);
  const partial=psbt(parsed,{maps:parsed.ins.map(i=>[...i.map,[bytes(Buffer.concat([Buffer.from([2]),pubkey])),bytes(signature)]])});
  const raw=f.scope.signedPsbtHex(partial,b.psbt,f.L);assert.ok(raw.length);
  if(address.startsWith('1'))assert.equal(f.scope.rawTx(f.scope.transactionBytes(raw)).segwit,false);
});
test('Preparation rejects incorrect funding transaction hash, amount, output index or locking script before building',async()=>{
  for(const kind of ['hash','amount','index','script']){
    const f=await fundingFixture();let builds=0;
    const L={...f.L,buildPsbt:async args=>{builds++;return f.L.buildPsbt(args)}};
    if(kind==='hash')f.scope.fetch=async()=>({ok:true,text:async()=>f.raw.slice(0,-2)+'01'});
    if(kind==='amount')f.args.utxos[0].value--;
    if(kind==='index')f.args.utxos[0].vout=1;
    if(kind==='script')f.args.address='1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH';
    await assert.rejects(f.scope.preparePsbt(L,f.args),/funding/);assert.equal(builds,0);
  }
});
test('Address/script mismatch from a changed builder decoder is rejected independently',async()=>{
  const f=await fundingFixture(),wrong=(await f.L.decodeAddress('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'));
  await assert.rejects(f.scope.preparePsbt({...f.L,decodeAddress:async()=>wrong},f.args),/address does not match/);
  assert.equal(f.fetches.length,0);
});
test('Builder changes to selected source identity or input value cannot satisfy the verified snapshot',async()=>{
  for(const kind of ['amount','identity']){
    const f=await fundingFixture();
    const L={...f.L,buildPsbt:async args=>{
      if(kind==='amount')args.utxos[0].value++;
      else args.utxos[0].txid='ff'.repeat(32);
      return f.L.buildPsbt(args);
    }};
    await assert.rejects(f.scope.preparePsbt(L,f.args),/verified funding/);
    assert.equal(f.args.utxos[0].value,1000000);assert.equal(f.args.utxos[0].txid,f.txid);
  }
});
test('Malformed, duplicate or unknown selected coins are rejected before funding requests',async()=>{
  const f=await fundingFixture();
  for(const coins of [[...f.args.utxos,...f.args.utxos],[{txid:'<img>',vout:0,value:1}],[{txid:f.txid,vout:-1,value:1}],[{txid:f.txid,vout:0,value:'1000000'}]]){
    await assert.rejects(f.scope.preparePsbt(f.L,{...f.args,utxos:coins}),/unspent output/);
  }
  await assert.rejects(f.scope.preparePsbt({...f.L,select:()=>({inputs:[{txid:'dd'.repeat(32),vout:0,value:1000000}]})},f.args),/unknown coin/);
  assert.equal(f.fetches.length,0);
});
function offlineRuntime(){
  const f=runtime(),elements=new Map(),events=[],classes=new Set(['on']),timers=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{id,value:id==='qa'?'address':'',disabled:false,innerHTML:'',textContent:'',focus(){events.push(['focus',id])},appendChild(){}});return elements.get(id)};
  const scope=f.scope;
  Object.assign(scope,{$:element,ovp:{classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)}},pcard:element('pcard'),
    OFFLINE_RUN:1,OFFLINE_BUILDING:false,OFFLINE_SENDING:false,OFFLINE_DECODING:null,ANIM:null,CAM:null,WALLET_EPOCH:0,RATE:3,
    captureDraft:()=>({text,reply:null}),clearSentDraft:()=>events.push('clear'),markMine:()=>events.push('mine'),
    sats:n=>n+' sats',esc:s=>s,hint:s=>events.push(['hint',s]),setst:s=>events.push(['status',s]),fail:e=>events.push(['error',e.message]),
    setInterval:fn=>{timers.push(fn);events.push('animation');return timers.length},clearInterval:()=>events.push('stop-animation'),
    lib:async()=>({bbqr:()=>['one','two'],qrCanvas:()=>{events.push('paint');return{}}}),
    getUtxos:async()=>[{txid:TXID,vout:0,value:1}],
    preparePsbt:async()=>({psbt:bytes([1]),fee:3,vbytes:1}),
  });
  for(const name of ['stopAnim','stopCam','invalidateOffline','closeSheet','drawQR','buildQR','broadcastPasted'])vm.runInContext(declaration(name),scope);
  return {...f,element,elements,events,classes,timers};
}
test('Closing during offline loading invalidates pending work and repeated Enter cannot start concurrent preparation',async()=>{
  const f=offlineRuntime();let resolve,calls=0;
  f.scope.lib=()=>{calls++;return new Promise(r=>{resolve=r})};
  const pending=f.scope.buildQR(text);await f.scope.buildQR(text);assert.equal(calls,1);assert.equal(f.element('qgo').disabled,true);
  f.scope.closeSheet();resolve({});await pending;
  assert.equal(f.events.includes('paint'),false);assert.equal(f.events.includes('animation'),false);assert.equal(f.scope.OFFLINE_BUILDING,false);
});
test('Address edits discard a pending prepared transaction without painting or attaching a publish action',async()=>{
  const f=offlineRuntime();let finish,started;
  const ready=new Promise(r=>{started=r});
  f.scope.preparePsbt=()=>{started();return new Promise(r=>{finish=r})};
  const pending=f.scope.buildQR(text);await ready;
  f.element('qa').value='new address';f.scope.invalidateOffline();finish({psbt:bytes([1]),fee:3,vbytes:1});await pending;
  assert.equal(f.events.includes('paint'),false);assert.equal(f.events.includes('animation'),false);assert.equal(f.element('bcb').onclick,undefined);
  assert.equal(f.element('qgo').disabled,false);
});
test('Preparation failure restores the button and a retry can show the current QR',async()=>{
  const f=offlineRuntime();f.scope.preparePsbt=async()=>{throw new Error('Could not verify funding')};
  await f.scope.buildQR(text);assert.equal(f.element('qgo').disabled,false);assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='error'));
  f.scope.preparePsbt=async()=>({psbt:bytes([1]),fee:3,vbytes:1});await f.scope.buildQR(text);
  assert.ok(f.events.includes('paint'));assert.ok(f.events.includes('animation'));assert.equal(typeof f.element('bcb').onclick,'function');
});
test('A signed result from an old offline generation cannot broadcast or overwrite a reopened dialog',async()=>{
  const f=offlineRuntime();f.scope.push=async()=>{f.events.push('push');return TXID};
  f.scope.invalidateOffline();await f.scope.broadcastPasted(f.L,{text},bytes([1]),1);
  assert.equal(f.events.includes('push'),false);assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='error'),false);
});
test('A queued old QR callback cannot paint or stop the new dialog animation',async()=>{
  const f=offlineRuntime();await f.scope.buildQR(text);const stale=f.timers[0];
  f.scope.invalidateOffline();await f.scope.buildQR(text);const current=f.scope.ANIM;
  const paints=f.events.filter(e=>e==='paint').length;stale();
  assert.equal(f.scope.ANIM,current);assert.equal(f.events.filter(e=>e==='paint').length,paints);
});
