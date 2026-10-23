// 제거: settings.json에서 우리 훅·상태줄만 빼고(백업 후), 자동 켜기와 아이콘 앱을 지운다. ~/.synthetic-office(설정·토큰)는 남긴다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { removeClaudeSettings } from './lib/settingsMerge.ts';
import { APP, LABEL, PLIST, UID, backupSettings, readSettingsFile, writeSettingsIfUnchanged } from './lib/system.ts';

// 읽고 → 우리 것만 빼고 → 쓰기 직전에 그사이 바뀌었는지 확인(최대 3번)
let settled = false;
for (let attempt = 1; attempt <= 3 && !settled; attempt++) {
  const { raw, settings } = readSettingsFile();
  const removed = removeClaudeSettings(settings);
  if (!removed.changed) {
    settled = true;
    break;
  }
  const backup = backupSettings('제거전');
  if (backup) console.log(`백업: ${backup}`);
  settled = writeSettingsIfUnchanged(removed.settings, raw);
  if (settled) console.log('settings.json에서 Synthetic Office 훅·상태줄을 뺐어요');
}
if (!settled) {
  console.error('✖ settings.json이 계속 바뀌고 있어 멈췄어요. 잠시 뒤 다시 해 주세요(자동 켜기·아이콘 앱도 그대로 둠).');
  process.exit(1);
}
spawnSync('launchctl', ['bootout', `gui/${UID}/${LABEL}`], { stdio: 'ignore' });
fs.rmSync(PLIST, { force: true });
fs.rmSync(APP, { recursive: true, force: true });
console.log('자동 켜기와 아이콘 앱을 지웠어요. 설정·토큰(~/.synthetic-office)은 남겨 두었어요.');
