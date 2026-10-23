// 오피스 배치(격자 단위). 바닥 15×18, x는 화면 오른쪽 아래로, y는 왼쪽 아래로.
// three.js에선 x → X, y → Z, 높이 → Y. 왼쪽 벽(x=0)은 통창, 뒷벽(y=0)엔 TV.

export type Point = { x: number; y: number };
export type Room = { x0: number; y0: number; x1: number; y1: number; label: string };

export const FLOOR_X = 15;
export const FLOOR_Z = 18;
/** 일하는 방들의 앞 끝 = 앞쪽 띠(창고·화장실·입구 복도·휴게실→안쪽 탕비실)의 시작 */
export const FRONT_Y = 15;
/** 사무실(열린 공간)과 오른쪽 방들 사이 벽 */
export const SPLIT_X = 7.5;
/** 입구 복도(앞쪽 띠): x 범위 */
export const CORRIDOR = { x0: 3.2, x1: 4.4 };
/** 휴게실과 그 안쪽 탕비실 사이 벽 */
export const PANTRY_X = 11;
/** 창가 작은 방을 나누는 벽: 안쪽 창고 | 앞쪽 화장실 */
export const RESTROOM_Y = 16.4;

export const ROOMS: Record<'claude' | 'codex' | 'aria' | 'meeting' | 'storage' | 'restroom' | 'lounge' | 'pantry', Room> = {
  claude: { x0: 0, y0: 0, x1: SPLIT_X, y1: FRONT_Y, label: '사무실' },
  codex: { x0: SPLIT_X, y0: 0, x1: FLOOR_X, y1: 4.5, label: '개발실' },
  aria: { x0: SPLIT_X, y0: 4.5, x1: FLOOR_X, y1: 9.5, label: '비서실' },
  meeting: { x0: SPLIT_X, y0: 9.5, x1: FLOOR_X, y1: FRONT_Y, label: '회의실' },
  storage: { x0: 0, y0: FRONT_Y, x1: CORRIDOR.x0, y1: RESTROOM_Y, label: '창고' },
  restroom: { x0: 0, y0: RESTROOM_Y, x1: CORRIDOR.x0, y1: FLOOR_Z, label: '화장실' },
  lounge: { x0: CORRIDOR.x1, y0: FRONT_Y, x1: PANTRY_X, y1: FLOOR_Z, label: '휴게실' },
  pantry: { x0: PANTRY_X, y0: FRONT_Y, x1: FLOOR_X, y1: FLOOR_Z, label: '탕비실' },
};

/** 들어오고 나가는 입구 (판 맨 앞, 입구 복도 가운데) */
export const DOOR: Point = { x: (CORRIDOR.x0 + CORRIDOR.x1) / 2, y: FLOOR_Z };
/** 앞쪽 띠의 문(벽의 틈): 복도 → 창고·화장실(x=CORRIDOR.x0), 복도 → 휴게실(x=CORRIDOR.x1), 휴게실 → 탕비실(x=PANTRY_X). 가운데 y와 폭 */
export const BAND_DOORS = { storage: { y: 15.7, w: 0.8 }, restroom: { y: 17.2, w: 0.8 }, lounge: { y: 17.3, w: 0.9 }, pantry: { y: 17.3, w: 0.9 } };
/** 쉬는 동안 갈 만한 지점(나중에 '쉬는 동안 산책'이 쓸 자리) */
export const IDLE_SPOTS: Record<'vending' | 'sofa' | 'bookshelf' | 'coffee' | 'pantryTable', Point> = {
  vending: { x: 4.95, y: 16.1 },
  sofa: { x: 5.45, y: 16.3 },
  bookshelf: { x: 9.6, y: 15.75 },
  coffee: { x: 11.6, y: 16.1 },
  pantryTable: { x: 12.85, y: 17.6 },
};

/** 사무실 → 오른쪽 방 문(벽 x=SPLIT_X의 틈): 가운데 y와 폭 */
export const ROOM_DOORS = { codex: { y: 3.3, w: 1 }, aria: { y: 7.0, w: 1 }, meeting: { y: 10.5, w: 1 } };

/** 사무실 책상 묶음 2개(4인, 두 자리씩 마주 봄, 가운데 칸막이): x POD_X0..POD_X0+2·DESK_DEPTH. 뒤 묶음 y POD_YS[0], 앞 묶음 POD_YS[1] */
export const POD_X0 = 2.75;
export const POD_YS = [0.9, 5.1];
export const DESK_DEPTH = 0.75; // x 방향(책상 하나 깊이)
export const DESK_WIDTH = 1.6; // y 방향(한 자리 폭)
const DESK_GAP = 0.04;

/** 책상 하나: facing = 사람이 앉는 쪽(px = 보는 사람 쪽, nx = 창 쪽) */
export type Desk = { x0: number; y0: number; facing: 'px' | 'nx' };
/** 자리 0~7의 책상. 잘 보이는 자리부터 채운다: 앞 묶음 +x → 뒤 묶음 +x → 앞 묶음 창 쪽 → 뒤 묶음 창 쪽 */
export const DESKS: Desk[] = ([[1, 'px'], [0, 'px'], [1, 'nx'], [0, 'nx']] as const).flatMap(([pod, facing]) =>
  [0, 1].map((k) => ({ x0: facing === 'px' ? POD_X0 + DESK_DEPTH : POD_X0, y0: POD_YS[pod] + k * (DESK_WIDTH + DESK_GAP), facing })),
);

/** 비서실 스탠딩 책상 3개(한 줄, 사람은 책상 앞 +y 쪽에 서서 일함) — ARIA 에이전트 여럿을 위한 자리 */
export const ARIA_DESK_XS = [8.6, 10.9, 13.2];
export const ARIA_DESK_Y = 5.7;
export const ARIA_DESK = { w: 1.3, d: 0.6, h: 0.8 };

/** 자리 없는 세션이 기다리는 곳: 로비 안내 데스크 앞 */
const WAITING_SPOT: Point = { x: 5.4, y: 14.2 };
/** 입구에서 곧게 들어오는 통로(x = DOOR.x)가 책상 구역 앞에서 만나는 가로 통로 */
const CROSS_Y = 9.2;
/** 책상 묶음 양옆 세로 통로: 창 쪽, 유리벽 쪽 */
const AISLE_X = { window: 1.0, glass: 6.4 };

/** 0~7 → 사무실 책상 앞 자리, 그 밖(-1 등) → 로비 대기 자리 */
export function seatPosition(seat: number): Point {
  if (seat < 0 || seat > 7) return WAITING_SPOT;
  const d = DESKS[seat];
  return { x: d.facing === 'px' ? d.x0 + DESK_DEPTH + 0.45 : d.x0 - 0.45, y: d.y0 + DESK_WIDTH / 2 };
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

/** 입구에서 목적지까지 걷는 길. 입구 복도를 곧게 지나, 사무실 책상은 가로 통로 → 묶음 옆 통로로, 회의실은 회의실 문을 지난다 */
export function pathTo(dest: Point): Point[] {
  if (inRoom(dest, ROOMS.meeting)) {
    const y = ROOM_DOORS.meeting.y;
    return [DOOR, { x: DOOR.x, y }, { x: SPLIT_X, y }, { x: 8.6, y }, { x: 8.6, y: dest.y }, dest];
  }
  if (inRoom(dest, ROOMS.claude) && dest.y < CROSS_Y) {
    const x = dest.x < POD_X0 + DESK_DEPTH ? AISLE_X.window : AISLE_X.glass;
    return [DOOR, { x: DOOR.x, y: CROSS_Y }, { x, y: CROSS_Y }, { x, y: dest.y }, dest];
  }
  // 그 밖(로비 대기 자리 등): 입구 복도를 곧게 지나 로비로 들어온 뒤
  return dest.y < FRONT_Y ? [DOOR, { x: DOOR.x, y: FRONT_Y - 0.4 }, dest] : [DOOR, dest];
}
