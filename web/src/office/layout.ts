// 오피스 배치(격자 단위). 바닥 15×15, x는 화면 오른쪽 아래로, y는 왼쪽 아래로.
// three.js에선 x → X, y → Z, 높이 → Y. 왼쪽 벽(x=0)은 통창, 뒷벽(y=0)엔 TV.

export type Point = { x: number; y: number };
export type Room = { x0: number; y0: number; x1: number; y1: number; label: string };

export const FLOOR = 15;
/** 사무실(열린 공간)과 오른쪽 방들 사이 벽 */
export const SPLIT_X = 7.5;

export const ROOMS: Record<'claude' | 'codex' | 'aria' | 'meeting', Room> = {
  claude: { x0: 0, y0: 0, x1: SPLIT_X, y1: FLOOR, label: '사무실' },
  codex: { x0: SPLIT_X, y0: 0, x1: FLOOR, y1: 4.5, label: '개발실' },
  aria: { x0: SPLIT_X, y0: 4.5, x1: FLOOR, y1: 9.5, label: '비서실' },
  meeting: { x0: SPLIT_X, y0: 9.5, x1: FLOOR, y1: FLOOR, label: '회의실' },
};

/** 들어오고 나가는 입구 (사무실 앞쪽 가장자리) */
export const DOOR: Point = { x: 3.75, y: FLOOR };
/** 사무실 → 오른쪽 방 문(벽 x=SPLIT_X의 틈): 가운데 y와 폭 */
export const ROOM_DOORS = { codex: { y: 3.3, w: 1 }, aria: { y: 7.0, w: 1 }, meeting: { y: 10.5, w: 1 } };

/** 책상 8개: 2열 × 4. 아이소메트릭 시점에서 앞 줄 책상이 캐릭터를 가리지 않도록 캐릭터는 책상의 +x 쪽(통로)에 선다 */
export const DESK_COLS = [1.0, 4.2]; // 책상 x 시작
export const DESK_YS = [1.4, 4.0, 6.6, 9.2]; // 책상 y 시작
export const DESK_W = 0.75; // x 방향
export const DESK_D = 0.85; // y 방향

/** 비서실 스탠딩 책상 3개(한 줄, 사람은 책상 앞 +y 쪽에 서서 일함) — ARIA 에이전트 여럿을 위한 자리 */
export const ARIA_DESK_XS = [8.6, 10.9, 13.2];
export const ARIA_DESK_Y = 5.7;
export const ARIA_DESK = { w: 1.3, d: 0.6, h: 0.8 };

const WAITING_SPOT: Point = { x: 4.9, y: 14.3 };
/** 사무실 안 앞쪽 통로(입구에서 책상 줄로 갈라지는 곳) */
const FRONT_AISLE = 14;

/** 0~7 → 사무실 책상 옆 자리(두 열을 번갈아 채움), 그 밖(-1 등) → 입구 옆 대기 자리 */
export function seatPosition(seat: number): Point {
  if (seat < 0 || seat > 7) return WAITING_SPOT;
  const col = seat % 2;
  const row = Math.floor(seat / 2);
  return { x: DESK_COLS[col] + DESK_W + 0.5, y: DESK_YS[row] + DESK_D / 2 };
}

/** 회의 테이블 */
export const MEETING_TABLE = { x0: 9.4, y0: 11.6, x1: 13.4, y1: 12.9 };

/** 0~5 회의실 의자, 그 이상은 테이블을 둘러섬 */
export function meetingSpot(i: number): Point {
  const chairs: Point[] = [
    { x: 9.9, y: 11.2 }, { x: 11.4, y: 11.2 }, { x: 12.9, y: 11.2 },
    { x: 9.9, y: 13.3 }, { x: 11.4, y: 13.3 }, { x: 12.9, y: 13.3 },
  ];
  if (i >= 0 && i < chairs.length) return chairs[i];
  const a = (i - chairs.length) * 0.9;
  return { x: 11.4 + Math.cos(a) * 2.5, y: 12.25 + Math.sin(a) * 1.6 };
}

const inRoom = (p: Point, r: Room) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

/** 입구에서 목적지까지 걷는 길. 사무실 책상은 앞 통로에서 꺾고, 회의실은 회의실 문을 지난다 */
export function pathTo(dest: Point): Point[] {
  if (inRoom(dest, ROOMS.meeting)) {
    const y = ROOM_DOORS.meeting.y;
    return [DOOR, { x: 6.6, y: FRONT_AISLE }, { x: 6.6, y }, { x: SPLIT_X, y }, { x: 8.6, y }, { x: 8.6, y: dest.y }, dest];
  }
  if (inRoom(dest, ROOMS.claude) && dest.y < FRONT_AISLE) return [DOOR, { x: dest.x, y: FRONT_AISLE }, dest];
  return [DOOR, dest];
}
