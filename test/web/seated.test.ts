import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { Status } from '../../src/shared/types.ts';
import { LOOKS } from '../../web/src/office/sprites/look.ts';
import { SEATED_ATLAS, SEATED_CYCLE_MS, SEATED_PARTS, SEATED_REST, canSit, seatedCell, seatedFiles, seatedFrame, seatedIndex, seatedLookId, seatedMode, seatedPreview } from '../../web/src/office/sprites/seated.ts';

const CHARACTERS = new URL('../../web/public/characters/', import.meta.url);

test('앉은 그림 파일: 여덟 모습 seated-v27/<모습> 하나씩(옛 JP01 폴더로 물러서지 않음), 모두 세 장 × SE·NW가 같은 규격(512×960 RGBA)', () => {
  assert.deepEqual(seatedFiles(LOOKS[0], 'SE', 'body'), ['seated-v27/JP01/SE/body.png']);
  assert.deepEqual(seatedFiles(LOOKS[3], 'NW', 'farArm'), ['seated-v27/KR01/NW/farArm.png']);
  assert.deepEqual(LOOKS.map(seatedLookId), ['JP01', 'JP02', 'JP03', 'KR01', 'KR02', 'KR03', 'EX1', 'EX2']);
  assert.deepEqual(seatedFiles({ hair: 'bob', outfit: 'jp-classic' }, 'SE', 'body'), []);
  // 개발실·회의실 방향(SW·NE)은 SE·NW 그림을 읽어 뒤집는다
  assert.deepEqual(seatedFiles(LOOKS[3], 'NE', 'body'), ['seated-v27/KR01/NW/body.png']);
  assert.deepEqual(seatedFiles(LOOKS[0], 'SW', 'nearArm'), ['seated-v27/JP01/SE/nearArm.png']);
  const header = (rel: string) => {
    const b = readFileSync(new URL(rel, CHARACTERS));
    return [b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]]; // IHDR 폭·높이·비트 깊이·색 형식(6 = RGBA)
  };
  let n = 0;
  for (const look of LOOKS) for (const dir of ['SE', 'NW'] as const) for (const part of SEATED_PARTS) {
    for (const f of seatedFiles(look, dir, part)) {
      assert.ok(existsSync(new URL(f, CHARACTERS)), f);
      assert.deepEqual(header(f), [512, 960, 8, 6], f);
      n++;
    }
  }
  assert.equal(n, 8 * 2 * 3);
});

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

test('seatedFrame rest(끝남 쉬기): 칸 72 + 눈 — 상체는 그대로, 일하기와 같은 때에 깜빡인다', () => {
  for (let t = 0; t < 2 * SEATED_CYCLE_MS; t += 5) {
    const eye = seatedFrame('upper', t) % 3; // upper는 손 0이라 칸 % 3 = 눈
    assert.equal(seatedFrame('rest', t), SEATED_REST + eye, `t=${t}`);
  }
  assert.equal(seatedFrame('rest', 0), 72);
  assert.equal(seatedFrame('rest', 3000), 73);
  assert.equal(seatedFrame('rest', 3080), 74);
  assert.deepEqual([72, 73, 74].map(seatedCell), [0, 1, 2].map((col) => ({ col, row: 9 })));
});

test('seatedIndex·seatedCell: 손×9+상체×3+눈, 8열 10행 칸(그림 위에서 센 행 — 마지막 행은 쉬기)', () => {
  assert.equal(seatedIndex(0, 0, 0), 0);
  assert.equal(seatedIndex(7, 2, 2), 71);
  assert.equal(seatedIndex(4, 1, 0), 39);
  assert.deepEqual(seatedCell(39), { col: 7, row: 4 });
  assert.deepEqual(seatedCell(71), { col: 7, row: 8 });
  assert.deepEqual(seatedCell(SEATED_REST + 2), { col: 2, row: SEATED_ATLAS.rows - 1 });
});

test('seatedMode: 실행·고침은 타이핑, 읽기·생각류·질문·승인 필요는 손 멈춤, 끝남은 쉬기, 나머지는 서기', () => {
  const rows: [Status, string | null][] = [
    ['running', 'work'], ['editing', 'work'],
    ['reading', 'upper'], ['thinking', 'upper'], ['approving', 'upper'], ['delegating', 'upper'], ['compacting', 'upper'],
    ['permission', 'upper'], ['question', 'upper'], ['done', 'rest'], ['stalled', null], ['quota', null], ['idle', null], ['gone', null],
  ];
  for (const [s, m] of rows) assert.equal(seatedMode(s), m, s);
});

test('canSit: 여덟 모습 모두 앉는다(LOOKS에 없는 조합은 아니다)', () => {
  assert.deepEqual(LOOKS.map(canSit), [true, true, true, true, true, true, true, true]);
  assert.equal(canSit({ hair: 'bob', outfit: 'jp-classic' }), false);
});

test('seatedPreview: 앉기는 기본으로 켜짐(움직임), ?seated=off면 끔, ?seated=still이면 첫 칸에 멈춤', () => {
  assert.equal(seatedPreview(''), 'motion');
  assert.equal(seatedPreview('?view=office'), 'motion');
  assert.equal(seatedPreview('?view=office&seated'), 'motion');
  assert.equal(seatedPreview('?seated=still'), 'still');
  assert.equal(seatedPreview('?view=office&seated=off'), 'off');
});
