import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PORT = 4567;
const PROTO_DIR = path.join(os.tmpdir(), 'forge-prototypes');

let server: http.Server | null = null;

export function startPrototypeServer(): void {
  fs.mkdirSync(PROTO_DIR, { recursive: true });
  server = http.createServer((req, res) => {
    const id = (req.url || '/').replace(/^\//, '').replace(/[^a-z0-9_-]/gi, '');
    const file = path.join(PROTO_DIR, `${id}.html`);
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404);
      res.end('Prototype not found');
    }
  });
  server.listen(PORT, '127.0.0.1');
}

export function savePrototype(id: string, html: string): string {
  fs.mkdirSync(PROTO_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROTO_DIR, `${id}.html`), html);
  return `http://localhost:${PORT}/${id}`;
}

export function stopPrototypeServer(): void {
  server?.close();
}
