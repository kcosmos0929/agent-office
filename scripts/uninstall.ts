// 제거: settings.json에서 우리 훅·상태줄만 빼고(백업 후), 자동 켜기와 아이콘 앱을 지운다. ~/.synthetic-office(설정·토큰)는 남긴다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { removeClaudeSettings } from './lib/settingsMerge.ts';
import { APP, LABEL, PLIST, UID, backupSettings, readSettings, writeSettings } from './lib/system.ts';

const removed = removeClaudeSettings(readSettings());
if (removed.changed) {
  const backup = backupSettings('제거전');
  if (backup) console.log(`백업: ${backup}`);
  writeSettings(removed.settings);
  console.log('settings.json에서 Synthetic Office 훅·상태줄을 뺐어요');
}
spawnSync('launchctl', ['bootout', `gui/${UID}/${LABEL}`], { stdio: 'ignore' });
fs.rmSync(PLIST, { force: true });
fs.rmSync(APP, { recursive: true, force: true });
console.log('자동 켜기와 아이콘 앱을 지웠어요. 설정·토큰(~/.synthetic-office)은 남겨 두었어요.');
