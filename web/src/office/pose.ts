import type { Status } from '../../../src/shared/types.ts';

// 캐릭터 자세
export type Pose = 'type-fast' | 'scroll' | 'think' | 'wave' | 'lean-back' | 'sleep' | 'walk' | 'stand';

const POSE: Record<Status, Pose> = {
  permission: 'wave',
  done: 'lean-back',
  thinking: 'think',
  reading: 'scroll',
  editing: 'type-fast',
  running: 'type-fast',
  delegating: 'think',
  stalled: 'stand',
  idle: 'sleep',
  gone: 'walk',
};

export function poseFor(status: Status): Pose {
  return POSE[status];
}
