import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_SPOTS, ROOMS, ROOM_DOORS, SPLIT_X, seatPosition, meetingSpot, waitingSpot, DOOR, pathTo, facingAt, forwardFrom, backwardFrom, type Point } from '../../web/src/office/layout.ts';
import { targetFps } from '../../web/src/office/fps.ts';

const inside = (p: { x: number; y: number }, r: { x0: number; y0: number; x1: number; y1: number }) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

test('방 배치: 15×18, 통창 쪽 열린 사무실 + 오른쪽에 개발실·비서실·회의실 + 앞쪽 띠(창고·화장실·입구 복도·휴게실→안쪽 탕비실) (2026-10-23)', () => {
  assert.deepEqual([ROOMS.claude.x0, ROOMS.claude.y0, ROOMS.claude.x1, ROOMS.claude.y1], [0, 0, 7.5, 15]);
  assert.deepEqual([ROOMS.codex.x0, ROOMS.codex.y0, ROOMS.codex.x1, ROOMS.codex.y1], [7.5, 0, 15, 4.5]);
  assert.deepEqual([ROOMS.aria.x0, ROOMS.aria.y0, ROOMS.aria.x1, ROOMS.aria.y1], [7.5, 4.5, 15, 9.5]);
  assert.deepEqual([ROOMS.meeting.x0, ROOMS.meeting.y0, ROOMS.meeting.x1, ROOMS.meeting.y1], [7.5, 9.5, 15, 15]);
  for (const r of [ROOMS.lounge, ROOMS.pantry]) assert.deepEqual([r.y0, r.y1], [15, 18]);
  assert.deepEqual([ROOMS.storage.y0, ROOMS.storage.y1, ROOMS.restroom.y0, ROOMS.restroom.y1], [15, ROOMS.restroom.y0, ROOMS.storage.y1, 18]);
  assert.ok(ROOMS.restroom.x1 < DOOR.x && DOOR.x < ROOMS.lounge.x0, '입구는 창고·화장실과 휴게실 사이 복도');
  assert.equal(ROOMS.lounge.x1, ROOMS.pantry.x0, '탕비실은 휴게실 안쪽(휴게실을 지나 들어감)');
  assert.deepEqual(Object.values(ROOMS).map((r) => r.label), ['사무실', '개발실', '비서실', '회의실', '창고', '화장실', '휴게실', '탕비실']);
});

test('seatPosition 0~7은 모두 다르고 Claude 작업실 안', () => {
  const seats = Array.from({ length: 8 }, (_, i) => seatPosition(i));
  assert.equal(new Set(seats.map((s) => `${s.x},${s.y}`)).size, 8);
  for (const s of seats) assert.ok(inside(s, ROOMS.claude), JSON.stringify(s));
});

test('seatPosition(-1)과 범위 밖 자리는 로비(사무실 앞쪽) 대기 자리', () => {
  for (const i of [-1, 8, 99]) {
    const p = seatPosition(i);
    assert.ok(inside(p, ROOMS.claude) && p.y > 13, JSON.stringify(p));
  }
});

test('쉬는 동안 갈 지점은 휴게실·탕비실 안', () => {
  for (const p of Object.values(IDLE_SPOTS)) assert.ok(inside(p, ROOMS.pantry) || inside(p, ROOMS.lounge), JSON.stringify(p));
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

test('걷는 길은 바닥 격자 방향만(구간마다 x 또는 y 하나만 바뀜) — 비스듬한 4방향 그림과 맞춤', () => {
  const dests = [...Array.from({ length: 8 }, (_, i) => seatPosition(i)), seatPosition(-1), ...Array.from({ length: 5 }, (_, i) => waitingSpot(i)), ...Array.from({ length: 12 }, (_, i) => meetingSpot(i))];
  for (const d of dests) {
    const p = pathTo(d);
    for (let i = 1; i < p.length; i++) {
      const dx = Math.abs(p[i].x - p[i - 1].x);
      const dy = Math.abs(p[i].y - p[i - 1].y);
      assert.ok(dx < 1e-9 || dy < 1e-9, `${JSON.stringify(d)}: ${JSON.stringify(p[i - 1])} → ${JSON.stringify(p[i])}`);
    }
  }
});

test('자리 없는 세션은 로비 안내 데스크 앞에 흩어져 기다리고(5명까지 겹치지 않음) 데스크를 본다', () => {
  const spots = Array.from({ length: 5 }, (_, k) => waitingSpot(k));
  assert.equal(new Set(spots.map((p) => `${p.x},${p.y}`)).size, 5);
  for (const p of spots) {
    assert.ok(p.x > 4.4 && p.x < SPLIT_X - 0.5 && p.y > 13.5 && p.y < 15, JSON.stringify(p));
    assert.deepEqual(facingAt(p), { x: 0, y: -1 });
  }
  assert.deepEqual(waitingSpot(0), seatPosition(-1));
});

test('머무는 곳에서 보는 방향: 책상 자리는 모니터 쪽, 회의실은 테이블 쪽', () => {
  const dirs = Array.from({ length: 8 }, (_, i) => facingAt(seatPosition(i)));
  for (const f of dirs) assert.equal(Math.abs(f.x) + Math.abs(f.y), 1);
  assert.ok(dirs.some((f) => f.x === 1) && dirs.some((f) => f.x === -1), '묶음 양쪽 자리가 서로 마주 봄');
  assert.deepEqual(facingAt(meetingSpot(0)), { x: 0, y: 1 });
  assert.deepEqual(facingAt(meetingSpot(3)), { x: 0, y: -1 });
  assert.deepEqual(facingAt(seatPosition(-1)), { x: 0, y: -1 });
});

test('경로를 따라 되돌아가고 다시 가기: 같은 길 위라 격자 방향 유지', () => {
  const route = pathTo(seatPosition(2));
  const mid: Point = { x: route[1].x, y: (route[0].y + route[1].y) / 2 }; // 입구 복도 한가운데
  assert.deepEqual(backwardFrom(route, mid), [mid, DOOR]);
  assert.deepEqual(forwardFrom(route, mid), [mid, ...route.slice(1)]);
  const atSeat = route.at(-1)!;
  assert.deepEqual(backwardFrom(route, atSeat), [atSeat, ...route.slice(0, -1).reverse()]);
});

test('targetFps', () => {
  assert.equal(targetFps(['walk', 'sleep'], true), 0);
  assert.equal(targetFps(['walk', 'sleep'], false), 16);
  assert.equal(targetFps(['wave'], false), 16);
  assert.equal(targetFps(['type-fast', 'lean-back'], false), 8);
  assert.equal(targetFps(['think'], false), 8);
  assert.equal(targetFps(['scroll'], false), 8);
  assert.equal(targetFps(['sleep', 'lean-back', 'stand'], false), 1);
  assert.equal(targetFps([], false), 1);
});
