// 로컬 서버: 신호 받기(POST) · 화면에 실시간 전송(WebSocket) · 화면 파일 제공(GET).
// 인증: 루프백 GET은 그대로, 그 밖의 GET은 토큰 쿠키, 모든 POST /api/*는 Bearer 토큰. 관리 명령은 루프백 + 전용 헤더 + 같은 출처.
// 터널 전용 문(밖에서 보기, 설정했을 때만): 127.0.0.1의 따로 된 포트. 터널은 맥 안 주소로 들어오므로 이 문은 언제나 바깥으로 다룬다 —
// 정해 둔 주소(Host)만, GET·WebSocket만, 보기 토큰 쿠키(so_view) 필수. 설계서 docs/specs/2026-10-27-외부-접속-VPS-설계.md
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';
import { TV_FOOTS, type Config } from './config.ts';
import type { TvFoot } from '../shared/types.ts';
import type { OfficeState } from './state.ts';
import { tokenMatches } from './token.ts';
import { hookPaths, hookToEvents } from './collectors/claudeHook.ts';
import { codexHookToEvents } from './collectors/codexHook.ts';
import { statuslineToUsage } from './collectors/usage.ts';
import { readTranscriptTitle } from './collectors/transcriptTitle.ts';
import { readContext, type ContextReading } from './collectors/contextUsage.ts';
import { makeContextRefresher } from './contextRefresher.ts';

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
  /** 대화 게이지 읽기(테스트에서 바꿈) */
  readContext?: (file: string) => Promise<ContextReading>;
  /** 설정 창에서 바꾼 값을 config.json에 저장 — 저장했으면 true(테스트에서 바꿈) */
  saveConfig?: (patch: Partial<Config>) => boolean;
  /** Codex 세션 id → 제목(Codex 색인 파일, 테스트에서 바꿈). 없으면 Codex 제목을 안 읽음 */
  codexTitle?: (sessionId: string) => string | null;
  /** 화면 빌드 지문(켜질 때 한 번). 바뀌면 열린 화면이 새로 고침. 없으면 null */
  build?: string | null;
  /** 밖에서 보기 토큰(터널 전용 문). config.remotePublicHost와 함께 있어야 전용 문을 연다 */
  viewerToken?: string;
  /** 보기 토큰 새로 받기(파일에 저장해 돌려줌) — 설정 창 버튼 */
  rotateViewerToken?: () => string;
  /** 터널 전용 문 포트(테스트는 0). 없으면 config.remotePort */
  remoteListenPort?: number;
};

/** remotePort = 터널 전용 문이 연 포트(안 열었으면 null) */
export type RunningServer = { port: number; remotePort: number | null; close(): Promise<void>; notify(): void };

type Door = 'main' | 'remote';

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

/** 요청 주소 → URL. 이상한 주소(`//%5B` 등)는 null — new URL이 던지면 요청 처리 밖이라 서버 전체가 꺼진다 */
function parseUrl(raw: string | undefined): URL | null {
  try {
    return new URL(raw ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

/** 지금 문은 so_token(훅 토큰), 터널 전용 문은 so_view(보기 토큰) */
const COOKIE: Record<Door, string> = { main: 'so_token', remote: 'so_view' };

function cookieToken(req: http.IncomingMessage, door: Door = 'main'): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE[door]) return v.join('=');
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
  let viewer = opts.viewerToken ?? null;
  const remoteSockets = new Set<WebSocket>();
  const remoteOn = () => !!config.remotePublicHost && viewer !== null;
  /** 터널 전용 문: 정해 둔 주소(포트 포함, 대소문자 무시)로 들어온 요청만 */
  const remoteHostOk = (host: string | undefined) =>
    !!host && !!config.remotePublicHost && host.trim().toLowerCase() === config.remotePublicHost.toLowerCase();
  /** 전용 문 WebSocket 출처: 없거나 https://<정해 둔 주소>만(스킴·포트까지) */
  const remoteOriginOk = (req: http.IncomingMessage) => {
    const origin = req.headers.origin;
    return !origin || (!!config.remotePublicHost && origin.toLowerCase() === `https://${config.remotePublicHost}`.toLowerCase());
  };
  /** 전용 문이 실제로 열렸나(설정했어도 포트가 사용 중이면 false) */
  let doorOpen = false;
  /** TV 아랫줄 판: 바뀔 때마다 커진다. 켠 시각에서 시작해 다시 켜도 앞 판보다 크다 — 화면은 더 큰 판만 믿어 늦은 응답·스냅샷이 새 값을 덮지 않게 */
  let tvFootRev = now();

  const send = (ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'snapshot', build: opts.build ?? null, ...state.snapshot(now()), tvFoot: config.tvFoot, tvFootRev }));
  };
  const notify = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      for (const ws of sockets) send(ws);
    }, BROADCAST_MS);
  };

  const refreshContext = makeContextRefresher({ state, read: opts.readContext ?? readContext, onChange: notify, now });

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
      if (action === 'codex-auto-approve') {
        // 설정 창 스위치: {on: boolean} → 바로 반영하고 config.json에 저장
        const raw = await readBody(req);
        let on: unknown;
        try {
          on = raw === null ? undefined : (JSON.parse(raw) as { on?: unknown }).on;
        } catch {
          on = undefined;
        }
        if (typeof on !== 'boolean') return text(res, 400);
        // 저장이 된 뒤에만 반영 — 실패하면 화면(체크 되돌림)·서버·파일이 같은 값으로 남게
        let saved: boolean;
        try {
          saved = opts.saveConfig ? opts.saveConfig({ codexAutoApprove: on }) : true;
        } catch {
          saved = false;
        }
        if (!saved) return text(res, 500);
        const was = config.codexAutoApprove;
        config.codexAutoApprove = on;
        // 켜는 순간 이미 떠 있던 Codex 승인 대기(🛡️·❗)도 지운다
        if (on && !was && state.dropCodexApprovals(now())) notify();
        return text(res, 204);
      }
      if (action === 'tv-foot') {
        // 설정 창 TV 아랫줄: {foot: 'quote'|'sun'|'none'} → 저장된 뒤에만 반영하고 판을 올려 {rev}로 답하고, 모든 화면에 스냅샷으로 알린다
        const raw = await readBody(req);
        let foot: unknown;
        try {
          foot = raw === null ? undefined : (JSON.parse(raw) as { foot?: unknown }).foot;
        } catch {
          foot = undefined;
        }
        if (!TV_FOOTS.includes(foot as TvFoot)) return text(res, 400);
        let saved: boolean;
        try {
          saved = opts.saveConfig ? opts.saveConfig({ tvFoot: foot as TvFoot }) : true;
        } catch {
          saved = false;
        }
        if (!saved) return text(res, 500);
        config.tvFoot = foot as TvFoot;
        tvFootRev = Math.max(tvFootRev + 1, now());
        notify();
        return json(res, { rev: tvFootRev });
      }
      if (action === 'remote-token') {
        // 밖에서 보기 토큰 새로 받기 → 옛 토큰으로 열려 있던 바깥 화면은 바로 끊는다
        if (!remoteOn() || !opts.rotateViewerToken) return text(res, 404);
        try {
          viewer = opts.rotateViewerToken();
        } catch {
          return text(res, 500);
        }
        for (const ws of remoteSockets) ws.terminate();
        return text(res, 204);
      }
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
      if (events[0]) changed = state.touchPaths(events[0].sessionId, hookPaths(payload), events[0].cwd) || changed;
      if (changed) notify();
      text(res, 204);
      if (events[0]) {
        void fetchTitle(events[0].sessionId);
        // 대화 정리 뒤엔 5초 간격을 기다리지 않고 바로 다시 읽는다
        refreshContext(events[0].sessionId, events.some((e) => e.type === 'compact-end'));
      }
      return;
    }
    if (url.pathname === '/api/codex/hook') {
      // Codex: 기록 파일은 읽지 않는다(형식이 안정적이지 않음). 제목은 Codex 색인 파일의 id·제목만
      const events = codexHookToEvents(payload, now());
      let changed = false;
      for (const e of events) changed = state.apply(e) || changed;
      const sessionId = events[0]?.sessionId;
      if (sessionId) changed = state.touchPaths(sessionId, hookPaths(payload), events[0].cwd) || changed;
      const title = sessionId && opts.codexTitle ? opts.codexTitle(sessionId) : null;
      if (sessionId && title) changed = state.apply({ type: 'title', sessionId, at: now(), cwd: '', title, kind: 'codex' }) || changed;
      if (changed) notify();
      return text(res, 204);
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

  /** door = 'remote'면 보기 토큰·so_view 쿠키(HTTPS라 Secure)를 쓰고, local은 늘 false로 들어온다 */
  const handleGet = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL, local: boolean, door: Door = 'main') => {
    const secret = door === 'remote' ? viewer : token;
    const given = url.searchParams.get('token');
    if (given !== null) {
      if (!secret || !tokenMatches(given, secret)) return text(res, 401, '토큰이 맞지 않아요');
      url.searchParams.delete('token');
      const attrs = ['Path=/', 'HttpOnly', ...(door === 'remote' ? ['Secure'] : []), 'SameSite=Strict', 'Max-Age=31536000'];
      res.writeHead(302, {
        location: url.pathname + (url.searchParams.size ? `?${url.searchParams}` : ''),
        'set-cookie': `${COOKIE[door]}=${secret}; ${attrs.join('; ')}`,
      });
      return res.end();
    }
    if (!local && (!secret || !tokenMatches(cookieToken(req, door), secret))) {
      return text(res, 401, door === 'remote' ? '토큰이 필요해요 — 맥의 설정 화면에서 「밖에서 보기」 QR을 찍으세요' : '토큰이 필요해요 — 맥의 설정 화면에서 QR로 접속하세요');
    }
    switch (url.pathname) {
      case '/healthz':
        return local ? text(res, 200, 'ok') : text(res, 404);
      case '/api/health':
        return json(res, state.snapshot(now()).health);
      case '/api/client-config':
        return json(res, { softSound: config.softSound, loopback: local, codexAutoApprove: config.codexAutoApprove, tvFoot: config.tvFoot, tvFootRev, build: opts.build ?? null });
      case '/api/lan-info': {
        if (!local) return text(res, 404);
        const ip = lanAddress();
        if (!ip) return json(res, { url: null, qrSvg: null });
        const lan = `http://${ip}:${port}/?token=${token}`;
        return json(res, { url: lan, qrSvg: await QRCode.toString(lan, { type: 'svg', margin: 1 }) });
      }
      case '/api/remote-info': {
        // 밖에서 보기 QR(보기 토큰을 담음) — 맥 안에서만
        if (!local) return text(res, 404);
        if (!remoteOn()) return json(res, { url: null, qrSvg: null });
        if (!doorOpen) return json(res, { url: null, qrSvg: null, problem: 'door-failed' });
        const remote = `https://${config.remotePublicHost}/?token=${viewer}`;
        return json(res, { url: remote, qrSvg: await QRCode.toString(remote, { type: 'svg', margin: 1 }) });
      }
    }
    return serveStatic(res, url);
  };

  const fail = (res: http.ServerResponse) => (err: unknown) => {
    console.error('[synthetic-office] 요청 처리 실패', err instanceof Error ? err.message : err);
    if (!res.headersSent) text(res, 500);
    else res.end();
  };

  const server = http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) return text(res, 403);
    const local = isLoopback(req.socket.remoteAddress ?? '');
    const url = parseUrl(req.url);
    if (!url) return text(res, 400);
    const run = req.method === 'POST' ? handlePost : req.method === 'GET' || req.method === 'HEAD' ? handleGet : null;
    if (!run) return text(res, 405);
    run(req, res, url, local).catch(fail(res));
  });

  // 터널 전용 문: 정해 둔 주소만, 보기만(GET·HEAD·WebSocket) — 훅·사용량·관리 POST는 여기로 못 들어온다
  const doorServer = http.createServer((req, res) => {
    if (!remoteHostOk(req.headers.host)) return text(res, 403);
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405);
    const url = parseUrl(req.url);
    if (!url) return text(res, 400);
    handleGet(req, res, url, false, 'remote').catch(fail(res));
  });

  // 화면은 서버에 메시지를 보내지 않는다 → 아주 작은 한도, 잘못된 프레임은 그 연결만 끊는다(서버는 계속)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const upgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer, door: Door) => {
    const local = door === 'main' && isLoopback(req.socket.remoteAddress ?? '');
    const url = parseUrl(req.url);
    if (!url) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const hostOk = door === 'remote' ? remoteHostOk(req.headers.host) : hostAllowed(req.headers.host);
    const originOk = door === 'remote' ? remoteOriginOk(req) : originAllowed(req);
    if (!hostOk || !originOk) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const secret = door === 'remote' ? viewer : token;
    if (url.pathname !== '/ws' || (!local && (!secret || !tokenMatches(cookieToken(req, door), secret)))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      if (door === 'remote') remoteSockets.add(ws);
      ws.on('error', () => ws.terminate());
      ws.on('close', () => {
        sockets.delete(ws);
        remoteSockets.delete(ws);
      });
      send(ws);
    });
  };
  server.on('upgrade', (req, socket, head) => upgrade(req, socket, head, 'main'));
  doorServer.on('upgrade', (req, socket, head) => upgrade(req, socket, head, 'remote'));

  /** 설정했을 때만 127.0.0.1에 연다. 못 열면(포트 사용 중 등) 경고만 — 지금 문은 그대로 */
  const openDoor = () =>
    new Promise<number | null>((done) => {
      if (!remoteOn()) return done(null);
      doorServer.once('error', (err) => {
        console.warn('[synthetic-office] 밖에서 보기 문을 열지 못했어요 —', err.message);
        done(null);
      });
      doorServer.listen(opts.remoteListenPort ?? config.remotePort, '127.0.0.1', () => {
        const addr = doorServer.address();
        doorOpen = true;
        done(typeof addr === 'object' && addr ? addr.port : null);
      });
    });

  const closeServer = (s: http.Server) =>
    new Promise<void>((done) => {
      if (!s.listening) return done();
      s.closeAllConnections();
      s.close(() => done());
    });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.listenPort ?? config.port, opts.host ?? '0.0.0.0', () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      void openDoor().then((remotePort) =>
        resolve({
          port,
          remotePort,
          notify,
          close: async () => {
            if (timer) clearTimeout(timer);
            for (const ws of sockets) ws.terminate();
            wss.close();
            await Promise.all([closeServer(server), closeServer(doorServer)]);
          },
        }),
      );
    });
  });
}
