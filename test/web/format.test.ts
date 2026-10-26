import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, formatReset, agentName, agentModel } from '../../web/src/format.ts';
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
  const a = { title: null, hat: 1, kind: 'claude' } as Agent;
  assert.equal(agentName(a), 'Claude · 세션 2');
  assert.equal(agentName({ ...a, title: '정류장 승하차 결합' }), 'Claude · 정류장 승하차 결합');
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

test('agentName: 종류별 이름', () => {
  assert.equal(agentName({ title: null, hat: 2, kind: 'codex' }), 'Codex · 세션 3');
  assert.equal(agentName({ title: null, hat: 0, kind: 'claude' }), 'Claude · 세션 1');
  assert.equal(agentName({ title: '제목', hat: 0, kind: 'codex' }), 'Codex · 제목');
});

test('agentModel: 훅이 준 모델 우선, 없으면 대화 게이지의 모델, 둘 다 없으면 null — Claude id는 짧은 이름', () => {
  const base = { model: null, context: null } as Pick<Agent, 'model' | 'context'>;
  assert.equal(agentModel({ ...base, model: 'gpt-5.5' }), 'gpt-5.5');
  assert.equal(agentModel({ ...base, context: { state: 'ok', used: 1, window: null, model: 'claude-opus-5-5' } }), 'Opus 5.5');
  assert.equal(agentModel({ model: 'claude-fable-5-1', context: { state: 'ok', used: 1, window: null, model: 'claude-opus-5-5' } }), 'Fable 5.1');
  assert.equal(agentModel({ ...base, context: { state: 'ok', used: 1, window: null, model: 'unknown' } }), null);
  assert.equal(agentModel({ ...base, context: { state: 'compacted' } }), null);
  assert.equal(agentModel(base), null);
});
