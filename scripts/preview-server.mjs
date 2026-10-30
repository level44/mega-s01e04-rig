import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    port: { type: 'string', default: '8788' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log('Usage: node scripts/preview-server.mjs --file <exported.html> [--port 8788]');
  console.log('Serves only /digest.html on 127.0.0.1; rereads the file for each request.');
  process.exit(0);
}

const port = Number(values.port);
if (!values.file || !/^\d+$/.test(values.port) || port < 1 || port > 65535) {
  console.error('Provide --file and a --port between 1 and 65535. Use --help for usage.');
  process.exit(1);
}

const file = resolve(values.file);
await readFile(file); // Fail before opening the listener if the export cannot be read.

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const pathname = request.url?.split('?', 1)[0];
  if (pathname !== '/digest.html') {
    response.writeHead(404).end('Not found');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  try {
    const html = await readFile(file);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  } catch (error) {
    const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
    response.writeHead(missing ? 404 : 500).end(missing ? 'Not found' : 'Cannot read preview');
    if (!missing) console.error(error);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Preview: http://127.0.0.1:${port}/digest.html`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
