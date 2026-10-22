// 설치: 화면 빌드 → 훅 스크립트 복사 → settings.json 백업·병합 → launchd 등록 → 서버 확인 → 아이콘 앱.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/server/config.ts';
import { soHome } from '../src/server/paths.ts';
import { renderPlist } from './lib/plist.ts';
import { mergeClaudeSettings } from './lib/settingsMerge.ts';
import { APP, LABEL, PLIST, REPO_ROOT, UID, backupSettings, readSettings, writeSettings } from './lib/system.ts';

const step = (msg: string) => console.log(`▶ ${msg}`);

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function healthy(port: number): boolean {
  const r = spawnSync('curl', ['-s', '--max-time', '1', `http://127.0.0.1:${port}/healthz`], { encoding: 'utf8' });
  return r.stdout === 'ok';
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
  const before = readSettings();
  const node = process.execPath;
  const merged = mergeClaudeSettings(before, {
    hook: `"${node}" "${path.join(bin, 'claude-hook.mjs')}"`,
    statusline: `"${node}" "${path.join(bin, 'statusline.mjs')}"`,
  });
  if (merged.conflict) {
    console.error(`✖ ${merged.conflict}`);
    console.error('  settings.json은 바꾸지 않았어요. 기존 설정을 정리한 뒤 다시 설치하세요.');
    process.exit(1);
  }
  if (merged.changed) {
    const backup = backupSettings('설치전');
    if (backup) console.log(`  백업: ${backup}`);
    writeSettings(merged.settings);
    console.log('  훅·상태줄 추가');
  } else {
    console.log('  이미 설치돼 있음');
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
  spawnSync('launchctl', ['bootout', `gui/${UID}/${LABEL}`], { stdio: 'ignore' });
  execFileSync('launchctl', ['bootstrap', `gui/${UID}`, PLIST]);

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
