// 트랜스크립트(JSONL) 끝부분에서 마지막 답의 토큰 수와 모델 이름만 꺼낸다. 대화 내용은 저장하거나 보내지 않는다.
import fs from 'node:fs';

export type ContextReading = { state: 'ok'; used: number; model: string } | { state: 'compacted' } | null;

/** 끝 256KB에서 못 찾으면 1MB까지만 늘린다(수백 MB 파일도 끝부분만) */
const TAILS = [256 * 1024, 1024 * 1024];
const USAGE_KEYS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'] as const;

function parse(line: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(line) as unknown;
    return j !== null && typeof j === 'object' ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 뒤에서부터: 정리 경계를 먼저 만나면 compacted, 메인 대화의 실제 답을 먼저 만나면 그 사용량 */
export function parseContextLines(lines: string[]): ContextReading {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('"compact_boundary"')) {
      const j = parse(line);
      if (j?.type === 'system' && j.subtype === 'compact_boundary') return { state: 'compacted' };
    }
    if (!line.includes('"assistant"')) continue;
    const j = parse(line);
    if (j?.type !== 'assistant' || j.isSidechain === true) continue;
    const m = j.message as { model?: unknown; usage?: Record<string, unknown> } | undefined;
    if (!m?.usage || m.model === '<synthetic>') continue;
    const used = USAGE_KEYS.reduce((sum, k) => sum + (typeof m.usage![k] === 'number' ? (m.usage![k] as number) : 0), 0);
    if (used <= 0) continue;
    return { state: 'ok', used, model: typeof m.model === 'string' ? m.model : 'unknown' };
  }
  return null;
}

export async function readContext(file: string): Promise<ContextReading> {
  let size: number;
  try {
    size = (await fs.promises.stat(file)).size;
  } catch {
    return null;
  }
  const handle = await fs.promises.open(file, 'r');
  try {
    for (const tail of TAILS) {
      const start = Math.max(0, size - tail);
      const buf = Buffer.alloc(size - start);
      await handle.read(buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n');
      if (start > 0) lines.shift(); // 잘린 첫 줄
      const found = parseContextLines(lines);
      if (found !== null || start === 0) return found;
    }
    return null;
  } finally {
    await handle.close();
  }
}
