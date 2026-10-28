import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkBytes, TV_TEXT, tvLines } from '../../web/src/office/tv.ts';

test('TV 글씨 색: 지정한 화면 색(sRGB) 바이트 그대로 — 선형 값으로 쓰면 한 번 더 어두워진다(#9AA5B4 → #526074가 되던 문제)', () => {
  assert.deepEqual(inkBytes('#9AA5B4'), [0x9a, 0xa5, 0xb4]);
  assert.deepEqual(inkBytes('#7CE0A3'), [0x7c, 0xe0, 0xa3]);
});

test('TV 글줄: 갈무리 설계 크기의 정수배(같은 배율)로 그린다 — 어긋나면 획이 빠지거나 뭉친다', () => {
  const DESIGN: Record<string, number> = { Galmuri11: 12, Galmuri14: 15 };
  const scales = Object.values(TV_TEXT).map(({ font }) => {
    const [, size, family] = /^(\d+)px (\w+)$/.exec(font)!;
    return Number(size) / DESIGN[family];
  });
  for (const k of scales) assert.ok(Number.isInteger(k) && k >= 1, `배율 ${k}`);
  assert.equal(new Set(scales).size, 1);
});

// 보는 기기 시간대 기준 시각(테스트도 같은 시간대로 만들어 어느 시간대에서 돌려도 같다)
const at = (y: number, mo: number, d: number, h: number, mi: number, s: number) => new Date(y, mo - 1, d, h, mi, s).getTime();
const sec = (ms: number) => Math.floor(ms / 1000);

test('TV: 사용량이 없으면 시계 — 큰 줄 시:분:초(24시간), 작은 줄 월·일·요일, 막대 숨김', () => {
  assert.deepEqual(tvLines(null, at(2026, 10, 28, 11, 42, 7)), { main: '11:42:07', sub: '10월 28일 (수)', pct: null, bar: false });
  assert.deepEqual(tvLines(null, at(2026, 1, 4, 0, 5, 9)), { main: '00:05:09', sub: '1월 4일 (일)', pct: null, bar: false });
});

test('TV: 5시간 사용량이 있으면 지금처럼 사용량 %·리셋까지 남은 시간·주간 %', () => {
  const now = at(2026, 10, 28, 11, 0, 0);
  const u = { fiveHour: { pct: 41.6, resetsAt: sec(now) + 90 * 60 }, sevenDay: { pct: 17.2, resetsAt: sec(now) + 3 * 86400 }, at: now };
  assert.deepEqual(tvLines(u, now), { main: '사용량 42%', sub: '리셋 1:30 · 주간 17%', pct: 41.6, bar: true });
});

test('TV: 5시간 리셋 시각이 지난 사용량은 잡히지 않은 것으로 보고 시계 — "리셋 0:00"으로 남지 않게', () => {
  const now = at(2026, 10, 28, 11, 42, 7);
  const u = { fiveHour: { pct: 80, resetsAt: sec(now) - 1 }, sevenDay: { pct: 17.2, resetsAt: sec(now) + 3 * 86400 }, at: now - 6 * 3600_000 };
  assert.deepEqual(tvLines(u, now), { main: '11:42:07', sub: '10월 28일 (수) · 주간 17%', pct: null, bar: false });
});

test('TV: 주간만 있으면 시계 + 주간 %, 주간도 리셋이 지났으면 뺀다', () => {
  const now = at(2026, 10, 28, 11, 42, 7);
  assert.equal(tvLines({ fiveHour: null, sevenDay: { pct: 17.2, resetsAt: sec(now) + 60 }, at: now }, now).sub, '10월 28일 (수) · 주간 17%');
  const stale = { fiveHour: { pct: 30, resetsAt: sec(now) + 60 }, sevenDay: { pct: 17.2, resetsAt: sec(now) - 60 }, at: now };
  assert.equal(tvLines(stale, now).sub, '리셋 0:01');
  assert.equal(tvLines({ fiveHour: null, sevenDay: { pct: 17.2, resetsAt: sec(now) - 60 }, at: now }, now).sub, '10월 28일 (수)');
});
