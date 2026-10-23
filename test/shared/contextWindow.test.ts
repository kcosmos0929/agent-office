import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextWindow, modelLabel } from '../../src/shared/contextWindow.ts';

test('창 크기: 5 계열 100만, haiku-4-5 20만, 모르면 null', () => {
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) assert.equal(contextWindow(m), 1_000_000);
  assert.equal(contextWindow('claude-haiku-4-5-20251001'), 200_000);
  assert.equal(contextWindow('gpt-5'), null);
  assert.equal(contextWindow('<synthetic>'), null);
});

test('모델 표시 이름', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('mystery-model'), 'mystery-model');
});
