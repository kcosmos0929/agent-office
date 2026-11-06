import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Status } from '../../src/shared/types.ts';
import {
  ANCHOR, CELL, DIRS, DOT, FACES, HAIRS, LAYERS, LOOKS, OUTFITS, PACE_FPS, STEP, UPRIGHT,
  SEATED_ANCHOR, SEATED_SOURCE, dirFor, faceFor, headTop, lookFor, partFiles, partPath, planeOffset, planeSize, seatedDir, walkSpeed,
} from '../../web/src/office/sprites/look.ts';

test('모습: 모자 0~7은 모두 다르고 머리 넷·옷 여섯 벌을 다 쓴다', () => {
  const keys = Array.from({ length: 8 }, (_, i) => `${lookFor(i).hair}|${lookFor(i).outfit}`);
  assert.equal(new Set(keys).size, 8);
  assert.deepEqual([...new Set(LOOKS.map((l) => l.hair))].sort(), [...HAIRS].sort());
  assert.deepEqual([...new Set(LOOKS.map((l) => l.outfit))].sort(), [...OUTFITS].sort());
  assert.deepEqual(lookFor(8), lookFor(0));
});

test('부품 파일 후보는 하나 — 버전 폴더 없이 parts/… 그대로', () => {
  assert.deepEqual(partFiles('torso', LOOKS[0], 'neutral', 'SE'), ['parts/outfit/jp-classic/torso/SE.png']);
  assert.deepEqual(partFiles('head', LOOKS[3], 'neutral', 'NE'), ['parts/hair/longbob/head/NE.png']);
  assert.deepEqual(partFiles('face', LOOKS[1], 'happy', 'NW'), ['parts/face/bob/happy/NW.png']);
  for (const look of LOOKS) for (const face of FACES) for (const dir of DIRS) for (const layer of LAYERS) {
    assert.deepEqual(partFiles(layer, look, face, dir), [partPath(layer, look, face, dir)]);
  }
  assert.deepEqual(HAIRS, ['bun', 'bob', 'pony', 'longbob']);
  assert.deepEqual(OUTFITS, ['jp-classic', 'jp-vest', 'jp-suit', 'kr-blazer', 'kr-cardigan', 'kr-shirt']);
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

test('앉은 그림: 책상 바깥 자리 NW·창 쪽 SE, 기준점은 의자 가운데 바닥(v16 pose.json)', () => {
  assert.equal(seatedDir('px'), 'NW');
  assert.equal(seatedDir('nx'), 'SE');
  assert.deepEqual(SEATED_ANCHOR, { SE: [34, 85], NW: [29, 85], SW: [29, 85], NE: [34, 85] });
  // SW·NE는 SE·NW 그림 좌우 뒤집기 — 기준점 x도 칸 안에서 뒤집힌다(63 − x), 서기 ANCHOR(SE 34 ↔ SW 29)와 같은 규칙
  for (const [d, src] of [['SW', 'SE'], ['NE', 'NW']] as const) {
    assert.deepEqual(SEATED_SOURCE[d], { dir: src, mirror: true });
    assert.equal(SEATED_ANCHOR[d][0], 63 - SEATED_ANCHOR[src][0]);
    assert.equal(SEATED_ANCHOR[d][1], SEATED_ANCHOR[src][1]);
  }
  for (const d of ['SE', 'NW'] as const) assert.deepEqual(SEATED_SOURCE[d], { dir: d, mirror: false });
});
