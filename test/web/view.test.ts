import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialOverride } from '../../web/src/view.ts';

test('화면 고르기 기억: ?view= 가 우선, 없으면 저장값(올바른 값만), 아니면 null', () => {
  assert.equal(initialOverride('list', 'office'), 'list');
  assert.equal(initialOverride(null, 'office'), 'office');
  assert.equal(initialOverride(null, 'list'), 'list');
  assert.equal(initialOverride(null, 'x'), null);
  assert.equal(initialOverride(null, null), null);
});
