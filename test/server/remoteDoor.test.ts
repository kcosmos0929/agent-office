// 외부 접속(VPS) 터널 전용 문 — 설계서 docs/specs/2026-10-27-외부-접속-VPS-설계.md 4장
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { WebSocket } from 'ws';
import { startServer } from '../../src/server/http.ts';
import { loadConfig } from '../../src/server/config.ts';
import { loadOrCreateToken, loadOrCreateViewerToken, rotateViewerToken } from '../../src/server/token.ts';
import { OfficeState } from '../../src/server/state.ts';
import { M } from '../helpers.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'so-remote-'));
const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-remote-static-'));
fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>office</title>');
const TOKEN = 'a'.repeat(64);
const VIEW = 'b'.repeat(64);
const NEXT = 'c'.repeat(64);
const PUBLIC = 'office-1-2-3-4.sslip.io:8443';
const closers: Array<() => Promise<void>> = [];
after(async () => { for (const c of closers) await c(); });

async function boot(o: { publicHost?: string | null; remoteListenPort?: number; rotate?: () => string } = {}) {
  const config = { ...loadConfig(home), remotePublicHost: o.publicHost === undefined ? PUBLIC : o.publicHost };
  const state = new OfficeState({ restMs: 30 * M, leaveMs: 120 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, resolveProject: () => 'x', startedAt: 0, registryWaitRule: false });
  const srv = await startServer({
    config, token: TOKEN, viewerToken: VIEW, rotateViewerToken: o.rotate ?? (() => NEXT), state, staticDir,
    listenPort: 0, host: '127.0.0.1', remoteListenPort: o.remoteListenPort ?? 0, onAdmin: () => {},
  });
  closers.push(srv.close);
  return { main: srv.port, door: srv.remotePort };
}

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };
function req(port: number, p: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: PUBLIC, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}
const view = (t = VIEW) => ({ cookie: `so_view=${t}` });

function wsStatus(port: number, headers: Record<string, string>, origin?: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { host: PUBLIC, ...headers }, ...(origin ? { origin } : {}) });
    ws.on('unexpected-response', (_q, res) => resolve(res.statusCode ?? 0));
    ws.on('message', () => { resolve(101); ws.close(); });
  });
}

test('설정 기본값: 외부 접속은 꺼짐(remotePublicHost null), 맥 안 포트 4311', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'so-remote-cfg-'));
  const c = loadConfig(h);
  assert.equal(c.remotePublicHost, null);
  assert.equal(c.remotePort, 4311);
});

test('보기 토큰: 훅 토큰과 다른 파일(0600), 다시 읽으면 같고 새로 받으면 바뀜', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'so-remote-tok-'));
  const hook = loadOrCreateToken(h);
  const v = loadOrCreateViewerToken(h);
  assert.match(v, /^[0-9a-f]{64}$/);
  assert.notEqual(v, hook);
  assert.equal(fs.statSync(path.join(h, 'viewer-token')).mode & 0o777, 0o600);
  assert.equal(loadOrCreateViewerToken(h), v);
  const n = rotateViewerToken(h);
  assert.notEqual(n, v);
  assert.equal(loadOrCreateViewerToken(h), n);
  assert.equal(loadOrCreateToken(h), hook, '훅 토큰은 그대로');
});

test('꺼져 있으면 전용 문을 열지 않음(remotePort null), remote-info는 null', async () => {
  const { main, door } = await boot({ publicHost: null });
  assert.equal(door, null);
  const info = await req(main, '/api/remote-info', { host: `127.0.0.1:${main}` });
  assert.deepEqual(JSON.parse(info.body), { url: null, qrSvg: null });
});

test('전용 문: 터널로 와서 맥 안 주소여도 토큰 없으면 401, 훅 토큰 쿠키도 401', async () => {
  const { door } = await boot();
  assert.equal((await req(door!, '/')).status, 401);
  assert.equal((await req(door!, '/', { cookie: `so_token=${TOKEN}` })).status, 401);
  assert.equal((await req(door!, '/', view(TOKEN))).status, 401);
  assert.equal((await req(door!, '/', view())).status, 200);
});

test('전용 문: ?token=보기 토큰 → Secure 쿠키 + 토큰 없는 주소로 302, 훅 토큰은 401', async () => {
  const { door } = await boot();
  const r = await req(door!, `/?view=list&token=${VIEW}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/?view=list');
  const cookie = String(r.headers['set-cookie'] ?? '');
  assert.match(cookie, new RegExp(`so_view=${VIEW}`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal((await req(door!, `/?token=${TOKEN}`)).status, 401);
});

test('전용 문: 보기만 — POST(훅·관리·사용량)는 Bearer가 맞아도 405', async () => {
  const { door } = await boot();
  const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...view() };
  assert.equal((await req(door!, '/api/claude/hook', bearer, 'POST')).status, 405);
  assert.equal((await req(door!, '/api/codex/hook', bearer, 'POST')).status, 405);
  assert.equal((await req(door!, '/api/claude/usage', bearer, 'POST')).status, 405);
  assert.equal((await req(door!, '/api/admin/stop', { 'x-so-admin': '1', ...view() }, 'POST')).status, 405);
  assert.equal((await req(door!, '/api/admin/remote-token', { 'x-so-admin': '1', ...view() }, 'POST')).status, 405);
});

test('전용 문: 토큰을 주는 길·맥 안 전용 길은 404, client-config는 loopback false', async () => {
  const { door } = await boot();
  for (const p of ['/api/lan-info', '/api/remote-info', '/healthz']) assert.equal((await req(door!, p, view())).status, 404, p);
  assert.equal(JSON.parse((await req(door!, '/api/client-config', view())).body).loopback, false);
  assert.equal((await req(door!, '/api/health', view())).status, 200);
});

test('전용 문: 정해 둔 주소(Host)만 — 다른 이름·IP·localhost는 403, 대소문자는 무시', async () => {
  const { door } = await boot();
  assert.equal((await req(door!, '/', { host: 'evil.example:8443', ...view() })).status, 403);
  assert.equal((await req(door!, '/', { host: `127.0.0.1:${door}`, ...view() })).status, 403);
  assert.equal((await req(door!, '/', { host: `localhost:${door}`, ...view() })).status, 403);
  assert.equal((await req(door!, '/', { host: PUBLIC.replace(':8443', ''), ...view() })).status, 403);
  assert.equal((await req(door!, '/', { host: PUBLIC.toUpperCase(), ...view() })).status, 200);
});

test('전용 문 WebSocket: 쿠키 없으면 401, 다른 출처 403, https 같은 출처·쿠키면 스냅샷', async () => {
  const { door } = await boot();
  assert.equal(await wsStatus(door!, {}), 401);
  assert.equal(await wsStatus(door!, view(), 'https://evil.example'), 403);
  assert.equal(await wsStatus(door!, view(), `https://${PUBLIC}`), 101);
  assert.equal(await wsStatus(door!, view()), 101);
});

test('지금 문: remote-info는 맥 안에서만(주소에 보기 토큰), 밖에선 404', async () => {
  const { main } = await boot();
  const info = JSON.parse((await req(main, '/api/remote-info', { host: `127.0.0.1:${main}` })).body) as { url: string; qrSvg: string };
  assert.equal(info.url, `https://${PUBLIC}/?token=${VIEW}`);
  assert.match(info.qrSvg, /<svg/);
  // 이름 Host는 지금 문에서 막힘(DNS 리바인딩), 바깥(LAN) 접속은 404
  assert.equal((await req(main, '/api/remote-info', { host: PUBLIC })).status, 403);
});

test('지금 문: 토큰 새로 받기 — 맥 안 + 관리 머리말만, 옛 쿠키는 401·새 쿠키는 200, 열린 바깥 WebSocket은 끊김', async () => {
  const { main, door } = await boot();
  const ws = new WebSocket(`ws://127.0.0.1:${door}/ws`, { headers: { host: PUBLIC, ...view() } });
  await new Promise((r) => ws.once('message', r));
  const closed = new Promise((r) => ws.once('close', r));
  assert.equal((await req(main, '/api/admin/remote-token', { host: `127.0.0.1:${main}` }, 'POST')).status, 403);
  assert.equal((await req(main, '/api/admin/remote-token', { host: `127.0.0.1:${main}`, 'x-so-admin': '1', origin: 'https://evil.example' }, 'POST')).status, 403);
  assert.equal((await req(main, '/api/admin/remote-token', { host: `127.0.0.1:${main}`, 'x-so-admin': '1' }, 'POST')).status, 204);
  await closed;
  assert.equal((await req(door!, '/', view())).status, 401);
  assert.equal((await req(door!, '/', view(NEXT))).status, 200);
  const info = JSON.parse((await req(main, '/api/remote-info', { host: `127.0.0.1:${main}` })).body) as { url: string };
  assert.equal(info.url, `https://${PUBLIC}/?token=${NEXT}`);
});

/** Upgrade 요청을 보내고 어떻게 끝나는지(응답 코드·연결 끊김)만 본다 */
function rawUpgrade(port: number, p: string): Promise<string> {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, headers: { host: PUBLIC, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13', ...view() } });
    r.on('response', (res) => { res.resume(); resolve(`status ${res.statusCode}`); });
    r.on('upgrade', (_res, socket) => { socket.destroy(); resolve('upgraded'); });
    r.on('error', () => resolve('closed'));
    r.end();
  });
}

test('잘못된 주소 한 줄(//%5B)로 서버가 꺼지지 않음 — 두 문 모두 400, WebSocket은 거절, 그 뒤에도 응답 (리뷰 P2)', async () => {
  const { main, door } = await boot();
  assert.equal((await req(main, '//%5B', { host: `127.0.0.1:${main}` })).status, 400);
  assert.equal((await req(door!, '//%5B', view())).status, 400);
  assert.notEqual(await rawUpgrade(door!, '//%5B'), 'upgraded');
  assert.notEqual(await rawUpgrade(main, '//%5B'), 'upgraded');
  assert.equal((await req(main, '/', { host: `127.0.0.1:${main}` })).status, 200);
  assert.equal((await req(door!, '/', view())).status, 200);
});

test('전용 문 WebSocket: http:// 출처는 주소가 같아도 403 — https 출처만 (리뷰 P2)', async () => {
  const { door } = await boot();
  assert.equal(await wsStatus(door!, view(), `http://${PUBLIC}`), 403);
  assert.equal(await wsStatus(door!, view(), `https://${PUBLIC.replace(':8443', ':9443')}`), 403);
  assert.equal(await wsStatus(door!, view(), `https://${PUBLIC}`), 101);
});

test('토큰 새로 받기 실패(저장 오류) → 500, 옛 토큰·열린 WebSocket은 그대로 (리뷰 P2)', async () => {
  const { main, door } = await boot({ rotate: () => { throw new Error('disk'); } });
  const ws = new WebSocket(`ws://127.0.0.1:${door}/ws`, { headers: { host: PUBLIC, ...view() } });
  await new Promise((r) => ws.once('message', r));
  assert.equal((await req(main, '/api/admin/remote-token', { host: `127.0.0.1:${main}`, 'x-so-admin': '1' }, 'POST')).status, 500);
  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal((await req(door!, '/', view())).status, 200);
  ws.close();
});

test('보기 토큰 새로 받기는 통째로 바꾸거나 그대로 둠 — 새 파일을 못 만들면 옛 토큰 파일이 그대로 (리뷰 P2)', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'so-remote-atomic-'));
  const v = loadOrCreateViewerToken(h);
  fs.chmodSync(h, 0o500);
  try {
    assert.throws(() => rotateViewerToken(h));
    assert.equal(fs.readFileSync(path.join(h, 'viewer-token'), 'utf8').trim(), v);
  } finally {
    fs.chmodSync(h, 0o700);
  }
  assert.deepEqual(fs.readdirSync(h).filter((f) => f.includes('.tmp')), []);
});

test('전용 문을 못 열면(포트 사용 중) 지금 문은 그대로, remote-info는 QR 대신 실패 상태 (리뷰 P3)', async () => {
  const busy = net.createServer();
  await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()));
  closers.push(() => new Promise<void>((r) => busy.close(() => r())));
  const taken = (busy.address() as net.AddressInfo).port;
  const { main, door } = await boot({ remoteListenPort: taken });
  assert.equal(door, null);
  const info = JSON.parse((await req(main, '/api/remote-info', { host: `127.0.0.1:${main}` })).body) as { url: unknown; qrSvg: unknown; problem?: string };
  assert.equal(info.url, null);
  assert.equal(info.qrSvg, null);
  assert.equal(info.problem, 'door-failed');
  assert.equal((await req(main, '/', { host: `127.0.0.1:${main}` })).status, 200);
});
