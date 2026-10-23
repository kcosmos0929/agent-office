#!/usr/bin/env node
// Synthetic Office용 Claude Code 상태줄. 사용량(rate_limits)을 로컬 서버로 보내고, 상태줄에 짧은 한 줄을 출력한다.
// 형식은 서버의 statusLineText와 같다: "5h 62% · 3:12" / 사용량 없으면 모델 이름 / 둘 다 없으면 빈 줄.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.SO_HOME ?? path.join(os.homedir(), '.synthetic-office');
const POST_TIMEOUT_MS = 300;
setTimeout(() => process.exit(0), 1500).unref();

function endpoint() {
  try {
    const e = JSON.parse(fs.readFileSync(path.join(HOME, 'endpoint.json'), 'utf8'));
    process.kill(e.pid, 0);
    return e;
  } catch {
    return null;
  }
}

function line(d) {
  const w = d?.rate_limits?.five_hour;
  const nowSec = Date.now() / 1000;
  if (w && typeof w.used_percentage === 'number' && typeof w.resets_at === 'number' && w.resets_at > nowSec) {
    const mins = Math.max(0, Math.floor((w.resets_at - nowSec) / 60));
    return `5h ${Math.round(w.used_percentage)}% · ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
  }
  return typeof d?.model?.display_name === 'string' ? d.model.display_name : '';
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let d = null;
  try { d = JSON.parse(input); } catch { /* 출력만 비움 */ }
  const finish = () => { process.stdout.write(line(d), () => process.exit(0)); };
  const ep = d ? endpoint() : null;
  if (!ep) return finish();
  const req = http.request(
    { host: '127.0.0.1', port: ep.port, path: '/api/claude/usage', method: 'POST', timeout: POST_TIMEOUT_MS,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(input), authorization: `Bearer ${ep.token}` } },
    (res) => { res.resume(); res.on('end', finish); },
  );
  req.on('timeout', () => { req.destroy(); finish(); });
  req.on('error', finish);
  req.end(input);
});
