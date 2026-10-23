import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exitCode, formatReport, runChecks, type DoctorEnv } from '../../scripts/lib/doctorChecks.ts';
import { mergeClaudeSettings } from '../../scripts/lib/settingsMerge.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const TOKEN = 'e'.repeat(64);
const NAMES = ['서버 응답', 'endpoint.json', '훅 등록 (14개)', '설치된 스크립트 = 레포', '자동 켜기 (launchd)', '마지막 훅', '세션 목록 폴더', '위키 허브', '화면 파일'];

/** 모두 정상인 가짜 설치: 데이터 폴더·settings·레포·세션 목록·위키 허브 1개 */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-doc-'));
  const home = path.join(root, '.synthetic-office');
  const bin = path.join(home, 'bin');
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'dist', 'web'), { recursive: true });
  for (const f of ['claude-hook.mjs', 'statusline.mjs']) {
    fs.copyFileSync(path.join(REPO, 'hooks', f), path.join(bin, f));
    fs.copyFileSync(path.join(REPO, 'hooks', f), path.join(repoRoot, 'hooks', f));
  }
  fs.writeFileSync(path.join(repoRoot, 'dist', 'web', 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(home, 'endpoint.json'), JSON.stringify({ port: 5001, token: TOKEN, pid: process.pid }), { mode: 0o600 });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port: 4999 }));
  const settingsFile = path.join(root, 'settings.json');
  const cmd = { hook: `node "${bin}/claude-hook.mjs"`, statusline: `node "${bin}/statusline.mjs"` };
  fs.writeFileSync(settingsFile, JSON.stringify(mergeClaudeSettings({}, cmd).settings));
  const registryDir = path.join(root, 'sessions');
  fs.mkdirSync(registryDir);
  const wikiPath = path.join(root, 'wiki');
  const hubDir = path.join(wikiPath, 'AI-Sessions', 'wiki', 'projects', 'x');
  fs.mkdirSync(hubDir, { recursive: true });
  fs.writeFileSync(path.join(hubDir, '00 x 허브.md'), '---\nproject: x\nproject_path: /Users/seop/developer/x/\n---\n');
  const urls: string[] = [];
  const env: DoctorEnv = {
    home, settingsFile, repoRoot, registryDir, wikiPath,
    isAlive: () => true,
    launchdRunning: () => true,
    getText: async (url) => { urls.push(url); return url.endsWith('/healthz') ? 'ok' : null; },
    getJson: async (url) => { urls.push(url); return { startedAt: 0, lastHookAt: Date.now() - 3 * 60_000, registry: 'ok', sessions: 1, hookless: 0 }; },
  };
  return { root, home, env, urls, settingsFile, repoRoot, registryDir, hubDir };
}

const byName = (checks: Awaited<ReturnType<typeof runChecks>>, name: string) => checks.find((c) => c.name === name)!;

test('모두 정상 → ✓ 9개(이 순서), 종료 코드 0, 서버는 endpoint.json 포트로', async () => {
  const { env, urls } = setup();
  const checks = await runChecks(env);
  assert.deepEqual(checks.map((c) => c.name), NAMES);
  assert.deepEqual(checks.map((c) => c.level), Array(9).fill('ok'));
  assert.equal(exitCode(checks), 0);
  assert.ok(urls.includes('http://127.0.0.1:5001/healthz'));
  assert.equal(byName(checks, '마지막 훅').hint, '3분 전');
  assert.equal(byName(checks, '위키 허브').hint, '1개');
});

test('endpoint.json 없음 → ✗, 서버 응답은 설정 포트로 시도', async () => {
  const { env, home, urls } = setup();
  fs.rmSync(path.join(home, 'endpoint.json'));
  const checks = await runChecks(env);
  assert.equal(byName(checks, 'endpoint.json').level, 'fail');
  assert.ok(urls.includes('http://127.0.0.1:4999/healthz'));
  assert.equal(exitCode(checks), 1);
});

test('endpoint.json의 pid가 죽음 → ✗, 권한이 0600이 아니면 ⚠', async () => {
  const dead = setup();
  dead.env.isAlive = () => false;
  assert.equal(byName(await runChecks(dead.env), 'endpoint.json').level, 'fail');
  const open = setup();
  fs.chmodSync(path.join(open.home, 'endpoint.json'), 0o644);
  assert.equal(byName(await runChecks(open.env), 'endpoint.json').level, 'warn');
});

test('PreCompact 훅 빠짐 → ✗ 훅 등록 (14개), 안내에 PreCompact', async () => {
  const { env, settingsFile } = setup();
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  delete s.hooks.PreCompact;
  fs.writeFileSync(settingsFile, JSON.stringify(s));
  const c = byName(await runChecks(env), '훅 등록 (14개)');
  assert.equal(c.level, 'fail');
  assert.match(c.hint ?? '', /PreCompact/);
});

test('설치된 훅 내용이 다름 → ⚠ 설치된 스크립트 = 레포', async () => {
  const { env, home } = setup();
  fs.appendFileSync(path.join(home, 'bin', 'claude-hook.mjs'), '\n// 옛 버전\n');
  const c = byName(await runChecks(env), '설치된 스크립트 = 레포');
  assert.equal(c.level, 'warn');
  assert.match(c.hint ?? '', /claude-hook\.mjs/);
});

test('launchd 안 돎 ✗ · lastHookAt null ⚠ · 세션 목록 폴더 없음 ⚠ · 허브 0개 ⚠', async () => {
  const { env, registryDir, hubDir } = setup();
  env.launchdRunning = () => false;
  env.getJson = async () => ({ startedAt: 0, lastHookAt: null, registry: 'ok', sessions: 0, hookless: 0 });
  fs.rmSync(registryDir, { recursive: true });
  fs.rmSync(hubDir, { recursive: true });
  const checks = await runChecks(env);
  assert.equal(byName(checks, '자동 켜기 (launchd)').level, 'fail');
  assert.equal(byName(checks, '마지막 훅').level, 'warn');
  assert.equal(byName(checks, '세션 목록 폴더').level, 'warn');
  assert.equal(byName(checks, '위키 허브').level, 'warn');
});

test('화면 파일 없음 → ✗, 안내 npm run build:web', async () => {
  const { env, repoRoot } = setup();
  fs.rmSync(path.join(repoRoot, 'dist'), { recursive: true });
  const c = byName(await runChecks(env), '화면 파일');
  assert.equal(c.level, 'fail');
  assert.match(c.hint ?? '', /npm run build:web/);
});

test('formatReport: 기호와 안내, 토큰 문자열이 출력에 없음', async () => {
  const { env, home } = setup();
  fs.chmodSync(path.join(home, 'endpoint.json'), 0o644);
  env.launchdRunning = () => false;
  const text = formatReport(await runChecks(env));
  assert.match(text, /^✓ 서버 응답$/m);
  assert.match(text, /^⚠ endpoint\.json — /m);
  assert.match(text, /^✗ 자동 켜기 \(launchd\) — /m);
  assert.ok(!text.includes(TOKEN));
});

test('읽기 전용: 점검 전후 파일 목록이 같고 config.json을 만들지 않음', async () => {
  const { env, root, home } = setup();
  fs.rmSync(path.join(home, 'config.json'));
  const list = () => fs.readdirSync(root, { recursive: true }).map(String).sort();
  const before = list();
  await runChecks(env);
  assert.deepEqual(list(), before);
});
