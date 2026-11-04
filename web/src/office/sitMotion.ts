// 앉고 일어서기(앉기 확장 7단계, 2026-11-04): 서는 자리 ↔ 의자 사이 마지막 걸음 + 돌아서기 + 내려앉기, 일어설 땐 거꾸로.
// 새 그림 없이 걷기·서기·앉은 그림과 들썩(도트)만 쓴다(사용자 결정 「A. 움직임만」). three.js 없는 순수 함수(테스트 대상).
import type { Point } from './layout.ts';
import { dirFor, PACE_FPS, STEP, type Dir, type Pace, type SeatedDir } from './sprites/look.ts';

/** 의자 앞에 서서 앉을 방향을 보는 짬(앉을 때) · 일어나 그 방향으로 선 짬(일어설 때) */
export const TURN_MS = 120;
/** 내려앉기 한 칸: 앉은 그림을 2 → 1도트 띄웠다가 내려놓는다(일어설 땐 1 → 2도트 들썩 뒤 선 그림) */
export const DROP_MS = 80;
export const DROP_DOTS = [2, 1] as const;

/** down = 서는 자리에서 의자로 가 앉기, up = 의자에서 일어나 서는 자리로. start = 시작 시각(ms), pace = 의자와 서는 자리 사이 걸음의 빠르기 */
export type SitMotion = { kind: 'down' | 'up'; start: number; stand: Point; seat: Point; dir: SeatedDir; pace: Pace };

/**
 * walk = 걷기 그림(step = 이번 전환에서 몇 걸음째, back = 뒷걸음 — 걷기 칸을 거꾸로 넘긴다), turn = 서기 그림, seat = 앉은 그림을 lift도트 띄움.
 * 일어설 땐 앉았던 방향을 본 채로 물러난다: 책상·회의 테이블은 뒷걸음, 소파·빈백은 앞으로 걸어 나온다
 */
export type SitMotionFrame =
  | { stage: 'walk'; at: Point; dir: Dir; step: number; back: boolean }
  | { stage: 'turn'; at: Point; dir: Dir }
  | { stage: 'seat'; lift: number };

/** 서는 자리와 의자 사이 걸음 수: 걷기 한 장 = STEP(걷는 길과 같은 보폭). 떨어져 있으면 적어도 한 걸음, 같은 점이면 0 */
export function sitSteps(stand: Point, seat: Point): number {
  const d = Math.hypot(seat.x - stand.x, seat.y - stand.y);
  return d < 1e-6 ? 0 : Math.max(1, Math.round(d / STEP));
}

/** 전환 전체 길이(ms): 걸음(그 빠르기의 한 장 시간 × 걸음 수) + 돌아서기 + 내려앉기 */
export function sitMotionMs(m: Pick<SitMotion, 'stand' | 'seat' | 'pace'>): number {
  return (sitSteps(m.stand, m.seat) * 1000) / PACE_FPS[m.pace] + TURN_MS + DROP_MS * DROP_DOTS.length;
}

/** 시각 now의 모습. 끝났으면 null(그 뒤는 앉아 있거나 서는 자리에 서 있다) */
export function sitMotionAt(m: SitMotion, now: number): SitMotionFrame | null {
  const n = sitSteps(m.stand, m.seat);
  const stepMs = 1000 / PACE_FPS[m.pace];
  const walkMs = n * stepMs;
  const dropMs = DROP_MS * DROP_DOTS.length;
  const e = Math.max(0, now - m.start);
  // k번째 걸음을 마친 자리(걷는 길처럼 한 장에 한 보폭씩 — 첫 장에서 이미 한 걸음 나간다)
  const toward = (k: number, from: Point, to: Point): Point => ({ x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n });
  if (m.kind === 'down') {
    if (e < walkMs) {
      const k = Math.floor(e / stepMs);
      return { stage: 'walk', at: toward(k + 1, m.stand, m.seat), dir: dirFor(m.seat.x - m.stand.x, m.seat.y - m.stand.y), step: k, back: false };
    }
    if (e < walkMs + TURN_MS) return { stage: 'turn', at: m.seat, dir: m.dir };
    if (e < walkMs + TURN_MS + dropMs) return { stage: 'seat', lift: DROP_DOTS[Math.floor((e - walkMs - TURN_MS) / DROP_MS)] };
    return null;
  }
  if (e < dropMs) return { stage: 'seat', lift: DROP_DOTS[DROP_DOTS.length - 1 - Math.floor(e / DROP_MS)] };
  if (e < dropMs + TURN_MS) return { stage: 'turn', at: m.seat, dir: m.dir };
  if (e < dropMs + TURN_MS + walkMs) {
    const k = Math.floor((e - dropMs - TURN_MS) / stepMs);
    return { stage: 'walk', at: toward(k + 1, m.seat, m.stand), dir: m.dir, step: k, back: dirFor(m.stand.x - m.seat.x, m.stand.y - m.seat.y) !== m.dir };
  }
  return null;
}
