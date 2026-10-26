import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPan, dragToPan, isDrag, Press, snapPan } from '../../web/src/office/pan.ts';

test('isDrag: 4px를 넘게 움직여야 끌기(그 이하는 누르기 — 카드 열기)', () => {
  assert.equal(isDrag(3, 0), false);
  assert.equal(isDrag(4, 0), false);
  assert.equal(isDrag(3, 3), true);
  assert.equal(isDrag(0, -5), true);
});

test('clampPan: 1배 이하면 가운데(0,0), 확대하면 1배 때 보이는 영역 안까지만', () => {
  assert.deepEqual(clampPan({ x: 3, y: -2 }, 10, 6, 1), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: 3, y: -2 }, 10, 6, 0.8), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: 100, y: -100 }, 10, 6, 2), { x: 5, y: -3 });
  assert.deepEqual(clampPan({ x: 1, y: 1 }, 10, 6, 2), { x: 1, y: 1 });
});

test('dragToPan: 끈 방향으로 사무실이 따라옴(오른쪽으로 끌면 보는 창은 왼쪽, 아래로 끌면 위)', () => {
  assert.deepEqual(dragToPan({ x: 1, y: 1 }, 10, -20, 0.1), { x: 0, y: -1 });
});

test('snapPan: 도트가 흔들리지 않게 화면 점 단위로 맞춤', () => {
  assert.deepEqual(snapPan({ x: 0.74, y: -0.26 }, 0.5), { x: 0.5, y: -0.5 });
  assert.deepEqual(snapPan({ x: 0, y: 0 }, 0.5), { x: 0, y: 0 });
});

test('Press: 4px 넘게 움직이면 확대 배율과 상관없이 누르기가 아님(카드 안 열림), 옮기기는 확대했을 때만 (리뷰 P2)', () => {
  const flat = new Press(100, 100, { x: 0, y: 0 });
  assert.equal(flat.move(103, 100, 0.8, 0.1), null);
  assert.equal(flat.isClick, true);
  assert.equal(flat.move(110, 100, 0.8, 0.1), null); // 1배 이하: 옮기지 않음
  assert.equal(flat.isClick, false); // 그래도 끌었으니 손을 떼도 카드 안 열림
  const zoomed = new Press(100, 100, { x: 1, y: 1 });
  assert.equal(zoomed.move(102, 101, 2, 0.1), null);
  assert.deepEqual(zoomed.move(110, 80, 2, 0.1), { x: 0, y: -1 });
  assert.equal(zoomed.isClick, false);
  assert.equal(zoomed.dragging(2), true);
  assert.equal(flat.dragging(0.8), false); // 1배 이하에선 쥔 손 커서 아님
});
