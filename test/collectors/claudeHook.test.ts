import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookToEvents, classifyTool, summarizeToolInput, clip } from '../../src/server/collectors/claudeHook.ts';
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

test('Notification: idle_prompt는 무시, permission_prompt는 permission', () => {
  assert.deepEqual(hookToEvents({ ...fx('notification'), notification_type: 'idle_prompt' }, 0), []);
  const [e] = hookToEvents(fx('notification'), 0);
  assert.equal(e.type, 'permission');
  if (e.type !== 'permission') throw new Error('type');
  assert.equal(e.detail, 'Claude needs your permission to use Bash');
  for (const t of ['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']) {
    assert.equal(hookToEvents({ ...fx('notification'), notification_type: t }, 0)[0].type, 'permission');
  }
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
