import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBubble, bubbleCompact, bubbleShown, bubbleText, bubbleTone } from '../../web/src/office/bubbles.ts';
import { KIND_COLOR, QUOTA_COLOR, WAIT_COLOR } from '../../src/shared/labels.ts';

test('bubbleTone: ❓ 주황, ⏳ 회보라, 🧹 일함 색', () => {
  assert.equal(bubbleTone({ status: 'question' }).bg, WAIT_COLOR);
  assert.equal(bubbleTone({ status: 'quota' }).bg, QUOTA_COLOR);
  assert.equal(bubbleTone({ status: 'compacting' }).bg, KIND_COLOR.claude);
});

test('말풍선: 나를 기다리는 상태만 글자, 일하는 중·쉬는 중은 아이콘만(책상 묶음에서 덜 겹치게)', () => {
  for (const status of ['permission', 'question', 'done'] as const) {
    assert.equal(bubbleCompact({ status }), false, status);
    assert.equal(bubbleShown({ status }), bubbleText({ status }));
  }
  for (const status of ['thinking', 'reading', 'editing', 'running', 'delegating', 'compacting', 'stalled', 'quota', 'idle', 'gone'] as const) {
    assert.equal(bubbleCompact({ status }), true, status);
    assert.equal(bubbleShown({ status }), bubbleText({ status }).split(' ')[0]);
  }
  assert.equal(bubbleShown({ status: 'reading' }), '📖');
});

test('bubbleTone: Codex가 일하면 청록, kind가 없으면 Claude색, 승인 대기는 종류 무관 주황', () => {
  assert.equal(bubbleTone({ status: 'running', kind: 'codex' }).bg, KIND_COLOR.codex);
  assert.equal(bubbleTone({ status: 'running' }).bg, KIND_COLOR.claude);
  assert.equal(bubbleTone({ status: 'permission', kind: 'codex' }).bg, WAIT_COLOR);
});

test('말풍선: 💭 생각 중일 때만 thinking 클래스(점 셋 애니메이션)', () => {
  const classes = new Set<string>();
  const el = {
    className: '', textContent: '', style: {} as Record<string, string>,
    classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) },
  };
  const b = makeBubble({ createElement: () => el } as unknown as Document);
  b.set({ status: 'thinking', project: 'p' });
  assert.ok(el.classList.contains('thinking'));
  b.set({ status: 'reading', project: 'p' });
  assert.ok(!el.classList.contains('thinking'));
});
