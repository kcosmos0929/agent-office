import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPan, dragToPan, isDrag, Press, PressOwner, snapPan } from '../../web/src/office/pan.ts';

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

test('PressOwner: 먼저 누른 포인터만 주인 — 두 번째 누르기·다른 포인터의 떼기/취소는 무시, 끈 뒤 카드 안 열림 (리뷰 P2)', () => {
  const o = new PressOwner();
  assert.equal(o.down(1, 100, 100, { x: 0, y: 0 }), true);
  assert.deepEqual(o.move(1, 110, 100, 2, 0.1), { x: -1, y: 0 });
  assert.equal(o.dragging(2), true);
  assert.equal(o.down(2, 300, 300, { x: 0, y: 0 }), false); // 두 번째 손가락은 무시
  assert.equal(o.move(2, 301, 300, 2, 0.1), null);
  assert.equal(o.up(2), null); // 주인이 아니면 누르기도 아님
  o.cancel(2); // 다른 포인터 취소는 주인을 지우지 않음
  assert.equal(o.dragging(2), true);
  assert.equal(o.up(1), false); // 주인이 끌었으니 카드 안 열림
  assert.equal(o.down(3, 50, 50, { x: 0, y: 0 }), true); // 끝난 뒤엔 새로 누를 수 있음
  o.cancel(3);
  assert.equal(o.up(3), null);
  assert.equal(o.down(4, 50, 50, { x: 0, y: 0 }), true);
  assert.equal(o.up(4), true); // 안 움직이고 떼면 누르기
});
