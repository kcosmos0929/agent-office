import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleCompact, bubbleShown, bubbleText, bubbleTone } from '../../web/src/office/bubbles.ts';
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
