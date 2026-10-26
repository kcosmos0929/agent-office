import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hopDots, makeZzz } from '../../web/src/office/effects.ts';
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
