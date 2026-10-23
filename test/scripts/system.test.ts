import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettingsFile, stableNodePath, writeSettingsIfUnchanged } from '../../scripts/lib/system.ts';

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
