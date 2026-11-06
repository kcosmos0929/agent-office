// 그림 묶음(art pack) 판정: 설정 charactersDir가 쓸 수 있는 묶음인지. 서버 시작 때 한 번, doctor도 같은 판정을 쓴다.
// 묶음 = 폴더 + pack.json {"format": 1}. 화면 쪽 규격(파일 목록)은 web/src/office/sprites/pack.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** pack.json의 format 값(web/src/office/sprites/pack.ts PACK_FORMAT과 같게) */
const PACK_FORMAT = 1;

export type PackStatus = { kind: 'none' } | { kind: 'ok'; dir: string } | { kind: 'invalid'; dir: string | null; reason: string };

export function resolvePack(charactersDir: unknown, homedir: string = os.homedir()): PackStatus {
  if (charactersDir === null || charactersDir === undefined) return { kind: 'none' };
  if (typeof charactersDir !== 'string' || charactersDir.trim() === '') return { kind: 'invalid', dir: null, reason: '경로가 문자열이 아니거나 비어 있어요' };
  const expanded = charactersDir === '~' ? homedir : charactersDir.startsWith('~/') ? path.join(homedir, charactersDir.slice(2)) : charactersDir;
  if (!path.isAbsolute(expanded)) return { kind: 'invalid', dir: null, reason: `절대 경로나 ~/로 적어 주세요: ${charactersDir}` };
  const dir = path.resolve(expanded);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { kind: 'invalid', dir, reason: `폴더가 없어요: ${dir}` };
  const metaFile = path.join(dir, 'pack.json');
  if (!fs.existsSync(metaFile)) return { kind: 'invalid', dir, reason: `pack.json이 없어요: ${dir}` };
  let meta: unknown;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch {
    return { kind: 'invalid', dir, reason: 'pack.json을 읽을 수 없어요(JSON 아님)' };
  }
  const format = (meta as { format?: unknown } | null)?.format;
  if (format !== PACK_FORMAT) return { kind: 'invalid', dir, reason: `pack.json format이 ${PACK_FORMAT}이 아니에요(${String(format)})` };
  return { kind: 'ok', dir };
}
