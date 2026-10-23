// 대화 기록 파일(JSONL)에서 세션 제목 줄("custom-title")만 읽는다. 다른 줄(대화 본문)은 파싱하지 않는다.
import fs from 'node:fs';
import readline from 'node:readline';

const TAIL_BYTES = 256 * 1024;
const MARKER = '"type":"custom-title"';

function titleFrom(line: string): string | null {
  if (!line.includes(MARKER)) return null;
  try {
    const j = JSON.parse(line) as { type?: unknown; customTitle?: unknown };
    return j.type === 'custom-title' && typeof j.customTitle === 'string' && j.customTitle ? j.customTitle : null;
  } catch {
    return null;
  }
}

function lastTitle(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = titleFrom(lines[i]);
    if (t) return t;
  }
  return null;
}

export async function readTranscriptTitle(path: string): Promise<string | null> {
  let size: number;
  try {
    size = (await fs.promises.stat(path)).size;
  } catch {
    return null;
  }
  const start = Math.max(0, size - TAIL_BYTES);
  const handle = await fs.promises.open(path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // 잘린 첫 줄
    const found = lastTitle(lines);
    if (found || start === 0) return found;
  } finally {
    await handle.close();
  }
  // 끝부분에 없으면 처음부터 줄 단위로 훑는다
  let last: string | null = null;
  const rl = readline.createInterface({ input: fs.createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = titleFrom(line);
    if (t) last = t;
  }
  return last;
}
