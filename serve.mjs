import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';

const port = Number(process.argv[2] || 8080);
const prefix = '/woerterflotte/';
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path.startsWith(prefix)) path = path.slice(prefix.length - 1);
    if (path === '/') path = '/index.html';
    const type = types[extname(path)];
    if (!type || !/^\/[A-Za-z0-9._/-]+$/.test(path) || path.split('/').some(part => part.startsWith('.'))) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(new URL('.' + path, import.meta.url));
    response.writeHead(200, {'Content-Type':type, 'Cache-Control':'no-cache'}).end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port + prefix));
