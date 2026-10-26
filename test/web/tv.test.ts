import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkBytes, TV_TEXT } from '../../web/src/office/tv.ts';

test('TV 글씨 색: 지정한 화면 색(sRGB) 바이트 그대로 — 선형 값으로 쓰면 한 번 더 어두워진다(#9AA5B4 → #526074가 되던 문제)', () => {
  assert.deepEqual(inkBytes('#9AA5B4'), [0x9a, 0xa5, 0xb4]);
  assert.deepEqual(inkBytes('#7CE0A3'), [0x7c, 0xe0, 0xa3]);
});

test('TV 글줄: 갈무리 설계 크기의 정수배(같은 배율)로 그린다 — 어긋나면 획이 빠지거나 뭉친다', () => {
  const DESIGN: Record<string, number> = { Galmuri11: 12, Galmuri14: 15 };
  const scales = Object.values(TV_TEXT).map(({ font }) => {
    const [, size, family] = /^(\d+)px (\w+)$/.exec(font)!;
    return Number(size) / DESIGN[family];
  });
  for (const k of scales) assert.ok(Number.isInteger(k) && k >= 1, `배율 ${k}`);
  assert.equal(new Set(scales).size, 1);
});
