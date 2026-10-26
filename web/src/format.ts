import { KIND_LABEL } from '../../src/shared/labels.ts';
import type { Agent } from '../../src/shared/types.ts';

/** <1분 "방금", <60분 "N분째", 그 이상 "H:MM:SS" */
export function formatElapsed(ms: number): string {
  if (ms < 60_000) return '방금';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}분째`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 리셋까지 남은 시간 "H:MM" */
export function formatReset(resetsAtSec: number, nowMs: number): string {
  const mins = Math.max(0, Math.floor((resetsAtSec * 1000 - nowMs) / 60_000));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

export function agentName(a: Pick<Agent, 'title' | 'hat' | 'kind'>): string {
  return a.title ?? `${KIND_LABEL[a.kind]} · 세션 ${a.hat + 1}`;
}
