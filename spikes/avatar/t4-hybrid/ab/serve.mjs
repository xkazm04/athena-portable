// A/B server for t4-hybrid (port 5183): t1's web/ at "/" (so /src/rig.js is t1's runtime, unchanged),
// this folder at "/t4/", ATHENA_AVATAR_HOME at "/home/". No deps.
//   node spikes/avatar/t4-hybrid/ab/serve.mjs [--port 5183]
//   http://127.0.0.1:5183/t4/?line=calm&portrait=<id>        (portrait omitted -> stub face)
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const AB = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(AB, '../../web');
const HOME = process.env.ATHENA_AVATAR_HOME || join(homedir(), '.athena-avatar');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.css': 'text/css' };
const safeJoin = (root, rel) => {
  const p = resolve(root, normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, ''));
  return p.startsWith(resolve(root)) ? p : null;
};

export function startServer(port = 5183) {
  const server = createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const file = p.startsWith('/home/') ? safeJoin(HOME, p.slice(6))
      : p.startsWith('/t4/') ? safeJoin(AB, p === '/t4/' ? 'index.html' : p.slice(4))
      : safeJoin(WEB, p === '/' ? 'index.html' : p);
    let st; try { st = file && statSync(file); } catch { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 5183;
  startServer(port).then(() => console.log(`t4 A/B on http://127.0.0.1:${port}/t4/  (home: ${HOME})`));
}
