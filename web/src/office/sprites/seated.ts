// 앉은 그림(v23, JP01만): 누가 앉는지·상태 번호·시계·아틀라스 칸. three.js 없는 순수 함수(테스트 대상).
// 그림은 몸·가까운 팔·먼 팔 세 장(같은 칸 배치)이고, 칸 번호는 손·상체·눈 상태의 조합 번호다(0→71 차례 재생이 아니다).
import type { Status } from '../../../../src/shared/types.ts';
import type { Look } from './look.ts';

/** 앉은 그림이 있는 모습: 번 머리 + 기본 일본형 복장(JP01). 다른 모습은 그림이 올 때까지 서 있는다 */
export const SEATED_LOOK: Look = { hair: 'bun', outfit: 'jp-classic' };
export function canSit(look: Look): boolean {
  return look.hair === SEATED_LOOK.hair && look.outfit === SEATED_LOOK.outfit;
}

/** 세 장 모두 같은 칸 배치. 어깨 둘레 소매(cap)는 body에 있고, 팔 두 장만 카메라 쪽으로 당긴다 */
export const SEATED_PARTS = ['body', 'nearArm', 'farArm'] as const;
export type SeatedPart = (typeof SEATED_PARTS)[number];
/** 아틀라스: 8열 × 9행(512×864), 칸 64×96 */
export const SEATED_ATLAS = { cols: 8, rows: 9 } as const;
/** 앉은 그림 폴더 후보(앞부터 읽는다): v24 = 서기 v18 옷·외곽선·펌프스를 맞춘 것, 못 읽으면 v23(되돌리려면 앞 항목을 지운다) */
export const SEATED_VERSIONS = ['seated-v24', 'seated-v23'] as const;
export function seatedFiles(dir: 'SE' | 'NW', part: SeatedPart): string[] {
  return SEATED_VERSIONS.map((v) => `${v}/${dir}/${part}.png`);
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

/** `?seated` 미리 보기: 없으면 off(늘 서 있음), `?seated=still`이면 첫 칸(정지 v21과 같은 그림)에 멈춤, 그 밖엔 움직임 */
export type SeatedPreview = 'off' | 'still' | 'motion';
export function seatedPreview(search: string): SeatedPreview {
  const q = new URLSearchParams(search);
  if (!q.has('seated')) return 'off';
  return q.get('seated') === 'still' ? 'still' : 'motion';
}
