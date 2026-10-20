// Static dev server for the t1 rig: web/ at "/", ATHENA_AVATAR_HOME at "/home/". No deps.
// node spikes/avatar/web/serve.mjs [--port 5181]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const WEB = dirname(fileURLToPath(import.meta.url));
export const HOME = process.env.ATHENA_AVATAR_HOME || join(homedir(), '.athena-avatar');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.css': 'text/css',
};

function safeJoin(root, rel) {
  const p = resolve(root, normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, ''));
  return p.startsWith(resolve(root)) ? p : null;
}

export function startServer(port = 5181) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname;
    const file = p.startsWith('/home/') ? safeJoin(HOME, p.slice(6)) : safeJoin(WEB, p === '/' ? 'index.html' : p);
    let st;
    try { st = file && statSync(file); } catch { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-length': st.size,
      'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 5181;
  startServer(port).then(() => console.log(`t1-rig web on http://127.0.0.1:${port}/  (home: ${HOME})`));
}
