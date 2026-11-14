// Phase 33 spike: a local HTTP server on 127.0.0.1 that plays the failures a model download can meet (D9), for
// hf-fetch --test-local. Nothing leaves the computer.
//   /ok            200, 1 MB of bytes, with Range support (206)
//   /html          200 text/html: a filter's block page
//   /html-as-file  200 application/octet-stream, but a small HTML page: caught only by the size and hash
//   /403           403 Forbidden            /451  451 Unavailable For Legal Reasons
//   /429           429 with Retry-After and RateLimit headers, as Hugging Face sends
//   /drop          200 announcing 10 MB, then the connection is cut after 1 MB
//   /to-http       302 to a plain-HTTP URL elsewhere, which hf-fetch must refuse
// Usage: node scripts/spikes/local-stt/test-server.mjs [port=8765]
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8765);
const MB = 1024 * 1024;
const ok = Buffer.alloc(MB, 7);
const blockPage =
  '<!doctype html><html><body><h1>Blocked</h1><p>This site is blocked by your organisation.</p></body></html>';

createServer((req, res) => {
  const path = req.url.split('?')[0];
  switch (path) {
    case '/ok': {
      const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
      const from = range ? Number(range[1]) : 0;
      const body = ok.subarray(from);
      res.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': body.length,
        ...(range ? { 'Content-Range': `bytes ${from}-${ok.length - 1}/${ok.length}` } : {}),
      });
      return res.end(body);
    }
    case '/html':
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(blockPage);
    case '/html-as-file':
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': blockPage.length,
      });
      return res.end(blockPage);
    case '/403':
    case '/451':
      res.writeHead(Number(path.slice(1)), { 'Content-Type': 'text/plain' });
      return res.end('No');
    case '/429':
      res.writeHead(429, {
        'Retry-After': '120',
        RateLimit: '"resolvers";r=0;t=120',
        'RateLimit-Policy': '"fixed window";"resolvers";q=3000;w=300',
      });
      return res.end();
    case '/drop':
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 10 * MB });
      res.write(ok);
      return setTimeout(() => req.socket.destroy(), 200);
    case '/to-http':
      res.writeHead(302, { Location: 'http://example.com/model.gguf' });
      return res.end();
    default:
      res.writeHead(404);
      return res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`test-server on http://127.0.0.1:${port}`));
