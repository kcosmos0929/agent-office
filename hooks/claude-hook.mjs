#!/usr/bin/env node
// Synthetic Office용 Claude Code 훅. 받은 입력을 로컬 서버로 넘기기만 한다.
// 약속: 표준 출력에 아무것도 쓰지 않고(권한 결정에 끼어들지 않음), 어떤 경우에도 exit 0.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.SO_HOME ?? path.join(os.homedir(), '.synthetic-office');
const POST_TIMEOUT_MS = 1000;
const done = () => process.exit(0);
setTimeout(done, 2000).unref(); // 무슨 일이 있어도 2초 안에 끝

function endpoint() {
  try {
    const e = JSON.parse(fs.readFileSync(path.join(HOME, 'endpoint.json'), 'utf8'));
    process.kill(e.pid, 0); // 서버 프로세스가 살아 있는지
    return e;
  } catch {
    return null;
  }
}

// 서버 수집기(claudeHook.ts)가 실제로 쓰는 필드만 보낸다 — 큰 파일 내용·프롬프트·응답·도구 결과·정리 요약·오류 원문은 보내지 않음
const KEEP = ['session_id', 'hook_event_name', 'cwd', 'transcript_path', 'session_title', 'agent_id', 'agent_type',
  'tool_name', 'tool_use_id', 'notification_type', 'message', 'is_interrupt', 'trigger'];
const KEEP_INPUT = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'subagent_type'];
const cut = (v) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) : v);

function minimize(d) {
  const out = {};
  for (const k of KEEP) if (d[k] !== undefined) out[k] = cut(d[k]);
  // StopFailure의 error는 오류 종류 이름(rate_limit 등). 다른 훅(PostToolUseFailure)의 error는 오류 원문이라 보내지 않는다
  if (d.hook_event_name === 'StopFailure' && d.error !== undefined) out.error = cut(d.error);
  if (d.tool_input && typeof d.tool_input === 'object') {
    const ti = {};
    for (const k of KEEP_INPUT) if (d.tool_input[k] !== undefined) ti[k] = cut(d.tool_input[k]);
    out.tool_input = ti;
  }
  return out;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const ep = endpoint();
  if (!ep) return done();
  let body;
  try {
    body = JSON.stringify(minimize(JSON.parse(input)));
  } catch {
    return done();
  }
  const req = http.request(
    { host: '127.0.0.1', port: ep.port, path: '/api/claude/hook', method: 'POST', timeout: POST_TIMEOUT_MS,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${ep.token}` } },
    (res) => { res.resume(); res.on('end', done); },
  );
  req.on('timeout', () => { req.destroy(); done(); });
  req.on('error', done);
  req.end(body);
});
process.stdin.on('error', done);
