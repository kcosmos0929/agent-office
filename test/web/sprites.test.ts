import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Status } from '../../src/shared/types.ts';
import {
  ANCHOR, CELL, DIRS, DOT, FACES, LAYERS, LOOKS, OUTFIT_VERSION, PACE_FPS, PART_BASE, STEP, UPRIGHT,
  SEATED_ANCHOR, dirFor, faceFor, headTop, lookFor, partFiles, partPath, planeOffset, planeSize, seatedDir, walkSpeed,
} from '../../web/src/office/sprites/look.ts';

const CHARACTERS = path.resolve(import.meta.dirname, '../../web/public/characters');
const PARTS = path.join(CHARACTERS, 'v15');

test('모습: 모자 0~7은 모두 다르고, 앞 6개는 정리된 6종(catalog 프리셋)의 머리·옷', () => {
  const keys = Array.from({ length: 8 }, (_, i) => `${lookFor(i).hair}|${lookFor(i).outfit}`);
  assert.equal(new Set(keys).size, 8);
  const catalog = JSON.parse(fs.readFileSync(path.join(PARTS, 'catalog.json'), 'utf8')) as { presets: Array<{ hair: string; outfit: string }> };
  assert.deepEqual(LOOKS.slice(0, 6).map((l) => [l.hair, l.outfit]), catalog.presets.map((p) => [p.hair, p.outfit]));
  assert.deepEqual(lookFor(8), lookFor(0));
});

test('부품 파일: 모든 모습×표정×방향×레이어가 실제로 있다(새 버전 옷도, 되돌릴 v15도)', () => {
  let n = 0;
  for (const look of LOOKS) for (const face of FACES) for (const dir of DIRS) for (const layer of LAYERS) {
    const files = partFiles(layer, look, face, dir);
    assert.equal(files.at(-1), `${PART_BASE}/${partPath(layer, look, face, dir)}`);
    for (const f of files) assert.ok(fs.existsSync(path.join(CHARACTERS, f)), f);
    n++;
  }
  assert.equal(n, 8 * 4 * 4 * 10);
});

test('부품 버전: 옷 여섯 벌 모두 v18 먼저, 머리·얼굴은 v15만', () => {
  for (const look of LOOKS) {
    assert.deepEqual(partFiles('torso', look, 'neutral', 'SE'), [`v18/parts/outfit/${look.outfit}/torso/SE.png`, `v15/parts/outfit/${look.outfit}/torso/SE.png`]);
    assert.deepEqual(partFiles('head', look, 'neutral', 'SE'), [`v15/parts/hair/${look.hair}/head/SE.png`]);
    assert.deepEqual(partFiles('face', look, 'happy', 'NW'), [`v15/parts/face/${look.hair}/happy/NW.png`]);
  }
  assert.deepEqual(Object.keys(OUTFIT_VERSION).sort(), ['jp-classic', 'jp-suit', 'jp-vest', 'kr-blazer', 'kr-cardigan', 'kr-shirt']);
});

test('v18 옷 부품은 v15와 같은 규격(576×96 RGBA PNG)이고 옷 여섯 벌 × 7장 × 4방향이 다 있다', () => {
  const header = (f: string) => {
    const b = fs.readFileSync(f);
    return [b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]]; // IHDR 폭·높이·비트 깊이·색 형식(6 = RGBA)
  };
  const v18 = path.join(CHARACTERS, 'v18/parts/outfit');
  assert.deepEqual(fs.readdirSync(v18).sort(), Object.keys(OUTFIT_VERSION).sort());
  let n = 0;
  for (const outfit of fs.readdirSync(v18)) for (const layer of fs.readdirSync(path.join(v18, outfit))) for (const dir of DIRS) {
    const rel = `parts/outfit/${outfit}/${layer}/${dir}.png`;
    assert.deepEqual(header(path.join(CHARACTERS, 'v18', rel)), [576, 96, 8, 6], rel);
    assert.deepEqual(header(path.join(CHARACTERS, 'v18', rel)).slice(0, 2), header(path.join(PARTS, rel)).slice(0, 2), rel);
    n++;
  }
  assert.equal(n, 6 * 7 * 4);
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

test('앉은 그림: 책상 바깥 자리 NW·창 쪽 SE, 기준점은 의자 가운데 바닥(v16 pose.json)', () => {
  assert.equal(seatedDir('px'), 'NW');
  assert.equal(seatedDir('nx'), 'SE');
  assert.deepEqual(SEATED_ANCHOR, { SE: [34, 85], NW: [29, 85] });
});
