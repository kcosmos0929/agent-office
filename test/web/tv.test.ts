import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkBytes } from '../../web/src/office/tv.ts';

test('TV 글씨 색: 지정한 화면 색(sRGB) 바이트 그대로 — 선형 값으로 쓰면 한 번 더 어두워진다(#9AA5B4 → #526074가 되던 문제)', () => {
  assert.deepEqual(inkBytes('#9AA5B4'), [0x9a, 0xa5, 0xb4]);
  assert.deepEqual(inkBytes('#7CE0A3'), [0x7c, 0xe0, 0xa3]);
});
