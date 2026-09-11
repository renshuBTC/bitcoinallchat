const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const { buildLocales } = require('./build-locales.cjs');
const { applyIntegrity, normalize, MODULES } = require('./update-csp.cjs');

const root = path.join(__dirname, '..');
const check = process.argv.includes('--check');
const notice = normalize(fs.readFileSync(path.join(root, 'licenses/qrcode-generator.txt'), 'utf8'));
if (notice.includes('*/')) throw new Error('License notice cannot terminate a JavaScript comment');
const result = buildSync({
  absWorkingDir: root,
  entryPoints: ['./entry.js'],
  outfile: 'post.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  banner: { js: '/*!\n' + notice + '*/' }
});
const generated = { 'post.js': normalize(result.outputFiles[0].text), 'locales.js': buildLocales(root) };
// Hash the exact bytes we write. Editors may leave CRLF or trailing whitespace
// in handwritten modules, even though the repository checks out with LF endings.
for (const name of MODULES) {
  if (!Object.hasOwn(generated, name)) generated[name] = normalize(fs.readFileSync(path.join(root, name), 'utf8'));
}
generated['index.html'] = applyIntegrity(fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  name => generated[name] ?? fs.readFileSync(path.join(root, name), 'utf8'));
for (const [name, content] of Object.entries(generated)) {
  if (name.endsWith('.js')) new vm.Script(content, { filename: name });
  const file = path.join(root, name);
  if (check) {
    if (fs.readFileSync(file, 'utf8') !== content) throw new Error(name + ' is stale; run npm run build and commit the generated changes');
  } else fs.writeFileSync(file, content);
}
console.log(check ? 'Generated assets and integrity hashes match their sources.' : 'Built post.js, locales.js and page integrity hashes; normalized pinned modules.');
