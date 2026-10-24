// 설치: 화면 빌드 → 훅 스크립트 복사 → settings.json 백업·병합 → (Codex 있으면) hooks.json 백업·병합 → launchd 등록 → 서버 확인 → 아이콘 앱.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/server/config.ts';
import { soHome } from '../src/server/paths.ts';
import { renderPlist } from './lib/plist.ts';
import { mergeCodexHooks } from './lib/codexHooksMerge.ts';
import { mergeClaudeSettings } from './lib/settingsMerge.ts';
import { APP, CLAUDE_SETTINGS, CODEX_DIR, CODEX_HOOKS, LABEL, PLIST, REPO_ROOT, UID, backupSettings, stableNodePath, updateJsonFile } from './lib/system.ts';

const step = (msg: string) => console.log(`▶ ${msg}`);
/** Codex 훅 신뢰 위치 안내(2단계 Task 0 확인 결과로 채움) */
const CODEX_TRUST_HINT = 'CLI는 /hooks';

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function healthy(port: number): boolean {
  const r = spawnSync('curl', ['-s', '--max-time', '1', `http://127.0.0.1:${port}/healthz`], { encoding: 'utf8' });
  return r.stdout === 'ok';
}

const loaded = () => spawnSync('launchctl', ['print', `gui/${UID}/${LABEL}`], { stdio: 'ignore' }).status === 0;

/** 이미 등록돼 있으면 내리고(완전히 내려갈 때까지 기다림), 다시 올린다. 올리기는 3번까지 재시도 */
function reloadService(): void {
  if (loaded()) {
    spawnSync('launchctl', ['bootout', `gui/${UID}/${LABEL}`], { stdio: 'ignore' });
    for (let i = 0; i < 20 && loaded(); i++) sleep(250);
  }
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync('launchctl', ['bootstrap', `gui/${UID}`, PLIST], { encoding: 'utf8' });
    if (r.status === 0) return;
    if (attempt >= 3) throw new Error(`launchctl bootstrap 실패: ${r.stderr.trim()}`);
    sleep(1000);
  }
}

function main(): void {
  const home = soHome();
  const config = loadConfig(home);

  step('화면 빌드');
  execFileSync('npm', ['run', 'build:web'], { cwd: REPO_ROOT, stdio: 'inherit' });

  step(`훅 스크립트 복사 → ${path.join(home, 'bin')}`);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  for (const f of ['claude-hook.mjs', 'statusline.mjs']) {
    fs.copyFileSync(path.join(REPO_ROOT, 'hooks', f), path.join(bin, f));
    fs.chmodSync(path.join(bin, f), 0o755);
  }

  step('~/.claude/settings.json 확인');
  const node = stableNodePath(process.execPath);
  const cmd = {
    hook: `"${node}" "${path.join(bin, 'claude-hook.mjs')}"`,
    statusline: `"${node}" "${path.join(bin, 'statusline.mjs')}"`,
  };
  // 읽고 → 합치고 → 쓰기 직전에 그사이 바뀌었는지 확인. 바뀌었으면 새 내용으로 다시(최대 3번)
  const claude = updateJsonFile(CLAUDE_SETTINGS, (s) => {
    const r = mergeClaudeSettings(s, cmd);
    return { next: r.settings, changed: r.changed, conflict: r.conflict };
  }, () => backupSettings('설치전'));
  if (claude.kind === 'conflict') {
    console.error(`✖ ${claude.message}`);
    console.error('  settings.json은 바꾸지 않았어요. 기존 설정을 정리한 뒤 다시 설치하세요.');
    process.exit(1);
  }
  if (claude.kind === 'busy') {
    console.error('✖ settings.json이 계속 바뀌고 있어 설치를 멈췄어요. 잠시 뒤 다시 해 주세요.');
    process.exit(1);
  }
  if (claude.kind === 'written') {
    if (claude.backup) console.log(`  백업: ${claude.backup}`);
    console.log('  훅·상태줄 추가');
  } else {
    console.log('  이미 설치돼 있음');
  }

  // Codex: 실패해도 Claude 설치는 그대로 진행(경고만). config.toml은 건드리지 않는다
  step('~/.codex/hooks.json 확인 (Codex)');
  if (!fs.existsSync(CODEX_DIR)) {
    console.log('  Codex 없음 — 건너뜀');
  } else {
    // 명령 문자열은 고정 — Codex는 훅 신뢰를 이 내용의 해시에 묶는다
    const codexCmd = `"${node}" "${path.join(bin, 'claude-hook.mjs')}" codex`;
    const codex = updateJsonFile(CODEX_HOOKS, (f) => mergeCodexHooks(f, codexCmd), () => backupSettings('설치전', CODEX_HOOKS, 'codex-hooks'));
    if (codex.kind === 'written') {
      if (codex.backup) console.log(`  백업: ${codex.backup}`);
      console.log(`  Codex 훅 12개 추가 — Codex에서 새 훅을 검토·신뢰해 주세요(${CODEX_TRUST_HINT})`);
    } else if (codex.kind === 'unchanged') {
      console.log('  이미 설치돼 있음');
    } else {
      console.warn(`  ⚠ ${codex.kind === 'conflict' ? codex.message : 'hooks.json이 계속 바뀌고 있어요'} — Codex 훅은 건너뜀(Claude 쪽은 그대로 설치)`);
    }
  }

  step(`자동 켜기 등록 (${LABEL})`);
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, renderPlist({
    label: LABEL,
    nodePath: node,
    mainPath: path.join(REPO_ROOT, 'src', 'server', 'main.ts'),
    logPath: path.join(home, 'server.log'),
    soHome: home,
  }));
  reloadService();

  step('서버 확인');
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = healthy(config.port);
    if (!ok) sleep(500);
  }
  if (!ok) {
    console.error(`✖ 서버가 응답하지 않아요 — ${path.join(home, 'server.log')} 를 확인하세요`);
    process.exit(1);
  }
  console.log(`  켜짐: http://127.0.0.1:${config.port}`);

  step(`아이콘 앱 → ${APP}`);
  const script = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'launcher.applescript'), 'utf8').replaceAll('{{PORT}}', String(config.port));
  const tmpScript = path.join(home, 'launcher.applescript');
  fs.writeFileSync(tmpScript, script);
  fs.mkdirSync(path.dirname(APP), { recursive: true });
  fs.rmSync(APP, { recursive: true, force: true });
  execFileSync('osacompile', ['-o', APP, tmpScript]);
  const res = path.join(APP, 'Contents', 'Resources');
  fs.copyFileSync(path.join(REPO_ROOT, 'assets', 'icon.icns'), path.join(res, 'applet.icns'));
  fs.rmSync(path.join(res, 'Assets.car'), { force: true });
  spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :CFBundleIconName', path.join(APP, 'Contents', 'Info.plist')], { stdio: 'ignore' });
  execFileSync('codesign', ['--force', '--deep', '-s', '-', APP], { stdio: 'ignore' });
  spawnSync('touch', [APP]);

  console.log('\n✔ 설치 끝. 아이콘 "Synthetic Office"를 누르거나 브라우저에서 위 주소를 여세요.');
  console.log('  이미 열려 있던 Claude 세션은 훅을 다시 읽을 때부터 보여요.');
}

main();
