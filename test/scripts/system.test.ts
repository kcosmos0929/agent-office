import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupSettings, readSettingsFile, stableNodePath, updateJsonFile, writeSettingsIfUnchanged } from '../../scripts/lib/system.ts';
import { codexUninstallEdit, mergeCodexHooks } from '../../scripts/lib/codexHooksMerge.ts';

function tempSettings(content: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-set-'));
  const file = path.join(dir, 'settings.json');
  if (content !== null) fs.writeFileSync(file, content);
  return file;
}

test('stableNodePath: Homebrew 버전 경로 대신 고정 링크', () => {
  const exists = (p: string) => p === '/opt/homebrew/bin/node';
  assert.equal(stableNodePath('/opt/homebrew/Cellar/node/26.3.0/bin/node', exists), '/opt/homebrew/bin/node');
  assert.equal(stableNodePath('/usr/local/Cellar/node/22.1.0/bin/node', (p) => p === '/usr/local/bin/node'), '/usr/local/bin/node');
});

test('stableNodePath: 링크가 없거나 Cellar가 아니면 그대로', () => {
  assert.equal(stableNodePath('/opt/homebrew/Cellar/node/26.3.0/bin/node', () => false), '/opt/homebrew/Cellar/node/26.3.0/bin/node');
  assert.equal(stableNodePath('/Users/seop/.nvm/versions/node/v26.3.0/bin/node', () => true), '/Users/seop/.nvm/versions/node/v26.3.0/bin/node');
});

test('설정이 읽은 그대로면 쓰고 true', () => {
  const file = tempSettings('{"model":"opus"}');
  const { raw, settings } = readSettingsFile(file);
  assert.deepEqual(settings, { model: 'opus' });
  assert.equal(writeSettingsIfUnchanged({ ...settings, hooks: {} }, raw, file), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { model: 'opus', hooks: {} });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'], '임시 파일이 남지 않음');
});

test('읽은 뒤 다른 프로그램이 설정을 바꿨으면 쓰지 않고 false, 그 변경이 그대로 남음', () => {
  const file = tempSettings('{"model":"opus"}');
  const { raw, settings } = readSettingsFile(file);
  fs.writeFileSync(file, '{"model":"opus","theme":"dark"}'); // Claude Code가 끼어들어 씀
  assert.equal(writeSettingsIfUnchanged({ ...settings, hooks: {} }, raw, file), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"model":"opus","theme":"dark"}');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('설정 파일이 바로가기(심볼릭 링크)면 링크는 두고 진짜 파일을 바꿈', () => {
  const real = tempSettings('{"a":1}');
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'so-link-')), 'settings.json');
  fs.symlinkSync(real, link);
  const { raw } = readSettingsFile(link);
  assert.equal(writeSettingsIfUnchanged({ a: 2 }, raw, link), true);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { a: 2 });
});

test('파일이 없던 상태에서 읽었는데 그사이 생겼으면 false', () => {
  const file = tempSettings(null);
  const { raw, settings } = readSettingsFile(file);
  assert.equal(raw, null);
  assert.deepEqual(settings, {});
  fs.writeFileSync(file, '{"b":1}');
  assert.equal(writeSettingsIfUnchanged({ c: 1 }, raw, file), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"b":1}');
});

// ---------- 2단계: 공용 원문 비교 쓰기 ----------
function tmpFile(content?: string): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'so-upd-')), 'hooks.json');
  if (content !== undefined) fs.writeFileSync(f, content);
  return f;
}
const addMine = (cur: Record<string, unknown>) => ({ next: { ...cur, mine: true }, changed: cur.mine !== true, conflict: null });

test('updateJsonFile: 없던 파일은 written(백업 함수 부름), 같은 내용이면 unchanged', () => {
  const f = tmpFile();
  let backups = 0;
  assert.deepEqual(updateJsonFile(f, addMine, () => { backups++; return null; }), { kind: 'written', backup: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { mine: true });
  assert.deepEqual(updateJsonFile(f, addMine, () => 'b'), { kind: 'unchanged' });
  assert.equal(backups, 1);
});

test('updateJsonFile: 그사이 다른 프로그램이 바꾸면 다시 읽어 병합, 계속 바뀌면 busy', () => {
  const f = tmpFile('{"other":1}');
  let calls = 0;
  const r = updateJsonFile(f, (cur) => {
    if (calls++ === 0) fs.writeFileSync(f, '{"other":2}');
    return addMine(cur);
  }, () => null);
  assert.equal(r.kind, 'written');
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { other: 2, mine: true });
  const g = tmpFile('{"n":0}');
  let n = 0;
  const busy = updateJsonFile(g, (cur) => { fs.writeFileSync(g, JSON.stringify({ n: ++n })); return addMine(cur); }, () => null);
  assert.deepEqual(busy, { kind: 'busy' });
});

test('updateJsonFile: 깨진 JSON은 conflict, 파일 그대로', () => {
  const bad = tmpFile('{ not json');
  assert.equal(updateJsonFile(bad, addMine, () => null).kind, 'conflict');
  assert.equal(fs.readFileSync(bad, 'utf8'), '{ not json');
});

test('backupSettings: 다른 파일·접두어로 <dir>/codex-hooks-설치전-날짜.json, 같은 날 두 번째는 시각을 붙임', () => {
  const f = tmpFile('{"a":1}');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-bak-'));
  const first = backupSettings('설치전', f, 'codex-hooks', dir)!;
  assert.match(path.basename(first), /^codex-hooks-설치전-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(fs.readFileSync(first, 'utf8'), '{"a":1}');
  const second = backupSettings('설치전', f, 'codex-hooks', dir)!;
  assert.match(path.basename(second), /^codex-hooks-설치전-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  assert.equal(backupSettings('설치전', f + '.none', 'codex-hooks', dir), null);
});

test('updateJsonFile: 쓰기·백업 I/O 오류는 던지지 않고 conflict(오류 이름), 원본·폴더에 흔적 없음', () => {
  const f = tmpFile('{"a":1}');
  const dir = path.dirname(f);
  fs.chmodSync(dir, 0o500);
  try {
    const r = updateJsonFile(f, addMine, () => null);
    assert.equal(r.kind, 'conflict');
    assert.match(r.kind === 'conflict' ? r.message : '', /EACCES/);
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.deepEqual(fs.readdirSync(dir), ['hooks.json']);
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}');
  const r2 = updateJsonFile(tmpFile('{}'), addMine, () => { throw Object.assign(new Error('꽉 참'), { code: 'ENOSPC' }); });
  assert.equal(r2.kind, 'conflict');
  assert.match(r2.kind === 'conflict' ? r2.message : '', /ENOSPC/);
});

test('Codex 제거는 hooks.json을 절대 지우지 않음: 우리 훅만 있던 파일도 {}로, 바로가기면 링크·원본 둘 다 남음 (리뷰 P1)', () => {
  const CMD = '"/opt/homebrew/bin/node" "/Users/seop/.synthetic-office/bin/claude-hook.mjs" codex';
  const ours = JSON.stringify(mergeCodexHooks({}, CMD).next);
  const f = tmpFile(ours);
  assert.equal(updateJsonFile(f, codexUninstallEdit, () => null).kind, 'written');
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), {});
  const real = tmpFile(ours);
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'so-lnk-')), 'hooks.json');
  fs.symlinkSync(real, link);
  assert.equal(updateJsonFile(link, codexUninstallEdit, () => null).kind, 'written');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), {});
});
