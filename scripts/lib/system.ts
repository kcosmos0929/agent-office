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

export function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return {};
  return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')) as Record<string, unknown>;
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

/** 임시 파일에 쓴 뒤 바꿔치기, 다시 읽어서 JSON이 맞는지 확인 */
export function writeSettings(settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  const tmp = CLAUDE_SETTINGS + '.synthetic-office.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, CLAUDE_SETTINGS);
}
