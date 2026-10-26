import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldReload } from '../../web/src/reload.ts';

test('새로 고침 판단: 한 빌드당 한 번만', () => {
  const rows: Array<[string | null, string | null, string | null, boolean]> = [
    [null, 'b', null, false], // 처음 받은 빌드를 모름 → 비교 불가
    ['a', null, null, false], // 서버가 지문을 안 줌
    ['a', 'a', null, false], // 같은 빌드
    ['a', 'b', null, true], // 새 빌드, 아직 안 새로 고침
    ['a', 'b', 'b', false], // 이미 이 빌드로 새로 고침함
    ['a', 'c', 'b', true], // 또 다른 새 빌드
  ];
  for (const [loaded, seen, done, want] of rows) {
    assert.equal(shouldReload(loaded, seen, done), want, JSON.stringify([loaded, seen, done]));
  }
});
