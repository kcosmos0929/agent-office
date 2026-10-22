import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const HOOK = path.join(ROOT, 'hooks', 'claude-hook.mjs');
const STATUS = path.join(ROOT, 'hooks', 'statusline.mjs');
const TOKEN = 'd'.repeat(64);
const servers: http.Server[] = [];
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

function run(script: string, home: string, stdin: string): Promise<{ code: number | null; stdout: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [script], { env: { ...process.env, SO_HOME: home } });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - t0 }));
    child.stdin.end(stdin);
  });
}

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'so-hook-'));
}

async function fakeServer(respond = true): Promise<{ port: number; got: Array<{ url: string; auth: string; body: string }> }> {
  const got: Array<{ url: string; auth: string; body: string }> = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      got.push({ url: req.url ?? '', auth: req.headers.authorization ?? '', body });
      if (respond) { res.writeHead(204); res.end(); }
    });
  });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return { port: (srv.address() as { port: number }).port, got };
}

function writeEndpoint(home: string, port: number, pid = process.pid) {
  fs.writeFileSync(path.join(home, 'endpoint.json'), JSON.stringify({ port, token: TOKEN, pid }));
}

const PAYLOAD = JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });

test('서버 없음: 0.3초 안에 출력 없이 exit 0', async () => {
  const r = await run(HOOK, tempHome(), PAYLOAD);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 300, `${r.ms}ms`);
});

test('endpoint.json의 pid가 죽었으면 보내지 않고 끝', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port, 999_999);
  const r = await run(HOOK, home, PAYLOAD);
  assert.equal(r.code, 0);
  assert.equal(fake.got.length, 0);
});

test('서버 있음: 페이로드가 그대로 전달되고 출력 없음', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  const r = await run(HOOK, home, PAYLOAD);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(fake.got.length, 1);
  assert.equal(fake.got[0].url, '/api/claude/hook');
  assert.equal(fake.got[0].auth, 'Bearer ' + TOKEN);
  assert.equal(fake.got[0].body, PAYLOAD);
});

test('서버가 응답 안 함: 1.5초 안에 exit 0', async () => {
  const home = tempHome();
  const fake = await fakeServer(false);
  writeEndpoint(home, fake.port);
  const r = await run(HOOK, home, PAYLOAD);
  assert.equal(r.code, 0);
  assert.ok(r.ms < 1500, `${r.ms}ms`);
});

test('깨진 JSON stdin에도 출력 없이 exit 0', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  const r = await run(HOOK, home, '{깨짐');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(fake.got.length, 0);
});

test('statusline: rate_limits 있으면 "5h 62% · 3:12" 형식 출력 + 사용량 전송', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  const resets = Math.floor(Date.now() / 1000) + 3 * 3600 + 12 * 60 + 30;
  const input = JSON.stringify({ model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 62.4, resets_at: resets } } });
  const r = await run(STATUS, home, input);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '5h 62% · 3:12');
  assert.equal(fake.got[0].url, '/api/claude/usage');
  assert.equal(fake.got[0].body, input);
});

test('statusline: 사용량 없으면 모델 이름, 서버 없어도 출력', async () => {
  const r = await run(STATUS, tempHome(), JSON.stringify({ model: { display_name: 'Opus 5.5' } }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'Opus 5.5');
});
