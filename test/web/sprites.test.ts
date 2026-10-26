import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Status } from '../../src/shared/types.ts';
import {
  ANCHOR, CELL, DIRS, DOT, FACES, LAYERS, LOOKS, PACE_FPS, STEP, UPRIGHT,
  dirFor, faceFor, headTop, lookFor, partPath, planeOffset, planeSize, walkSpeed,
} from '../../web/src/office/sprites/look.ts';

const PARTS = path.resolve(import.meta.dirname, '../../web/public/characters/v15');

test('모습: 모자 0~7은 모두 다르고, 앞 6개는 정리된 6종(catalog 프리셋)의 머리·옷', () => {
  const keys = Array.from({ length: 8 }, (_, i) => `${lookFor(i).hair}|${lookFor(i).outfit}`);
  assert.equal(new Set(keys).size, 8);
  const catalog = JSON.parse(fs.readFileSync(path.join(PARTS, 'catalog.json'), 'utf8')) as { presets: Array<{ hair: string; outfit: string }> };
  assert.deepEqual(LOOKS.slice(0, 6).map((l) => [l.hair, l.outfit]), catalog.presets.map((p) => [p.hair, p.outfit]));
  assert.deepEqual(lookFor(8), lookFor(0));
});

test('부품 파일: 모든 모습×표정×방향×레이어가 실제로 있다', () => {
  let n = 0;
  for (const look of LOOKS) for (const face of FACES) for (const dir of DIRS) for (const layer of LAYERS) {
    assert.ok(fs.existsSync(path.join(PARTS, partPath(layer, look, face, dir))), partPath(layer, look, face, dir));
    n++;
  }
  assert.equal(n, 8 * 4 * 4 * 10);
});

test('부품 배치 계약이 v15 layout.json과 같다', () => {
  const layout = JSON.parse(fs.readFileSync(path.join(PARTS, 'layout.json'), 'utf8')) as { cell: number[]; rows: string[]; layerOrder: string[]; anchor: Record<string, number[]> };
  assert.deepEqual(layout.cell, [CELL.w, CELL.h]);
  assert.deepEqual(layout.rows, DIRS);
  assert.deepEqual(layout.layerOrder, LAYERS);
  for (const d of DIRS) assert.deepEqual(layout.anchor[d], [...ANCHOR[d]]);
});

test('표정: 일하는 중 집중, 끝남 환한 미소, 기다림 기본, 쉬는 중 은은한 미소', () => {
  const want: Record<string, Status[]> = {
    focused: ['approving', 'thinking', 'reading', 'editing', 'running', 'delegating', 'compacting'],
    happy: ['done'],
    neutral: ['permission', 'question', 'stalled'],
    soft: ['idle', 'quota', 'gone'],
  };
  for (const [face, statuses] of Object.entries(want)) for (const s of statuses) assert.equal(faceFor(s), face, s);
});

test('화면 방향: 격자 +x 오른쪽 아래(SE), +y 왼쪽 아래(SW), −x 왼쪽 위(NW), −y 오른쪽 위(NE)', () => {
  assert.equal(dirFor(1, 0), 'SE');
  assert.equal(dirFor(0, 1), 'SW');
  assert.equal(dirFor(-1, 0), 'NW');
  assert.equal(dirFor(0, -1), 'NE');
});

test('걷기 한 장 = 화면 가로 2·세로 1 도트, 일 받은 걸음은 자유 걸음의 2배', () => {
  // 격자 x축 한 칸은 화면에서 가로 cos45°, 세로 cos45°·sin(내려다본 각)만큼 움직인다
  const sinPitch = Math.sqrt(1 - UPRIGHT * UPRIGHT);
  assert.ok(Math.abs((STEP * Math.SQRT1_2) / DOT - 2) < 1e-9);
  assert.ok(Math.abs((STEP * Math.SQRT1_2 * sinPitch) / DOT - 1) < 0.01);
  assert.equal(PACE_FPS.work, 16);
  assert.equal(PACE_FPS.free, 8);
  assert.ok(Math.abs(walkSpeed('work') - 2 * walkSpeed('free')) < 1e-12);
});

test('판: 1440×900 창에서 도트 하나 = 0.75 CSS 점, 발 기준점이 원점에 온다', () => {
  assert.ok(Math.abs((DOT * 900) / 18.6 - 0.75) < 1e-9);
  const { w, h } = planeSize();
  for (const d of DIRS) {
    const o = planeOffset(d);
    const [ax, ay] = ANCHOR[d];
    // 판 왼쪽 위에서 기준점까지 = 기준점 도트 좌표
    assert.ok(Math.abs((-(o.x - w / 2)) / DOT - ax) < 1e-9, d);
    assert.ok(Math.abs(((o.y + h / 2) * UPRIGHT) / DOT - ay) < 1e-9, d);
  }
  assert.ok(headTop() > 1.4 && headTop() < 1.7, String(headTop()));
  assert.ok(Math.abs(planeSize(0.8).w - 0.8 * w) < 1e-12);
});
