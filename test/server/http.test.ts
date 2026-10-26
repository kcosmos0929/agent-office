import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { startServer } from '../../src/server/http.ts';
import { loadConfig, saveConfigPatch } from '../../src/server/config.ts';
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
  const state = new OfficeState({ restMs: 30 * M, leaveMs: 120 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, resolveProject: () => '가로망 중심성', startedAt: 0, registryWaitRule: false });
  const admin: string[] = [];
  const srv = await startServer({ config, token: TOKEN, state, staticDir, listenPort: 0, host: '127.0.0.1', onAdmin: (a) => admin.push(a), ...extra });
  closers.push(srv.close);
  return { url: `http://127.0.0.1:${srv.port}`, port: srv.port, admin, srv };
}

async function bootWithWork(resolveWork: (p: string, cwd: string) => string | null) {
  const config = loadConfig(home);
  const state = new OfficeState({ restMs: 30 * M, leaveMs: 120 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, resolveProject: () => 'CnC Wiki', startedAt: 0, registryWaitRule: false, resolveWork });
  const srv = await startServer({ config, token: TOKEN, state, staticDir, listenPort: 0, host: '127.0.0.1' });
  closers.push(srv.close);
  return { url: `http://127.0.0.1:${srv.port}`, state };
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
  assert.deepEqual(await (await fetch(local.url + '/api/client-config')).json(), { softSound: true, loopback: true, codexAutoApprove: true });
  assert.equal(await (await fetch(local.url + '/healthz')).text(), 'ok');
  const remote = await boot({ isLoopback: () => false });
  const cookie = { cookie: 'so_token=' + TOKEN };
  assert.deepEqual(await (await fetch(remote.url + '/api/client-config', { headers: cookie })).json(), { softSound: true, loopback: false, codexAutoApprove: true });
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

function rawRequest(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}

test('DNS 리바인딩 차단: 이름 Host(IP·localhost가 아님)는 403, 토큰을 주는 lan-info도 막힘', async () => {
  const { port } = await boot();
  assert.equal(await rawRequest(port, '/api/lan-info', { host: 'attacker.example' }), 403);
  assert.equal(await rawRequest(port, '/', { host: `evil.example:${port}` }), 403);
  assert.equal(await rawRequest(port, '/healthz', { host: `localhost:${port}` }), 200);
  assert.equal(await rawRequest(port, '/healthz', { host: `127.0.0.1:${port}` }), 200);
  assert.equal(await rawRequest(port, '/healthz', { host: `[::1]:${port}` }), 200);
});

test('폰(LAN IP Host + 쿠키)은 그대로 접속', async () => {
  const { port } = await boot({ isLoopback: () => false });
  assert.equal(await rawRequest(port, '/', { host: `192.168.0.5:${port}`, cookie: 'so_token=' + TOKEN }), 200);
});

test('다른 사이트(Origin이 다른) WebSocket은 거절, 같은 출처·Origin 없음은 허용', async () => {
  const { url, port } = await boot();
  const evil = new WebSocket(url.replace('http', 'ws') + '/ws', { origin: 'https://evil.example' });
  const code = await new Promise<number>((resolve) => {
    evil.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    evil.on('open', () => resolve(101));
  });
  assert.equal(code, 403);
  const same = new WebSocket(url.replace('http', 'ws') + '/ws', { origin: `http://127.0.0.1:${port}` });
  assert.ok((await nextSnapshot(same, () => true)).agents);
  same.close();
});

test('잘못된 WebSocket 프레임·너무 큰 메시지에도 서버는 살아 있음', async () => {
  const { url } = await boot();
  const bad = new WebSocket(url.replace('http', 'ws') + '/ws');
  await nextSnapshot(bad, () => true);
  bad.on('error', () => {});
  // 마스크된 텍스트 프레임, 내용 0xFF(UTF-8 아님)
  (bad as unknown as { _socket: import('node:net').Socket })._socket.write(Buffer.from([0x81, 0x81, 0, 0, 0, 0, 0xff]));
  const big = new WebSocket(url.replace('http', 'ws') + '/ws');
  await nextSnapshot(big, () => true);
  big.on('error', () => {});
  big.send('x'.repeat(10_000));
  await new Promise((r) => setTimeout(r, 300));
  const r = await fetch(url + '/healthz');
  assert.equal(await r.text(), 'ok');
  const fresh = new WebSocket(url.replace('http', 'ws') + '/ws');
  assert.ok((await nextSnapshot(fresh, () => true)).agents);
  fresh.close();
});

test('loadConfig: 없으면 기본값 파일 생성', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'so-cfg-'));
  const c = loadConfig(h);
  assert.equal(c.port, 4310);
  assert.equal(c.restMinutes, 10);
  assert.equal(c.leaveMinutes, 120);
  assert.equal(c.goneMinutes, 10);
  assert.equal(c.stalledMinutes, 15);
  assert.equal(c.forgetHours, 12);
  assert.equal(c.softSound, true);
  assert.equal(c.codexAutoApprove, true);
  assert.equal(c.wikiPath, path.join(os.homedir(), 'Documents', 'CnC Wiki'));
  assert.equal(c.projectNames['lst-seongsu'], '성수 LST');
  assert.ok(fs.existsSync(path.join(h, 'config.json')));
  fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ port: 5000, restMinutes: 5 }));
  const c2 = loadConfig(h);
  assert.equal(c2.port, 5000);
  assert.equal(c2.restMinutes, 5);
  assert.equal(c2.leaveMinutes, 120);
  fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ idleMinutes: 30 }));
  assert.equal(loadConfig(h).restMinutes, 10, '옛 idleMinutes는 더 읽지 않음');
  fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ port: 5000, restMinutes: 5 }));
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

test('hook 뒤 대화 게이지가 스냅샷에 실림', { timeout: 5000 }, async () => {
  const { url } = await boot({ readContext: async () => ({ state: 'ok', used: 500_000, model: 'claude-opus-5-5' }) });
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  await nextSnapshot(ws, () => true);
  const got = nextSnapshot(ws, (s) => s.agents.some((a) => a.context?.state === 'ok'));
  const r = await fetch(url + '/api/claude/hook', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(fx('stop')) });
  assert.equal(r.status, 204);
  const snap = await got;
  assert.deepEqual(snap.agents[0].context, { state: 'ok', used: 500_000, window: 1_000_000, model: 'claude-opus-5-5' });
  ws.close();
});

test('/api/health: 루프백은 JSON(키 6개), 루프백이 아니면 쿠키 없을 때 401', async () => {
  const { url } = await boot();
  const r = await fetch(url + '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(await r.json()).sort(), ['hookless', 'lastCodexHookAt', 'lastHookAt', 'registry', 'sessions', 'startedAt']);
  const remote = await boot({ isLoopback: () => false });
  assert.equal((await fetch(remote.url + '/api/health')).status, 401);
});

test('POST /api/codex/hook: 토큰 없으면 401, 있으면 204 후 스냅샷에 codex 에이전트', { timeout: 5000 }, async () => {
  const { url } = await boot();
  const body = JSON.stringify({ session_id: 'x1', cwd: '/x', hook_event_name: 'UserPromptSubmit' });
  assert.equal((await fetch(url + '/api/codex/hook', { method: 'POST', body })).status, 401);
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  await nextSnapshot(ws, () => true);
  const got = nextSnapshot(ws, (s) => s.agents.some((a) => a.kind === 'codex'));
  const r = await fetch(url + '/api/codex/hook', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body });
  assert.equal(r.status, 204);
  const snap = await got;
  assert.deepEqual([snap.agents[0].id, snap.agents[0].status], ['codex:x1', 'thinking']);
  ws.close();
});

test('훅이 만진 경로로 프로젝트 이름표가 바뀜(Claude 파일 경로·Codex 상대 경로 패치)', { timeout: 5000 }, async () => {
  const { url, state } = await bootWithWork((p, cwd) => (p.includes('lst_ss') || cwd.includes('lst_ss') && p.startsWith('src') ? '성수 LST' : null));
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  await nextSnapshot(ws, () => true);
  const got = nextSnapshot(ws, (s) => s.agents.some((a) => a.project === '성수 LST'));
  const body = JSON.stringify({ session_id: 'c9', cwd: '/vault', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: '/Users/seop/developer/lst_ss/a.py' } });
  assert.equal((await fetch(url + '/api/claude/hook', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body })).status, 204);
  assert.equal((await got).agents.find((a) => a.sessionId === 'c9')!.project, '성수 LST');
  const cx = JSON.stringify({ session_id: 'x8', cwd: '/Users/seop/developer/lst_ss', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_use_id: 'p1', tool_input: { files: ['src/b.py'] } });
  await fetch(url + '/api/codex/hook', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: cx });
  assert.equal(state.snapshot(0).agents.find((a) => a.sessionId === 'x8')!.project, '성수 LST');
  ws.close();
});

test('POST /api/codex/hook: Codex 제목 읽기가 주는 제목을 붙임(Claude 훅엔 안 씀)', { timeout: 5000 }, async () => {
  const asked: string[] = [];
  const { url } = await boot({ codexTitle: (id) => { asked.push(id); return id === 'x9' ? 'touch 명령 실행' : null; } });
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  await nextSnapshot(ws, () => true);
  const got = nextSnapshot(ws, (s) => s.agents.some((a) => a.title === 'touch 명령 실행'));
  const body = JSON.stringify({ session_id: 'x9', cwd: '/x', hook_event_name: 'UserPromptSubmit' });
  assert.equal((await fetch(url + '/api/codex/hook', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body })).status, 204);
  const snap = await got;
  assert.deepEqual([snap.agents[0].id, snap.agents[0].title], ['codex:x9', 'touch 명령 실행']);
  assert.deepEqual(asked, ['x9']);
  ws.close();
});

test('admin codex-auto-approve: 루프백+헤더만, {on: boolean}이면 설정을 바꾸고 저장, 아니면 400', async () => {
  const saved: unknown[] = [];
  const { url, srv } = await boot({ saveConfig: (patch) => { saved.push(patch); return true; } });
  const post = (body: string, headers: Record<string, string> = { 'x-so-admin': '1' }) => fetch(url + '/api/admin/codex-auto-approve', { method: 'POST', headers, body });
  assert.equal((await post('{"on":false}', {})).status, 403);
  assert.equal((await post('{"on":"아니"}')).status, 400);
  assert.equal((await post('깨진')).status, 400);
  assert.equal((await post('{"on":false}')).status, 204);
  assert.deepEqual(saved, [{ codexAutoApprove: false }]);
  assert.equal((await (await fetch(url + '/api/client-config')).json()).codexAutoApprove, false);
  void srv;
});

test('admin codex-auto-approve: 저장에 실패하면(false·예외) 500이고 설정은 그대로, 켜면 이미 떠 있던 Codex 승인 대기를 지움 (리뷰 P2)', { timeout: 5000 }, async () => {
  let fail: 'no' | 'false' | 'throw' = 'false';
  const { url } = await boot({ saveConfig: () => { if (fail === 'throw') throw new Error('디스크'); return fail === 'no'; } });
  const post = (on: boolean) => fetch(url + '/api/admin/codex-auto-approve', { method: 'POST', headers: { 'x-so-admin': '1' }, body: JSON.stringify({ on }) });
  const cfg = async () => (await (await fetch(url + '/api/client-config')).json()).codexAutoApprove;
  assert.equal((await post(false)).status, 500);
  assert.equal(await cfg(), true);
  fail = 'throw';
  assert.equal((await post(false)).status, 500);
  assert.equal(await cfg(), true);
  fail = 'no';
  assert.equal((await post(false)).status, 204);
  assert.equal(await cfg(), false);
  const hook = (o: Record<string, unknown>) => fetch(url + '/api/codex/hook', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ session_id: 'x5', cwd: '/x', ...o }) });
  await hook({ hook_event_name: 'UserPromptSubmit' });
  await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'npm test' } });
  await hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  await nextSnapshot(ws, (s) => s.agents.some((a) => a.sessionId === 'x5' && a.status === 'approving'));
  const cleared = nextSnapshot(ws, (s) => s.agents.some((a) => a.sessionId === 'x5' && a.status === 'running'));
  assert.equal((await post(true)).status, 204);
  await cleared;
  ws.close();
});

test('saveConfigPatch: config.json의 다른 값·프로젝트 이름은 그대로 두고 그 키만 바꿈', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'so-cfgp-'));
  fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ port: 4999, projectNames: { a: '가' }, extra: 1 }));
  assert.equal(saveConfigPatch(h, { codexAutoApprove: false }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8')), { port: 4999, projectNames: { a: '가' }, extra: 1, codexAutoApprove: false });
  assert.equal(loadConfig(h).codexAutoApprove, false);
  fs.writeFileSync(path.join(h, 'config.json'), '{ 깨진');
  assert.equal(saveConfigPatch(h, { codexAutoApprove: true }), false);
  assert.equal(fs.readFileSync(path.join(h, 'config.json'), 'utf8'), '{ 깨진');
});
