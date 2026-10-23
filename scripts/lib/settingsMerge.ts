// ~/.claude/settings.json에 Synthetic Office 훅·상태줄을 넣고 빼는 순수 함수. 남의 설정은 건드리지 않는다.

export const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'PreCompact', 'PostCompact', 'StopFailure',
] as const;

const MARK = '/.synthetic-office/bin/';

type Settings = Record<string, unknown>;
type HookItem = { type?: string; command?: string; timeout?: number };
type HookGroup = { matcher?: string; hooks?: HookItem[] };

const isOurs = (item: unknown): boolean => typeof (item as HookItem)?.command === 'string' && (item as HookItem).command!.includes(MARK);
const groupHasOurs = (g: unknown): boolean => Array.isArray((g as HookGroup)?.hooks) && (g as HookGroup).hooks!.some(isOurs);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mergeClaudeSettings(settings: Settings, cmd: { hook: string; statusline: string }): { settings: Settings; changed: boolean; conflict: string | null } {
  const unchanged = (conflict: string | null) => ({ settings, changed: false, conflict });
  if (settings.hooks !== undefined && !isObject(settings.hooks)) return unchanged('settings.json의 hooks 형식이 예상과 달라요');
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  for (const ev of HOOK_EVENTS) {
    if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) return unchanged(`settings.json의 hooks.${ev} 형식이 예상과 달라요`);
  }
  const status = settings.statusLine;
  if (status !== undefined && !isOurs(status)) {
    return unchanged(`이미 다른 상태줄 설정이 있어요: ${JSON.stringify(status)} — 덮어쓰지 않았어요`);
  }

  const next = structuredClone(settings);
  const nextHooks = (next.hooks ?? {}) as Record<string, HookGroup[]>;
  let changed = false;
  for (const ev of HOOK_EVENTS) {
    const arr = nextHooks[ev] ?? [];
    if (!arr.some(groupHasOurs)) {
      arr.push({ matcher: '', hooks: [{ type: 'command', command: cmd.hook, timeout: 5 }] });
      changed = true;
    }
    for (const g of arr) {
      for (const h of g.hooks ?? []) {
        if (isOurs(h) && h.command !== cmd.hook) {
          h.command = cmd.hook; // 경로가 바뀌었으면(예: node 위치) 새 경로로
          changed = true;
        }
      }
    }
    nextHooks[ev] = arr;
  }
  next.hooks = nextHooks;
  const wantStatus = { type: 'command', command: cmd.statusline };
  if (JSON.stringify(next.statusLine) !== JSON.stringify(wantStatus)) {
    next.statusLine = wantStatus;
    changed = true;
  }
  return changed ? { settings: next, changed, conflict: null } : unchanged(null);
}

export function removeClaudeSettings(settings: Settings): { settings: Settings; changed: boolean } {
  const next = structuredClone(settings);
  let changed = false;
  if (isObject(next.hooks)) {
    const hooks = next.hooks as Record<string, unknown>;
    for (const ev of Object.keys(hooks)) {
      const arr = hooks[ev];
      if (!Array.isArray(arr)) continue;
      const kept: HookGroup[] = [];
      for (const g of arr as HookGroup[]) {
        if (!groupHasOurs(g)) {
          kept.push(g);
          continue;
        }
        changed = true;
        const rest = (g.hooks ?? []).filter((h) => !isOurs(h));
        if (rest.length) kept.push({ ...g, hooks: rest });
      }
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
    if (Object.keys(hooks).length === 0) delete next.hooks;
  }
  if (isOurs(next.statusLine)) {
    delete next.statusLine;
    changed = true;
  }
  return { settings: changed ? next : settings, changed };
}
