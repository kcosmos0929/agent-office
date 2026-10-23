// 화면 확인용: 켜져 있는 서버(SO_HOME의 endpoint.json)에 가짜 세션 신호를 보낸다. 실제 대화 내용 없음.
// 사용: SO_HOME=/tmp/x node scripts/demo.ts [scene]   scene = all(기본) | subagent | end
import fs from 'node:fs';
import path from 'node:path';
import { homeFiles, soHome } from '../src/server/paths.ts';

const { port, token } = JSON.parse(fs.readFileSync(homeFiles(soHome()).endpoint, 'utf8')) as { port: number; token: string };
const DEV = '/Users/seop/developer';

async function post(route: 'hook' | 'usage', body: Record<string, unknown>) {
  const r = await fetch(`http://127.0.0.1:${port}/api/claude/${route}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (r.status !== 204) throw new Error(`${route} → ${r.status}`);
}
const hook = (session: string, cwd: string, event: string, extra: Record<string, unknown> = {}) =>
  post('hook', { session_id: session, cwd, transcript_path: path.join('/tmp', `${session}.jsonl`), hook_event_name: event, ...extra });

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
}
console.log(`보냄: ${scene}`);
