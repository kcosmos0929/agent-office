import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTranscriptTitle } from '../../src/server/collectors/transcriptTitle.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-tr-'));
const write = (name: string, lines: unknown[]) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return p;
};

test('제목 줄이 여러 개면 마지막 것', async () => {
  const p = write('a.jsonl', [
    { type: 'user', message: { content: 'custom-title 이라는 글자가 본문에 있어도' } },
    { type: 'custom-title', customTitle: '첫 제목', sessionId: 'x' },
    { type: 'assistant', message: { content: [] } },
    { type: 'custom-title', customTitle: '정류장 승하차 결합', sessionId: 'x' },
  ]);
  assert.equal(await readTranscriptTitle(p), '정류장 승하차 결합');
});

test('파일 없음 → null', async () => {
  assert.equal(await readTranscriptTitle(path.join(dir, '없음.jsonl')), null);
});

test('제목 줄 없는 3MB 파일 → null', async () => {
  const big = Array.from({ length: 30_000 }, (_, i) => ({ type: 'assistant', i, pad: 'x'.repeat(80) }));
  const p = write('big.jsonl', big);
  assert.ok(fs.statSync(p).size > 3_000_000);
  assert.equal(await readTranscriptTitle(p), null);
});

test('앞부분에만 제목이 있는 큰 파일도 찾음', async () => {
  const lines: unknown[] = [{ type: 'custom-title', customTitle: '앞쪽 제목' }];
  for (let i = 0; i < 30_000; i++) lines.push({ type: 'assistant', i, pad: 'x'.repeat(80) });
  assert.equal(await readTranscriptTitle(write('front.jsonl', lines)), '앞쪽 제목');
});

test('깨진 제목 줄은 건너뜀', async () => {
  const p = write('broken.jsonl', [{ type: 'custom-title', customTitle: '좋은 제목' }, '{"type":"custom-title", 깨짐']);
  assert.equal(await readTranscriptTitle(p), '좋은 제목');
});
