// 그림 묶음(art pack) 규격: 코드가 읽는 312장이 다 있고 크기·형식이 맞는지.
// 기본은 레포의 대체 그림, ART_PACK_DIR로 다른 묶음(예: 비공개 진짜 그림)도 같은 검사를 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, FACES, LAYERS, LOOKS, partFiles } from '../../web/src/office/sprites/look.ts';
import { SEATED_PARTS, seatedFiles } from '../../web/src/office/sprites/seated.ts';
import { PACK_FORMAT, packFiles } from '../../web/src/office/sprites/pack.ts';

const PACK = process.env.ART_PACK_DIR ?? path.resolve(import.meta.dirname, '../../web/public/characters');

test('packFiles: 312장, 경로 중복 없음, 서기 부품 576×96 · 앉은 시트 512×960', () => {
  const files = packFiles();
  assert.equal(files.length, 312);
  assert.equal(new Set(files.map((f) => f.path)).size, 312);
  for (const f of files) {
    if (f.path.startsWith('parts/')) assert.deepEqual([f.w, f.h], [576, 96], f.path);
    else assert.ok(f.path.startsWith('seated/') && f.w === 512 && f.h === 960, f.path);
  }
  assert.equal(files.filter((f) => f.path.startsWith('seated/')).length, 48);
});

test('packFiles는 코드가 요청하는 모든 경로를 담는다(모든 모습 × 표정 × 방향 × 층, 앉은 그림 여덟 모습)', () => {
  const set = new Set(packFiles().map((f) => f.path));
  for (const look of LOOKS) for (const face of FACES) for (const dir of DIRS) for (const layer of LAYERS) {
    for (const p of partFiles(layer, look, face, dir)) assert.ok(set.has(p), p);
  }
  for (const look of LOOKS) for (const dir of ['SE', 'SW', 'NE', 'NW'] as const) for (const part of SEATED_PARTS) {
    for (const p of seatedFiles(look, dir, part)) assert.ok(set.has(p), p);
  }
});

test(`묶음 폴더(${PACK})의 pack.json은 format ${PACK_FORMAT}`, () => {
  const meta = JSON.parse(fs.readFileSync(path.join(PACK, 'pack.json'), 'utf8')) as { format?: unknown };
  assert.equal(meta.format, PACK_FORMAT);
});

test('묶음 폴더에 312장이 다 있고 PNG 머리가 [폭, 높이, 8비트, RGBA]', () => {
  for (const f of packFiles()) {
    const file = path.join(PACK, f.path);
    assert.ok(fs.existsSync(file), f.path);
    const b = fs.readFileSync(file);
    assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]], [f.w, f.h, 8, 6], f.path);
  }
});
