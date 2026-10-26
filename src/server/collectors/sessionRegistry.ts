// Claude 앱의 세션 목록 파일(~/.claude/sessions/<pid>.json) 읽기. 필드 7개만 보고(그중 6개만 남김), 파일은 절대 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import type { RegistryHealth } from '../../shared/types.ts';
import { clip } from './claudeHook.ts';

export type RegistryStatus = 'busy' | 'waiting' | 'idle';
/** startedAt = 그 세션 프로세스가 시작된 시각(열기만 한 세션 가리기용, 없을 수 있음) */
export type RegistryEntry = { sessionId: string; pid: number; cwd: string; name: string | null; status: RegistryStatus; statusUpdatedAt: number; startedAt?: number };
export type RegistryRead = { health: RegistryHealth; entries: RegistryEntry[] };

const STATUSES = new Set<string>(['busy', 'waiting', 'idle']);
const DEBOUNCE_MS = 100;

/** 대화형 세션 파일 하나 → 필요한 7개 필드. 형식이 다르면 null */
export function parseRegistryFile(text: string): RegistryEntry | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (d === null || typeof d !== 'object' || d.kind !== 'interactive') return null;
  const { sessionId, pid, status, statusUpdatedAt, cwd, name, startedAt } = d;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;
  if (typeof statusUpdatedAt !== 'number' || !Number.isFinite(statusUpdatedAt)) return null;
  return {
    sessionId,
    pid,
    cwd: typeof cwd === 'string' ? cwd : '',
    name: typeof name === 'string' && name ? clip(name, 80) : null,
    status: status as RegistryStatus,
    statusUpdatedAt,
    ...(typeof startedAt === 'number' && Number.isFinite(startedAt) ? { startedAt } : {}),
  };
}

/** 프로세스가 살아 있나 (권한 없음 EPERM도 살아 있는 것) */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 폴더 전체를 한 번 읽는다. 깨진 파일(쓰는 중)·죽은 pid는 빼고, 폴더 자체를 못 읽을 때만 missing/error */
export async function readRegistry(dir: string, isAlive: (pid: number) => boolean = pidAlive): Promise<RegistryRead> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    return { health: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error', entries: [] };
  }
  const entries: RegistryEntry[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const text = await fs.promises.readFile(path.join(dir, name), 'utf8').catch(() => null);
    const entry = text === null ? null : parseRegistryFile(text);
    if (entry && isAlive(entry.pid)) entries.push(entry);
  }
  return { health: 'ok', entries };
}

/** 바로 한 번, 그 뒤 intervalMs마다, 폴더가 바뀌면 조금 모아서 읽는다. 읽기는 겹치지 않는다 */
export function watchRegistry(
  dir: string,
  onRead: (r: RegistryRead) => void,
  opts: { intervalMs?: number; isAlive?: (pid: number) => boolean } = {},
): () => void {
  let stopped = false;
  let running = false;
  let again = false;
  let debounce: NodeJS.Timeout | null = null;
  const run = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const r = await readRegistry(dir, opts.isAlive);
      if (!stopped) onRead(r);
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      void run();
    }
  };
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(dir, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void run(), DEBOUNCE_MS);
    });
    watcher.on('error', () => watcher?.close()); // 감시가 끊겨도 주기 읽기가 대신한다
  } catch {
    // 폴더가 아직 없음 → 주기 읽기만
  }
  const timer = setInterval(() => void run(), opts.intervalMs ?? 2000);
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    watcher?.close();
  };
}
