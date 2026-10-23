import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, formatReset, agentName } from '../../web/src/format.ts';
import { chooseView } from '../../web/src/view.ts';
import type { Agent } from '../../src/shared/types.ts';
import { M } from '../helpers.ts';

test('formatElapsed', () => {
  assert.equal(formatElapsed(30_000), '방금');
  assert.equal(formatElapsed(-5), '방금');
  assert.equal(formatElapsed(3 * M), '3분째');
  assert.equal(formatElapsed(59 * M + 59_000), '59분째');
  assert.equal(formatElapsed(6130_000), '1:42:10');
});

test('formatReset: 남은 시간 H:MM', () => {
  const now = 1_800_000_000_000;
  assert.equal(formatReset(now / 1000 + 3 * 3600 + 12 * 60 + 30, now), '3:12');
  assert.equal(formatReset(now / 1000 - 10, now), '0:00');
});

test('agentName: 제목이 없으면 세션 번호', () => {
  const a = { title: null, hat: 1 } as Agent;
  assert.equal(agentName(a), 'Claude · 세션 2');
  assert.equal(agentName({ ...a, title: '정류장 승하차 결합' }), '정류장 승하차 결합');
});

test('chooseView', () => {
  assert.equal(chooseView(1920, 1080, null), 'office');
  assert.equal(chooseView(900, 600, null), 'office');
  assert.equal(chooseView(899, 1080, null), 'list');
  assert.equal(chooseView(1920, 599, null), 'list');
  assert.equal(chooseView(320, 480, null), 'list');
  assert.equal(chooseView(1920, 1080, 'list'), 'list');
  assert.equal(chooseView(320, 480, 'office'), 'office');
  assert.equal(chooseView(320, 480, '이상한값'), 'list');
});
