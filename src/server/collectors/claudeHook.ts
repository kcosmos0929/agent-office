// Claude Code 훅 입력(JSON) → 오피스 이벤트. 대화 내용(prompt, 응답, 도구 결과, 에러 본문)은 여기서 버린다.
import path from 'node:path';
import type { Activity, OfficeEvent } from '../../shared/types.ts';

const READING = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead']);
const EDITING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const DELEGATING = new Set(['Agent', 'Task']);
const NEEDS_ME = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

type Json = Record<string, unknown>;

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

export function hookToEvents(payload: unknown, now: number): OfficeEvent[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const p = payload as Json;
  const sessionId = str(p.session_id);
  if (!sessionId) return [];

  const base: { sessionId: string; at: number; cwd: string; title?: string; transcriptPath?: string; subagentId?: string } = {
    sessionId,
    at: now,
    cwd: str(p.cwd) ?? '',
  };
  const title = str(p.session_title);
  if (title) base.title = clip(title, 80);
  const transcript = str(p.transcript_path);
  if (transcript) base.transcriptPath = transcript;
  const agentId = str(p.agent_id);
  // SubagentStart/Stop 자체는 하위 에이전트 "에 대한" 이벤트라 subagentId를 달지 않는다
  const event = str(p.hook_event_name);
  if (agentId && event !== 'SubagentStart' && event !== 'SubagentStop') base.subagentId = agentId;

  const tool = str(p.tool_name) ?? '';
  switch (event) {
    case 'SessionStart':
      return [{ ...base, type: 'session-start' }];
    case 'UserPromptSubmit':
      return [{ ...base, type: 'prompt' }];
    case 'PreToolUse':
      return [{ ...base, type: 'tool-start', toolUseId: str(p.tool_use_id) ?? '', activity: classifyTool(tool), detail: summarizeToolInput(tool, p.tool_input) }];
    case 'PostToolUse':
      return [{ ...base, type: 'tool-end', toolUseId: str(p.tool_use_id) ?? '' }];
    case 'PostToolUseFailure': {
      const end: OfficeEvent = { ...base, type: 'tool-end', toolUseId: str(p.tool_use_id) ?? '' };
      // 사용자가 도구 도중에 끊으면 Stop 훅이 오지 않는다 → 차례가 끝난 것으로
      return p.is_interrupt === true ? [end, { ...base, type: 'stop' }] : [end];
    }
    case 'PermissionRequest':
      return [{ ...base, type: 'permission', detail: summarizeToolInput(tool, p.tool_input) }];
    case 'Notification': {
      const kind = str(p.notification_type);
      if (kind === 'idle_prompt') return [{ ...base, type: 'idle' }];
      if (!kind || !NEEDS_ME.has(kind)) return [];
      return [{ ...base, type: 'permission', detail: clip(str(p.message) ?? '') }];
    }
    case 'Stop':
      return [{ ...base, type: 'stop' }];
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
