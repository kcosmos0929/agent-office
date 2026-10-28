import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUOTES, QUOTE_MS, quoteAt } from '../../web/src/office/quotes.ts';

test('TV 문구: 42줄, 겹치는 줄·빈 줄 없음, 이모지 없음(픽셀 글꼴에 없어 한 색 덩어리로 찍힘)', () => {
  assert.equal(QUOTES.length, 42);
  assert.equal(new Set(QUOTES).size, QUOTES.length);
  for (const q of QUOTES) {
    assert.ok(q.trim() === q && q.length > 0, q);
    assert.ok(!/\p{Extended_Pictographic}/u.test(q), q);
  }
});

test('TV 문구: 5분 동안 같은 줄, 5분 경계를 넘으면 다른 줄', () => {
  assert.equal(QUOTE_MS, 5 * 60_000);
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % QUOTE_MS);
  assert.equal(quoteAt(t0), quoteAt(t0 + QUOTE_MS - 1));
  assert.notEqual(quoteAt(t0), quoteAt(t0 + QUOTE_MS));
});

test('TV 문구: 줄 수만큼 바뀌는 동안 모든 줄이 한 번씩 — 적은 순서(주제별) 그대로가 아니라 섞어서', () => {
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % QUOTE_MS);
  const seen = QUOTES.map((_, i) => quoteAt(t0 + i * QUOTE_MS));
  assert.deepEqual([...seen].sort(), [...QUOTES].sort());
  const start = QUOTES.indexOf(seen[0]);
  const inOrder = seen.every((q, i) => q === QUOTES[(start + i) % QUOTES.length]);
  assert.equal(inOrder, false);
});
