import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardContextLine, contextPct, formatTokens, gaugeLevel, rowGaugeText } from '../../web/src/gauge.ts';

test('gaugeLevel 경계: 69 ok, 70 warn, 89 warn, 90 full', () => {
  assert.deepEqual([69, 70, 89, 90].map(gaugeLevel), ['ok', 'warn', 'warn', 'full']);
});

test('contextPct: 내림, 창 모름·compacted → null', () => {
  assert.equal(contextPct({ state: 'ok', used: 619_999, window: 1_000_000, model: 'm' }), 61);
  assert.equal(contextPct({ state: 'ok', used: 619_999, window: null, model: 'm' }), null);
  assert.equal(contextPct({ state: 'compacted' }), null);
});

test('formatTokens: 234560 → 약 23만, 8400 → 약 8천, 512 → 약 512', () => {
  assert.equal(formatTokens(234_560), '약 23만');
  assert.equal(formatTokens(8_400), '약 8천');
  assert.equal(formatTokens(512), '약 512');
});

test('rowGaugeText: % / 창 모르면 토큰 수 / 정리 직후', () => {
  assert.equal(rowGaugeText({ state: 'ok', used: 234_560, window: 1_000_000, model: 'claude-opus-5-5' }), '대화 23%');
  assert.equal(rowGaugeText({ state: 'ok', used: 234_560, window: null, model: 'mystery' }), '대화 약 23만');
  assert.equal(rowGaugeText({ state: 'compacted' }), '대화 정리 직후');
});

test('cardContextLine', () => {
  assert.equal(cardContextLine({ state: 'ok', used: 620_000, window: 1_000_000, model: 'claude-opus-5-5' }), '대화 62% · 약 62만 / 100만 토큰 · Opus 5.5');
  assert.equal(cardContextLine({ state: 'ok', used: 150_000, window: 200_000, model: 'claude-haiku-4-5-20251001' }), '대화 75% · 약 15만 / 20만 토큰 · Haiku 4.5');
  assert.equal(cardContextLine({ state: 'ok', used: 620_000, window: null, model: 'mystery' }), '대화 약 62만 토큰 · mystery');
  assert.equal(cardContextLine({ state: 'compacted' }), '대화 정리 직후 — 다음 답부터 다시 계산');
  assert.equal(cardContextLine(null), '대화 —');
});
