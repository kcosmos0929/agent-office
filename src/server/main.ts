// 서버 조립: 설정·토큰 → 프로젝트 이름표 → 상태 정리기 → HTTP/WebSocket → endpoint.json → 타이머.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { startServer } from './http.ts';
import { homeFiles, soHome } from './paths.ts';
import { loadProjects, makeResolver } from './projects.ts';
import { OfficeState } from './state.ts';
import { loadOrCreateToken } from './token.ts';

const TICK_MS = 5_000;
const MINUTE = 60_000;
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

async function main(): Promise<void> {
  const home = soHome();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const config = loadConfig(home);
  const token = loadOrCreateToken(home);

  let resolver = makeResolver(await loadProjects(config.wikiPath), config.projectNames, config.wikiPath);
  const state = new OfficeState({
    idleMs: config.idleMinutes * MINUTE,
    goneMs: config.goneMinutes * MINUTE,
    stalledMs: config.stalledMinutes * MINUTE,
    resolveProject: (cwd) => resolver(cwd),
  });

  // 허브 문서가 바뀌면 이름표를 다시 읽는다 (위키는 읽기만)
  const hubDir = path.join(config.wikiPath, 'AI-Sessions', 'wiki', 'projects');
  let reload: NodeJS.Timeout | null = null;
  try {
    fs.watch(hubDir, { recursive: true }, () => {
      if (reload) clearTimeout(reload);
      reload = setTimeout(async () => {
        resolver = makeResolver(await loadProjects(config.wikiPath), config.projectNames, config.wikiPath);
      }, 1_000);
    });
  } catch {
    console.warn('[synthetic-office] 허브 폴더를 지켜볼 수 없어요 — 이름표는 시작할 때 값으로 고정');
  }

  const server = await startServer({ config, token, state, staticDir: path.join(REPO_ROOT, 'dist', 'web') });
  const endpoint = homeFiles(home).endpoint;
  fs.writeFileSync(endpoint, JSON.stringify({ port: server.port, token, pid: process.pid }) + '\n', { mode: 0o600 });
  fs.chmodSync(endpoint, 0o600);
  console.log(`[synthetic-office] 켜짐 — http://127.0.0.1:${server.port}`);

  const ticker = setInterval(() => {
    if (state.tick(Date.now())) server.notify();
  }, TICK_MS);

  const shutdown = async () => {
    clearInterval(ticker);
    try {
      fs.unlinkSync(endpoint);
    } catch {
      // 이미 없음
    }
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('[synthetic-office] 시작 실패:', err instanceof Error ? err.message : err);
  process.exit(1);
});
