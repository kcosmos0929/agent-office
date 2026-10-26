// 화면 빌드 지문: 서버가 켜질 때 index.html의 해시를 한 번 읽어 둔다.
// 빌드마다 번들 파일 이름이 index.html에 박히므로, 이 값이 달라졌으면 새 빌드다.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** index.html의 sha256 앞 12자. 파일이 없으면(화면을 아직 안 만듦) null */
export function buildId(staticDir: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(path.join(staticDir, 'index.html'))).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}
