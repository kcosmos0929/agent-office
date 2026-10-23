// 연결 상태 띠: 화면이 서버와 이어져 있고 훅 신호가 잘 오는지. 누르면 자세한 정보(비밀 없음). 글자는 textContent로만.
import type { Health } from '../../src/shared/types.ts';

export type StripTone = 'red' | 'orange' | 'gray' | 'green';

const REGISTRY_TEXT: Record<Health['registry'], string> = { ok: '읽힘', missing: '폴더 없음', error: '못 읽음' };

export function formatAgo(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

/** 우선순위: 끊김 > 훅 없음 > 아직 신호 없음 > 정상 */
export function stripState(connected: boolean, health: Health | null, now: number): { tone: StripTone; text: string } {
  if (!connected) return { tone: 'red', text: '🔴 끊김 — 다시 연결 중' };
  if (health && health.hookless > 0) return { tone: 'orange', text: '🟠 훅 신호가 안 와요 — 점검 필요' };
  if (!health || health.lastHookAt === null) return { tone: 'gray', text: '⚪ 연결됨 · 아직 신호 없음' };
  return { tone: 'green', text: `🟢 연결됨 · 신호 ${formatAgo(now - health.lastHookAt)}` };
}

export function stripDetails(health: Health | null, now: number): string[] {
  if (!health) return ['서버 정보를 아직 못 받았어요'];
  return [
    `서버 켜짐 · ${formatAgo(now - health.startedAt)}`,
    `세션 ${health.sessions}개 (훅 없음 ${health.hookless})`,
    `등록부: ${REGISTRY_TEXT[health.registry]}`,
    `마지막 훅 · ${health.lastHookAt === null ? '없음' : formatAgo(now - health.lastHookAt)}`,
    '자세한 점검: 터미널에서 npm run doctor',
  ];
}

/** <details>라서 누르면 펼쳐진다(스크립트 없음). open = 다시 그릴 때 펼친 상태 유지 */
export function renderStrip(doc: Document, connected: boolean, health: Health | null, now: number, open = false): HTMLElement {
  const { tone, text } = stripState(connected, health, now);
  const details = doc.createElement('details');
  details.className = `strip ${tone}`;
  if (open) details.setAttribute('open', '');
  const summary = doc.createElement('summary');
  const label = doc.createElement('span');
  label.className = 'strip-text';
  label.textContent = text;
  summary.appendChild(label);
  const panel = doc.createElement('div');
  panel.className = 'strip-panel';
  for (const line of stripDetails(health, now)) {
    const row = doc.createElement('div');
    row.textContent = line;
    panel.appendChild(row);
  }
  details.append(summary, panel);
  return details;
}
