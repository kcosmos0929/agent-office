import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookToEvents, hookPaths, classifyTool, summarizeToolInput, clip } from '../../src/server/collectors/claudeHook.ts';
import { fx } from '../helpers.ts';

test('PreToolUse Bash → tool-start running', () => {
  const [e] = hookToEvents(fx('pre-bash'), 1000);
  assert.equal(e.type, 'tool-start');
  assert.equal(e.at, 1000);
  assert.equal(e.sessionId, 's1');
  assert.equal(e.cwd, '/Users/seop/developer/street-centrality-bus');
  assert.equal(e.transcriptPath, '/tmp/t.jsonl');
  if (e.type !== 'tool-start') throw new Error('type');
  assert.equal(e.activity, 'running');
  assert.equal(e.detail, 'Bash: python run_model.py');
  assert.equal(e.toolUseId, 'tu1');
});

test('PostToolUse → tool-end', () => {
  const [e] = hookToEvents(fx('post-bash'), 0);
  assert.deepEqual({ type: e.type, id: e.type === 'tool-end' ? e.toolUseId : null }, { type: 'tool-end', id: 'tu1' });
  assert.equal(hookToEvents({ ...fx('post-bash'), hook_event_name: 'PostToolUseFailure', error: '실패' }, 0)[0].type, 'tool-end');
});

test('PermissionRequest → permission, detail은 도구 요약', () => {
  const [e] = hookToEvents(fx('permission'), 0);
  assert.equal(e.type, 'permission');
  if (e.type !== 'permission') throw new Error('type');
  assert.equal(e.detail, 'Bash: python run_model.py');
});

test('하위 에이전트 안의 권한 요청은 subagentId를 단다', () => {
  const [e] = hookToEvents({ ...fx('permission'), agent_id: 'a1' }, 0);
  assert.equal(e.type, 'permission');
  assert.equal(e.subagentId, 'a1');
});

test('Notification: idle_prompt는 idle, 다른 알림은 무시, permission_prompt는 permission(알림 출처 표시)', () => {
  assert.equal(hookToEvents({ ...fx('notification'), notification_type: 'idle_prompt' }, 0)[0].type, 'idle');
  assert.deepEqual(hookToEvents({ ...fx('notification'), notification_type: 'auth_success' }, 0), []);
  const [e] = hookToEvents(fx('notification'), 0);
  assert.equal(e.type, 'permission');
  if (e.type !== 'permission') throw new Error('type');
  assert.equal(e.detail, 'Claude needs your permission to use Bash');
  assert.equal(e.viaNotification, true);
});

test('UserPromptSubmit → prompt + 제목, 프롬프트 내용은 없음', () => {
  const evs = hookToEvents(fx('prompt'), 0);
  assert.equal(evs[0].type, 'prompt');
  assert.equal(evs[0].title, '정류장 승하차 결합');
  assert.ok(!JSON.stringify(evs).includes('비밀'));
});

test('대화 내용(last_assistant_message, tool_response, error)은 이벤트에 남지 않는다', () => {
  const s = JSON.stringify([
    ...hookToEvents(fx('stop'), 0),
    ...hookToEvents(fx('post-bash'), 0),
    ...hookToEvents(fx('subagent-stop'), 0),
    ...hookToEvents({ ...fx('post-bash'), hook_event_name: 'PostToolUseFailure', error: '비밀 에러' }, 0),
  ]);
  assert.ok(!s.includes('비밀'));
  assert.ok(!s.includes('작업 끝'));
  assert.ok(!s.includes('요약'));
});

test('세션·하위 에이전트 시작과 끝', () => {
  assert.equal(hookToEvents(fx('session-start'), 0)[0].type, 'session-start');
  assert.equal(hookToEvents(fx('session-end'), 0)[0].type, 'session-end');
  assert.equal(hookToEvents(fx('stop'), 0)[0].type, 'stop');
  const [s] = hookToEvents(fx('subagent-start'), 0);
  assert.deepEqual(s.type === 'subagent-start' ? [s.agentId, s.agentType] : null, ['a1', 'Explore']);
  const [t] = hookToEvents(fx('subagent-stop'), 0);
  assert.deepEqual(t.type === 'subagent-stop' ? t.agentId : null, 'a1');
});

test('session_id 없음·모르는 이벤트·이상한 입력 → 빈 배열', () => {
  assert.deepEqual(hookToEvents({ hook_event_name: 'Stop' }, 0), []);
  assert.deepEqual(hookToEvents({ ...fx('stop'), hook_event_name: 'TeammateIdle' }, 0), []);
  assert.deepEqual(hookToEvents(null, 0), []);
  assert.deepEqual(hookToEvents('문자열', 0), []);
});

test('clip: 긴 명령·줄바꿈·이모지·태그', () => {
  const d = summarizeToolInput('Bash', { command: 'echo "<script>x</script>"' + '😀'.repeat(80) + '\nrm -rf /tmp/a' });
  assert.ok([...d].length <= 60);
  assert.ok(!d.includes('\n'));
  assert.ok(d.endsWith('…'));
  assert.ok(d.startsWith('Bash: echo "<script>x</script>"'));
  assert.equal(clip('a\tb\u0007c   d'), 'a b c d');
  assert.equal([...clip('가'.repeat(100))].length, 60);
});

test('classifyTool', () => {
  assert.equal(classifyTool('Grep'), 'reading');
  assert.equal(classifyTool('WebSearch'), 'reading');
  assert.equal(classifyTool('Edit'), 'editing');
  assert.equal(classifyTool('NotebookEdit'), 'editing');
  assert.equal(classifyTool('Agent'), 'delegating');
  assert.equal(classifyTool('Task'), 'delegating');
  assert.equal(classifyTool('Bash'), 'running');
  assert.equal(classifyTool('mcp__qgis__render_map'), 'running');
});

test('summarizeToolInput 도구별', () => {
  assert.equal(summarizeToolInput('Read', { file_path: '/Users/seop/developer/x/analysis.py' }), 'analysis.py');
  assert.equal(summarizeToolInput('NotebookEdit', { notebook_path: '/a/b/model.ipynb' }), 'model.ipynb');
  assert.equal(summarizeToolInput('Grep', { pattern: 'rate_limits' }), '"rate_limits"');
  assert.equal(summarizeToolInput('Glob', { pattern: '**/*.ts' }), '**/*.ts');
  assert.equal(summarizeToolInput('WebFetch', { url: 'https://code.claude.com/docs/en/hooks' }), 'code.claude.com');
  assert.equal(summarizeToolInput('WebSearch', { query: 'three.js isometric' }), 'three.js isometric');
  assert.equal(summarizeToolInput('Agent', { description: '코드 찾기', subagent_type: 'Explore' }), '코드 찾기');
  assert.equal(summarizeToolInput('Task', { subagent_type: 'Explore' }), 'Explore');
  assert.equal(summarizeToolInput('mcp__qgis__render_map', {}), 'qgis · render_map');
  assert.equal(summarizeToolInput('TodoWrite', {}), 'TodoWrite');
  assert.equal(summarizeToolInput('Bash', { command: 'ls\nrm x' }), 'Bash: ls');
  assert.equal(summarizeToolInput('WebFetch', { url: '잘못된 주소' }), 'WebFetch');
});

test('도구 실행 중 사용자가 끊으면(PostToolUseFailure is_interrupt) tool-end 다음 stop', () => {
  const evs = hookToEvents({ ...fx('post-bash'), hook_event_name: 'PostToolUseFailure', is_interrupt: true }, 0);
  assert.deepEqual(evs.map((e) => e.type), ['tool-end', 'stop']);
  const normal = hookToEvents({ ...fx('post-bash'), hook_event_name: 'PostToolUseFailure', is_interrupt: false }, 0);
  assert.deepEqual(normal.map((e) => e.type), ['tool-end']);
});

// 공통 필드를 뺀 나머지만 비교
const kinds = (p: unknown) => hookToEvents(p, 5).map(({ sessionId, at, cwd, transcriptPath, title, subagentId, ...rest }) => rest);

test('PreCompact/PostCompact → 정리 시작/끝, 모르는 trigger는 auto', () => {
  assert.deepEqual(kinds(fx('pre-compact')), [{ type: 'compact-start', trigger: 'manual' }]);
  assert.deepEqual(kinds(fx('post-compact')), [{ type: 'compact-end', trigger: 'auto' }]);
  assert.deepEqual(kinds({ ...fx('pre-compact'), trigger: 'weird' }), [{ type: 'compact-start', trigger: 'auto' }]);
});

test('StopFailure: rate_limit → 한도 대기, 그 밖 → stop + error', () => {
  assert.deepEqual(kinds(fx('stop-failure')), [{ type: 'quota-wait' }]);
  assert.deepEqual(kinds({ ...fx('stop-failure'), error: 'overloaded' }), [{ type: 'stop', error: 'overloaded' }]);
  assert.deepEqual(kinds({ ...fx('stop-failure'), error: undefined }), [{ type: 'stop', error: 'unknown' }]);
});

test('AskUserQuestion: PreToolUse → tool-start + question, PermissionRequest → question', () => {
  assert.deepEqual(kinds(fx('ask-question')), [
    { type: 'tool-start', toolUseId: 'q1', activity: 'running', detail: 'AskUserQuestion' },
    { type: 'question', detail: null },
  ]);
  assert.deepEqual(kinds({ ...fx('ask-question'), hook_event_name: 'PermissionRequest' }), [{ type: 'question', detail: null }]);
});

test('다음 할 일 상자(wrap_up): 질문 있으면 tool-start + turn-ask, 없거나 다른 도구면 tool-start만', () => {
  const p = { session_id: 's1', hook_event_name: 'PreToolUse', cwd: '/x', tool_name: 'mcp__ccd_turn__wrap_up', tool_use_id: 'w1', tool_input: { asks: true } };
  const types = (q: object) => kinds(q).map((e) => e.type);
  assert.deepEqual(types(p), ['tool-start', 'turn-ask']);
  assert.deepEqual(types({ ...p, tool_input: {} }), ['tool-start']);
  assert.deepEqual(types({ ...p, tool_name: 'Bash' }), ['tool-start']);
  assert.deepEqual(types({ ...p, hook_event_name: 'PostToolUse' }), ['tool-end']);
});

test('Notification: 질문류 → question, 승인 → permission (둘 다 viaNotification), 한도 재개 3종', () => {
  const n = (t: string) => kinds({ ...fx('notification'), notification_type: t, message: '입력이 필요해요' });
  for (const t of ['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']) {
    assert.deepEqual(n(t), [{ type: 'question', detail: '입력이 필요해요', viaNotification: true }]);
  }
  assert.deepEqual(n('permission_prompt'), [{ type: 'permission', detail: '입력이 필요해요', viaNotification: true }]);
  assert.deepEqual(n('quota_auto_resume_fired'), [{ type: 'resume' }]);
  assert.deepEqual(n('quota_auto_resume_stale'), [{ type: 'stop' }]);
  assert.deepEqual(n('quota_auto_resume_disabled'), [{ type: 'stop' }]);
  assert.deepEqual(n('auth_success'), []);
  assert.deepEqual(kinds({ ...fx('notification'), notification_type: 'elicitation_dialog', message: undefined }), [{ type: 'question', detail: null, viaNotification: true }]);
});

test('SessionStart의 model이 사건에 실림(없으면 안 실림)', () => {
  const [e] = hookToEvents({ session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5-5' }, 1);
  assert.equal(e.model, 'claude-opus-5-5');
  assert.equal(hookToEvents({ session_id: 's1', cwd: '/x', hook_event_name: 'SessionStart', source: 'clear' }, 1)[0].model, undefined);
});

test('hookPaths: 파일·폴더·Codex 파일 목록·셸 첫 줄의 경로(따옴표 안 공백 포함), 옵션·주소·경로 아닌 말은 뺌', () => {
  assert.deepEqual(hookPaths({ tool_input: { file_path: '/a/b.ts' } }), ['/a/b.ts']);
  assert.deepEqual(hookPaths({ tool_input: { path: 'src', pattern: 'x' } }), ['src']);
  assert.deepEqual(hookPaths({ tool_input: { files: ['a.ts', '/x/b.md'] } }), ['a.ts', '/x/b.md']);
  const command = 'cd ~/developer/x && rg "foo" "/Users/seop/Documents/CnC Wiki/AI-Sessions/wiki/projects/so/a.md" --glob=*/x https://example.com/a/b -n';
  assert.deepEqual(hookPaths({ tool_input: { command } }), ['~/developer/x', '/Users/seop/Documents/CnC Wiki/AI-Sessions/wiki/projects/so/a.md']);
  assert.deepEqual(hookPaths({ hook_event_name: 'Stop' }), []);
  assert.deepEqual(hookPaths(null), []);
});
