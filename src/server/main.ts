// 서버 조립: 설정·토큰 → 프로젝트 이름표 → 상태 정리기 → HTTP/WebSocket → endpoint.json → 타이머.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { startServer } from './http.ts';
import { makeCodexTitleReader } from './collectors/codexTitles.ts';
import { watchRegistry } from './collectors/sessionRegistry.ts';
import { claudeSessionsDir, codexSessionIndex, homeFiles, soHome } from './paths.ts';
import { loadProjects, makeResolver } from './projects.ts';
import { OfficeState } from './state.ts';
import { loadOrCreateToken } from './token.ts';

/** Codex '승인 확인 중' → ❗(5초)가 1초 안에 바뀌도록 촘촘히 */
const TICK_MS = 1_000;
const MINUTE = 60_000;
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
/**
 * 등록부 waiting을 '사용자 입력 기다림'으로 믿고 R2(연달아 대기)·늦은 알림 무시를 켤지.
 * 2026-10-23 실제 확인: 세션 2개·승인/거절/질문 7번 모두 waiting은 승인·질문 창이 떠 있을 때만 나타남 → 켬.
 */
const REGISTRY_WAIT_RULE = true;

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
    forgetMs: config.forgetHours * 60 * MINUTE,
    resolveProject: (cwd) => resolver(cwd),
    startedAt: Date.now(),
    registryWaitRule: REGISTRY_WAIT_RULE,
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

  const server = await startServer({ config, token, state, staticDir: path.join(REPO_ROOT, 'dist', 'web'), codexTitle: makeCodexTitleReader(codexSessionIndex()) });
  const endpoint = homeFiles(home).endpoint;
  fs.writeFileSync(endpoint, JSON.stringify({ port: server.port, token, pid: process.pid }) + '\n', { mode: 0o600 });
  fs.chmodSync(endpoint, 0o600);
  console.log(`[synthetic-office] 켜짐 — http://127.0.0.1:${server.port}`);

  const ticker = setInterval(() => {
    if (state.tick(Date.now())) server.notify();
  }, TICK_MS);

  // Claude 앱 세션 목록(읽기만): 승인 순간·훅 없는 세션·퇴근을 잡는다
  const stopRegistry = watchRegistry(claudeSessionsDir(), (r) => {
    if (state.applyRegistry(r, Date.now())) server.notify();
  });

  const shutdown = async () => {
    clearInterval(ticker);
    stopRegistry();
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
