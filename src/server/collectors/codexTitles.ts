// Codex 앱이 대화마다 id·제목·수정 시각만 적어 두는 색인(~/.codex/session_index.jsonl)에서 제목을 읽는다.
// 대화 기록 파일·Codex 데이터베이스는 읽지 않는다. 공식 형식이 아니라서 못 읽으면 조용히 null(화면은 '세션 N').
import fs from 'node:fs';
import { clip } from './claudeHook.ts';

/** 색인은 줄이 붙기만 한다 — 큰 파일은 뒤쪽만 읽는다(최근 대화·이름 바꾸기가 뒤에 있음) */
const TAIL_BYTES = 2 * 1024 * 1024;

/** 같은 id는 뒤 줄이 이김(이름 바꾸기는 줄이 하나 더 붙음). 깨진 줄·빈 이름은 건너뜀 */
export function parseCodexIndex(text: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
      if (typeof j.id === 'string' && typeof j.thread_name === 'string' && j.thread_name.trim()) titles.set(j.id, clip(j.thread_name.trim(), 80));
    } catch {
      // 쓰는 중이거나 깨진 줄
    }
  }
  return titles;
}

function readTail(file: string, size: number): string {
  if (size <= TAIL_BYTES) return fs.readFileSync(file, 'utf8');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(TAIL_BYTES);
    fs.readSync(fd, buf, 0, TAIL_BYTES, size - TAIL_BYTES);
    const text = buf.toString('utf8');
    return text.slice(text.indexOf('\n') + 1); // 잘린 첫 줄은 버림
  } finally {
    fs.closeSync(fd);
  }
}

/** 파일이 바뀌었을 때(크기·수정 시각)만 다시 읽는 제목 찾기 */
export function makeCodexTitleReader(file: string): (sessionId: string) => string | null {
  let key = '';
  let titles = new Map<string, string>();
  return (sessionId) => {
    try {
      const st = fs.statSync(file);
      // FIFO·장치 파일(또는 그 바로가기)은 동기 읽기가 서버 전체를 멈출 수 있어 읽지 않는다
      if (!st.isFile()) throw new Error('정규 파일 아님');
      const next = `${st.size}:${st.mtimeMs}`;
      if (next !== key) {
        titles = parseCodexIndex(readTail(file, st.size));
        key = next;
      }
    } catch {
      key = '';
      titles = new Map();
    }
    return titles.get(sessionId) ?? null;
  };
}
