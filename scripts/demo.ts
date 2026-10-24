// 화면 확인용: 켜져 있는 서버(SO_HOME의 endpoint.json)에 가짜 세션 신호를 보낸다. 실제 대화 내용 없음.
// 사용: SO_HOME=/tmp/x node scripts/demo.ts [scene]   scene = all(기본) | subagent | end | accuracy
// accuracy: ❓·🧹·⏳·대화 게이지 + (SO_CLAUDE_SESSIONS가 있으면) 그 폴더에 훅 없는 세션 등록부 파일
// codex: Codex 세션 셋(📖 읽기 · ✏️ 고치기 · ❗ 승인)을 /api/codex/hook으로
import fs from 'node:fs';
import path from 'node:path';
import { homeFiles, soHome } from '../src/server/paths.ts';

const { port, token, pid } = JSON.parse(fs.readFileSync(homeFiles(soHome()).endpoint, 'utf8')) as { port: number; token: string; pid: number };
const DEV = '/Users/seop/developer';

async function post(route: 'hook' | 'usage' | 'codex', body: Record<string, unknown>) {
  const url = route === 'codex' ? '/api/codex/hook' : `/api/claude/${route}`;
  const r = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (r.status !== 204) throw new Error(`${route} → ${r.status}`);
}
const hook = (session: string, cwd: string, event: string, extra: Record<string, unknown> = {}) =>
  post('hook', { session_id: session, cwd, transcript_path: path.join('/tmp', `${session}.jsonl`), hook_event_name: event, ...extra });

const codexHook = (session: string, cwd: string, event: string, extra: Record<string, unknown> = {}) =>
  post('codex', { session_id: session, cwd, hook_event_name: event, ...extra });

const scene = process.argv[2] ?? 'all';
if (scene === 'all') {
  await hook('demo-lst', `${DEV}/lst_ss`, 'SessionStart', { source: 'startup' });
  await hook('demo-lst', `${DEV}/lst_ss`, 'UserPromptSubmit', { session_title: 'LST 차별성 파일럿' });
  await hook('demo-lst', `${DEV}/lst_ss`, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${DEV}/lst_ss/analysis.py` }, tool_use_id: 't1' });
  await hook('demo-bus', `${DEV}/street-centrality-bus`, 'UserPromptSubmit', { session_title: '정류장 승하차 결합' });
  await hook('demo-bus', `${DEV}/street-centrality-bus`, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'python run_model.py' }, tool_use_id: 't2' });
  await hook('demo-bus', `${DEV}/street-centrality-bus`, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'python run_model.py' } });
  await hook('demo-wiki', '/Users/seop/Documents/CnC Wiki', 'UserPromptSubmit', {});
  await hook('demo-wiki', '/Users/seop/Documents/CnC Wiki', 'Stop', {});
  await hook('demo-read', `${DEV}/synthetic-office`, 'UserPromptSubmit', { session_title: '오피스 3D 장면' });
  await hook('demo-read', `${DEV}/synthetic-office`, 'PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'seatPosition' }, tool_use_id: 't3' });
  await post('usage', { rate_limits: { five_hour: { used_percentage: 62, resets_at: Math.floor(Date.now() / 1000) + 3 * 3600 + 12 * 60 }, seven_day: { used_percentage: 41, resets_at: Math.floor(Date.now() / 1000) + 4 * 86400 } } });
} else if (scene === 'subagent') {
  await hook('demo-read', `${DEV}/synthetic-office`, 'PreToolUse', { tool_name: 'Agent', tool_input: { description: '코드 찾기' }, tool_use_id: 't4' });
  await hook('demo-read', `${DEV}/synthetic-office`, 'SubagentStart', { agent_id: 'sub1', agent_type: 'Explore' });
  await hook('demo-read', `${DEV}/synthetic-office`, 'SubagentStart', { agent_id: 'sub2', agent_type: 'Explore' });
} else if (scene === 'end') {
  await hook('demo-wiki', '/Users/seop/Documents/CnC Wiki', 'SessionEnd', { reason: 'other' });
} else if (scene === 'codex') {
  await codexHook('x-review', `${DEV}/street-centrality-bus`, 'UserPromptSubmit');
  await codexHook('x-review', `${DEV}/street-centrality-bus`, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'rg TODO src' } });
  await codexHook('x-edit', `${DEV}/synthetic-office`, 'UserPromptSubmit');
  await codexHook('x-edit', `${DEV}/synthetic-office`, 'PreToolUse', { tool_name: 'apply_patch', tool_use_id: 'u2', tool_input: { files: ['/Users/seop/developer/synthetic-office/src/server/state.ts'] } });
  await codexHook('x-perm', `${DEV}/lst_ss`, 'UserPromptSubmit');
  await codexHook('x-perm', `${DEV}/lst_ss`, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'u3', tool_input: { command: 'npm test' } });
  await codexHook('x-perm', `${DEV}/lst_ss`, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
} else if (scene === 'accuracy') {
  await hook('demo-ask', `${DEV}/lst_ss`, 'UserPromptSubmit', { session_title: '질문 대기 예시' });
  await hook('demo-ask', `${DEV}/lst_ss`, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'q1' });
  await hook('demo-compact', `${DEV}/street-centrality-bus`, 'UserPromptSubmit', { session_title: '대화 정리 예시' });
  await hook('demo-compact', `${DEV}/street-centrality-bus`, 'PreCompact', { trigger: 'manual' });
  await hook('demo-quota', `${DEV}/synthetic-office`, 'UserPromptSubmit', { session_title: '토큰 기다림 예시' });
  await hook('demo-quota', `${DEV}/synthetic-office`, 'StopFailure', { error: 'rate_limit' });
  // 대화 게이지: 숫자만 든 가짜 트랜스크립트(합 720 000 → 72%)
  const transcript = path.join(soHome(), 'demo-gauge.jsonl');
  const usage = { input_tokens: 2, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 690_000, output_tokens: 9_998 };
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-5-5', usage } }) + '\n');
  const gauge = { session_id: 'demo-gauge', cwd: '/Users/seop/Documents/CnC Wiki', transcript_path: transcript };
  await post('hook', { ...gauge, hook_event_name: 'UserPromptSubmit', session_title: '게이지 예시' });
  await post('hook', { ...gauge, hook_event_name: 'Stop' });
  // 훅 없는 세션: 서버 pid를 빌려 살아 있는 것처럼(서버가 켜진 지 2분이 지나야 '훅 없음')
  const sessions = process.env.SO_CLAUDE_SESSIONS;
  if (sessions) {
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, `${pid}.json`), JSON.stringify({
      kind: 'interactive', sessionId: 'demo-nohook', pid, cwd: `${DEV}/lst_ss`, name: '훅 없는 세션', status: 'busy', statusUpdatedAt: Date.now() - 3 * 60_000,
    }));
  }
}
console.log(`보냄: ${scene}`);
