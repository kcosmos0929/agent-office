// ~/.codex/hooks.json에 Synthetic Office 훅을 넣고 빼는 순수 함수. 남의 훅·키는 건드리지 않는다. (config.toml은 다루지 않음)
import { mergeHookEvents, removeOurHooks } from './settingsMerge.ts';

export const CODEX_HOOK_EVENTS: readonly string[] = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
  'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt',
];

/** Codex는 Interrupt·SessionEnd 훅을 최대 3초로 깎는다(넘게 적으면 실행 때 경고) */
const timeoutFor = (ev: string) => (ev === 'Interrupt' || ev === 'SessionEnd' ? 3 : 5);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mergeCodexHooks(file: Record<string, unknown>, command: string): { next: Record<string, unknown>; changed: boolean; conflict: string | null } {
  const unchanged = (conflict: string | null) => ({ next: file, changed: false, conflict });
  if (file.hooks !== undefined && !isObject(file.hooks)) return unchanged('hooks.json의 hooks 형식이 예상과 달라요');
  const hooks = (file.hooks ?? {}) as Record<string, unknown>;
  for (const ev of CODEX_HOOK_EVENTS) {
    if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) return unchanged(`hooks.json의 hooks.${ev} 형식이 예상과 달라요`);
  }
  const next = structuredClone(file);
  const nextHooks = (next.hooks ?? {}) as Record<string, unknown[]>;
  const changed = mergeHookEvents(nextHooks, CODEX_HOOK_EVENTS, command, timeoutFor);
  next.hooks = nextHooks;
  return changed ? { next, changed, conflict: null } : unchanged(null);
}

/** 우리 것만 뺀다. empty = 훅이 다 비고 다른 키도 없음(그러면 파일을 지워도 됨) */
export function removeCodexHooks(file: Record<string, unknown>): { next: Record<string, unknown>; changed: boolean; empty: boolean } {
  if (!isObject(file.hooks)) return { next: file, changed: false, empty: false };
  const next = structuredClone(file);
  const hooks = next.hooks as Record<string, unknown>;
  const changed = removeOurHooks(hooks);
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return { next: changed ? next : file, changed, empty: changed && Object.keys(next).length === 0 };
}
