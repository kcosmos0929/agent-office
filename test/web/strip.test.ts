import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo, renderStrip, stripDetails, stripState } from '../../web/src/strip.ts';
import type { Health } from '../../src/shared/types.ts';
import { FakeElement, fakeDocument } from './fakeDom.ts';

const H = (o: Partial<Health> = {}): Health => ({ startedAt: 0, lastHookAt: 50_000, registry: 'ok', sessions: 2, hookless: 0, lastCodexHookAt: null, ...o });

test('stripState 우선순위: 끊김 > 훅 없음 > 신호 없음 > 정상', () => {
  assert.deepEqual(stripState(false, H({ hookless: 1 }), 62_000), { tone: 'red', text: '🔴 끊김 — 다시 연결 중' });
  assert.deepEqual(stripState(true, H({ hookless: 1 }), 62_000), { tone: 'orange', text: '🟠 훅 신호가 안 와요 — 점검 필요' });
  assert.deepEqual(stripState(true, H({ lastHookAt: null }), 62_000), { tone: 'gray', text: '⚪ 연결됨 · 아직 신호 없음' });
  assert.deepEqual(stripState(true, null, 0), { tone: 'gray', text: '⚪ 연결됨 · 아직 신호 없음' });
  assert.deepEqual(stripState(true, H(), 62_000), { tone: 'green', text: '🟢 연결됨 · 신호 12초 전' });
});

test('formatAgo: 59초 전 / 1분 전 / 59분 전 / 1시간 전 (음수는 0초)', () => {
  assert.deepEqual([59_000, 60_000, 59 * 60_000, 60 * 60_000, -5].map(formatAgo), ['59초 전', '1분 전', '59분 전', '1시간 전', '0초 전']);
});

test('stripDetails: 5줄, 등록부·마지막 훅 문구', () => {
  assert.deepEqual(stripDetails(H(), 3_662_000),
    ['서버 켜짐 · 1시간 전', '세션 2개 (훅 없음 0)', '등록부: 읽힘', '마지막 훅 · 1시간 전', '자세한 점검: 터미널에서 npm run doctor']);
  assert.equal(stripDetails(H({ registry: 'missing' }), 0)[2], '등록부: 폴더 없음');
  assert.equal(stripDetails(H({ registry: 'error' }), 0)[2], '등록부: 못 읽음');
  assert.equal(stripDetails(H({ lastHookAt: null }), 0)[3], '마지막 훅 · 없음');
  assert.deepEqual(stripDetails(null, 0), ['서버 정보를 아직 못 받았어요']);
});

test('renderStrip: details.strip.green 안에 summary 문구와 strip-panel 줄 5개', () => {
  const el = renderStrip(fakeDocument as unknown as Document, true, H(), 62_000) as unknown as FakeElement;
  assert.equal(el.tagName, 'details');
  assert.equal(el.className, 'strip green');
  assert.equal(el.byClass('strip-text')[0].textContent, '🟢 연결됨 · 신호 12초 전');
  assert.equal(el.byClass('strip-panel')[0].children.length, 5);
});

test('renderStrip: open이면 펼친 채로 다시 그림(스냅샷마다 닫히지 않게)', () => {
  const closed = renderStrip(fakeDocument as unknown as Document, true, H(), 62_000) as unknown as FakeElement;
  const open = renderStrip(fakeDocument as unknown as Document, true, H(), 62_000, true) as unknown as FakeElement;
  assert.equal(closed.getAttribute('open'), null);
  assert.equal(open.getAttribute('open'), '');
});
