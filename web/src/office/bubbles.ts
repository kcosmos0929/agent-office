// 머리 위 말풍선과 상세 카드에 쓰는 글자·색 (DOM만 다루고 three.js는 모름)
import { groupOf, KIND_COLOR, STATUS_LABEL, WAIT_COLOR } from '../../../src/shared/labels.ts';
import type { Agent } from '../../../src/shared/types.ts';

export function bubbleText(a: Pick<Agent, 'status' | 'project'>): string {
  return `${STATUS_LABEL[a.status]} · ${a.project}`;
}

export function bubbleTone(a: Pick<Agent, 'status'>): { bg: string; fg: string } {
  switch (groupOf(a.status)) {
    case 'urgent':
      return { bg: WAIT_COLOR, fg: '#3A2600' };
    case 'waiting':
      return { bg: '#2F9E5B', fg: '#FFFFFF' };
    case 'working':
      return a.status === 'stalled' ? { bg: '#B5ADA3', fg: '#FFFFFF' } : { bg: KIND_COLOR.claude, fg: '#FFFFFF' };
    default:
      return { bg: '#B5ADA3', fg: '#FFFFFF' };
  }
}

/** /Users/<이름>/… → ~/… */
export function shortCwd(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, '~');
}

/** 말풍선 DOM: 글자는 textContent로 */
export function makeBubble(doc: Document): { el: HTMLElement; set(a: Pick<Agent, 'status' | 'project'>): void } {
  const el = doc.createElement('div');
  el.className = 'bubble';
  let last = '';
  return {
    el,
    set(a) {
      const text = bubbleText(a);
      const tone = bubbleTone(a);
      const key = text + tone.bg;
      if (key === last) return;
      last = key;
      el.textContent = text;
      el.style.background = tone.bg;
      el.style.color = tone.fg;
      el.classList.toggle('urgent', a.status === 'permission');
    },
  };
}
