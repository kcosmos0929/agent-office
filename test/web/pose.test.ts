import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poseFor } from '../../web/src/office/pose.ts';
import { bubbleText, bubbleTone, shortCwd } from '../../web/src/office/bubbles.ts';
import type { Agent } from '../../src/shared/types.ts';

test('poseFor: 10개 상태 전부', () => {
  assert.equal(poseFor('permission'), 'wave');
  assert.equal(poseFor('done'), 'lean-back');
  assert.equal(poseFor('thinking'), 'think');
  assert.equal(poseFor('reading'), 'scroll');
  assert.equal(poseFor('editing'), 'type-fast');
  assert.equal(poseFor('running'), 'type-fast');
  assert.equal(poseFor('delegating'), 'think');
  assert.equal(poseFor('stalled'), 'stand');
  assert.equal(poseFor('idle'), 'sleep');
  assert.equal(poseFor('gone'), 'walk');
});

test('말풍선 글자와 색', () => {
  const a = { status: 'permission', project: '가로망 중심성' } as Agent;
  assert.equal(bubbleText(a), '❗ 승인 필요 · 가로망 중심성');
  assert.equal(bubbleTone(a).bg, '#F5A524');
  assert.equal(bubbleTone({ ...a, status: 'done' }).bg, '#2F9E5B');
  assert.equal(bubbleTone({ ...a, status: 'editing' }).bg, '#D97757');
  assert.equal(bubbleTone({ ...a, status: 'idle' }).bg, '#B5ADA3');
});

test('shortCwd: 홈 폴더를 ~로', () => {
  assert.equal(shortCwd('/Users/seop/developer/street-centrality-bus'), '~/developer/street-centrality-bus');
  assert.equal(shortCwd('/opt/x'), '/opt/x');
});
