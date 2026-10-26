// 머리 위 말풍선과 상세 카드에 쓰는 글자·색 (DOM만 다루고 three.js는 모름)
import { groupOf, KIND_COLOR, QUOTA_COLOR, STATUS_LABEL, WAIT_COLOR } from '../../../src/shared/labels.ts';
import type { Agent } from '../../../src/shared/types.ts';

/** 머리 위 말풍선: 상태만 짧게 (이웃 캐릭터를 덜 가리게) */
export function bubbleText(a: Pick<Agent, 'status'>): string {
  return STATUS_LABEL[a.status];
}

/** 발밑 이름표: 프로젝트 이름 */
export function nameplateText(a: Pick<Agent, 'project'>): string {
  return a.project;
}

export function bubbleTone(a: Pick<Agent, 'status'> & Partial<Pick<Agent, 'kind'>>): { bg: string; fg: string } {
  if (a.status === 'quota') return { bg: QUOTA_COLOR, fg: '#FFFFFF' };
  switch (groupOf(a.status)) {
    case 'urgent':
      return { bg: WAIT_COLOR, fg: '#3A2600' };
    case 'waiting':
      return { bg: '#2F9E5B', fg: '#FFFFFF' };
    case 'working':
      return a.status === 'stalled' ? { bg: '#B5ADA3', fg: '#FFFFFF' } : { bg: KIND_COLOR[a.kind ?? 'claude'], fg: '#FFFFFF' };
    default:
      return { bg: '#B5ADA3', fg: '#FFFFFF' };
  }
}

/** /Users/<이름>/… → ~/… */
export function shortCwd(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, '~');
}

/** 책상 묶음에서 말풍선이 겹치지 않게: 나를 기다리는 상태(승인·질문·끝남)만 글자, 일하는 중·쉬는 중은 아이콘만 */
export function bubbleCompact(a: Pick<Agent, 'status'>): boolean {
  const g = groupOf(a.status);
  return g === 'working' || g === 'rest';
}

/** 말풍선에 보일 글자: 아이콘만일 땐 상태 문구의 첫 덩어리(그림 문자) */
export function bubbleShown(a: Pick<Agent, 'status'>): string {
  const text = bubbleText(a);
  return bubbleCompact(a) ? text.split(' ')[0] : text;
}

/** 말풍선 DOM: 글자는 textContent로 */
export function makeBubble(doc: Document): { el: HTMLElement; set(a: Pick<Agent, 'status' | 'project'> & Partial<Pick<Agent, 'kind'>>): void } {
  const el = doc.createElement('div');
  el.className = 'bubble';
  let last = '';
  return {
    el,
    set(a) {
      const text = bubbleShown(a);
      const tone = bubbleTone(a);
      const key = text + tone.bg;
      if (key === last) return;
      last = key;
      el.textContent = text;
      el.classList.toggle('compact', bubbleCompact(a));
      el.style.background = tone.bg;
      el.style.color = tone.fg;
      el.classList.toggle('urgent', groupOf(a.status) === 'urgent');
    },
  };
}
