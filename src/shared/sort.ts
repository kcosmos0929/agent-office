import type { Agent, Status } from './types.ts';

const RANK: Record<Status, number> = {
  permission: 0,
  question: 0,
  approving: 2, // 조용한 일하는 중 묶음(몇 초 뒤 ❗가 되면 맨 위로)
  done: 1,
  thinking: 2,
  reading: 2,
  editing: 2,
  running: 2,
  delegating: 2,
  compacting: 2,
  stalled: 3,
  quota: 4,
  idle: 5,
  gone: 6,
};

/** 목록형 정렬: 날 기다리는 순서대로, 같은 묶음 안에서는 오래된 순 */
export function sortForBoard(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => RANK[a.status] - RANK[b.status] || a.since - b.since);
}
