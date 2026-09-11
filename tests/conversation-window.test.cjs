const {test}=require('node:test'),assert=require('node:assert/strict');
const {messages,runtime}=require('./reader-fixture.cjs');
test('A dense conversation stays within 1,000 bubbles with every older and newer row reachable',async()=>{
  const h=runtime(20000,'talk'),seen=new Set(h.scope.chatPage().rows.map(h.key));
  while(h.scope.chatPage().start>0){h.position(0);await h.scope.earlierMessages();h.scope.chatPage().rows.forEach(m=>seen.add(h.key(m)));assert.equal(h.rows().length,1000)}
  assert.equal(seen.size,20000);assert.deepEqual(h.loads,[]);assert.doesNotMatch(h.html(),/<button|chat-nav/);
  while(h.scope.chatPage().end<h.scope.chatPage().matches.length){h.position(h.rows().length-5);await h.scope.newerMessages()}
  assert.equal(h.scope.chatPage().latest,true);assert.equal(h.scope.chatPage().rows.at(-1).text,'Message 19999');
});
test('Conversation shifts preserve the exact visible bubble position in both directions',async()=>{
  const h=runtime(4000,'talk');let anchor=h.position(2,70);await h.scope.earlierMessages();assert.equal(h.anchorTop(anchor),anchor.top);
  anchor=h.position(h.rows().length-5,49);await h.scope.newerMessages();assert.equal(h.anchorTop(anchor),anchor.top);
});
test('An exact historical output can be revealed outside the normal feed and selected view',()=>{
  const h=runtime(100),archived=messages(2,-1000);archived[1].txid=archived[0].txid;archived[1].vout=7;
  h.scope.searchMessages=()=>[...archived,...h.scope.msgs];assert.equal(h.scope.revealMessage(h.key(archived[1])),true);assert.equal(h.scope.filter,'talk');
  assert.ok(h.document.getElementById(h.scope.messageDomId(archived[1])));assert.equal(h.scope.msgs.length,100);assert.ok(h.scope.chatPage().rows.length<=1000);assert.equal(h.buttons[0]['aria-pressed'],'true');
});
test('Quoted-parent jumps clear incompatible search and position the exact target',()=>{
  const h=runtime(3500,'talk'),target=h.scope.msgs[7];h.scope.query='Message 3499';h.scope.render();assert.equal(h.scope.revealMessage(h.key(target)),true);assert.equal(h.scope.query,'');
  assert.ok(h.scope.chatPage().rows.some(m=>h.key(m)===h.key(target)));assert.equal(h.scope.chatPage().rows.length,1000);
});
test('A conversation edge loads one batch without network chaining or viewport jumps',async()=>{
  const h=runtime(100,'talk'),anchor=h.position(0,60);h.scope.loadBatch=async n=>{h.loads.push(n);h.scope.msgs=[...messages(2000,-2000),...h.scope.msgs]};
  await h.scope.earlierMessages();assert.deepEqual(h.loads,[3]);assert.equal(h.anchorTop(anchor),anchor.top);assert.ok(h.rows().length<=1000);
  for(let i=0;i<5;i++){h.scope.render();h.scope.handleReaderScroll();await Promise.resolve()}assert.deepEqual(h.loads,[3]);
});
test('The latest shortcut invalidates a pending older selection',async()=>{
  const h=runtime(100,'talk');let finish;h.scope.loadBatch=()=>new Promise(resolve=>finish=resolve);const pending=h.scope.earlierMessages();h.scope.latestMessages();
  h.scope.msgs=[...messages(1000,-1000),...h.scope.msgs];finish();await pending;assert.equal(h.scope.chatPage().latest,true);assert.equal(h.scope.chatPage().rows.at(-1).text,'Message 99');assert.equal(h.evaluate('CHAT_LOADING'),false);
});
test('Changing conversation search resets its window without losing matching records',async()=>{
  const h=runtime(5000,'talk');h.position(0);await h.scope.earlierMessages();h.scope.query='Message 4';h.scope.render();const seen=new Set(h.scope.chatPage().rows.map(h.key));
  while(h.scope.chatPage().start>0){h.position(0);await h.scope.earlierMessages();h.scope.chatPage().rows.forEach(m=>seen.add(h.key(m)))}assert.equal(seen.size,h.scope.chatPage().matches.length);assert.deepEqual(h.loads,[]);
});
