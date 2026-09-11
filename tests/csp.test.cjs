const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace(/\r\n/g,'\n');
test('the browser permits only the exact inline application script, not injected event handlers',()=>{
  const policy=html.match(/script-src ([^;]+);/)[1];
  assert.ok(!policy.includes("'unsafe-inline'")&&!policy.includes("'unsafe-eval'"));
  for(const [,script] of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)){
    const hash=crypto.createHash('sha256').update(script).digest('base64');
    assert.ok(policy.includes("'sha256-"+hash+"'"),'Run node scripts/update-csp.cjs after changing inline JavaScript');
  }
  assert.ok(!/\son(?:click|error|load|keydown)=/i.test(html),'Use registered handlers instead of inline attributes');
});
