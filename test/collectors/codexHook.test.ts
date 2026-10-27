import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexHookToEvents, shellHead } from '../../src/server/collectors/codexHook.ts';

const BASE = { session_id: 'x1', cwd: '/Users/seop/developer/street-centrality-bus', transcript_path: '/Users/seop/.codex/sessions/2026/10/24/rollout-x1.jsonl', model: 'gpt-5.5', turn_id: 't1' };
const ev = (o: Record<string, unknown>) => ({ ...BASE, ...o });
// 공통 필드를 뺀 나머지만 비교
const kinds = (p: unknown) => codexHookToEvents(p, 5).map(({ sessionId, at, cwd, transcriptPath, title, subagentId, kind, model, ...rest }) => rest);
const pre = (tool_name: string, tool_input: Record<string, unknown>) => kinds(ev({ hook_event_name: 'PreToolUse', tool_name, tool_use_id: 'u1', tool_input }));

test('shellHead: 래퍼·따옴표 벗기고 첫 단어', () => {
  assert.equal(shellHead('rg foo src'), 'rg');
  assert.equal(shellHead('bash -lc "sed -n 1,5p a.ts"'), 'sed');
  assert.equal(shellHead("zsh -c '/usr/bin/cat x'"), 'cat');
  assert.equal(shellHead('sh -c "ls -la"'), 'ls');
  assert.equal(shellHead('npm test'), 'npm');
  assert.equal(shellHead(''), '');
});

test('PreToolUse: 읽기 명령 📖, 그 밖 ▶, apply_patch ✏️ 파일 이름, spawn_agent 👥, MCP ▶', () => {
  assert.deepEqual(pre('Bash', { command: 'rg foo src' }), [{ type: 'tool-start', toolUseId: 'u1', activity: 'reading', detail: 'Bash: rg foo src' }]);
  assert.deepEqual(pre('Bash', { command: 'npm test' }), [{ type: 'tool-start', toolUseId: 'u1', activity: 'running', detail: 'Bash: npm test' }]);
  assert.deepEqual(pre('apply_patch', { files: ['/x/src/a.ts', '/x/b.md'] }), [{ type: 'tool-start', toolUseId: 'u1', activity: 'editing', detail: 'a.ts, b.md' }]);
  assert.deepEqual(pre('apply_patch', {}), [{ type: 'tool-start', toolUseId: 'u1', activity: 'editing', detail: 'apply_patch' }]);
  assert.deepEqual(pre('spawn_agent', { description: '리뷰 도우미' }), [{ type: 'tool-start', toolUseId: 'u1', activity: 'delegating', detail: '리뷰 도우미', spawn: true }]);
  assert.deepEqual(pre('spawn_agent', {}), [{ type: 'tool-start', toolUseId: 'u1', activity: 'delegating', detail: '도우미', spawn: true }]);
  // 앱(0.162)은 묶음 이름을 앞에 붙이고 task_name을 쓴다(Task 0 실측). 기다리는 동안(wait_agent)도 👥
  assert.deepEqual(pre('collaborationspawn_agent', { task_name: 'count_md' }), [{ type: 'tool-start', toolUseId: 'u1', activity: 'delegating', detail: 'count_md', spawn: true }]);
  assert.deepEqual(pre('collaborationwait_agent', {}), [{ type: 'tool-start', toolUseId: 'u1', activity: 'delegating', detail: '도우미 기다림' }]);
  assert.deepEqual(pre('wait_agent', {}), [{ type: 'tool-start', toolUseId: 'u1', activity: 'delegating', detail: '도우미 기다림' }]);
  assert.deepEqual(pre('mcp__fs__read', {}), [{ type: 'tool-start', toolUseId: 'u1', activity: 'running', detail: 'fs · read' }]);
});

test('사건 매핑: 시작·프롬프트·승인(도우미면 subagentId)·도우미·정리·끝·중단→stop·퇴근, 모르는 사건 []', () => {
  assert.deepEqual(kinds(ev({ hook_event_name: 'SessionStart', source: 'startup' })), [{ type: 'session-start' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'UserPromptSubmit', prompt: '비밀' })), [{ type: 'prompt' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } })), [{ type: 'permission', detail: 'Bash: npm test' }]);
  const sub = codexHookToEvents(ev({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'A' }), 5);
  assert.equal(sub[0].subagentId, 'A');
  assert.deepEqual(kinds(ev({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'worker' })), [{ type: 'subagent-start', agentId: 'A', agentType: 'worker' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'SubagentStop', agent_id: 'A', agent_type: 'worker' })), [{ type: 'subagent-stop', agentId: 'A' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'PreCompact', trigger: 'manual' })), [{ type: 'compact-start', trigger: 'manual' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'PostCompact', trigger: 'auto' })), [{ type: 'compact-end', trigger: 'auto' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'u1' })), [{ type: 'tool-end', toolUseId: 'u1' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'Stop' })), [{ type: 'stop' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'Interrupt' })), [{ type: 'stop', interrupted: true }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'SessionEnd', reason: 'other' })), [{ type: 'session-end' }]);
  assert.deepEqual(kinds(ev({ hook_event_name: 'Mystery' })), []);
});

test('모든 Codex 이벤트는 kind codex, transcriptPath·title 없음', () => {
  for (const e of codexHookToEvents(ev({ hook_event_name: 'SessionStart', session_title: '제목' }), 5)) {
    assert.equal(e.kind, 'codex');
    assert.equal('transcriptPath' in e, false);
    assert.equal('title' in e, false);
  }
});

test('모델 이름이 모든 Codex 사건에 실림(없으면 안 실림)', () => {
  assert.equal(codexHookToEvents(ev({ hook_event_name: 'UserPromptSubmit' }), 5)[0].model, 'gpt-5.5');
  const { model, ...noModel } = BASE;
  assert.equal(codexHookToEvents({ ...noModel, hook_event_name: 'Stop' }, 5)[0].model, undefined);
});

test('기록 파일이 없는 일회용 세션(transcript_path null — Codex 기억 정리 등)은 모든 사건을 버림, 경로를 안 보내면(옛 버전) 그대로', () => {
  // 2026-10-27 실측: codex exec --ephemeral은 SessionStart·UserPromptSubmit·Stop·SessionEnd 모두 transcript_path null, 보통 세션은 파일 경로
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'Interrupt', 'PermissionRequest']) {
    assert.deepEqual(codexHookToEvents(ev({ hook_event_name, transcript_path: null }), 5), [], hook_event_name);
  }
  assert.deepEqual(codexHookToEvents(ev({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'ls' }, transcript_path: null }), 5), []);
  assert.equal(kinds(ev({ hook_event_name: 'UserPromptSubmit' }))[0]?.type, 'prompt');
  const { transcript_path: _omit, ...noPath } = BASE;
  assert.equal(kinds({ ...noPath, hook_event_name: 'UserPromptSubmit' })[0]?.type, 'prompt');
});
