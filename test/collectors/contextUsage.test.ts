import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseContextLines, readContext } from '../../src/server/collectors/contextUsage.ts';

const USAGE = { input_tokens: 2, cache_creation_input_tokens: 10468, cache_read_input_tokens: 223526, output_tokens: 564 };
const A = (o: Record<string, unknown> = {}, model = 'claude-opus-5-5', usage: object = USAGE) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { model, content: [{ type: 'text', text: '비밀 내용' }], usage }, ...o });
const BOUNDARY = JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' });
const USER = JSON.stringify({ type: 'user', message: { content: '질문' } });

test('parseContextLines: 네 값 합 234560과 모델, 결과에 내용 없음', () => {
  assert.deepEqual(parseContextLines([USER, A()]), { state: 'ok', used: 234560, model: 'claude-opus-5-5' });
});

test('parseContextLines: 하위 에이전트·<synthetic>·사용량 0은 건너뜀', () => {
  const lines = [A({}, 'claude-opus-5-5', { ...USAGE, output_tokens: 1000 }), A({ isSidechain: true }), A({}, '<synthetic>'),
    A({}, 'claude-opus-5-5', { input_tokens: 0, output_tokens: 0 })];
  assert.deepEqual(parseContextLines(lines), { state: 'ok', used: 234996, model: 'claude-opus-5-5' });
});

test('parseContextLines: 정리 경계가 마지막 답보다 뒤면 compacted, 경계 뒤에 답이 있으면 ok', () => {
  assert.deepEqual(parseContextLines([A(), BOUNDARY, USER]), { state: 'compacted' });
  assert.deepEqual(parseContextLines([A(), BOUNDARY, A({}, 'claude-opus-5-5', { input_tokens: 5, output_tokens: 5 })]), { state: 'ok', used: 10, model: 'claude-opus-5-5' });
});

test('parseContextLines: 깨진 줄은 건너뛰고, 아무것도 없으면 null, 마지막 기록의 모델', () => {
  assert.deepEqual(parseContextLines([A(), '{"type":"assistant", 깨짐']), { state: 'ok', used: 234560, model: 'claude-opus-5-5' });
  assert.equal(parseContextLines([USER, '']), null);
  assert.equal(parseContextLines([A(), A({}, 'claude-haiku-4-5-20251001')]) !== null && (parseContextLines([A(), A({}, 'claude-haiku-4-5-20251001')]) as { model: string }).model, 'claude-haiku-4-5-20251001');
});

function tempFile(lines: string[]): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'so-ctx-')), 't.jsonl');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
const FILLER = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(1000) } });

test('readContext: 끝에서 300KB 앞의 답도 찾음, 1.2MB 앞이면 null, 파일 없으면 null', async () => {
  assert.deepEqual(await readContext(tempFile([A(), ...Array(300).fill(FILLER)])), { state: 'ok', used: 234560, model: 'claude-opus-5-5' });
  assert.equal(await readContext(tempFile([A(), ...Array(1200).fill(FILLER)])), null);
  assert.equal(await readContext('/nope/none.jsonl'), null);
  assert.deepEqual(await readContext(tempFile([A()])), { state: 'ok', used: 234560, model: 'claude-opus-5-5' });
});
