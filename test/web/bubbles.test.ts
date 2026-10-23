import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleTone } from '../../web/src/office/bubbles.ts';
import { KIND_COLOR, QUOTA_COLOR, WAIT_COLOR } from '../../src/shared/labels.ts';

test('bubbleTone: ❓ 주황, ⏳ 회보라, 🧹 일함 색', () => {
  assert.equal(bubbleTone({ status: 'question' }).bg, WAIT_COLOR);
  assert.equal(bubbleTone({ status: 'quota' }).bg, QUOTA_COLOR);
  assert.equal(bubbleTone({ status: 'compacting' }).bg, KIND_COLOR.claude);
});
