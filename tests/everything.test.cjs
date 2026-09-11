const {test}=require('node:test'),assert=require('node:assert/strict');
const {messages,runtime}=require('./reader-fixture.cjs');
test('Everything draws at most 2,000 rows with no inline navigation buttons',()=>{
  const h=runtime();assert.equal(h.rows().length,2000);assert.equal(h.scope.allPage().start,2500);
  assert.doesNotMatch(h.html(),/<button|payload-nav|all-earlier|all-latest/);assert.match(h.html(),/Scroll up to load earlier entries/);
});
test('Overlapping windows reach every record in both directions without extra requests',async()=>{
  const h=runtime(),seen=new Set(h.scope.allPage().rows.map(h.key));
  while(h.scope.allPage().start>0){h.position(0);await h.scope.earlierPayloads();h.scope.allPage().rows.forEach(m=>seen.add(h.key(m)));assert.ok(h.rows().length<=2000)}
  assert.equal(seen.size,4500);assert.deepEqual(h.loads,[]);
  while(h.scope.allPage().end<h.scope.allPage().matches.length){h.position(h.rows().length-8);await h.scope.newerPayloads();assert.ok(h.rows().length<=2000)}
  assert.equal(h.scope.allPage().latest,true);assert.equal(h.scope.allPage().rows.at(-1).text,'Message 4499');
});
test('Older and newer shifts preserve the visible row at its exact pixel offset',async()=>{
  const h=runtime();let anchor=h.position(4,63);await h.scope.earlierPayloads();assert.equal(h.anchorTop(anchor),anchor.top);
  anchor=h.position(h.rows().length-7,51);await h.scope.newerPayloads();assert.equal(h.anchorTop(anchor),anchor.top);assert.deepEqual(h.loads,[]);
});
test('One edge gesture loads one batch, preserves its anchor, and never chains from rendering',async()=>{
  const h=runtime(1000),anchor=h.position(1,27);
  h.scope.loadBatch=async n=>{h.loads.push(n);h.scope.msgs=[...messages(2500,-2500),...h.scope.msgs]};
  await h.scope.earlierPayloads();assert.deepEqual(h.loads,[3]);assert.equal(h.anchorTop(anchor),anchor.top);assert.equal(h.rows().length,2000);
  for(let i=0;i<8;i++){h.scope.render();h.scope.handleReaderScroll();await Promise.resolve()}assert.deepEqual(h.loads,[3]);
});
test('An empty batch stops until another upward gesture even while its edge remains visible',async()=>{
  const h=runtime(0);h.scope.readerUserScroll(-1);await new Promise(setImmediate);assert.deepEqual(h.loads,[3]);
  for(let i=0;i<10;i++){h.scope.render();h.scope.handleReaderScroll();await Promise.resolve()}assert.deepEqual(h.loads,[3]);
  h.scope.readerUserScroll(-1);await new Promise(setImmediate);assert.deepEqual(h.loads,[3,3]);
});
test('Programmatic smooth-scroll frames and resize clamping cannot initiate loading',async()=>{
  const h=runtime(100);h.position(70);h.scope.syncReaderScroll();
  for(const y of [1000,600,200,0]){h.window.scrollY=y;h.scope.handleReaderScroll();await Promise.resolve()}
  assert.deepEqual(h.loads,[]);
  h.scope.readerUserScroll(-1);await new Promise(setImmediate);assert.deepEqual(h.loads,[3]);
});
test('A Home-style user scroll keeps its intent through animation until reaching the older edge once',async()=>{
  const h=runtime(4500);h.position(500);const first=h.scope.allPage().rows[0];h.scope.readerUserScroll(-1);
  for(const y of [8000,4000,1000,0]){h.window.scrollY=y;h.scope.handleReaderScroll();await Promise.resolve()}
  assert.equal(h.scope.allPage().start,1500);assert.notEqual(h.key(h.scope.allPage().rows[0]),h.key(first));assert.deepEqual(h.loads,[]);
  assert.equal(h.evaluate('READER_SCROLL_ARMED'),0);
});
test('Idle scroll intent expires before unrelated later programmatic movement',async()=>{
  const h=runtime(1000);h.position(500);h.scope.readerUserScroll(-1);assert.equal(h.timers.size,1);
  [...h.timers.values()][0]();assert.equal(h.evaluate('READER_SCROLL_ARMED'),0);
  h.window.scrollY=0;h.scope.handleReaderScroll();await Promise.resolve();assert.deepEqual(h.loads,[]);
});
test('Repeated input during an in-flight batch cannot start overlapping requests',async()=>{
  const h=runtime(100);let finish;h.scope.loadBatch=n=>{h.loads.push(n);return new Promise(resolve=>finish=resolve)};
  const pending=h.scope.earlierPayloads();for(let i=0;i<10;i++)h.scope.readerUserScroll(-1);
  assert.deepEqual(h.loads,[3]);finish();await pending;assert.equal(h.scope.busy,false);
});
test('Failed scans keep current rows and another upward gesture retries without a button',async()=>{
  const h=runtime(100),anchor=h.position(2);h.scope.loadBatch=async()=>{throw Error('offline')};
  await h.scope.earlierPayloads();assert.equal(h.scope.LOAD_FAILED,true);assert.equal(h.anchorTop(anchor),anchor.top);
  assert.match(h.html(),/Scroll up to retry/);assert.doesNotMatch(h.html(),/<button/);
  h.scope.loadBatch=async n=>{h.loads.push(n);assert.equal(h.scope.LOAD_FAILED,false)};
  await h.scope.earlierPayloads();assert.deepEqual(h.loads,[3]);assert.equal(h.scope.busy,false);
});
test('An exhausted edge does not fetch and newer cached records remain reachable',async()=>{
  const h=runtime(4500);h.scope.next=0;while(h.scope.allPage().start>0){h.position(0);await h.scope.earlierPayloads()}
  await h.scope.earlierPayloads();assert.deepEqual(h.loads,[]);assert.match(h.html(),/Beginning of the scanned range/);
  h.position(h.rows().length-4);await h.scope.newerPayloads();assert.ok(h.scope.allPage().start>0);
});
test('Changing view, query or latest selection while loading cannot move the new viewport',async()=>{
  for(const change of ['view','query','latest']){
    const h=runtime(100);let finish;h.scope.loadBatch=()=>new Promise(resolve=>finish=resolve);const pending=h.scope.earlierPayloads();
    if(change==='view')h.scope.filter='talk';else if(change==='query')h.scope.query='missing';else h.scope.latestPayloads();
    h.scope.render();const before=h.window.scrollY;finish();await pending;assert.equal(h.window.scrollY,before);assert.equal(h.scope.busy,false);assert.equal(h.evaluate('ALL_LOADING'),false);
  }
});
test('Live arrivals preserve an older window and its exact visible position',async()=>{
  const h=runtime();h.position(0);await h.scope.earlierPayloads();const anchor=h.position(500,75),keys=h.scope.allPage().rows.map(h.key);
  h.scope.msgs=[...messages(20,-20),...h.scope.msgs,...messages(30,4500)];h.scope.render();assert.deepEqual(h.scope.allPage().rows.map(h.key),keys);assert.equal(h.anchorTop(anchor),anchor.top);
});
test('Reader gestures are ignored in overlays, language menus, and editable controls',()=>{
  const h=runtime(0);h.node('ovs').classList.add('on');h.scope.readerUserScroll(-1);assert.deepEqual(h.loads,[]);
  h.node('ovs').classList.remove('on');h.node('language-menu').hidden=false;h.scope.readerUserScroll(-1);assert.deepEqual(h.loads,[]);
  h.node('language-menu').hidden=true;for(const target of ['textarea','input','contenteditable'])assert.equal(h.scope.readerInputAllowed({target:{closest:()=>target}}),false);
  assert.equal(h.scope.readerInputAllowed({target:{closest:()=>null}}),true);
});
test('Initial paint says Loading until a chain tip is known and refreshes visible search',()=>{
  const h=runtime(0);h.scope.TIP=0;h.scope.next=0;h.scope.render();assert.match(h.html(),/Loading…/);assert.doesNotMatch(h.html(),/Beginning of the scanned range/);assert.ok(h.refreshes()>0);
});
test('Payload previews stay bounded and escaped',()=>{
  const h=runtime(1);h.scope.msgs[0].text='<img src=x onerror=alert(1)>';h.scope.render();assert.match(h.html(),/&lt;img/);assert.doesNotMatch(h.html(),/<img/);
  assert.equal(h.scope.payloadExcerpt({kind:'talk',text:' '.repeat(1000000)+'hidden'}),' ');assert.equal(h.scope.messageExcerpt({text:' '.repeat(1000000)+'hidden'}),' ');
});
