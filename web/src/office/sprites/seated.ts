// 앉은 그림(여덟 모습): 누가 앉는지·상태 번호·시계·아틀라스 칸. three.js 없는 순수 함수(테스트 대상).
// 그림은 몸·가까운 팔·먼 팔 세 장(같은 칸 배치)이고, 칸 번호는 손·상체·눈 상태의 조합 번호다(0→71 차례 재생이 아니다).
import type { Status } from '../../../../src/shared/types.ts';
import { LOOKS, SEATED_SOURCE, type Look, type SeatedDir } from './look.ts';

/** 모습 이름(LOOKS 순서 = 모자 번호 0~7): 앉은 그림 폴더 이름. 6·7은 겹치지 않는 다른 조합(추가 1·2) */
export const SEATED_LOOK_IDS = ['JP01', 'JP02', 'JP03', 'KR01', 'KR02', 'KR03', 'EX1', 'EX2'] as const;
export type SeatedLookId = (typeof SEATED_LOOK_IDS)[number];
export function seatedLookId(look: Look): SeatedLookId | null {
  const i = LOOKS.findIndex((l) => l.hair === look.hair && l.outfit === look.outfit);
  return i < 0 ? null : SEATED_LOOK_IDS[i];
}
/** 앉은 그림이 있는 모습: 여덟 모습 모두(seated-v25, 2026-10-28). JP01 그림을 본보기로 머리·옷을 옮기고 다리는 이미지 생성 */
export function canSit(look: Look): boolean {
  return seatedLookId(look) !== null;
}

/** 세 장 모두 같은 칸 배치. 어깨 둘레 소매(cap)는 body에 있고, 팔 두 장만 카메라 쪽으로 당긴다 */
export const SEATED_PARTS = ['body', 'nearArm', 'farArm'] as const;
export type SeatedPart = (typeof SEATED_PARTS)[number];
/** 아틀라스: 8열 × 9행(512×864), 칸 64×96 */
export const SEATED_ATLAS = { cols: 8, rows: 9 } as const;
/**
 * 앉은 그림 폴더 후보(앞부터 읽는다): seated-v25/<모습> = 여덟 모습(뒷모습 머리·등판·다리 새로).
 * JP01만 옛 폴더로 물러설 수 있다: v24 = 서기 v18 옷·외곽선·펌프스를 맞춘 것, v23(되돌리려면 앞 항목을 지운다)
 */
export const SEATED_BASE = 'seated-v25';
export const SEATED_JP01_FALLBACK = ['seated-v24', 'seated-v23'] as const;
export function seatedFiles(look: Look, seatedDir: SeatedDir, part: SeatedPart): string[] {
  const id = seatedLookId(look);
  if (!id) return [];
  const dir = SEATED_SOURCE[seatedDir].dir; // SW·NE는 SE·NW 그림을 뒤집어 쓴다
  const main = `${SEATED_BASE}/${id}/${dir}/${part}.png`;
  return id === 'JP01' ? [main, ...SEATED_JP01_FALLBACK.map((v) => `${v}/${dir}/${part}.png`)] : [main];
}

/** work = 손(타이핑)+상체+눈, upper = 손 멈춤+상체+눈(읽기·생각용 임시 대용 — 전용 자세 아님) */
export type SeatedMode = 'work' | 'upper';
/** 상태 → 앉는 방식. 실행·고침은 타이핑, 읽기·생각류는 손 멈춤, 나머지(대기·끝남·멈춤·쉼)는 서 있는다(null) */
export function seatedMode(status: Status): SeatedMode | null {
  switch (status) {
    case 'running': case 'editing': return 'work';
    case 'reading': case 'thinking': case 'approving': case 'delegating': case 'compacting': return 'upper';
    default: return null;
  }
}

/** 상태 번호 = 손(0~7) × 9 + 상체(0~2) × 3 + 눈(0 뜸·1 반·2 감음) */
export function seatedIndex(hand: number, body: number, eye: number): number {
  return hand * 9 + body * 3 + eye;
}

/** 손 125ms × 8, 상체 [0,1,2,1,0] 500ms씩, 눈은 3초부터 4초마다 반 70 → 감음 90 → 반 70ms. 공동 반복 20초 */
export const SEATED_CYCLE_MS = 20_000;
const BODY_LEVELS = [0, 1, 2, 1, 0];
function eyeAt(t: number): number {
  if (t < 3000) return 0;
  const p = (t - 3000) % 4000;
  return p < 70 ? 1 : p < 160 ? 2 : p < 230 ? 1 : 0;
}
/** 시작한 지 elapsedMs 지난 때의 칸 번호(원본 timeline.mjs sample()과 같은 값) */
export function seatedFrame(mode: SeatedMode, elapsedMs: number): number {
  const t = ((elapsedMs % SEATED_CYCLE_MS) + SEATED_CYCLE_MS) % SEATED_CYCLE_MS;
  const hand = mode === 'work' ? Math.floor(t / 125) % 8 : 0;
  return seatedIndex(hand, BODY_LEVELS[Math.floor(t / 500) % BODY_LEVELS.length], eyeAt(t));
}

/** 칸 번호 → 아틀라스 칸(열, 그림 위에서 센 행) */
export function seatedCell(index: number): { col: number; row: number } {
  return { col: index % SEATED_ATLAS.cols, row: Math.floor(index / SEATED_ATLAS.cols) };
}

/**
 * 앉기: 기본으로 켜짐(움직임, 2026-10-28 — 여덟 모습 앉은 그림과 개발실·회의실 자리가 생겨서).
 * `?seated=off`면 늘 서 있고(예전 화면), `?seated=still`이면 첫 칸(정지 v21과 같은 그림)에 멈춘다.
 */
export type SeatedPreview = 'off' | 'still' | 'motion';
export function seatedPreview(search: string): SeatedPreview {
  const v = new URLSearchParams(search).get('seated');
  return v === 'off' ? 'off' : v === 'still' ? 'still' : 'motion';
}
