import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { hookToEvents } from '../../src/server/collectors/claudeHook.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const HOOK = path.join(ROOT, 'hooks', 'claude-hook.mjs');
const STATUS = path.join(ROOT, 'hooks', 'statusline.mjs');
const TOKEN = 'd'.repeat(64);
const servers: http.Server[] = [];
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

function run(script: string, home: string, stdin: string, args: string[] = []): Promise<{ code: number | null; stdout: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, SO_HOME: home } });
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

test('서버 있음: 필요한 필드만 전달되고 출력 없음', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  const r = await run(HOOK, home, PAYLOAD);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(fake.got.length, 1);
  assert.equal(fake.got[0].url, '/api/claude/hook');
  assert.equal(fake.got[0].auth, 'Bearer ' + TOKEN);
  assert.deepEqual(JSON.parse(fake.got[0].body), JSON.parse(PAYLOAD));
});

test('큰 Write(2MB)도 작은 요청으로 전달되어 editing이 되고, 대화 내용·파일 내용은 보내지 않음', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  const big = JSON.stringify({
    session_id: 's1', hook_event_name: 'PreToolUse', cwd: '/x', transcript_path: '/t.jsonl', permission_mode: 'default', prompt_id: 'p',
    tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: '/x/big.txt', content: '비밀'.repeat(1_000_000) },
  });
  await run(HOOK, home, big);
  const body = fake.got[0].body;
  assert.ok(Buffer.byteLength(body) < 4096, `${Buffer.byteLength(body)} bytes`);
  assert.ok(!body.includes('비밀'));
  assert.ok(!body.includes('permission_mode'));
  const [e] = hookToEvents(JSON.parse(body), 0);
  assert.equal(e.type, 'tool-start');
  assert.deepEqual(e.type === 'tool-start' ? [e.activity, e.detail, e.toolUseId] : null, ['editing', 'big.txt', 'w1']);
  assert.equal(e.transcriptPath, '/t.jsonl');
});

test('프롬프트·응답·도구 결과는 빼고 제목·알림 종류·끊김 여부는 남김', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  await run(HOOK, home, JSON.stringify({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: '비밀 프롬프트', session_title: '제목' }));
  await run(HOOK, home, JSON.stringify({ session_id: 's1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 't', tool_response: '비밀 출력', error: '비밀 에러', is_interrupt: true }));
  await run(HOOK, home, JSON.stringify({ session_id: 's1', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }));
  await run(HOOK, home, JSON.stringify({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: '비밀 답' }));
  const bodies = fake.got.map((g) => JSON.parse(g.body));
  assert.ok(!fake.got.some((g) => g.body.includes('비밀')));
  assert.equal(bodies[0].session_title, '제목');
  assert.equal(bodies[1].is_interrupt, true);
  assert.equal(bodies[2].notification_type, 'permission_prompt');
  assert.equal(bodies[2].message, 'Claude needs your permission to use Bash');
});

test('훅 스크립트: trigger·error는 보내고 요약·지시문·오류 원문은 안 보냄', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  await run(HOOK, home, JSON.stringify({ session_id: 's1', hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: '비밀 요약', custom_instructions: '비밀 지시' }));
  await run(HOOK, home, JSON.stringify({ session_id: 's1', hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '비밀 상세', last_assistant_message: '비밀 오류문' }));
  const [compact, failure] = fake.got.map((g) => JSON.parse(g.body));
  assert.equal(compact.trigger, 'auto');
  assert.equal(failure.error, 'rate_limit');
  for (const b of [compact, failure]) {
    for (const k of ['compact_summary', 'custom_instructions', 'error_details', 'last_assistant_message']) assert.equal(k in b, false, k);
  }
  assert.ok(!fake.got.some((g) => g.body.includes('비밀')));
});

test('codex 인자: /api/codex/hook으로, apply_patch는 파일 경로만(원문 없음, 5개까지)', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  const adds = Array.from({ length: 6 }, (_, i) => `*** Add File: /x/new${i}.md\n+비밀 ${i}\n`).join('');
  const patch = `*** Begin Patch\n*** Update File: /x/src/a.ts\n@@\n-비밀 줄\n+비밀 줄2\n${adds}*** Delete File: /x/old.ts\n*** End Patch`;
  const r = await run(HOOK, home, JSON.stringify({ session_id: 'x1', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_use_id: 'p1', tool_input: { command: patch } }), ['codex']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(fake.got[0].url, '/api/codex/hook');
  const body = JSON.parse(fake.got[0].body);
  assert.deepEqual(body.tool_input, { files: ['/x/src/a.ts', '/x/new0.md', '/x/new1.md', '/x/new2.md', '/x/new3.md'] });
  assert.ok(!fake.got[0].body.includes('비밀'));
});

test('인자 없으면 지금처럼 /api/claude/hook', async () => {
  const home = tempHome();
  const fake = await fakeServer();
  writeEndpoint(home, fake.port);
  await run(HOOK, home, PAYLOAD);
  assert.equal(fake.got[0].url, '/api/claude/hook');
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
