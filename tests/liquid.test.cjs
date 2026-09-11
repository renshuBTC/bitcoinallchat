const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('const LIQUID=['),html.indexOf('/* ---------------- scanning ---------------- */'));
// Confirmation data verified against https://mempool.space/api/tx/<txid>.
// The final block's /txids response places 83825b… at index 1054 and 8a444e… at 1277.
const expected=[
  ['91271efcbb5ab29abfc38ae635f0644e3ba042aad56f92d40136e1dde4742fe8',965822,1788723107],
  ['bd81219691eb1e22475c5985d847fa888c38f1b6d2cb2b7193f54d0cfa72394c',965865,1788745789],
  ['3a3eac4a26395b8c2563aaf1eb8b1b77798c81c7d6337f51321827a244a480aa',965869,1788747618],
  ['83825b2135dd0abac12c9dfe17f29ab81b3427e1ae864947b0bebce5e47c3c4b',965875,1788751805],
  ['8a444eed65c4584f138e08ee138f61490ef73e84f71e14dac3ca66c230cf7e97',965875,1788751805],
];
test('Curated Liquid messages retain verified confirmation data and never invent reply edges',()=>{
  const rendered=[];let indexed;
  const scope={Date:{now(){throw Error('Pinned confirmations must not depend on the current date')}},
    reindex:messages=>{indexed=messages},turn:message=>{rendered.push(message);return '<message></message>'}};
  const output=vm.runInNewContext(source+'\nliquidHTML();',scope);
  assert.equal(rendered.length,5);assert.equal(indexed.length,5);
  assert.deepEqual(rendered.map(m=>[m.txid,m.height,m.time]),expected);
  for(const message of rendered){
    assert.equal(Object.hasOwn(message,'ins'),false);
    assert.equal(Object.hasOwn(message,'replyTo'),false);
    assert.equal(Object.hasOwn(message,'replyVout'),false);
  }
  assert.match(rendered[2].text,/sending most back to .*is that ok/);
  assert.match(rendered[3].text,/Please fix the bug first/);
  assert.match(rendered[4].text,/Yes, thank you/);
  assert.match(output,/Selected messages in block order/);
  assert.match(output,/times show Bitcoin block confirmations/);
  assert.match(output,/does not establish a reply relationship/);
  assert.doesNotMatch(output,/three outputs from|ransom note/);
});
