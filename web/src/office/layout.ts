// 오피스 배치(격자 단위). 바닥 10×10, x는 화면 오른쪽 아래로, y는 왼쪽 아래로 (시안 A와 같음).
// three.js에선 x → X, y → Z, 높이 → Y.

export type Point = { x: number; y: number };
export type Room = { x0: number; y0: number; x1: number; y1: number; label: string };

export const ROOMS: Record<'claude' | 'codex' | 'aria' | 'meeting', Room> = {
  claude: { x0: 0, y0: 0, x1: 6, y1: 5, label: 'CLAUDE 작업실' },
  codex: { x0: 6, y0: 0, x1: 10, y1: 5, label: 'CODEX 실험실' },
  aria: { x0: 0, y0: 5, x1: 4, y1: 10, label: 'ARIA 비서실' },
  meeting: { x0: 4, y0: 5, x1: 10, y1: 10, label: '회의실' },
};

/** 들어오고 나가는 문 (회의실 앞쪽 가장자리) */
export const DOOR: Point = { x: 7, y: 10 };
/** Claude 작업실과 앞쪽 방들 사이 유리 칸막이(y=5)의 틈 */
export const PARTITION_GAP: Point = { x: 3.1, y: 5 };

/** 책상 8개: 2열 × 4. 아이소메트릭 시점에서 앞 줄 책상이 캐릭터를 가리지 않도록 캐릭터는 책상의 +x 쪽(통로)에 선다 */
export const DESK_COLS = [0.5, 3.0]; // 책상 x 시작
export const DESK_YS = [0.55, 1.65, 2.75, 3.85]; // 책상 y 시작
export const DESK_W = 0.75; // x 방향
export const DESK_D = 0.85; // y 방향

const WAITING_SPOT: Point = { x: 6.4, y: 9.3 };

/** 0~7 → Claude 작업실 책상 옆 자리(두 열을 번갈아 채움), 그 밖(-1 등) → 문 옆 대기 자리 */
export function seatPosition(seat: number): Point {
  if (seat < 0 || seat > 7) return WAITING_SPOT;
  const col = seat % 2;
  const row = Math.floor(seat / 2);
  return { x: DESK_COLS[col] + DESK_W + 0.5, y: DESK_YS[row] + DESK_D / 2 };
}

/** 회의 테이블 */
export const MEETING_TABLE = { x0: 5.6, y0: 6.6, x1: 8.6, y1: 7.9 };

/** 0~5 회의실 의자, 그 이상은 테이블을 둘러섬 */
export function meetingSpot(i: number): Point {
  const chairs: Point[] = [
    { x: 6.0, y: 6.2 }, { x: 7.1, y: 6.2 }, { x: 8.2, y: 6.2 },
    { x: 6.0, y: 8.3 }, { x: 7.1, y: 8.3 }, { x: 8.2, y: 8.3 },
  ];
  if (i >= 0 && i < chairs.length) return chairs[i];
  const a = (i - chairs.length) * 0.9;
  return { x: 7.1 + Math.cos(a) * 1.9, y: 7.25 + Math.sin(a) * 1.3 };
}

/** 문에서 목적지까지 걷는 길. Claude 작업실은 칸막이 틈을 지난다 */
export function pathTo(dest: Point): Point[] {
  const r = ROOMS.claude;
  const inClaude = dest.x > r.x0 && dest.x < r.x1 && dest.y > r.y0 && dest.y < r.y1;
  if (!inClaude) return [DOOR, dest];
  return [DOOR, { x: PARTITION_GAP.x, y: 6.2 }, PARTITION_GAP, { x: dest.x, y: 4.6 }, dest];
}
