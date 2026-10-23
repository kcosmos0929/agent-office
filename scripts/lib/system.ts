// 설치기·제거기가 함께 쓰는 경로와 settings.json 읽고 쓰기.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const LABEL = 'com.synthetic-office.server';
export const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
export const BACKUP_DIR = path.join(os.homedir(), '.claude', '백업');
export const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
export const APP = path.join(os.homedir(), 'Applications', 'Synthetic Office.app');
export const UID = process.getuid?.() ?? 501;

/** Homebrew는 node를 버전 폴더(…/Cellar/node/26.3.0/bin/node)에 두므로, 업그레이드에도 안 깨지는 고정 링크(…/bin/node)가 있으면 그걸 쓴다 */
export function stableNodePath(execPath: string, exists: (p: string) => boolean = fs.existsSync): string {
  const m = /^(.*)\/Cellar\/node(?:@[^/]+)?\/[^/]+\/bin\/node$/.exec(execPath);
  if (!m) return execPath;
  const link = `${m[1]}/bin/node`;
  return exists(link) ? link : execPath;
}

/** settings.json 원문과 내용. 원문은 쓰기 직전에 '그사이 바뀌었는지' 비교하는 데 쓴다 */
export function readSettingsFile(file = CLAUDE_SETTINGS): { raw: string | null; settings: Record<string, unknown> } {
  const raw = currentRaw(file);
  return { raw, settings: raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>) };
}

function currentRaw(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 지금 파일을 ~/.claude/백업/settings-synthetic-office-<단계>-YYYY-MM-DD[-HHMMSS].json 으로 저장하고 경로를 돌려준다 */
export function backupSettings(stage: '설치전' | '제거전'): string | null {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let target = path.join(BACKUP_DIR, `settings-synthetic-office-${stage}-${day}.json`);
  if (fs.existsSync(target)) {
    const t = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    target = target.replace(/\.json$/, `-${t}.json`);
  }
  fs.copyFileSync(CLAUDE_SETTINGS, target);
  return target;
}

/**
 * 읽을 때의 원문(expectedRaw)과 지금 파일이 같을 때만 바꿔치기한다(그사이 Claude Code 등이 썼으면 아무것도 안 하고 false).
 * 바로가기(심볼릭 링크)면 링크는 두고 진짜 파일을 바꾼다. 임시 파일에 쓰고 JSON을 확인한 뒤 rename.
 */
export function writeSettingsIfUnchanged(settings: Record<string, unknown>, expectedRaw: string | null, file = CLAUDE_SETTINGS): boolean {
  let target = file;
  try {
    target = fs.realpathSync(file);
  } catch {
    // 아직 없는 파일
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.synthetic-office.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  if (currentRaw(target) !== expectedRaw) {
    fs.rmSync(tmp, { force: true });
    return false;
  }
  fs.renameSync(tmp, target);
  return true;
}
