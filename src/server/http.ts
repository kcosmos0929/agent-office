// 로컬 서버: 신호 받기(POST) · 화면에 실시간 전송(WebSocket) · 화면 파일 제공(GET).
// 인증: 루프백 GET은 그대로, 그 밖의 GET은 토큰 쿠키, 모든 POST /api/*는 Bearer 토큰. 관리 명령은 루프백 + 전용 헤더 + 같은 출처.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';
import type { Config } from './config.ts';
import type { OfficeState } from './state.ts';
import { tokenMatches } from './token.ts';
import { hookToEvents } from './collectors/claudeHook.ts';
import { statuslineToUsage } from './collectors/usage.ts';
import { readTranscriptTitle } from './collectors/transcriptTitle.ts';

export type AdminAction = 'restart' | 'stop';

export type ServerOptions = {
  config: Config;
  token: string;
  state: OfficeState;
  staticDir: string;
  listenPort?: number;
  host?: string;
  isLoopback?: (addr: string) => boolean;
  now?: () => number;
  onAdmin?: (action: AdminAction) => void;
};

export type RunningServer = { port: number; close(): Promise<void>; notify(): void };

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_BODY = 1024 * 1024;
const BROADCAST_MS = 100;
const TITLE_RETRY_MS = 60_000;
const SERVICE_LABEL = 'com.synthetic-office.server';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function defaultAdmin(action: AdminAction): void {
  if (action === 'restart') {
    setTimeout(() => process.exit(0), 200); // launchd(KeepAlive)가 다시 켠다
  } else {
    spawn('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${SERVICE_LABEL}`], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** Host가 IP 숫자 주소나 localhost일 때만 받는다 — 이름으로 들어오는 DNS 리바인딩(다른 사이트가 이 서버를 자기 이름으로 부르기)을 막는다 */
export function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  let h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 && net.isIPv6(h.slice(1, end));
  }
  h = h.replace(/:\d+$/, '');
  return h === 'localhost' || net.isIPv4(h);
}

/** 브라우저 WebSocket은 출처 제한이 없어서 직접 막는다: Origin이 없거나(브라우저 아님) Host와 같은 출처만 */
function originAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function cookieToken(req: http.IncomingMessage): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'so_token') return v.join('=');
  }
  return null;
}

function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lanAddress(): string | null {
  const ifaces = os.networkInterfaces();
  const names = Object.keys(ifaces).sort((a, b) => (a === 'en0' ? -1 : b === 'en0' ? 1 : 0));
  for (const name of names) {
    for (const i of ifaces[name] ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

function text(res: http.ServerResponse, status: number, body = ''): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function json(res: http.ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { config, token, state, staticDir } = opts;
  const now = opts.now ?? Date.now;
  const isLoopback = opts.isLoopback ?? ((a: string) => LOOPBACK.has(a));
  const onAdmin = opts.onAdmin ?? defaultAdmin;
  const sockets = new Set<WebSocket>();
  const titleTried = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let port = 0;

  const send = (ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'snapshot', ...state.snapshot(now()) }));
  };
  const notify = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      for (const ws of sockets) send(ws);
    }, BROADCAST_MS);
  };

  const fetchTitle = async (sessionId: string) => {
    const transcript = state.needsTitle(sessionId);
    const last = titleTried.get(sessionId) ?? 0;
    if (!transcript || now() - last < TITLE_RETRY_MS) return;
    titleTried.set(sessionId, now());
    const title = await readTranscriptTitle(transcript).catch(() => null);
    if (title && state.apply({ type: 'title', sessionId, at: now(), cwd: '', title })) notify();
  };

  const handlePost = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL, local: boolean) => {
    if (url.pathname.startsWith('/api/admin/')) {
      const origin = req.headers.origin;
      const sameOrigin = !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
      if (!local || req.headers['x-so-admin'] !== '1' || !sameOrigin) return text(res, 403);
      const action = url.pathname.slice('/api/admin/'.length);
      if (action !== 'restart' && action !== 'stop') return text(res, 404);
      text(res, 202);
      setImmediate(() => onAdmin(action));
      return;
    }
    if (!url.pathname.startsWith('/api/')) return text(res, 404);
    if (!tokenMatches(bearer(req), token)) return text(res, 401);
    const body = await readBody(req);
    if (body === null) return text(res, 413);
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return text(res, 400);
    }
    if (url.pathname === '/api/claude/hook') {
      const events = hookToEvents(payload, now());
      let changed = false;
      for (const e of events) changed = state.apply(e) || changed;
      if (changed) notify();
      text(res, 204);
      if (events[0]) void fetchTitle(events[0].sessionId);
      return;
    }
    if (url.pathname === '/api/claude/usage') {
      const usage = statuslineToUsage(payload, now());
      if (usage && state.setUsage(usage)) notify();
      return text(res, 204);
    }
    return text(res, 404);
  };

  const serveStatic = (res: http.ServerResponse, url: URL) => {
    const root = path.resolve(staticDir);
    if (!fs.existsSync(path.join(root, 'index.html'))) return text(res, 503, '화면 빌드가 없어요 — npm run build:web');
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return text(res, 400);
    }
    let file = path.resolve(root, '.' + (rel === '/' ? '/index.html' : rel));
    if (file !== root && !file.startsWith(root + path.sep)) return text(res, 404);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(file)) return text(res, 404);
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };

  const handleGet = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL, local: boolean) => {
    const given = url.searchParams.get('token');
    if (given !== null) {
      if (!tokenMatches(given, token)) return text(res, 401, '토큰이 맞지 않아요');
      url.searchParams.delete('token');
      res.writeHead(302, {
        location: url.pathname + (url.searchParams.size ? `?${url.searchParams}` : ''),
        'set-cookie': `so_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
      });
      return res.end();
    }
    if (!local && !tokenMatches(cookieToken(req), token)) return text(res, 401, '토큰이 필요해요 — 맥의 설정 화면에서 QR로 접속하세요');
    switch (url.pathname) {
      case '/healthz':
        return local ? text(res, 200, 'ok') : text(res, 404);
      case '/api/client-config':
        return json(res, { softSound: config.softSound, loopback: local });
      case '/api/lan-info': {
        if (!local) return text(res, 404);
        const ip = lanAddress();
        if (!ip) return json(res, { url: null, qrSvg: null });
        const lan = `http://${ip}:${port}/?token=${token}`;
        return json(res, { url: lan, qrSvg: await QRCode.toString(lan, { type: 'svg', margin: 1 }) });
      }
    }
    return serveStatic(res, url);
  };

  const server = http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) return text(res, 403);
    const local = isLoopback(req.socket.remoteAddress ?? '');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const run = req.method === 'POST' ? handlePost : req.method === 'GET' || req.method === 'HEAD' ? handleGet : null;
    if (!run) return text(res, 405);
    run(req, res, url, local).catch((err: unknown) => {
      console.error('[synthetic-office] 요청 처리 실패', err instanceof Error ? err.message : err);
      if (!res.headersSent) text(res, 500);
      else res.end();
    });
  });

  // 화면은 서버에 메시지를 보내지 않는다 → 아주 작은 한도, 잘못된 프레임은 그 연결만 끊는다(서버는 계속)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const local = isLoopback(req.socket.remoteAddress ?? '');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!hostAllowed(req.headers.host) || !originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws' || (!local && !tokenMatches(cookieToken(req), token))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on('error', () => ws.terminate());
      ws.on('close', () => sockets.delete(ws));
      send(ws);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.listenPort ?? config.port, opts.host ?? '0.0.0.0', () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        notify,
        close: () =>
          new Promise<void>((done) => {
            if (timer) clearTimeout(timer);
            for (const ws of sockets) ws.terminate();
            wss.close();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
