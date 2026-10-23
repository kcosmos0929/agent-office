import type { Group, Status } from './types.ts';

export const STATUS_LABEL: Record<Status, string> = {
  permission: '❗\uFE0F 승인 필요', // \uFE0F: 그림 문자로 고정(픽셀 글꼴의 흑백 ❗ 대신)
  question: '❓\uFE0F 질문 대기',
  done: '✅ 끝남 · 내 차례',
  thinking: '💭 생각 중',
  reading: '📖 읽는 중',
  editing: '✏️ 고치는 중',
  running: '▶ 실행 중',
  delegating: '👥 도우미 투입',
  compacting: '🧹 대화 정리 중',
  stalled: '… 응답 없음',
  quota: '⏳\uFE0F 토큰 기다림',
  idle: '😴 쉬는 중',
  gone: '👋 퇴근',
};

const GROUP: Record<Status, Group> = {
  permission: 'urgent',
  question: 'urgent',
  done: 'waiting',
  thinking: 'working',
  reading: 'working',
  editing: 'working',
  running: 'working',
  delegating: 'working',
  compacting: 'working',
  stalled: 'working',
  quota: 'rest',
  idle: 'rest',
  gone: 'rest',
};

export function groupOf(s: Status): Group {
  return GROUP[s];
}

/** 세션 구분용 모자 색 (인덱스 0~7) */
export const HAT_COLORS: string[] = ['#2F4B7C', '#C04A6B', '#3E7C4A', '#6B4E9B', '#B5651D', '#2C7A8C', '#8C2C3C', '#5C5C5C'];

export const KIND_COLOR = { claude: '#D97757', codex: '#2F8F83', aria: '#8B6CC9' } as const;

export const WAIT_COLOR = '#F5A524';

/** 사용량 한도가 풀리길 기다림(⏳) — 쉼 묶음이지만 일반 쉼과 구분되는 회보라 */
export const QUOTA_COLOR = '#8E86A8';
