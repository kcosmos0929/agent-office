import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkBytes, TV_TEXT, tvLines } from '../../web/src/office/tv.ts';
import { quoteAt } from '../../web/src/office/quotes.ts';
import { sunTimes } from '../../web/src/office/daylight.ts';

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

test('TV: 사용량이 없으면 시계 — 큰 줄 시:분:초(24시간), 작은 줄 월·일·요일, 아랫줄은 기본 문구', () => {
  const t1 = at(2026, 10, 28, 11, 42, 7);
  assert.deepEqual(tvLines(null, t1), { main: '11:42:07', sub: '10월 28일 (수)', foot: { kind: 'quote', text: quoteAt(t1) } });
  const t2 = at(2026, 1, 4, 0, 5, 9);
  assert.deepEqual(tvLines(null, t2, 'none'), { main: '00:05:09', sub: '1월 4일 (일)', foot: { kind: 'none' } });
});

test('TV: 5시간 사용량이 있으면 지금처럼 사용량 %·리셋까지 남은 시간·주간 %, 아랫줄은 설정과 상관없이 사용량 막대', () => {
  const now = at(2026, 10, 28, 11, 0, 0);
  const u = { fiveHour: { pct: 41.6, resetsAt: sec(now) + 90 * 60 }, sevenDay: { pct: 17.2, resetsAt: sec(now) + 3 * 86400 }, at: now };
  for (const foot of ['quote', 'sun', 'none'] as const) {
    assert.deepEqual(tvLines(u, now, foot), { main: '사용량 42%', sub: '리셋 1:30 · 주간 17%', foot: { kind: 'bar', pct: 41.6 } });
  }
});

test('TV: 5시간 리셋 시각이 지난 사용량은 잡히지 않은 것으로 보고 시계 — "리셋 0:00"으로 남지 않게', () => {
  const now = at(2026, 10, 28, 11, 42, 7);
  const u = { fiveHour: { pct: 80, resetsAt: sec(now) - 1 }, sevenDay: { pct: 17.2, resetsAt: sec(now) + 3 * 86400 }, at: now - 6 * 3600_000 };
  assert.deepEqual(tvLines(u, now, 'none'), { main: '11:42:07', sub: '10월 28일 (수) · 주간 17%', foot: { kind: 'none' } });
});

test('TV: 주간만 있으면 시계 + 주간 %, 주간도 리셋이 지났으면 뺀다', () => {
  const now = at(2026, 10, 28, 11, 42, 7);
  assert.equal(tvLines({ fiveHour: null, sevenDay: { pct: 17.2, resetsAt: sec(now) + 60 }, at: now }, now).sub, '10월 28일 (수) · 주간 17%');
  const stale = { fiveHour: { pct: 30, resetsAt: sec(now) + 60 }, sevenDay: { pct: 17.2, resetsAt: sec(now) - 60 }, at: now };
  assert.equal(tvLines(stale, now).sub, '리셋 0:01');
  assert.equal(tvLines({ fiveHour: null, sevenDay: { pct: 17.2, resetsAt: sec(now) - 60 }, at: now }, now).sub, '10월 28일 (수)');
});

// 해 막대: 서울 해(daylight.ts sunTimes) 기준 — 낮이면 해 뜸→해 짐, 밤이면 해 짐→다음 해 뜸. 양 끝 시각은 시계처럼 보는 기기 시간대
const DAY = 86_400_000;
const hm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function sunFoot(now: number) {
  const f = tvLines(null, now, 'sun').foot;
  assert.equal(f.kind, 'sun');
  return f as { kind: 'sun'; from: string; to: string; pct: number; night: boolean };
}

test('TV 해 막대: 낮에는 해 뜸 → 해 짐 중 지난 만큼', () => {
  const { rise, set } = sunTimes(Date.UTC(2026, 9, 28, 3, 0, 0)); // 서울 10-28 12:00
  const now = rise + 3600_000;
  const f = sunFoot(now);
  assert.deepEqual([f.from, f.to, f.night], [hm(rise), hm(set), false]);
  assert.ok(Math.abs(f.pct - (100 * 3600_000) / (set - rise)) < 1e-6, String(f.pct));
});

test('TV 해 막대: 해 진 뒤엔 해 짐 → 다음 날 해 뜸(밤), 해 뜨기 전엔 전날 해 짐 → 해 뜸(밤)', () => {
  const { rise, set } = sunTimes(Date.UTC(2026, 9, 28, 3, 0, 0));
  const evening = sunFoot(set + 3600_000);
  const nextRise = sunTimes(set + 3600_000 + DAY).rise;
  assert.deepEqual([evening.from, evening.to, evening.night], [hm(set), hm(nextRise), true]);
  assert.ok(Math.abs(evening.pct - (100 * 3600_000) / (nextRise - set)) < 1e-6);
  const dawn = sunFoot(rise - 3600_000);
  const lastSet = sunTimes(rise - 3600_000 - DAY).set;
  assert.deepEqual([dawn.from, dawn.to, dawn.night], [hm(lastSet), hm(rise), true]);
  assert.ok(dawn.pct > 90 && dawn.pct < 100);
});
