import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { startServer } from '../../src/server/http.ts';
import { loadConfig } from '../../src/server/config.ts';
import { loadOrCreateToken } from '../../src/server/token.ts';
import { OfficeState } from '../../src/server/state.ts';
import type { Snapshot } from '../../src/shared/types.ts';
import { fx, M } from '../helpers.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'so-home-'));
const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-static-'));
fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>office</title>');
const TOKEN = 'a'.repeat(64);
const closers: Array<() => Promise<void>> = [];
after(async () => { for (const c of closers) await c(); });

async function boot(extra: Partial<Parameters<typeof startServer>[0]> = {}) {
  const config = loadConfig(home);
  const state = new OfficeState({ idleMs: 30 * M, goneMs: 10 * M, stalledMs: 15 * M, resolveProject: () => '가로망 중심성' });
  const admin: string[] = [];
  const srv = await startServer({ config, token: TOKEN, state, staticDir, listenPort: 0, host: '127.0.0.1', onAdmin: (a) => admin.push(a), ...extra });
  closers.push(srv.close);
  return { url: `http://127.0.0.1:${srv.port}`, port: srv.port, admin, srv };
}

function nextSnapshot(ws: WebSocket, pred: (s: Snapshot) => boolean): Promise<Snapshot> {
  return new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type === 'snapshot' && pred(msg)) resolve(msg);
    });
  });
}

test('토큰 없는 POST는 401, 맞는 토큰이면 204 후 WebSocket에 permission 스냅샷', async () => {
  const { url } = await boot();
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  const first = await nextSnapshot(ws, () => true);
  assert.deepEqual(first.agents, []);
  const body = JSON.stringify(fx('permission'));
  assert.equal((await fetch(url + '/api/claude/hook', { method: 'POST', body })).status, 401);
  assert.equal((await fetch(url + '/api/claude/hook', { method: 'POST', body, headers: { authorization: 'Bearer ' + 'b'.repeat(64) } })).status, 401);
  const waiting = nextSnapshot(ws, (s) => s.agents.length === 1);
  assert.equal((await fetch(url + '/api/claude/hook', { method: 'POST', body, headers: { authorization: 'Bearer ' + TOKEN } })).status, 204);
  const snap = await waiting;
  assert.equal(snap.agents[0].status, 'permission');
  assert.equal(snap.agents[0].project, '가로망 중심성');
  ws.close();
});

test('깨진 JSON은 400', async () => {
  const { url } = await boot();
  const r = await fetch(url + '/api/claude/hook', { method: 'POST', body: '{깨짐', headers: { authorization: 'Bearer ' + TOKEN } });
  assert.equal(r.status, 400);
});

test('사용량 POST가 스냅샷에 반영', async () => {
  const { url } = await boot();
  const resets = Math.floor(Date.now() / 1000) + 3600;
  const r = await fetch(url + '/api/claude/usage', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 62, resets_at: resets } } }) });
  assert.equal(r.status, 204);
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  const snap = await nextSnapshot(ws, () => true);
  assert.equal(snap.usage?.fiveHour?.pct, 62);
  ws.close();
});

test('루프백 GET /은 200, 원격이면 X-Forwarded-For로 흉내 내도 401', async () => {
  const local = await boot();
  const ok = await fetch(local.url + '/');
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /office/);
  const remote = await boot({ isLoopback: () => false });
  const r = await fetch(remote.url + '/', { headers: { 'x-forwarded-for': '127.0.0.1' } });
  assert.equal(r.status, 401);
});

test('?token= 으로 들어오면 쿠키 설정 후 토큰 없는 주소로 302, 그 쿠키로 접속 가능', async () => {
  const { url } = await boot({ isLoopback: () => false });
  const r = await fetch(url + '/?view=list&token=' + TOKEN, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/?view=list');
  const cookie = r.headers.get('set-cookie') ?? '';
  assert.match(cookie, /so_token=a{64}/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const again = await fetch(url + '/?view=list', { headers: { cookie: 'so_token=' + TOKEN } });
  assert.equal(again.status, 200);
  const bad = await fetch(url + '/?token=' + 'c'.repeat(64), { redirect: 'manual' });
  assert.equal(bad.status, 401);
});

test('원격 WebSocket은 쿠키 없으면 거절', async () => {
  const { url } = await boot({ isLoopback: () => false });
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  const code = await new Promise<number>((resolve) => ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)));
  assert.equal(code, 401);
});

test('1MB 넘는 본문 413', async () => {
  const { url } = await boot();
  const r = await fetch(url + '/api/claude/hook', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 10), headers: { authorization: 'Bearer ' + TOKEN } });
  assert.equal(r.status, 413);
});

test('정적 파일 경로 탈출 막기', async () => {
  const { url } = await boot();
  const r = await fetch(url + '/..%2f..%2fetc%2fpasswd');
  assert.notEqual(r.status, 200);
});

test('client-config와 healthz, lan-info는 루프백만', async () => {
  const local = await boot();
  assert.deepEqual(await (await fetch(local.url + '/api/client-config')).json(), { softSound: true, loopback: true });
  assert.equal(await (await fetch(local.url + '/healthz')).text(), 'ok');
  const remote = await boot({ isLoopback: () => false });
  const cookie = { cookie: 'so_token=' + TOKEN };
  assert.deepEqual(await (await fetch(remote.url + '/api/client-config', { headers: cookie })).json(), { softSound: true, loopback: false });
  assert.equal((await fetch(remote.url + '/healthz', { headers: cookie })).status, 404);
  assert.equal((await fetch(remote.url + '/api/lan-info', { headers: cookie })).status, 404);
});

test('admin: 루프백 + X-SO-Admin 헤더 + 같은 출처만', async () => {
  const { url, admin, port } = await boot();
  assert.equal((await fetch(url + '/api/admin/restart', { method: 'POST' })).status, 403);
  assert.equal((await fetch(url + '/api/admin/restart', { method: 'POST', headers: { 'x-so-admin': '1', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(url + '/api/admin/restart', { method: 'POST', headers: { 'x-so-admin': '1', origin: `http://127.0.0.1:${port}` } })).status, 202);
  assert.equal((await fetch(url + '/api/admin/stop', { method: 'POST', headers: { 'x-so-admin': '1' } })).status, 202);
  assert.equal((await fetch(url + '/api/admin/nope', { method: 'POST', headers: { 'x-so-admin': '1' } })).status, 404);
  assert.deepEqual(admin, ['restart', 'stop']);
  const remote = await boot({ isLoopback: () => false });
  assert.equal((await fetch(remote.url + '/api/admin/stop', { method: 'POST', headers: { 'x-so-admin': '1', cookie: 'so_token=' + TOKEN } })).status, 403);
});

test('loadConfig: 없으면 기본값 파일 생성', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'so-cfg-'));
  const c = loadConfig(h);
  assert.equal(c.port, 4310);
  assert.equal(c.idleMinutes, 30);
  assert.equal(c.goneMinutes, 10);
  assert.equal(c.stalledMinutes, 15);
  assert.equal(c.softSound, true);
  assert.equal(c.wikiPath, path.join(os.homedir(), 'Documents', 'CnC Wiki'));
  assert.equal(c.projectNames['lst-seongsu'], '성수 LST');
  assert.ok(fs.existsSync(path.join(h, 'config.json')));
  fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ port: 5000, idleMinutes: 5 }));
  const c2 = loadConfig(h);
  assert.equal(c2.port, 5000);
  assert.equal(c2.idleMinutes, 5);
  assert.equal(c2.goneMinutes, 10);
  fs.writeFileSync(path.join(h, 'config.json'), '{깨짐');
  assert.equal(loadConfig(h).port, 4310);
  assert.equal(fs.readFileSync(path.join(h, 'config.json'), 'utf8'), '{깨짐', '깨진 설정은 덮어쓰지 않음');
});

test('토큰 파일 권한 0600, 다시 읽으면 같은 토큰', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'so-tok-'));
  const t = loadOrCreateToken(h);
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(path.join(h, 'token')).mode & 0o777, 0o600);
  assert.equal(loadOrCreateToken(h), t);
});
