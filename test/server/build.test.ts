import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildId } from '../../src/server/build.ts';

test('빌드 지문: index.html 내용이 같으면 같고 12자 16진수', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-build-'));
  fs.writeFileSync(path.join(dir, 'index.html'), 'a');
  const a = buildId(dir);
  assert.match(a ?? '', /^[0-9a-f]{12}$/);
  assert.equal(buildId(dir), a);
});

test('빌드 지문: index.html 내용이 바뀌면 값이 달라짐', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-build-'));
  fs.writeFileSync(path.join(dir, 'index.html'), 'a');
  const a = buildId(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), 'b');
  assert.notEqual(buildId(dir), a);
});

test('빌드 지문: index.html이 없으면 null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-build-'));
  assert.equal(buildId(dir), null);
});
