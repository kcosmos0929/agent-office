import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PROJECT_NAMES } from './projects.ts';
import { homeFiles } from './paths.ts';

export type Config = {
  port: number;
  /** CnC Wiki vault 루트 */
  wikiPath: string;
  /** ✅ 끝남 뒤 이만큼 지나면 😴 */
  restMinutes: number;
  /** 차례가 끝난 뒤 이만큼 지나면 👋 자동 퇴근(그 10분 뒤 화면에서 숨김) */
  leaveMinutes: number;
  goneMinutes: number;
  stalledMinutes: number;
  /** 이 시간 동안 신호가 없는 세션은 목록에서 정리 */
  forgetHours: number;
  softSound: boolean;
  /** Codex 앱에서 자동 승인(AutoReview)을 쓰나 — 켜져 있으면 Codex 승인 요청을 무시하고 하던 일을 보여 줌(설정 창 스위치) */
  codexAutoApprove: boolean;
  /** 밖에서 보기 주소(폰 주소창 그대로, 포트 포함 — 예: "1-2-3-4.sslip.io:8443"). null이면 터널 전용 문을 열지 않음 */
  remotePublicHost: string | null;
  /** 터널 전용 문이 듣는 맥 안 포트(127.0.0.1만) */
  remotePort: number;
  projectNames: Record<string, string>;
};

function defaults(): Config {
  return {
    port: 4310,
    wikiPath: path.join(os.homedir(), 'Documents', 'CnC Wiki'),
    restMinutes: 10,
    leaveMinutes: 120,
    goneMinutes: 10,
    stalledMinutes: 15,
    forgetHours: 12,
    softSound: true,
    codexAutoApprove: true,
    remotePublicHost: null,
    remotePort: 4311,
    projectNames: { ...DEFAULT_PROJECT_NAMES },
  };
}

/** config.json을 읽어 기본값과 합친다. 없으면 기본값으로 만들고, 깨져 있으면 건드리지 않고 기본값을 쓴다 */
export function loadConfig(home: string): Config {
  const file = homeFiles(home).config;
  if (!fs.existsSync(file)) {
    const base = defaults();
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(base, null, 2) + '\n');
    return base;
  }
  return peekConfig(home);
}

/** loadConfig와 같은 값을 읽기만 한다(파일을 만들지 않음 — npm run doctor용) */
export function peekConfig(home: string): Config {
  const file = homeFiles(home).config;
  const base = defaults();
  if (!fs.existsSync(file)) return base;
  try {
    const user = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Config>;
    return { ...base, ...user, projectNames: { ...base.projectNames, ...(user.projectNames ?? {}) } };
  } catch {
    console.warn('[synthetic-office] config.json을 읽지 못해 기본값을 씁니다');
    return base;
  }
}

/** config.json에서 patch의 키만 바꿔 저장한다(다른 값은 그대로). 저장했으면 true, 파일이 깨져 있어 건드리지 않았으면 false. 쓰기 오류는 던진다 */
export function saveConfigPatch(home: string, patch: Partial<Config>): boolean {
  const file = homeFiles(home).config;
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[synthetic-office] config.json을 읽지 못해 설정을 저장하지 않았어요');
      return false;
    }
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...current, ...patch }, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return true;
}
