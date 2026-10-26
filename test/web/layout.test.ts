import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIR_PULLBACK, DESKS, DESK_DEPTH, IDLE_SPOTS, ROOMS, ROOM_DOORS, SPLIT_X, chairPosition, seatPosition, meetingSpot, waitingSpot, DOOR, pathTo, facingAt, forwardFrom, backwardFrom, segmentAt, type Point, BAND_LANE_Y, DEV_LANE_Y, REST_SPOTS, OVERFLOW_SPOTS, CORRIDOR, FLOOR_Z, devSpot, routeBetween, simplifyPath, EXTRA_REST_SPOTS } from '../../web/src/office/layout.ts';
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

test('의자 가운데: 상판 가장자리 바깥으로 (빼는 거리 − 0.02)만큼, 서 있는 자리와는 따로', () => {
  assert.equal(CHAIR_PULLBACK, 0.2);
  for (let i = 0; i < 8; i++) {
    const d = DESKS[i];
    const c = chairPosition(i);
    const stand = seatPosition(i);
    assert.equal(c.y, stand.y, '같은 줄(z)');
    if (d.facing === 'px') {
      assert.ok(Math.abs(c.x - (d.x0 + DESK_DEPTH + 0.18)) < 1e-9, `${i}: ${c.x}`);
      assert.ok(c.x < stand.x, '의자가 서 있는 자리보다 책상 쪽');
    } else {
      assert.ok(Math.abs(c.x - (d.x0 - 0.18)) < 1e-9, `${i}: ${c.x}`);
      assert.ok(c.x > stand.x, '의자가 서 있는 자리보다 책상 쪽');
    }
  }
  // 빼기 전 위치(0)는 상판 안쪽 0.02 — 비교용
  const px = DESKS.findIndex((d) => d.facing === 'px');
  assert.ok(Math.abs(chairPosition(px, 0).x - (DESKS[px].x0 + DESK_DEPTH - 0.02)) < 1e-9);
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

const allPlaces = (): Point[] => [
  ...Array.from({ length: 8 }, (_, i) => seatPosition(i)),
  ...[0, 1, 2].map(devSpot),
  ...REST_SPOTS.map((r) => r.at),
  ...OVERFLOW_SPOTS,
  ...EXTRA_REST_SPOTS,
  ...Array.from({ length: 12 }, (_, i) => waitingSpot(i)),
  ...Array.from({ length: 6 }, (_, i) => meetingSpot(i)),
  DOOR,
];
const isGrid = (p: Point[]) => p.every((q, i) => i === 0 || Math.abs(q.x - p[i - 1].x) < 1e-9 || Math.abs(q.y - p[i - 1].y) < 1e-9);
const pathLen = (p: Point[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y) : 0), 0);

test('모든 장소 쌍의 routeBetween은 격자 방향만, 처음=from 끝=to', () => {
  const places = allPlaces();
  for (const a of places) for (const b of places) {
    const r = routeBetween(a, b);
    assert.deepEqual(r[0], a);
    assert.deepEqual(r.at(-1), b);
    assert.ok(isGrid(r), `${JSON.stringify(a)} → ${JSON.stringify(b)}: ${JSON.stringify(r)}`);
  }
});

test('routeBetween은 입구 끝(y=18)까지 내려가지 않음', () => {
  const places = allPlaces().filter((p) => p !== DOOR);
  for (const a of places) for (const b of places) {
    assert.ok(routeBetween(a, b).every((q) => q.y !== FLOOR_Z), `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
});

test('같은 띠 안 이동은 등뼈로 나가지 않음', () => {
  const r = routeBetween(REST_SPOTS[0].at, REST_SPOTS[4].at);
  assert.ok(r.every((q) => q.x > CORRIDOR.x1), JSON.stringify(r));
  assert.ok(r.some((q) => q.y === BAND_LANE_Y));
});

test('같은 자리로 가는 길은 한 점', () => {
  assert.deepEqual(routeBetween(seatPosition(0), seatPosition(0)), [seatPosition(0)]);
});

test('simplifyPath: 되돌기·직선 가운데 점·중복 점 제거, 빈 입력에도 안전', () => {
  const a = { x: 0, y: 0 }, b = { x: 2, y: 0 }, c = { x: 0, y: 3 };
  assert.deepEqual(simplifyPath([a, b, a, c]), [a, c]);
  assert.deepEqual(simplifyPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
  assert.deepEqual(simplifyPath([a, a, b, b]), [a, b]);
  assert.deepEqual(simplifyPath([]), []);
  assert.deepEqual(simplifyPath([a]), [a]);
  assert.deepEqual(simplifyPath([a, a, a]), [a]);
});

test('되짚어 돌아가기: 지나온 길만 되짚음', () => {
  const route = routeBetween(seatPosition(0), REST_SPOTS[1].at);
  const p: Point = { x: (route[1].x + route[2].x) / 2, y: (route[1].y + route[2].y) / 2 };
  const walked = pathLen([...route.slice(0, segmentAt(route, p) + 1), p]);
  const back = simplifyPath([...backwardFrom(route, p), ...routeBetween(route[0], seatPosition(0)).slice(1)]);
  assert.ok(isGrid(back));
  assert.deepEqual(back.at(-1), seatPosition(0));
  assert.ok(pathLen(back) <= walked + 1e-9, `${pathLen(back)} > ${walked}`);
});

test('devSpot 0~2는 개발실 안·서로 다름, 그 밖은 로비 첫 자리', () => {
  const s = [0, 1, 2].map(devSpot);
  assert.equal(new Set(s.map((q) => q.x)).size, 3);
  for (const q of s) { assert.ok(inside(q, ROOMS.codex)); assert.equal(q.y, DEV_LANE_Y); assert.deepEqual(facingAt(q), { x: 0, y: -1 }); }
  assert.deepEqual(devSpot(3), waitingSpot(0));
});

test('쉼 자리·넘침 자리는 휴게실·탕비실 안, 보는 방향이 정해져 있음', () => {
  assert.equal(BAND_LANE_Y, 17.55);
  for (const r of REST_SPOTS) { assert.ok(inside(r.at, ROOMS.lounge) || inside(r.at, ROOMS.pantry)); assert.deepEqual(facingAt(r.at), r.face); }
  assert.deepEqual(REST_SPOTS.map((r) => r.at), Object.values(IDLE_SPOTS));
  for (const q of OVERFLOW_SPOTS) { assert.ok(inside(q, ROOMS.lounge) || inside(q, ROOMS.pantry)); assert.deepEqual(facingAt(q), { x: 1, y: 0 }); }
});

test('pathTo: 휴게실·탕비실은 방 안 길로, 개발실은 유리벽 통로로', () => {
  const rest = pathTo(REST_SPOTS[3].at);
  assert.ok(rest.some((q) => q.y === BAND_LANE_Y && q.x === DOOR.x));
  assert.ok(isGrid(rest));
  const dev = pathTo(devSpot(1));
  assert.ok(isGrid(dev));
  assert.ok(dev.some((q) => q.y === DEV_LANE_Y && q.x < SPLIT_X));
});

test('마지막 넘침 자리는 빈백(노란 쿠션)을 피해 가로 길(17.55) 바로 옆 17.35~17.45에 있음', () => {
  const last = OVERFLOW_SPOTS[OVERFLOW_SPOTS.length - 1];
  assert.equal(last.x, 9.55);
  assert.ok(last.y >= 17.35 && last.y <= 17.45);
  assert.ok(inside(last, ROOMS.lounge) || inside(last, ROOMS.pantry));
});

test('targetFps', () => {
  assert.equal(targetFps(['walk', 'sleep'], true), 0);
  assert.equal(targetFps(['walk', 'sleep'], false), 16);
  assert.equal(targetFps(['wave'], false), 8);
  assert.equal(targetFps(['sleep'], false, true), 16);
  assert.equal(targetFps(['stroll'], false), 8);
  assert.equal(targetFps(['stroll', 'walk'], false), 16);
  assert.equal(targetFps(['type-fast', 'lean-back'], false), 8);
  assert.equal(targetFps(['think'], false), 8);
  assert.equal(targetFps(['scroll'], false), 8);
  assert.equal(targetFps(['sleep', 'lean-back', 'stand'], false), 1);
  assert.equal(targetFps([], false), 1);
});

test('로비 대기 자리 0~11은 서로 다른 12곳, 사무실 안, 입구가 아니고, 길은 격자 방향만', () => {
  const spots = Array.from({ length: 12 }, (_, k) => waitingSpot(k));
  assert.equal(new Set(spots.map((p) => `${p.x},${p.y}`)).size, 12);
  for (let i = 0; i < spots.length; i++) {
    const p = spots[i];
    assert.ok(p.x > ROOMS.claude.x0 && p.x < ROOMS.claude.x1 && p.y > 9.2 && p.y < ROOMS.claude.y1, JSON.stringify(p));
    assert.notDeepEqual(p, DOOR);
    assert.deepEqual(facingAt(p), { x: 0, y: -1 });
    assert.ok(isGrid(pathTo(p)), JSON.stringify(pathTo(p)));
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(p.x - spots[j].x, p.y - spots[j].y) >= 0.7, `${i}/${j}`);
  }
});

test('넘침 너머 쉼 자리(EXTRA_REST_SPOTS)는 휴게실·탕비실 띠 안, 서로·기존 쉼·넘침 자리와 0.3 이상 떨어짐', () => {
  const others = [...REST_SPOTS.map((r) => r.at), ...OVERFLOW_SPOTS];
  assert.ok(EXTRA_REST_SPOTS.length >= 17);
  EXTRA_REST_SPOTS.forEach((p, i) => {
    assert.ok(p.x > CORRIDOR.x1 && p.x <= 14.3 && p.y > 15 && p.y < FLOOR_Z, JSON.stringify(p));
    for (const q of others) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 0.3, `${JSON.stringify(p)} ~ ${JSON.stringify(q)}`);
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(p.x - EXTRA_REST_SPOTS[j].x, p.y - EXTRA_REST_SPOTS[j].y) >= 0.3);
    assert.deepEqual(facingAt(p), { x: 1, y: 0 });
  });
});
