import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burstElapsed, eventsFor, hopDots, makeSparkle, makeZzz, ringBurst } from '../../web/src/office/effects.ts';
import { fakeDocument, type FakeElement } from './fakeDom.ts';

test('hopDots: 1초 중 앞 250ms만 2도트, 동작 줄이기면 0', () => {
  assert.equal(hopDots(0, false), 2);
  assert.equal(hopDots(249, false), 2);
  assert.equal(hopDots(250, false), 0);
  assert.equal(hopDots(1100, false), 2);
  assert.equal(hopDots(0, true), 0);
});

test('Zzz: div.zzz 안에 Z 글자 셋', () => {
  const el = makeZzz(fakeDocument as unknown as Document) as unknown as FakeElement;
  assert.equal(el.className, 'zzz');
  assert.equal(el.children.length, 3);
  assert.ok(el.children.every((c) => c.textContent === 'Z'));
});

test('eventsFor: 처음 보는 상태는 기준만, 일하다 끝나면 반짝, 승인·질문이 풀려 일하면 링 퍼짐', () => {
  assert.deepEqual(eventsFor(undefined, 'done'), []);
  assert.deepEqual(eventsFor('editing', 'done'), ['sparkle']);
  assert.deepEqual(eventsFor('thinking', 'done'), ['sparkle']);
  assert.deepEqual(eventsFor('permission', 'running'), ['burst']);
  assert.deepEqual(eventsFor('question', 'thinking'), ['burst']);
  assert.deepEqual(eventsFor('permission', 'done'), []);
  assert.deepEqual(eventsFor('approving', 'running'), []);
  assert.deepEqual(eventsFor('done', 'done'), []);
});

test('ringBurst: 600ms 동안 1→1.8배로 퍼지며 투명해지고 그 밖은 null', () => {
  assert.deepEqual(ringBurst(0), { scale: 1, opacity: 1 });
  const mid = ringBurst(300)!;
  assert.ok(Math.abs(mid.scale - 1.4) < 1e-9 && Math.abs(mid.opacity - 0.5) < 1e-9);
  assert.equal(ringBurst(600), null);
  assert.equal(ringBurst(-1), null);
});

test('반짝: div.sparkle 안에 ✅ 하나(움직임은 안쪽 span)', () => {
  const el = makeSparkle(fakeDocument as unknown as Document) as unknown as FakeElement;
  assert.equal(el.className, 'sparkle');
  assert.equal(el.children.length, 1);
  assert.equal(el.children[0].textContent, '✅');
});

test('burstElapsed: 시각 어긋남은 0으로, 숨은 탭에서 오래 뒤면 600ms를 넘어 버려진다', () => {
  assert.equal(burstElapsed(990, 1000), 0);
  assert.equal(burstElapsed(1300, 1000), 300);
  assert.equal(ringBurst(burstElapsed(61_000, 1000)), null);
});
