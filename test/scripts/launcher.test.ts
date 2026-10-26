import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'launcher.applescript');

test('아이콘 앱은 보드를 크롬으로 열고(작게 띄우기가 항상 위 PiP), 크롬이 없으면 기본 브라우저', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  assert.match(src, /open -a " & quoted form of "Google Chrome"/);
  const chrome = src.indexOf('Google Chrome');
  const fallback = src.indexOf('open location baseURL');
  assert.ok(chrome > 0 && fallback > chrome, '크롬을 먼저 시도하고 실패하면 기본 브라우저');
});

test('launcher.applescript가 문법 오류 없이 컴파일됨', { skip: process.platform !== 'darwin' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'so-launch-')), 'l.scpt');
  execFileSync('osacompile', ['-o', out, FILE]);
  assert.ok(fs.existsSync(out));
});
