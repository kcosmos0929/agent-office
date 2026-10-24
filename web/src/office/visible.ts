// 오피스에 그릴 에이전트. Codex는 3단계(개발실 자리) 전까지 그리지 않는다 — 지금 배치엔 Codex 자리가 없어 사무실 책상에 섞이므로.
import type { Agent } from '../../../src/shared/types.ts';

export function officeAgents(agents: Agent[]): Agent[] {
  return agents.filter((a) => a.kind !== 'codex');
}
