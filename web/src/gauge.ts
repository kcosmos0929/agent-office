// 대화 게이지의 숫자·색·문구 (목록 줄과 카드가 같이 쓴다)
import { modelLabel } from '../../src/shared/contextWindow.ts';
import type { AgentContext } from '../../src/shared/types.ts';

export type GaugeLevel = 'ok' | 'warn' | 'full';

/** 창을 알 때만 내림한 정수 % */
export function contextPct(c: AgentContext): number | null {
  if (c.state !== 'ok' || !c.window) return null;
  return Math.floor((c.used / c.window) * 100);
}

/** 70% 미만 초록, 70~89% 호박, 90% 이상 빨강 */
export function gaugeLevel(pct: number): GaugeLevel {
  return pct < 70 ? 'ok' : pct < 90 ? 'warn' : 'full';
}

export function formatTokens(n: number): string {
  if (n >= 10_000) return `약 ${Math.round(n / 10_000)}만`;
  if (n >= 1_000) return `약 ${Math.round(n / 1_000)}천`;
  return `약 ${n}`;
}

const windowLabel = (w: number) => `${w / 10_000}만`;

export function rowGaugeText(c: AgentContext): string {
  if (c.state === 'compacted') return '대화 정리 직후';
  const pct = contextPct(c);
  return pct === null ? `대화 ${formatTokens(c.used)}` : `대화 ${pct}%`;
}

export function cardContextLine(c: AgentContext | null): string {
  if (!c) return '대화 —';
  if (c.state === 'compacted') return '대화 정리 직후 — 다음 답부터 다시 계산';
  const pct = contextPct(c);
  const model = modelLabel(c.model);
  return pct === null || !c.window
    ? `대화 ${formatTokens(c.used)} 토큰 · ${model}`
    : `대화 ${pct}% · ${formatTokens(c.used)} / ${windowLabel(c.window)} 토큰 · ${model}`;
}
