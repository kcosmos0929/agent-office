// 상태줄 입력의 rate_limits → 사용량. (데스크톱 앱 세션에선 상태줄이 돌지 않아 CLI 세션 값만 들어온다 — 스파이크 2026-10-22)
import type { Usage, UsageWindow } from '../../shared/types.ts';

function window(raw: unknown, nowSec: number): UsageWindow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  const pct = w.used_percentage;
  const resetsAt = w.resets_at;
  if (typeof pct !== 'number' || typeof resetsAt !== 'number' || !Number.isFinite(pct)) return null;
  if (resetsAt <= nowSec) return null;
  return { pct, resetsAt };
}

export function statuslineToUsage(payload: unknown, now: number): Usage | null {
  if (payload === null || typeof payload !== 'object') return null;
  const limits = (payload as Record<string, unknown>).rate_limits;
  if (limits === null || typeof limits !== 'object') return null;
  const l = limits as Record<string, unknown>;
  const nowSec = Math.floor(now / 1000);
  const fiveHour = window(l.five_hour, nowSec);
  const sevenDay = window(l.seven_day, nowSec);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, at: now };
}

/** 리셋까지 남은 시간 "H:MM" */
function untilReset(resetsAtSec: number, now: number): string {
  const mins = Math.max(0, Math.floor((resetsAtSec * 1000 - now) / 60_000));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

export function statusLineText(u: Usage | null, modelName: string | null, now: number): string {
  if (u?.fiveHour) return `5h ${Math.round(u.fiveHour.pct)}% · ${untilReset(u.fiveHour.resetsAt, now)}`;
  return modelName ?? '';
}
