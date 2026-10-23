import crypto from 'node:crypto';
import fs from 'node:fs';
import { homeFiles } from './paths.ts';

/** 32바이트 hex 토큰. 파일 권한 0600 */
export function loadOrCreateToken(home: string): string {
  const file = homeFiles(home).token;
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    // 없으면 만든다
  }
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return token;
}

export function tokenMatches(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
