const fs = require('node:fs');
const path = require('node:path');

function buildLocales(root) {
  const dir = path.join(root, 'locales');
  const codes = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  if (!Array.isArray(codes) || codes[0] !== 'en' || new Set(codes).size !== codes.length ||
      codes.some(code => typeof code !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(code))) {
    throw new Error('Invalid language list in locales/index.json');
  }
  const sourceFiles = fs.readdirSync(dir).filter(name => name.endsWith('.json') && name !== 'index.json');
  if (sourceFiles.length !== codes.length || sourceFiles.some(name => !codes.includes(name.slice(0, -5)))) {
    throw new Error('Language list and locale source files do not match');
  }
  const dictionaries = Object.fromEntries(codes.map(code => [code, JSON.parse(fs.readFileSync(path.join(dir, code + '.json'), 'utf8'))]));
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
      throw new Error('Language must be a JSON object: ' + code);
    }
  }
  const keys = Object.keys(dictionaries.en);
  if (!keys.length) throw new Error('English source catalog must not be empty');
  const placeholders = value => (value.match(/\{[a-z]+\}/g) || []).sort().join('|');
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    if (Object.keys(dictionary).length !== keys.length ||
        keys.some(key => !Object.hasOwn(dictionary, key))) throw new Error('Incomplete language: ' + code);
    for (const key of keys) {
      const value = dictionary[key];
      if (typeof value !== 'string' || !value.trim() || placeholders(value) !== placeholders(key)) {
        throw new Error('Invalid translation or placeholders: ' + code + ': ' + key);
      }
      if (code === 'en' && value !== key) throw new Error('English source keys and values must match: ' + key);
    }
  }
  const values = Object.fromEntries(codes.map(code => [code, keys.map(key => dictionaries[code][key])]));
  return '/* Generated from locales/*.json by scripts/build-locales.cjs. Do not edit directly. */\n' +
    "(()=>{\n'use strict';\nconst keys=" + JSON.stringify(keys) + ';\nconst values=' + JSON.stringify(values) +
    ';\nwindow.BAC_LOCALES=Object.freeze(Object.fromEntries(Object.entries(values).map(([code,strings])=>[code,Object.freeze(Object.fromEntries(keys.map((key,i)=>[key,strings[i]])))])));\n})();\n';
}

module.exports = { buildLocales };
if (require.main === module) {
  const root = path.join(__dirname, '..'), file = path.join(root, 'locales.js'), built = buildLocales(root);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(file, 'utf8') !== built) throw new Error('locales.js is stale; run npm run build');
    console.log('Language catalogs match the generated browser bundle.');
  } else {
    fs.writeFileSync(file, built);
    console.log('Built locales.js. Run npm run build to refresh page integrity hashes.');
  }
}
