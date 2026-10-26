import os from 'node:os';
import path from 'node:path';

/** 데이터 폴더. 테스트·설치기에선 SO_HOME으로 바꾼다 */
export function soHome(): string {
  return process.env.SO_HOME ?? path.join(os.homedir(), '.synthetic-office');
}

/** Claude 앱이 세션마다 <pid>.json을 쓰는 폴더(읽기만). 테스트·데모에선 SO_CLAUDE_SESSIONS로 바꾼다 */
export function claudeSessionsDir(): string {
  return process.env.SO_CLAUDE_SESSIONS ?? path.join(os.homedir(), '.claude', 'sessions');
}

/** Codex 앱의 대화 색인(id·제목·수정 시각, 읽기만). 테스트·데모에선 SO_CODEX_INDEX로 바꾼다 */
export function codexSessionIndex(): string {
  return process.env.SO_CODEX_INDEX ?? path.join(os.homedir(), '.codex', 'session_index.jsonl');
}

export function homeFiles(home: string) {
  return {
    config: path.join(home, 'config.json'),
    token: path.join(home, 'token'),
    endpoint: path.join(home, 'endpoint.json'),
  };
}
