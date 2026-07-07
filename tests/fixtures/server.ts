import http from 'http';
import { AddressInfo } from 'net';

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

export function startFixtureServer(pages: Record<string, string>): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const html = pages[req.url ?? '/'];
    if (html === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
