const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error('No inline application script found');
const hashes = scripts.map(([, script]) => "'sha256-" + crypto.createHash('sha256').update(script).digest('base64') + "'");
html = html.replace(/script-src [^;]+;/, "script-src 'self' " + hashes.join(' ') + ';');
for(const name of ['translate.js','ui-language.js','language-settings.js']){
  const filename=path.join(__dirname,'..',name);
  const source=fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n').trimEnd()+'\n';
  fs.writeFileSync(filename,source);
  const integrity='sha384-'+crypto.createHash('sha384').update(source).digest('base64');
  html=html.replace(new RegExp('<script src="'+name.replace('.', '\\.')+'"[^>]*></script>'),
    '<script src="'+name+'" integrity="'+integrity+'" defer></script>');
}
fs.writeFileSync(file, html);
console.log('Updated the application script integrity policy.');
