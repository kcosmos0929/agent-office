// 몸짓 효과: 폴짝(도트 단위)·쉬는 중 Zzz·차례 끝 ✅ 반짝·승인 뒤 링 퍼짐 (three.js는 모름)
import { groupOf } from '../../../src/shared/labels.ts';
import type { Status } from '../../../src/shared/types.ts';

/** 승인·질문 대기의 폴짝: 1초마다 앞 0.25초 동안 2도트 위로 (동작 줄이기면 0) */
export function hopDots(t: number, reduced: boolean): number {
  if (reduced) return 0;
  return t % 1000 < 250 ? 2 : 0;
}

/** 머리 위에 떠오르는 Z 셋(움직임은 CSS) */
export function makeZzz(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.className = 'zzz';
  for (let i = 0; i < 3; i++) {
    const s = doc.createElement('span');
    s.textContent = 'Z';
    el.appendChild(s);
  }
  return el;
}

export type FxEvent = 'sparkle' | 'burst';

/** 상태가 실제로 바뀐 순간에만 효과: 이전 상태를 모르면(첫 동기화·다시 연결 뒤) 없음 */
export function eventsFor(prev: Status | undefined, next: Status): FxEvent[] {
  if (!prev) return [];
  if (groupOf(prev) === 'working' && next === 'done') return ['sparkle'];
  if ((prev === 'permission' || prev === 'question') && groupOf(next) === 'working') return ['burst'];
  return [];
}

export const BURST_MS = 600;

/** 승인 뒤 바닥 링이 600ms 동안 1→1.8배로 퍼지며 사라짐(밖이면 null) */
export function ringBurst(elapsed: number): { scale: number; opacity: number } | null {
  if (elapsed < 0 || elapsed >= BURST_MS) return null;
  const k = elapsed / BURST_MS;
  return { scale: 1 + 0.8 * k, opacity: 1 - k };
}

/** 링 퍼짐이 시작한 뒤 흐른 시간(rAF 시각과 시작 시각의 어긋남으로 음수가 되지 않게). 숨은 탭에서 오래 뒤 돌아오면 600ms를 넘어 퍼짐이 버려진다 */
export function burstElapsed(t: number, startedAt: number): number {
  return Math.max(0, t - startedAt);
}

/** 머리(말풍선) 왼쪽 옆에 잠깐 뜨는 ✅ — 바깥 div는 CSS2D가 자리를 잡고(transform), 움직임은 안쪽 span의 CSS가 맡는다 */
export function makeSparkle(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.className = 'sparkle';
  const s = doc.createElement('span');
  s.textContent = '✅';
  el.appendChild(s);
  return el;
}
