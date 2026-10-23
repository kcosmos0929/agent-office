import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, ROOM_DOORS, SPLIT_X, seatPosition, meetingSpot, DOOR, pathTo } from '../../web/src/office/layout.ts';
import { targetFps } from '../../web/src/office/fps.ts';

const inside = (p: { x: number; y: number }, r: { x0: number; y0: number; x1: number; y1: number }) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

test('방 배치: 15×15, 통창 쪽 열린 사무실 + 오른쪽에 개발실·비서실·회의실 (2026-10-23 배치 A)', () => {
  assert.deepEqual([ROOMS.claude.x0, ROOMS.claude.y0, ROOMS.claude.x1, ROOMS.claude.y1], [0, 0, 7.5, 15]);
  assert.deepEqual([ROOMS.codex.x0, ROOMS.codex.y0, ROOMS.codex.x1, ROOMS.codex.y1], [7.5, 0, 15, 4.5]);
  assert.deepEqual([ROOMS.aria.x0, ROOMS.aria.y0, ROOMS.aria.x1, ROOMS.aria.y1], [7.5, 4.5, 15, 9.5]);
  assert.deepEqual([ROOMS.meeting.x0, ROOMS.meeting.y0, ROOMS.meeting.x1, ROOMS.meeting.y1], [7.5, 9.5, 15, 15]);
  assert.deepEqual(Object.values(ROOMS).map((r) => r.label), ['사무실', '개발실', '비서실', '회의실']);
});

test('seatPosition 0~7은 모두 다르고 Claude 작업실 안', () => {
  const seats = Array.from({ length: 8 }, (_, i) => seatPosition(i));
  assert.equal(new Set(seats.map((s) => `${s.x},${s.y}`)).size, 8);
  for (const s of seats) assert.ok(inside(s, ROOMS.claude), JSON.stringify(s));
});

test('seatPosition(-1)과 범위 밖 자리는 문 근처', () => {
  for (const i of [-1, 8, 99]) {
    const p = seatPosition(i);
    assert.ok(Math.hypot(p.x - DOOR.x, p.y - DOOR.y) < 1.5, JSON.stringify(p));
  }
});

test('meetingSpot 0~5는 회의실 안이고 서로 다름, 6 이상도 회의실 안', () => {
  const spots = Array.from({ length: 6 }, (_, i) => meetingSpot(i));
  assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, 6);
  for (const s of [...spots, meetingSpot(6), meetingSpot(11)]) assert.ok(inside(s, ROOMS.meeting), JSON.stringify(s));
});

test('pathTo: 입구에서 시작해 목적지에서 끝나고, 회의실로 갈 땐 회의실 문을 지남', () => {
  const seat = seatPosition(2);
  const p = pathTo(seat);
  assert.deepEqual(p[0], DOOR);
  assert.deepEqual(p.at(-1), seat);
  assert.ok(p.every((q) => q.x < SPLIT_X), '사무실 자리로 갈 땐 사무실 밖으로 나가지 않음');
  const m = pathTo(meetingSpot(0));
  assert.deepEqual(m[0], DOOR);
  assert.deepEqual(m.at(-1), meetingSpot(0));
  assert.ok(m.some((q) => q.x === SPLIT_X && Math.abs(q.y - ROOM_DOORS.meeting.y) < 1e-9), '회의실 문(벽 x=SPLIT_X의 틈)을 지나야 함');
});

test('targetFps', () => {
  assert.equal(targetFps(['walk', 'sleep'], true), 0);
  assert.equal(targetFps(['walk', 'sleep'], false), 20);
  assert.equal(targetFps(['wave'], false), 20);
  assert.equal(targetFps(['type-fast', 'lean-back'], false), 8);
  assert.equal(targetFps(['think'], false), 8);
  assert.equal(targetFps(['scroll'], false), 8);
  assert.equal(targetFps(['sleep', 'lean-back', 'stand'], false), 1);
  assert.equal(targetFps([], false), 1);
});
