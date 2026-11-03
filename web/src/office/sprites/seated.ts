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
/** 앉은 그림이 있는 모습: 여덟 모습 모두(seated-v25 2026-10-28, v26 = 쉬기 행 추가). JP01 그림을 본보기로 머리·옷을 옮기고 다리는 이미지 생성 */
export function canSit(look: Look): boolean {
  return seatedLookId(look) !== null;
}

/** 세 장 모두 같은 칸 배치. 어깨 둘레 소매(cap)는 body에 있고, 팔 두 장만 카메라 쪽으로 당긴다 */
export const SEATED_PARTS = ['body', 'nearArm', 'farArm'] as const;
export type SeatedPart = (typeof SEATED_PARTS)[number];
/** 아틀라스: 8열 × 10행(512×960), 칸 64×96 — 위 9행 = 일하는 칸 0~71, 10번째 행 = 쉬기 칸 72~74 */
export const SEATED_ATLAS = { cols: 8, rows: 10 } as const;
/**
 * 앉은 그림 폴더: seated-v26/<모습> = 여덟 모습(v25) + 쉬기 행.
 * 옛 JP01 폴더(v24·v23)로 물러서기는 없앴다 — 9행 그림이라 10행 칸 배치와 맞지 않는다.
 */
export const SEATED_BASE = 'seated-v26';
export function seatedFiles(look: Look, seatedDir: SeatedDir, part: SeatedPart): string[] {
  const id = seatedLookId(look);
  if (!id) return [];
  const dir = SEATED_SOURCE[seatedDir].dir; // SW·NE는 SE·NW 그림을 뒤집어 쓴다
  return [`${SEATED_BASE}/${id}/${dir}/${part}.png`];
}

/** work = 손(타이핑)+상체+눈, upper = 손 멈춤+상체+눈(읽기·생각·질문용 임시 대용 — 전용 자세 아님), rest = 손을 무릎에 내린 쉬기+눈 */
export type SeatedMode = 'work' | 'upper' | 'rest';
/**
 * 상태 → 앉는 방식. 실행·고침은 타이핑, 읽기·생각류와 질문·승인 필요는 손 멈춤(질문·승인은 의자에서 통통 — cast의 wave 효과),
 * 끝남은 쉬기, 나머지(멈춤·한도·쉼·퇴근)는 서 있는다(null)
 */
export function seatedMode(status: Status): SeatedMode | null {
  switch (status) {
    case 'running': case 'editing': return 'work';
    case 'reading': case 'thinking': case 'approving': case 'delegating': case 'compacting': return 'upper';
    case 'permission': case 'question': return 'upper';
    case 'done': return 'rest';
    default: return null;
  }
}

/** 상태 번호 = 손(0~7) × 9 + 상체(0~2) × 3 + 눈(0 뜸·1 반·2 감음) */
export function seatedIndex(hand: number, body: number, eye: number): number {
  return hand * 9 + body * 3 + eye;
}
/** 쉬기 칸 = 72 + 눈 — 일하는 칸 다음(10번째 행). 상체 움직임 없이 눈만 깜빡인다 */
export const SEATED_REST = 72;

/** 손 125ms × 8, 상체 [0,1,2,1,0] 500ms씩, 눈은 3초부터 4초마다 반 70 → 감음 90 → 반 70ms. 공동 반복 20초 */
export const SEATED_CYCLE_MS = 20_000;
const BODY_LEVELS = [0, 1, 2, 1, 0];
function eyeAt(t: number): number {
  if (t < 3000) return 0;
  const p = (t - 3000) % 4000;
  return p < 70 ? 1 : p < 160 ? 2 : p < 230 ? 1 : 0;
}
/** 시작한 지 elapsedMs 지난 때의 칸 번호(work·upper는 원본 timeline.mjs sample()과 같은 값) */
export function seatedFrame(mode: SeatedMode, elapsedMs: number): number {
  const t = ((elapsedMs % SEATED_CYCLE_MS) + SEATED_CYCLE_MS) % SEATED_CYCLE_MS;
  if (mode === 'rest') return SEATED_REST + eyeAt(t);
  const hand = mode === 'work' ? Math.floor(t / 125) % 8 : 0;
  return seatedIndex(hand, BODY_LEVELS[Math.floor(t / 500) % BODY_LEVELS.length], eyeAt(t));
}

/** 칸 번호 → 아틀라스 칸(열, 그림 위에서 센 행) */
export function seatedCell(index: number): { col: number; row: number } {
  return { col: index % SEATED_ATLAS.cols, row: Math.floor(index / SEATED_ATLAS.cols) };
}

/**
 * 앉기: 기본으로 켜짐(움직임, 2026-10-28 — 여덟 모습 앉은 그림과 개발실·회의실 자리가 생겨서).
 * `?seated=off`면 늘 서 있고(예전 화면), `?seated=still`이면 방식마다 첫 칸(일하기는 정지 v21과 같은 그림)에 멈춘다.
 */
export type SeatedPreview = 'off' | 'still' | 'motion';
export function seatedPreview(search: string): SeatedPreview {
  const v = new URLSearchParams(search).get('seated');
  return v === 'off' ? 'off' : v === 'still' ? 'still' : 'motion';
}
