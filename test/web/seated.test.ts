import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Status } from '../../src/shared/types.ts';
import { LOOKS } from '../../web/src/office/sprites/look.ts';
import { SEATED_ATLAS, SEATED_CYCLE_MS, canSit, seatedCell, seatedFrame, seatedIndex, seatedMode } from '../../web/src/office/sprites/seated.ts';

// 원본 motion.json의 work·upper 시간표(칸 번호, 시작, 길이)를 그대로 옮긴 것
const SEQ = JSON.parse(readFileSync(new URL('../fixtures/seated-v23-sequences.json', import.meta.url), 'utf8')) as Record<'work' | 'upper', [number, number, number][]>;

test('seatedFrame: 원본 시간표와 0~40초 매 ms 같은 칸', () => {
  for (const mode of ['work', 'upper'] as const) {
    const steps = SEQ[mode];
    assert.equal(steps.reduce((s, [, , d]) => s + d, 0), SEATED_CYCLE_MS);
    for (let t = 0; t < 2 * SEATED_CYCLE_MS; t++) {
      const u = t % SEATED_CYCLE_MS;
      const want = steps.find(([, start, d]) => u >= start && u < start + d)![0];
      assert.equal(seatedFrame(mode, t), want, `${mode} t=${t}`);
    }
  }
});

test('seatedFrame: 음수 시각도 주기 안으로 접는다', () => {
  assert.equal(seatedFrame('work', -125), seatedFrame('work', SEATED_CYCLE_MS - 125));
});

test('seatedIndex·seatedCell: 손×9+상체×3+눈, 8열 9행 칸(그림 위에서 센 행)', () => {
  assert.equal(seatedIndex(0, 0, 0), 0);
  assert.equal(seatedIndex(7, 2, 2), 71);
  assert.equal(seatedIndex(4, 1, 0), 39);
  assert.deepEqual(seatedCell(39), { col: 7, row: 4 });
  assert.deepEqual(seatedCell(71), { col: 7, row: SEATED_ATLAS.rows - 1 });
});

test('seatedMode: 실행·고침은 타이핑, 읽기·생각류는 손 멈춤, 나머지는 서기', () => {
  const rows: [Status, string | null][] = [
    ['running', 'work'], ['editing', 'work'],
    ['reading', 'upper'], ['thinking', 'upper'], ['approving', 'upper'], ['delegating', 'upper'], ['compacting', 'upper'],
    ['permission', null], ['question', null], ['done', null], ['stalled', null], ['quota', null], ['idle', null], ['gone', null],
  ];
  for (const [s, m] of rows) assert.equal(seatedMode(s), m, s);
});

test('canSit: 앉은 그림은 JP01(번 머리 + 기본 일본형)만', () => {
  assert.deepEqual(LOOKS.map(canSit), [true, false, false, false, false, false, false, false]);
});
