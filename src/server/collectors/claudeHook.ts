// Claude Code 훅 입력(JSON) → 오피스 이벤트. 대화 내용(prompt, 응답, 도구 결과, 에러 본문)은 여기서 버린다.
import path from 'node:path';
import type { Activity, CompactTrigger, OfficeEvent } from '../../shared/types.ts';

const READING = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead']);
const EDITING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const DELEGATING = new Set(['Agent', 'Task']);
/** 알림 중 '나에게 묻는' 종류 (permission_prompt는 승인으로 따로) */
const ASKS_ME = new Set(['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
/** 사용량 한도 대기가 자동 재개 없이 끝남 → 내 차례 */
const QUOTA_GAVE_UP = new Set(['quota_auto_resume_stale', 'quota_auto_resume_disabled']);
const ASK_TOOL = 'AskUserQuestion';
/** Claude 앱의 '다음 할 일' 상자 — 차례를 끝내며 부르고, 질문이 있으면 훅이 asks 표시만 보낸다 */
const WRAP_UP = 'mcp__ccd_turn__wrap_up';

export type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 공백 정리 + 제어문자 제거 + 코드포인트 max개로 자르기 */
export function clip(text: string, max = 60): string {
  const cleaned = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...cleaned];
  return chars.length <= max ? cleaned : chars.slice(0, max - 1).join('') + '…';
}

export function classifyTool(name: string): Activity {
  if (READING.has(name)) return 'reading';
  if (EDITING.has(name)) return 'editing';
  if (DELEGATING.has(name)) return 'delegating';
  return 'running';
}

function summarizeRaw(tool: string, input: Json): string {
  switch (tool) {
    case 'Bash': {
      const cmd = str(input.command);
      return cmd ? `Bash: ${cmd.split('\n')[0]}` : 'Bash';
    }
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'NotebookRead': {
      const p = str(input.file_path) ?? str(input.notebook_path);
      return p ? path.basename(p) : tool;
    }
    case 'Grep': {
      const p = str(input.pattern);
      return p ? `"${p}"` : tool;
    }
    case 'Glob':
      return str(input.pattern) ?? tool;
    case 'WebFetch': {
      const u = str(input.url);
      if (!u) return tool;
      try {
        return new URL(u).hostname;
      } catch {
        return tool;
      }
    }
    case 'WebSearch':
      return str(input.query) ?? tool;
    case 'Agent':
    case 'Task':
      return str(input.description) ?? str(input.subagent_type) ?? tool;
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) return `${mcp[1]} · ${mcp[2]}`;
  return tool;
}

export function summarizeToolInput(tool: string, input: unknown): string {
  const obj = input !== null && typeof input === 'object' ? (input as Json) : {};
  return clip(summarizeRaw(tool, obj));
}

/** 셸 명령 한 줄을 낱말로(따옴표 안 공백은 한 낱말) */
const WORD = /"([^"]*)"|'([^']*)'|([^\s;|&<>()]+)/g;

/** 경로처럼 보이는 낱말: '/'가 있고, 옵션(-…)·주소(…://)가 아님 */
const looksLikePath = (w: string) => w.includes('/') && !w.startsWith('-') && !w.includes('://');

/**
 * 훅 입력에서 세션이 만지는 경로 후보: 파일·폴더(file_path·notebook_path·path), Codex가 고친 파일 목록, 셸 명령 첫 줄의 경로.
 * 프로젝트 이름표를 알아내는 데만 쓰고 이 맥 서버 밖으로 내보내지 않는다.
 */
export function hookPaths(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object') return [];
  const input = (payload as Json).tool_input;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return [];
  const t = input as Json;
  const out: string[] = [];
  for (const k of ['file_path', 'notebook_path', 'path']) {
    const v = str(t[k]);
    if (v) out.push(v);
  }
  if (Array.isArray(t.files)) for (const f of t.files) if (typeof f === 'string' && f) out.push(f);
  const command = str(t.command);
  if (command) {
    for (const m of command.split('\n')[0].matchAll(WORD)) {
      const w = m[1] ?? m[2] ?? m[3] ?? '';
      if (looksLikePath(w)) out.push(w);
    }
  }
  return out.slice(0, 8);
}

/** 도구 이름·입력 → 활동·한 줄 요약. 에이전트마다 도구 이름이 달라 갈아 끼운다(Codex: codexHook.ts) */
export type ToolDialect = { classify(tool: string, input: Json): Activity; summarize(tool: string, input: unknown): string };

export const CLAUDE_TOOLS: ToolDialect = { classify: (tool) => classifyTool(tool), summarize: summarizeToolInput };

export function hookToEvents(payload: unknown, now: number, tools: ToolDialect = CLAUDE_TOOLS): OfficeEvent[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const p = payload as Json;
  const sessionId = str(p.session_id);
  if (!sessionId) return [];

  const base: { sessionId: string; at: number; cwd: string; title?: string; transcriptPath?: string; subagentId?: string; model?: string } = {
    sessionId,
    at: now,
    cwd: str(p.cwd) ?? '',
  };
  const title = str(p.session_title);
  if (title) base.title = clip(title, 80);
  const model = str(p.model);
  if (model) base.model = clip(model, 60);
  const transcript = str(p.transcript_path);
  if (transcript) base.transcriptPath = transcript;
  const agentId = str(p.agent_id);
  // SubagentStart/Stop 자체는 하위 에이전트 "에 대한" 이벤트라 subagentId를 달지 않는다
  const event = str(p.hook_event_name);
  if (agentId && event !== 'SubagentStart' && event !== 'SubagentStop') base.subagentId = agentId;

  const tool = str(p.tool_name) ?? '';
  const trigger: CompactTrigger = p.trigger === 'manual' ? 'manual' : 'auto';
  switch (event) {
    case 'SessionStart':
      return [{ ...base, type: 'session-start' }];
    case 'UserPromptSubmit':
      return [{ ...base, type: 'prompt' }];
    case 'PreToolUse': {
      const input = p.tool_input !== null && typeof p.tool_input === 'object' ? (p.tool_input as Json) : {};
      const start: OfficeEvent = { ...base, type: 'tool-start', toolUseId: str(p.tool_use_id) ?? '', activity: tools.classify(tool, input), detail: tools.summarize(tool, p.tool_input) };
      // 질문 도구는 시작하자마자 사용자 답을 기다린다
      return tool === ASK_TOOL ? [start, { ...base, type: 'question', detail: null }] : [start];
    }
    case 'PostToolUse': {
      const end: OfficeEvent = { ...base, type: 'tool-end', toolUseId: str(p.tool_use_id) ?? '' };
      if (tool !== WRAP_UP) return [end];
      // 상자가 실제로 뜬(성공한) 호출만 — 질문은 차례가 끝난 뒤에야 답을 기다리므로 표시만 해 두고 Stop 때 ❓
      const input = p.tool_input !== null && typeof p.tool_input === 'object' ? (p.tool_input as Json) : {};
      return [end, { ...base, type: 'wrap-up', asks: input.asks === true }];
    }
    case 'PostToolUseFailure': {
      const end: OfficeEvent = { ...base, type: 'tool-end', toolUseId: str(p.tool_use_id) ?? '' };
      // 사용자가 도구 도중에 끊으면 Stop 훅이 오지 않는다 → 차례가 끝난 것으로
      return p.is_interrupt === true ? [end, { ...base, type: 'stop' }] : [end];
    }
    case 'PermissionRequest':
      if (tool === ASK_TOOL) return [{ ...base, type: 'question', detail: null }];
      return [{ ...base, type: 'permission', detail: tools.summarize(tool, p.tool_input) }];
    case 'Notification': {
      const kind = str(p.notification_type);
      const message = str(p.message);
      if (kind === 'idle_prompt') return [{ ...base, type: 'idle' }];
      if (kind === 'permission_prompt') return [{ ...base, type: 'permission', detail: clip(message ?? ''), viaNotification: true }];
      if (kind && ASKS_ME.has(kind)) return [{ ...base, type: 'question', detail: message ? clip(message) : null, viaNotification: true }];
      if (kind === 'quota_auto_resume_fired') return [{ ...base, type: 'resume' }];
      if (kind && QUOTA_GAVE_UP.has(kind)) return [{ ...base, type: 'stop' }];
      return [];
    }
    case 'Stop':
      return [{ ...base, type: 'stop' }];
    case 'StopFailure': {
      // 오류 종류 이름만 쓴다(error_details·last_assistant_message 본문은 버림)
      const error = clip(str(p.error) ?? 'unknown', 30);
      return error === 'rate_limit' ? [{ ...base, type: 'quota-wait' }] : [{ ...base, type: 'stop', error }];
    }
    case 'PreCompact':
      return [{ ...base, type: 'compact-start', trigger }];
    case 'PostCompact':
      return [{ ...base, type: 'compact-end', trigger }];
    case 'SubagentStart':
      return agentId ? [{ ...base, type: 'subagent-start', agentId, agentType: str(p.agent_type) }] : [];
    case 'SubagentStop':
      return agentId ? [{ ...base, type: 'subagent-stop', agentId }] : [];
    case 'SessionEnd':
      return [{ ...base, type: 'session-end' }];
    default:
      return [];
  }
}
