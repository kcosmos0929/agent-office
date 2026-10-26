import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRegistryFile, readRegistry, watchRegistry, pidAlive } from '../../src/server/collectors/sessionRegistry.ts';
import type { RegistryRead } from '../../src/server/collectors/sessionRegistry.ts';
import { claudeSessionsDir } from '../../src/server/paths.ts';

const RAW = {
  pid: 15326, sessionId: 'decaaa1f-x', cwd: '/Users/seop/Documents/CnC Wiki', startedAt: 1, procStart: 'x', version: '2.1.300',
  kind: 'interactive', entrypoint: 'claude-desktop', messagingSocketPath: '/tmp/s.sock', bridgeSessionId: 'b', hostSessionId: 'h',
  name: '작업실 애니메이션', status: 'busy', statusUpdatedAt: 1761180000000,
};

test('parseRegistryFile: 쓰는 6개만 남기고 소켓 경로 등은 버림', () => {
  assert.deepEqual(parseRegistryFile(JSON.stringify(RAW)),
    { sessionId: 'decaaa1f-x', pid: 15326, cwd: '/Users/seop/Documents/CnC Wiki', name: '작업실 애니메이션', status: 'busy', statusUpdatedAt: 1761180000000, startedAt: 1 });
});

test('parseRegistryFile: interactive 아님·깨진 JSON·모르는 status·잘못된 pid → null, 긴 이름 80자, 이름 없으면 null', () => {
  assert.equal(parseRegistryFile(JSON.stringify({ ...RAW, kind: 'sdk' })), null);
  assert.equal(parseRegistryFile('{"pid": 1, "sessionId":'), null);
  assert.equal(parseRegistryFile(JSON.stringify({ ...RAW, status: 'sleeping' })), null);
  assert.equal(parseRegistryFile(JSON.stringify({ ...RAW, pid: -3 })), null);
  assert.equal(parseRegistryFile(JSON.stringify({ ...RAW, sessionId: '' })), null);
  assert.equal(parseRegistryFile(JSON.stringify({ ...RAW, statusUpdatedAt: 'x' })), null);
  assert.equal([...(parseRegistryFile(JSON.stringify({ ...RAW, name: '가'.repeat(200) }))?.name ?? '')].length, 80);
  assert.equal(parseRegistryFile(JSON.stringify({ ...RAW, name: undefined }))?.name, null);
  assert.equal(parseRegistryFile(JSON.stringify({ ...RAW, cwd: 3 }))?.cwd, '');
});

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'so-reg-'));
}

test('readRegistry: 폴더 없음 → missing, .json만, 깨진 파일·죽은 pid는 빼고 ok', async () => {
  assert.deepEqual(await readRegistry(path.join(tempDir(), 'nope')), { health: 'missing', entries: [] });
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '100.json'), JSON.stringify({ ...RAW, pid: 100, sessionId: 'alive' }));
  fs.writeFileSync(path.join(dir, '200.json'), JSON.stringify({ ...RAW, pid: 200, sessionId: 'dead' }));
  fs.writeFileSync(path.join(dir, '300.json'), '{"pid": 300, "sess');
  fs.writeFileSync(path.join(dir, 'note.txt'), JSON.stringify({ ...RAW, pid: 100, sessionId: 'txt' }));
  const r = await readRegistry(dir, (pid) => pid === 100);
  assert.equal(r.health, 'ok');
  assert.deepEqual(r.entries.map((e) => e.sessionId), ['alive']);
});

test('readRegistry: 폴더 자리에 파일이 있으면 error', async () => {
  const file = path.join(tempDir(), 'file');
  fs.writeFileSync(file, 'x');
  assert.equal((await readRegistry(file)).health, 'error');
});

test('pidAlive: 내 프로세스는 살아 있음, 없는 pid는 죽음', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(2 ** 22 + 12345), false);
});

test('watchRegistry: 시작하자마자 읽고, 파일을 쓰면 1초 안에 읽고, stop 뒤엔 안 읽음', async () => {
  const dir = tempDir();
  const reads: RegistryRead[] = [];
  const stop = watchRegistry(dir, (r) => reads.push(r), { intervalMs: 50, isAlive: () => true });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(reads.length >= 1);
  assert.deepEqual(reads[0].entries, []);
  fs.writeFileSync(path.join(dir, '100.json'), JSON.stringify({ ...RAW, pid: 100 }));
  const deadline = Date.now() + 1000;
  while (!reads.some((r) => r.entries.length === 1) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.ok(reads.some((r) => r.entries.length === 1), '파일을 읽음');
  stop();
  const n = reads.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(reads.length, n);
});

test('claudeSessionsDir: SO_CLAUDE_SESSIONS로 바꿀 수 있음, 기본은 ~/.claude/sessions', () => {
  const before = process.env.SO_CLAUDE_SESSIONS;
  process.env.SO_CLAUDE_SESSIONS = '/tmp/x-sessions';
  assert.equal(claudeSessionsDir(), '/tmp/x-sessions');
  delete process.env.SO_CLAUDE_SESSIONS;
  assert.equal(claudeSessionsDir(), path.join(os.homedir(), '.claude', 'sessions'));
  if (before !== undefined) process.env.SO_CLAUDE_SESSIONS = before;
});
