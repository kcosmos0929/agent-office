import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statuslineToUsage, statusLineText } from '../../src/server/collectors/usage.ts';

const NOW = 1_800_000_000_000; // ms
const sec = (ms: number) => Math.floor(ms / 1000);

test('rate_limits 두 창 모두 있음', () => {
  const u = statuslineToUsage({ rate_limits: {
    five_hour: { used_percentage: 62.4, resets_at: sec(NOW) + 3 * 3600 + 12 * 60 },
    seven_day: { used_percentage: 41.2, resets_at: sec(NOW) + 86400 },
  } }, NOW);
  assert.deepEqual(u, { fiveHour: { pct: 62.4, resetsAt: sec(NOW) + 11520 }, sevenDay: { pct: 41.2, resetsAt: sec(NOW) + 86400 }, at: NOW });
});

test('한쪽만 있거나, resets_at이 지난 창은 null', () => {
  const u = statuslineToUsage({ rate_limits: {
    five_hour: { used_percentage: 10, resets_at: sec(NOW) - 1 },
    seven_day: { used_percentage: 5, resets_at: sec(NOW) + 60 },
  } }, NOW);
  assert.equal(u?.fiveHour, null);
  assert.deepEqual(u?.sevenDay, { pct: 5, resetsAt: sec(NOW) + 60 });
});

test('rate_limits 없음·숫자 아님·모두 만료 → null', () => {
  assert.equal(statuslineToUsage({ model: { display_name: 'Opus' } }, NOW), null);
  assert.equal(statuslineToUsage({ rate_limits: { five_hour: { used_percentage: '많이', resets_at: 1 } } }, NOW), null);
  assert.equal(statuslineToUsage({ rate_limits: { five_hour: { used_percentage: 1, resets_at: 1 } } }, NOW), null);
  assert.equal(statuslineToUsage(null, NOW), null);
});

test('statusLineText 형식', () => {
  const u = { fiveHour: { pct: 62.4, resetsAt: sec(NOW) + 3 * 3600 + 12 * 60 + 30 }, sevenDay: null, at: NOW };
  assert.equal(statusLineText(u, 'Opus', NOW), '5h 62% · 3:12');
  assert.equal(statusLineText({ ...u, fiveHour: { pct: 5, resetsAt: sec(NOW) + 5 * 60 } }, null, NOW), '5h 5% · 0:05');
  assert.equal(statusLineText(null, 'Opus 5.5', NOW), 'Opus 5.5');
  assert.equal(statusLineText(null, null, NOW), '');
});
