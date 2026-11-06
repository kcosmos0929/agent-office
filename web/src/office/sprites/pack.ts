// 그림 묶음(art pack) 규격: 코드가 읽는 파일 목록(characters/ 기준)과 크기. three.js 없는 순수 함수(테스트·대체 그림 스크립트가 씀).
import { CELL, COLS, DIRS, FACES, HAIRS, LAYERS, OUTFITS, type Layer } from './look.ts';
import { SEATED_ATLAS, SEATED_BASE, SEATED_LOOK_IDS, SEATED_PARTS } from './seated.ts';

/** pack.json의 format 값 */
export const PACK_FORMAT = 1;
export type PackFile = { path: string; w: number; h: number };

const HAIR_LAYERS: readonly Layer[] = ['hairBack', 'head'];
const OUTFIT_LAYERS = LAYERS.filter((l) => l !== 'hairBack' && l !== 'head' && l !== 'face');

/** 묶음의 모든 그림(312장): 서기·걷기 부품 576×96, 앉은 시트 512×960 */
export function packFiles(): PackFile[] {
  const strip = { w: CELL.w * COLS, h: CELL.h };
  const seated = { w: CELL.w * SEATED_ATLAS.cols, h: CELL.h * SEATED_ATLAS.rows };
  const out: PackFile[] = [];
  for (const hair of HAIRS) for (const layer of HAIR_LAYERS) for (const dir of DIRS) out.push({ path: `parts/hair/${hair}/${layer}/${dir}.png`, ...strip });
  for (const hair of HAIRS) for (const face of FACES) for (const dir of DIRS) out.push({ path: `parts/face/${hair}/${face}/${dir}.png`, ...strip });
  for (const outfit of OUTFITS) for (const layer of OUTFIT_LAYERS) for (const dir of DIRS) out.push({ path: `parts/outfit/${outfit}/${layer}/${dir}.png`, ...strip });
  for (const id of SEATED_LOOK_IDS) for (const dir of ['SE', 'NW'] as const) for (const part of SEATED_PARTS) out.push({ path: `${SEATED_BASE}/${id}/${dir}/${part}.png`, ...seated });
  return out;
}
