import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, STATUS_LABEL, HAT_COLORS, KIND_COLOR, WAIT_COLOR } from '../../src/shared/labels.ts';

test('상태 묶음', () => {
  assert.equal(groupOf('permission'), 'urgent');
  assert.equal(groupOf('done'), 'waiting');
  for (const s of ['thinking', 'reading', 'editing', 'running', 'delegating', 'stalled'] as const) {
    assert.equal(groupOf(s), 'working');
  }
  for (const s of ['idle', 'gone'] as const) assert.equal(groupOf(s), 'rest');
});

test('문구', () => {
  // 픽셀 글꼴이 ❗를 흑백 네모로 그려서, 그림 문자(VS16)로 고정
  assert.equal(STATUS_LABEL.permission, '❗\uFE0F 승인 필요');
  assert.equal(STATUS_LABEL.done, '✅ 끝남 · 내 차례');
  assert.equal(STATUS_LABEL.thinking, '💭 생각 중');
  assert.equal(STATUS_LABEL.reading, '📖 읽는 중');
  assert.equal(STATUS_LABEL.editing, '✏️ 고치는 중');
  assert.equal(STATUS_LABEL.running, '▶ 실행 중');
  assert.equal(STATUS_LABEL.delegating, '👥 도우미 투입');
  assert.equal(STATUS_LABEL.stalled, '… 응답 없음');
  assert.equal(STATUS_LABEL.idle, '😴 쉬는 중');
  assert.equal(STATUS_LABEL.gone, '👋 퇴근');
});

test('색', () => {
  assert.deepEqual(HAT_COLORS, ['#2F4B7C', '#C04A6B', '#3E7C4A', '#6B4E9B', '#B5651D', '#2C7A8C', '#8C2C3C', '#5C5C5C']);
  assert.equal(KIND_COLOR.claude, '#D97757');
  assert.equal(KIND_COLOR.codex, '#2F8F83');
  assert.equal(KIND_COLOR.aria, '#8B6CC9');
  assert.equal(WAIT_COLOR, '#F5A524');
});
