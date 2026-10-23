// 모델 id → 컨텍스트 창 크기·표시 이름. 대화 게이지가 쓴다. (모델 표 기준일 2026-10-23, claude-api 스킬 확인)

/** 100만 토큰 창 — 20만 표보다 먼저 본다(claude-opus-4-6 같은 4.x 일부가 100만) */
const MILLION = [
  'claude-fable-5', 'claude-mythos-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5',
  'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6',
];
const TWO_HUNDRED_K = ['claude-haiku-4', 'claude-opus-4', 'claude-sonnet-4', 'claude-3'];

/** 모르는 모델이면 null(화면은 % 없이 토큰 수만) */
export function contextWindow(model: string): number | null {
  if (MILLION.some((p) => model.startsWith(p))) return 1_000_000;
  if (TWO_HUNDRED_K.some((p) => model.startsWith(p))) return 200_000;
  return null;
}

/** claude-opus-5-5 → "Opus 5.5", claude-haiku-4-5-20251001 → "Haiku 4.5", 모르면 그대로 */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
  if (!m) return model;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}
