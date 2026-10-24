// 제거: settings.json·Codex hooks.json에서 우리 것만 빼고(백업 후), 자동 켜기와 아이콘 앱을 지운다. ~/.synthetic-office(설정·토큰)는 남긴다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { removeCodexHooks } from './lib/codexHooksMerge.ts';
import { removeClaudeSettings } from './lib/settingsMerge.ts';
import { APP, CLAUDE_SETTINGS, CODEX_HOOKS, LABEL, PLIST, UID, backupSettings, updateJsonFile } from './lib/system.ts';

// 읽고 → 우리 것만 빼고 → 쓰기 직전에 그사이 바뀌었는지 확인(최대 3번)
const claude = updateJsonFile(CLAUDE_SETTINGS, (s) => {
  const r = removeClaudeSettings(s);
  return { next: r.settings, changed: r.changed, conflict: null };
}, () => backupSettings('제거전'));
if (claude.kind === 'busy' || claude.kind === 'conflict') {
  console.error('✖ settings.json이 계속 바뀌고 있거나 읽을 수 없어 멈췄어요. 잠시 뒤 다시 해 주세요(자동 켜기·아이콘 앱도 그대로 둠).');
  process.exit(1);
}
if (claude.kind === 'written') {
  if (claude.backup) console.log(`백업: ${claude.backup}`);
  console.log('settings.json에서 Synthetic Office 훅·상태줄을 뺐어요');
}

// Codex: 우리 훅만 빼고, 남는 게 없으면 우리가 만든 hooks.json을 지운다. 실패해도 나머지 제거는 계속(경고만)
if (fs.existsSync(CODEX_HOOKS)) {
  const codex = updateJsonFile(CODEX_HOOKS, (f) => {
    const r = removeCodexHooks(f);
    return { next: r.next, changed: r.changed, conflict: null, remove: r.empty };
  }, () => backupSettings('제거전', CODEX_HOOKS, 'codex-hooks'));
  if (codex.kind === 'written' || codex.kind === 'removed') {
    if (codex.backup) console.log(`백업: ${codex.backup}`);
    console.log(codex.kind === 'removed' ? 'Codex hooks.json을 지웠어요(우리 훅만 있었음)' : 'Codex hooks.json에서 Synthetic Office 훅을 뺐어요');
  } else if (codex.kind !== 'unchanged') {
    console.warn(`⚠ Codex hooks.json을 정리하지 못했어요(${codex.kind === 'conflict' ? codex.message : '계속 바뀜'}) — 직접 확인해 주세요`);
  }
}

spawnSync('launchctl', ['bootout', `gui/${UID}/${LABEL}`], { stdio: 'ignore' });
fs.rmSync(PLIST, { force: true });
fs.rmSync(APP, { recursive: true, force: true });
console.log('자동 켜기와 아이콘 앱을 지웠어요. 설정·토큰(~/.synthetic-office)은 남겨 두었어요.');
