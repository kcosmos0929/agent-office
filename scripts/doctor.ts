// npm run doctor — 설치·연결 점검(읽기만). ✗가 하나라도 있으면 종료 코드 1.
import { spawnSync } from 'node:child_process';
import { pidAlive } from '../src/server/collectors/sessionRegistry.ts';
import { peekConfig } from '../src/server/config.ts';
import { claudeSessionsDir, soHome } from '../src/server/paths.ts';
import { exitCode, formatReport, runChecks } from './lib/doctorChecks.ts';
import { CLAUDE_SETTINGS, LABEL, REPO_ROOT, UID } from './lib/system.ts';

async function get(url: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

const home = soHome();
const checks = await runChecks({
  home,
  settingsFile: CLAUDE_SETTINGS,
  repoRoot: REPO_ROOT,
  registryDir: claudeSessionsDir(),
  wikiPath: peekConfig(home).wikiPath,
  isAlive: pidAlive,
  launchdRunning: () => {
    const r = spawnSync('launchctl', ['print', `gui/${UID}/${LABEL}`], { encoding: 'utf8' });
    return r.status === 0 && /state = running/.test(r.stdout);
  },
  getText: async (url) => (await get(url))?.text() ?? null,
  getJson: async (url) => {
    const r = await get(url);
    return r ? r.json().catch(() => null) : null;
  },
});
console.log(formatReport(checks));
process.exitCode = exitCode(checks);
