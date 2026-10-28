// 도트 캐릭터(v15) 계산: 세션 모습·상태별 표정·화면 방향·걷기 보폭·판 크기. three.js 없는 순수 함수(테스트 대상).
import type { Status } from '../../../../src/shared/types.ts';
import { FIT, VIEW_DIR } from '../layout.ts';

export type Dir = 'SE' | 'SW' | 'NE' | 'NW';
/** 아틀라스 행 순서(v15 layout.json) */
export const DIRS: readonly Dir[] = ['SE', 'SW', 'NE', 'NW'];
export type Hair = 'bun' | 'bob' | 'pony' | 'longbob';
export type Outfit = 'jp-classic' | 'jp-vest' | 'jp-suit' | 'kr-blazer' | 'kr-cardigan' | 'kr-shirt';
export type Face = 'neutral' | 'soft' | 'happy' | 'focused';
export const FACES: readonly Face[] = ['neutral', 'soft', 'happy', 'focused'];
export type Look = { hair: Hair; outfit: Outfit };

/** 그림 한 칸(도트)과 열: 0~7 걷기, 8 서기 */
export const CELL = { w: 64, h: 96 };
export const WALK_FRAMES = 8;
export const IDLE_COL = 8;
export const COLS = 9;
/** 발 기준점(칸 안 도트 좌표) — 그림 왼쪽 위가 아니라 이 점을 바닥 위치에 맞춘다 */
export const ANCHOR: Record<Dir, readonly [number, number]> = { SE: [34, 88.5], NE: [34, 88.5], SW: [29, 88.5], NW: [29, 88.5] };
/** 앉은 그림(v16~)의 기준점: 의자 가운데 바닥점(월드 y 0, 바닥판 윗면 0.04 아님). 좌판 높이는 그림에 들어 있다 */
export const SEATED_ANCHOR: Record<'SE' | 'NW', readonly [number, number]> = { SE: [34, 85], NW: [29, 85] };
/** 앉는 방향: 책상 바깥(px) 자리 = NW(등이 보임), 창 쪽(nx) 자리 = SE(얼굴이 보임) */
export function seatedDir(facing: 'px' | 'nx'): 'SE' | 'NW' {
  return facing === 'px' ? 'NW' : 'SE';
}

/** 합치는 순서(아래 → 위) */
export const LAYERS = ['hairBack', 'farArm', 'farLeg', 'nearLeg', 'bottom', 'torso', 'nearArm', 'head', 'face', 'accessory'] as const;
export type Layer = (typeof LAYERS)[number];

/** 부품 파일(부품 폴더 기준). 얼굴은 머리마다 가림이 달라 머리 ID가 경로에 들어간다 */
export function partPath(layer: Layer, look: Look, face: Face, dir: Dir): string {
  if (layer === 'hairBack' || layer === 'head') return `parts/hair/${look.hair}/${layer}/${dir}.png`;
  if (layer === 'face') return `parts/face/${look.hair}/${face}/${dir}.png`;
  return `parts/outfit/${look.outfit}/${layer}/${dir}.png`;
}

/** 부품 묶음 폴더: 기본은 v15. 다시 그린 옷·머리만 새 버전 폴더에서 읽는다(되돌리려면 이 표에서 지운다) */
export const PART_BASE = 'v15';
/**
 * v18 = 외곽선·신발·다리·치마 몸매 디테일(JP01 2026-10-27, 나머지 다섯 옷 10-28).
 * v19 = 그 위에 뒷모습(NE·NW)만 새로: 이미지 생성 뒷모습을 옷 색으로 옮기고 등 솔기 규칙을 맞춤(2026-10-28). 앞모습(SE·SW)은 v18과 같다.
 */
export const OUTFIT_VERSION: Partial<Record<Outfit, string>> = {
  'jp-classic': 'v19',
  'jp-vest': 'v19',
  'jp-suit': 'v19',
  'kr-blazer': 'v19',
  'kr-cardigan': 'v19',
  'kr-shirt': 'v19',
};
/** 머리·얼굴 v19 = 뒷모습(NE·NW) 머리를 이미지 생성 그림으로: 뒤에서는 머리가 몸 위라 모두 head 층, hairBack NE·NW는 빔(2026-10-28) */
export const HAIR_VERSION: Partial<Record<Hair, string>> = { bun: 'v19', bob: 'v19', pony: 'v19', longbob: 'v19' };
/** 부품 파일 후보(characters/ 기준, 앞부터 읽는다): 새 버전 옷·머리면 그것, 못 읽으면 v15 */
export function partFiles(layer: Layer, look: Look, face: Face, dir: Dir): string[] {
  const rel = partPath(layer, look, face, dir);
  const version = rel.startsWith('parts/outfit/') ? OUTFIT_VERSION[look.outfit] : HAIR_VERSION[look.hair];
  return version ? [`${version}/${rel}`, `${PART_BASE}/${rel}`] : [`${PART_BASE}/${rel}`];
}

/** 모자 번호(hat 0~7) → 모습: 0~5 = 정리된 6종(JP01~KR03)의 머리·옷, 6·7 = 겹치지 않는 다른 조합 */
export const LOOKS: readonly Look[] = [
  { hair: 'bun', outfit: 'jp-classic' },
  { hair: 'bob', outfit: 'jp-vest' },
  { hair: 'pony', outfit: 'jp-suit' },
  { hair: 'longbob', outfit: 'kr-blazer' },
  { hair: 'pony', outfit: 'kr-cardigan' },
  { hair: 'bob', outfit: 'kr-shirt' },
  { hair: 'longbob', outfit: 'jp-suit' },
  { hair: 'bun', outfit: 'kr-cardigan' },
];
export function lookFor(hat: number): Look {
  const n = LOOKS.length;
  return LOOKS[((hat % n) + n) % n];
}

/** 상태 → 표정: 일하는 중 집중, 끝남 환한 미소, 기다림·응답 없음 기본, 쉬는 중·토큰 기다림·퇴근 은은한 미소 */
const FACE_BY_STATUS: Record<Status, Face> = {
  permission: 'neutral',
  question: 'neutral',
  stalled: 'neutral',
  done: 'happy',
  approving: 'focused',
  thinking: 'focused',
  reading: 'focused',
  editing: 'focused',
  running: 'focused',
  delegating: 'focused',
  compacting: 'focused',
  quota: 'soft',
  idle: 'soft',
  gone: 'soft',
};
export function faceFor(status: Status): Face {
  return FACE_BY_STATUS[status];
}

/** 격자 이동(x, y)을 화면 방향으로: 아이소에서 x는 오른쪽 아래, y는 왼쪽 아래로 보인다 */
export function dirFor(dx: number, dy: number): Dir {
  const sx = dx - dy;
  const sy = dx + dy;
  if (sy >= 0) return sx >= 0 ? 'SE' : 'SW';
  return sx >= 0 ? 'NE' : 'NW';
}

/** 도트 하나의 월드 크기: 1440×900 창(세로 FIT.h 칸 = 900 CSS 점)에서 0.75 CSS 점 = 레티나 1.5 기기 점(사용자 결정 1.5배) */
export const DOT = (0.75 * FIT.h) / 900;
/** 카메라가 내려다봐서 세로로 선 판은 화면에서 이만큼 짧아진다(높이를 이걸로 나눠 그림 비율을 지킨다) */
export const UPRIGHT = Math.hypot(VIEW_DIR[0], VIEW_DIR[2]) / Math.hypot(...VIEW_DIR);
/** 걷기 한 장 = 화면 (2, 1)도트 = 격자 축을 따라 2√2 도트(방위 45°) */
export const STEP = 2 * DOT * Math.SQRT2;
/** 걸음 두 가지(초당 장수): 일을 받아 이동 = 2배, 일이 끝나 자유 이동 = 그림 그대로 */
export const PACE_FPS = { work: 16, free: 8 } as const;
export type Pace = keyof typeof PACE_FPS;
export function walkSpeed(pace: Pace): number {
  return STEP * PACE_FPS[pace];
}

/** 판 크기(월드): 폭은 그대로, 높이는 UPRIGHT로 늘림 */
export function planeSize(scale = 1): { w: number; h: number } {
  return { w: CELL.w * DOT * scale, h: (CELL.h * DOT * scale) / UPRIGHT };
}
/** 발 기준점을 원점에 둘 때 판 가운데의 위치(판 안 가로·세로) */
export function planeOffset(dir: Dir, scale = 1): { x: number; y: number } {
  const [ax, ay] = ANCHOR[dir];
  return { x: (CELL.w / 2 - ax) * DOT * scale, y: ((ay - CELL.h / 2) * DOT * scale) / UPRIGHT };
}
/** 앉은 그림: 기준점(의자 가운데 바닥)을 원점에 둘 때 판 가운데의 위치 */
export function seatedPlaneOffset(dir: 'SE' | 'NW', scale = 1): { x: number; y: number } {
  const [ax, ay] = SEATED_ANCHOR[dir];
  return { x: (CELL.w / 2 - ax) * DOT * scale, y: ((ay - CELL.h / 2) * DOT * scale) / UPRIGHT };
}
/** 발에서 머리 꼭대기까지(월드) — 말풍선 높이용. 머리 그림 맨 위 줄은 1 */
export function headTop(scale = 1): number {
  return ((ANCHOR.SE[1] - 1) * DOT * scale) / UPRIGHT;
}
/** 아틀라스에서 칸 위치(열, 행) */
export function cellOf(dir: Dir, col: number): { col: number; row: number } {
  return { col, row: DIRS.indexOf(dir) };
}
