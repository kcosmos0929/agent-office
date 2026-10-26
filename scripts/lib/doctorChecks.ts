// npm run doctor의 점검 9개. 읽기만 하고 아무것도 고치지 않는다. 비밀(토큰)은 출력하지 않는다. 환경은 주입(테스트용).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { peekConfig } from '../../src/server/config.ts';
import { homeFiles } from '../../src/server/paths.ts';
import { loadProjects } from '../../src/server/projects.ts';
import { CODEX_HOOK_EVENTS } from './codexHooksMerge.ts';
import { HOOK_EVENTS, MARK } from './settingsMerge.ts';

export type CheckLevel = 'ok' | 'warn' | 'fail';
export type Check = { level: CheckLevel; name: string; hint: string | null };
export type DoctorEnv = {
  home: string;
  settingsFile: string;
  repoRoot: string;
  registryDir: string;
  wikiPath: string;
  /** ~/.codex 와 ~/.codex/hooks.json */
  codexDir: string;
  codexHooksFile: string;
  isAlive: (pid: number) => boolean;
  launchdRunning: () => boolean;
  /** 실패하면 null */
  getText: (url: string) => Promise<string | null>;
  getJson: (url: string) => Promise<unknown | null>;
};

const ICON: Record<CheckLevel, string> = { ok: '✓', warn: '⚠', fail: '✗' };
const REINSTALL = 'npm run install:office로 다시 설치';

const check = (level: CheckLevel, name: string, hint: string | null = null): Check => ({ level, name, hint });

function ago(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return j !== null && typeof j === 'object' ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sha(file: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function endpointCheck(env: DoctorEnv, file: string, ep: Record<string, unknown> | null): Check {
  const name = 'endpoint.json';
  if (!ep) return check('fail', name, '없어요 — 서버가 꺼져 있거나 시작에 실패했어요');
  if (typeof ep.pid !== 'number' || !env.isAlive(ep.pid)) return check('fail', name, `pid ${String(ep.pid)} 프로세스가 없어요 — 서버를 다시 켜 주세요`);
  const mode = fs.statSync(file).mode & 0o777;
  return mode === 0o600 ? check('ok', name) : check('warn', name, `권한이 ${mode.toString(8)}예요 — 0600이어야 해요`);
}

function hooksCheck(settingsFile: string): Check {
  const name = `훅 등록 (${HOOK_EVENTS.length}개)`;
  const settings = readJson(settingsFile);
  if (!settings) return check('fail', name, `${settingsFile}을 못 읽어요`);
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const ours = (ev: string) => Array.isArray(hooks[ev]) && (hooks[ev] as Array<{ hooks?: Array<{ command?: unknown }> }>)
    .some((g) => (g.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(MARK)));
  const missing = HOOK_EVENTS.filter((ev) => !ours(ev));
  return missing.length ? check('fail', name, `빠짐: ${missing.join(', ')} — ${REINSTALL}`) : check('ok', name);
}

function scriptsCheck(home: string, repoRoot: string): Check {
  const name = '설치된 스크립트 = 레포';
  const differ = ['claude-hook.mjs', 'statusline.mjs'].filter((f) => {
    const installed = sha(path.join(home, 'bin', f));
    return installed === null || installed !== sha(path.join(repoRoot, 'hooks', f));
  });
  return differ.length ? check('warn', name, `다름: ${differ.join(', ')} — ${REINSTALL} 권장`) : check('ok', name);
}

function lastHookCheck(h: unknown): Check {
  const name = '마지막 훅';
  if (!h || typeof h !== 'object' || !('lastHookAt' in h)) return check('warn', name, '서버에 물어보지 못했어요');
  const at = (h as { lastHookAt: unknown }).lastHookAt;
  if (typeof at !== 'number') return check('warn', name, '아직 없음 — Claude 세션에서 아무 작업이나 해 보세요');
  return check('ok', name, ago(Date.now() - at));
}

/** Codex hooks.json에 사건마다 우리 명령(… claude-hook.mjs" codex)이 있나 */
function codexHooksCheck(env: DoctorEnv): Check {
  const name = `Codex 훅 등록 (${CODEX_HOOK_EVENTS.length}개)`;
  if (!fs.existsSync(env.codexDir)) return check('warn', name, 'Codex 없음');
  const file = readJson(env.codexHooksFile);
  const hooks = (file?.hooks ?? {}) as Record<string, unknown>;
  const ours = (ev: string) => Array.isArray(hooks[ev]) && (hooks[ev] as Array<{ hooks?: Array<{ command?: unknown }> }>)
    .some((g) => (g.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(MARK) && h.command.trimEnd().endsWith(' codex')));
  const missing = CODEX_HOOK_EVENTS.filter((ev) => !ours(ev));
  return missing.length ? check('fail', name, `빠짐: ${missing.join(', ')} — ${REINSTALL}`) : check('ok', name);
}

function lastCodexHookCheck(env: DoctorEnv, h: unknown): Check {
  const name = '마지막 Codex 훅';
  if (!fs.existsSync(env.codexDir)) return check('warn', name, 'Codex 없음');
  if (!h || typeof h !== 'object' || !('lastCodexHookAt' in h)) return check('warn', name, '서버에 물어보지 못했어요');
  const at = (h as { lastCodexHookAt: unknown }).lastCodexHookAt;
  if (typeof at !== 'number') return check('warn', name, '아직 없음 — Codex에서 훅을 신뢰했는지 확인');
  return check('ok', name, ago(Date.now() - at));
}

function registryCheck(dir: string): Check {
  const name = '세션 목록 폴더';
  try {
    fs.readdirSync(dir);
    return check('ok', name);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? check('warn', name, '없어요 — 데스크톱 앱을 안 쓰면 정상')
      : check('warn', name, `못 읽어요 — ${dir}`);
  }
}

export async function runChecks(env: DoctorEnv): Promise<Check[]> {
  const endpointFile = homeFiles(env.home).endpoint;
  const ep = readJson(endpointFile);
  const port = typeof ep?.port === 'number' ? ep.port : peekConfig(env.home).port;
  const base = `http://127.0.0.1:${port}`;
  const healthz = await env.getText(`${base}/healthz`);
  const health = await env.getJson(`${base}/api/health`);
  const hubs = (await loadProjects(env.wikiPath)).length;
  return [
    healthz?.trim() === 'ok' ? check('ok', '서버 응답') : check('fail', '서버 응답', `${base} 응답 없음 — 아이콘 앱이나 launchd 확인`),
    endpointCheck(env, endpointFile, ep),
    hooksCheck(env.settingsFile),
    scriptsCheck(env.home, env.repoRoot),
    env.launchdRunning() ? check('ok', '자동 켜기 (launchd)') : check('fail', '자동 켜기 (launchd)', `등록 안 됨 또는 꺼짐 — ${REINSTALL}`),
    lastHookCheck(health),
    codexHooksCheck(env),
    lastCodexHookCheck(env, health),
    registryCheck(env.registryDir),
    hubs > 0 ? check('ok', '위키 허브', `${hubs}개`) : check('warn', '위키 허브', `0개 — 위키 경로 확인: ${env.wikiPath}`),
    fs.existsSync(path.join(env.repoRoot, 'dist', 'web', 'index.html'))
      ? check('ok', '화면 파일')
      : check('fail', '화면 파일', '없어요 — npm run build:web'),
  ];
}

export function formatReport(checks: Check[]): string {
  const lines = checks.map((c) => `${ICON[c.level]} ${c.name}${c.hint ? ` — ${c.hint}` : ''}`);
  const count = (l: CheckLevel) => checks.filter((c) => c.level === l).length;
  return [...lines, '', `✓ ${count('ok')} · ⚠ ${count('warn')} · ✗ ${count('fail')}`].join('\n');
}

export function exitCode(checks: Check[]): 0 | 1 {
  return checks.some((c) => c.level === 'fail') ? 1 : 0;
}
