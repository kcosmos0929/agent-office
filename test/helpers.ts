import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

/** test/fixtures/hook-<name>.json 을 읽는다 */
export function fx(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `hook-${name}.json`), 'utf8'));
}

export const M = 60_000;
