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

export function homeFiles(home: string) {
  return {
    config: path.join(home, 'config.json'),
    token: path.join(home, 'token'),
    endpoint: path.join(home, 'endpoint.json'),
  };
}
