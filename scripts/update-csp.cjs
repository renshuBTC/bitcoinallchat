const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MODULES = ['locales.js', 'translate.js', 'ui-language.js', 'language-settings.js'];
const normalize = source => source.replace(/\r\n/g, '\n').trimEnd() + '\n';
const integrity = source => 'sha384-' + crypto.createHash('sha384').update(source).digest('base64');

function applyIntegrity(input, readSource) {
  let html = normalize(input);
  const builderPin = /\bs\.integrity='sha384-[^']+'/g;
  if ([...html.matchAll(builderPin)].length !== 1) throw new Error('Expected one transaction-builder integrity pin');
  html = html.replace(builderPin, "s.integrity='" + integrity(readSource('post.js')) + "'");
  for (const name of MODULES) {
    const tag = new RegExp('<script src="' + name.replace('.', '\\.') + '"[^>]*></script>', 'g');
    if ([...html.matchAll(tag)].length !== 1) throw new Error('Expected one script tag for ' + name);
    html = html.replace(tag, '<script src="' + name + '" integrity="' + integrity(readSource(name)) + '" defer></script>');
  }
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!scripts.length || !/script-src [^;]+;/.test(html)) throw new Error('Missing inline script or CSP');
  const hashes = scripts.map(([, script]) => "'sha256-" + crypto.createHash('sha256').update(script).digest('base64') + "'");
  return html.replace(/script-src [^;]+;/, "script-src 'self' " + hashes.join(' ') + ';');
}

module.exports = { applyIntegrity, integrity, normalize, MODULES };
if (require.main === module) {
  const root = path.join(__dirname, '..'), file = path.join(root, 'index.html');
  for (const name of MODULES.concat('post.js')) {
    const target = path.join(root, name);
    fs.writeFileSync(target, normalize(fs.readFileSync(target, 'utf8')));
  }
  fs.writeFileSync(file, applyIntegrity(fs.readFileSync(file, 'utf8'), name => fs.readFileSync(path.join(root, name), 'utf8')));
  console.log('Updated all script integrity pins and the application CSP.');
}
