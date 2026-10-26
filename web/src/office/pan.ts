// 사무실 화면 끌기: 확대했을 때(1배 넘게)만 보는 창을 옮긴다. 옮길 수 있는 범위는 1배일 때 보이는 영역 안.
// 화면(DOM·three.js)과 떼어 둔 계산만 — officeView가 쓴다.

/** 보는 창의 가운데를 1배 기준에서 얼마나 옮겼나(세계 단위, x 오른쪽·y 위) */
export type Pan = { x: number; y: number };

/** 이만큼(CSS px) 넘게 움직이면 끌기, 아니면 누르기(카드 열기) */
export const DRAG_THRESHOLD_PX = 4;

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** fitHalfW·fitHalfH = 1배일 때 보이는 반폭·반높이. 1배 이하면 옮길 여유가 없어 가운데로 */
export function clampPan(p: Pan, fitHalfW: number, fitHalfH: number, zoom: number): Pan {
  const sx = Math.max(0, fitHalfW * (1 - 1 / zoom));
  const sy = Math.max(0, fitHalfH * (1 - 1 / zoom));
  return { x: clamp(p.x, -sx, sx) || 0, y: clamp(p.y, -sy, sy) || 0 };
}

/** 끌기 시작 때의 위치에서 화면으로 끈 만큼(CSS px) 옮긴다 — 사무실이 손을 따라오게 보는 창은 반대로 */
export function dragToPan(start: Pan, dxPx: number, dyPx: number, worldPerPx: number): Pan {
  return { x: start.x - dxPx * worldPerPx, y: start.y + dyPx * worldPerPx };
}

/** 도트 사무실이 흔들리지 않게 화면 점(worldPerDot) 단위로 맞춘다 */
export function snapPan(p: Pan, worldPerDot: number): Pan {
  return { x: Math.round(p.x / worldPerDot) * worldPerDot || 0, y: Math.round(p.y / worldPerDot) * worldPerDot || 0 };
}
