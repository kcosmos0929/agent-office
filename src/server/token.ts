import crypto from 'node:crypto';
import fs from 'node:fs';
import { homeFiles } from './paths.ts';

/** 32바이트 hex 토큰. 파일 권한 0600 */
function loadOrCreate(home: string, file: string): string {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    // 없으면 만든다
  }
  return write(home, file);
}

function write(home: string, file: string): string {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return token;
}

/** 훅·관리용 토큰(endpoint.json으로 훅 스크립트에 전달) */
export function loadOrCreateToken(home: string): string {
  return loadOrCreate(home, homeFiles(home).token);
}

/** 밖에서 보기(터널 전용 문)용 토큰 — 훅 토큰과 따로라 새도 보기만 된다 */
export function loadOrCreateViewerToken(home: string): string {
  return loadOrCreate(home, homeFiles(home).viewerToken);
}

/** 보기 토큰을 새로 만들어 저장한다(옛 토큰은 그 순간부터 안 통함) */
export function rotateViewerToken(home: string): string {
  return write(home, homeFiles(home).viewerToken);
}

export function tokenMatches(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
