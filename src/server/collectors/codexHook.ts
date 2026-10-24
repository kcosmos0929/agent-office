// Codex 훅 입력(JSON) → 오피스 이벤트. 사건 모양은 Claude와 거의 같아 Claude 해석기를 도구 방언만 바꿔 쓴다.
// Codex 기록 파일은 형식이 공식적으로 안정적이지 않아 읽지 않는다(transcriptPath·title을 싣지 않음).
import path from 'node:path';
import type { OfficeEvent } from '../../shared/types.ts';
import { CLAUDE_TOOLS, clip, hookToEvents, type Json, type ToolDialect } from './claudeHook.ts';

/** Codex는 파일을 셸 명령으로 읽는다 — 첫 단어가 이것이면 📖 */
export const READ_COMMANDS: ReadonlySet<string> = new Set(['cat', 'rg', 'grep', 'ls', 'sed', 'head', 'tail', 'find', 'wc']);
const WRAPPER = /^(?:bash|zsh|sh)\s+-l?c\s+/;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
// 앱(0.162)은 도구 이름 앞에 묶음 이름을 붙인다(collaborationspawn_agent) — 끝부분으로 본다
const isSpawn = (tool: string) => tool.endsWith('spawn_agent');
const isWait = (tool: string) => tool.endsWith('wait_agent');

/** `bash -lc "sed -n 1p a"` → `sed`, `/usr/bin/cat x` → `cat` */
export function shellHead(command: string): string {
  let c = command.trim().replace(WRAPPER, '');
  c = c.replace(/^["']/, '');
  const first = c.split(/\s+/)[0] ?? '';
  return path.basename(first.replace(/["']$/, ''));
}

export const CODEX_TOOLS: ToolDialect = {
  classify(tool, input) {
    if (tool === 'Bash') return READ_COMMANDS.has(shellHead(str(input.command) ?? '')) ? 'reading' : 'running';
    if (tool === 'apply_patch') return 'editing';
    if (isSpawn(tool) || isWait(tool)) return 'delegating';
    return CLAUDE_TOOLS.classify(tool, input);
  },
  summarize(tool, input) {
    const obj = input !== null && typeof input === 'object' ? (input as Json) : {};
    if (tool === 'apply_patch') {
      const files = Array.isArray(obj.files) ? obj.files.filter((f): f is string => typeof f === 'string') : [];
      return clip(files.length ? files.map((f) => path.basename(f)).join(', ') : 'apply_patch');
    }
    if (isSpawn(tool)) return clip(str(obj.task_name) ?? str(obj.description) ?? str(obj.agent_type) ?? '도우미');
    if (isWait(tool)) return '도우미 기다림';
    return CLAUDE_TOOLS.summarize(tool, input);
  },
};

export function codexHookToEvents(payload: unknown, now: number): OfficeEvent[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const p = payload as Json;
  // 중단(Interrupt)은 차례가 끝난 것으로 — Claude엔 없는 사건
  const events = p.hook_event_name === 'Interrupt'
    ? hookToEvents({ ...p, hook_event_name: 'Stop' }, now, CODEX_TOOLS)
    : hookToEvents(p, now, CODEX_TOOLS);
  return events.map(({ transcriptPath, title, ...e }) => ({ ...e, kind: 'codex' }) as OfficeEvent);
}
