const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/post.js', 'post.js'],
  ['/locales.js', 'locales.js'], ['/translate.js', 'translate.js'],
  ['/ui-language.js', 'ui-language.js'], ['/language-settings.js', 'language-settings.js']
]);
function createServer(root = path.join(__dirname, '..')) {
  return http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400); response.end(); return; }
    const name = ASSETS.get(pathname);
    if (!name) { response.writeHead(404); response.end(); return; }
    fs.readFile(path.join(root, name), (error, body) => {
      if (error) { response.writeHead(500); response.end('Could not read a site asset.'); return; }
      response.writeHead(200, {
        'Content-Type': (name.endsWith('.js') ? 'text/javascript' : 'text/html') + '; charset=utf-8',
        'Content-Length': body.length
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    });
  });
}
module.exports = { createServer };
if (require.main === module) {
  const argument = process.argv[2] || '8000';
  if (!/^\d{1,5}$/.test(argument) || Number(argument) < 1 || Number(argument) > 65535) throw new Error('Use a port from 1 to 65535');
  const port = Number(argument), server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('Bitcoin AllChat: http://127.0.0.1:' + port + '/'));
}
