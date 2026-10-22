import type { Pose } from './pose.ts';

/** 늘 켜두는 화면이라 움직임이 클 때만 자주 그린다: 숨김 0 · 걷기/손흔들기 20 · 작은 움직임 8 · 정지 1 */
export function targetFps(poses: Pose[], hidden: boolean): number {
  if (hidden) return 0;
  if (poses.some((p) => p === 'walk' || p === 'wave')) return 20;
  if (poses.some((p) => p === 'type-fast' || p === 'scroll' || p === 'think')) return 8;
  return 1;
}
