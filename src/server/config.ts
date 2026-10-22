import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PROJECT_NAMES } from './projects.ts';
import { homeFiles } from './paths.ts';

export type Config = {
  port: number;
  /** CnC Wiki vault 루트 */
  wikiPath: string;
  idleMinutes: number;
  goneMinutes: number;
  stalledMinutes: number;
  softSound: boolean;
  projectNames: Record<string, string>;
};

function defaults(): Config {
  return {
    port: 4310,
    wikiPath: path.join(os.homedir(), 'Documents', 'CnC Wiki'),
    idleMinutes: 30,
    goneMinutes: 10,
    stalledMinutes: 15,
    softSound: true,
    projectNames: { ...DEFAULT_PROJECT_NAMES },
  };
}

/** config.json을 읽어 기본값과 합친다. 없으면 기본값으로 만들고, 깨져 있으면 건드리지 않고 기본값을 쓴다 */
export function loadConfig(home: string): Config {
  const file = homeFiles(home).config;
  const base = defaults();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(base, null, 2) + '\n');
    return base;
  }
  try {
    const user = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Config>;
    return { ...base, ...user, projectNames: { ...base.projectNames, ...(user.projectNames ?? {}) } };
  } catch {
    console.warn('[synthetic-office] config.json을 읽지 못해 기본값을 씁니다');
    return base;
  }
}
