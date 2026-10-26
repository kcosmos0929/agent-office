import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCodexTitleReader, parseCodexIndex } from '../../src/server/collectors/codexTitles.ts';

const line = (id: string, name: unknown) => JSON.stringify({ id, thread_name: name, updated_at: '2026-10-26T04:32:10Z' });

test('parseCodexIndex: 같은 id는 뒤 줄이 이김(이름 바꾸기), 깨진 줄·빈 이름은 건너뜀, 80자로 자름', () => {
  const text = [line('a', '처음 이름'), '{ 깨진 줄', line('b', ''), line('c', 7), line('a', '바꾼 이름'), line('d', '가'.repeat(100)), ''].join('\n');
  const m = parseCodexIndex(text);
  assert.equal(m.get('a'), '바꾼 이름');
  assert.equal(m.has('b'), false);
  assert.equal(m.has('c'), false);
  assert.equal([...m.get('d')!].length <= 80, true);
});

test('makeCodexTitleReader: 파일 없으면 null, 줄이 더해지면 새 제목, 큰 파일은 뒤쪽만 읽어도 마지막 제목을 찾음', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-cxt-'));
  const file = path.join(dir, 'session_index.jsonl');
  const read = makeCodexTitleReader(file);
  assert.equal(read('a'), null);
  fs.writeFileSync(file, line('a', '처음 이름') + '\n');
  assert.equal(read('a'), '처음 이름');
  fs.appendFileSync(file, line('a', '바꾼 이름') + '\n');
  assert.equal(read('a'), '바꾼 이름');
  assert.equal(read('zz'), null);
  const big = path.join(dir, 'big.jsonl');
  fs.writeFileSync(big, Array.from({ length: 40_000 }, (_, i) => line(`p${i}`, '채움 줄 '.repeat(8))).join('\n') + '\n' + line('last', '마지막') + '\n');
  assert.ok(fs.statSync(big).size > 2 * 1024 * 1024);
  assert.equal(makeCodexTitleReader(big)('last'), '마지막');
});

test('정규 파일이 아니면(FIFO·그 바로가기) 읽지 않고 null — 서버가 멈추지 않음 (리뷰 P2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-cxf-'));
  const fifo = path.join(dir, 'session_index.jsonl');
  execFileSync('mkfifo', [fifo]);
  const link = path.join(dir, 'link.jsonl');
  fs.symlinkSync(fifo, link);
  // 멈추면 이 테스트 프로세스까지 멈추므로 따로 띄운 node에서 시간 제한을 두고 확인
  const mod = path.resolve(import.meta.dirname, '../../src/server/collectors/codexTitles.ts');
  const code = `import { makeCodexTitleReader } from ${JSON.stringify(mod)}; for (const f of process.argv.slice(1)) console.log(String(makeCodexTitleReader(f)('a')));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, fifo, link], { timeout: 3000, encoding: 'utf8' });
  assert.equal(r.signal, null, '시간 안에 안 끝남(읽다가 멈춤)');
  assert.deepEqual(r.stdout.trim().split('\n'), ['null', 'null']);
});
