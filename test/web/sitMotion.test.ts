import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Cast } from '../../web/src/office/cast.ts';
import { chairPosition, devChairPosition, devSpot, LOUNGE_SEATS, meetingChairPosition, meetingSpot, seatPosition } from '../../web/src/office/layout.ts';
import type { OfficeScene } from '../../web/src/office/scene.ts';
import { DROP_DOTS, DROP_MS, sitMotionAt, sitMotionMs, sitSteps, TURN_MS, type SitMotion } from '../../web/src/office/sitMotion.ts';
import { PACE_FPS, STEP } from '../../web/src/office/sprites/look.ts';
import type { Agent, Status } from '../../src/shared/types.ts';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;

test('sitSteps: 서는 자리와 의자 사이를 걷는 보폭(STEP)으로 — 사무실 6 · 개발실 14 · 휴게실 소파 5 · 회의실 2, 같은 점 0', () => {
  assert.equal(sitSteps(seatPosition(0), chairPosition(0)), 6);
  assert.equal(sitSteps(devSpot(0), devChairPosition(0)), 14);
  assert.equal(sitSteps(LOUNGE_SEATS[0].at, LOUNGE_SEATS[0].sit.at), 5);
  assert.equal(sitSteps(meetingSpot(0), meetingChairPosition(0)), 2);
  assert.equal(sitSteps({ x: 1, y: 1 }, { x: 1, y: 1 }), 0);
  assert.equal(sitSteps({ x: 1, y: 1 }, { x: 1, y: 1 + STEP / 4 }), 1); // 조금이라도 떨어져 있으면 한 걸음
});

test('앉기(down): 의자까지 한 장에 한 보폭씩 걷고 → 의자 앞에서 앉을 방향으로 서고 → 앉은 그림 2 → 1도트 → 끝', () => {
  const stand = LOUNGE_SEATS[0].at;
  const seat = LOUNGE_SEATS[0].sit.at;
  const m: SitMotion = { kind: 'down', start: 1000, stand, seat, dir: 'SW', pace: 'free' };
  const stepMs = 1000 / PACE_FPS.free;
  const n = sitSteps(stand, seat);
  let prev = Infinity;
  for (let k = 0; k < n; k++) {
    const f = sitMotionAt(m, 1000 + k * stepMs + 1);
    assert.ok(f && f.stage === 'walk');
    assert.equal(f.step, k);
    assert.equal(f.dir, 'NE'); // 소파 쪽(-y)으로 걸음
    const left = Math.hypot(f.at.x - seat.x, f.at.y - seat.y);
    assert.ok(left < prev);
    prev = left;
  }
  const last = sitMotionAt(m, 1000 + n * stepMs - 1);
  assert.ok(last && last.stage === 'walk' && close(last.at, seat)); // 마지막 걸음이 의자에 닿는다
  const turn = sitMotionAt(m, 1000 + n * stepMs + 1);
  assert.deepEqual(turn, { stage: 'turn', at: seat, dir: 'SW' }); // 돌아서서 이쪽을 본다
  assert.deepEqual(sitMotionAt(m, 1000 + n * stepMs + TURN_MS + 1), { stage: 'seat', lift: DROP_DOTS[0] });
  assert.deepEqual(sitMotionAt(m, 1000 + n * stepMs + TURN_MS + DROP_MS + 1), { stage: 'seat', lift: DROP_DOTS[1] });
  assert.equal(sitMotionAt(m, 1000 + sitMotionMs(m)), null);
  assert.deepEqual(DROP_DOTS, [2, 1]);
});

test('일어서기(up): 앉은 그림 1 → 2도트 들썩 → 의자 앞에 앉았던 방향으로 서고 → 그 방향을 본 채 서는 자리까지 뒷걸음 → 끝', () => {
  const stand = seatPosition(0);
  const seat = chairPosition(0);
  const m: SitMotion = { kind: 'up', start: 0, stand, seat, dir: 'NW', pace: 'work' };
  const stepMs = 1000 / PACE_FPS.work;
  assert.deepEqual(sitMotionAt(m, 1), { stage: 'seat', lift: 1 });
  assert.deepEqual(sitMotionAt(m, DROP_MS + 1), { stage: 'seat', lift: 2 });
  assert.deepEqual(sitMotionAt(m, 2 * DROP_MS + 1), { stage: 'turn', at: seat, dir: 'NW' });
  const t0 = 2 * DROP_MS + TURN_MS;
  const first = sitMotionAt(m, t0 + 1);
  assert.ok(first && first.stage === 'walk' && first.step === 0);
  assert.equal(first.dir, 'NW'); // 책상을 본 채
  assert.equal(first.back, true); // 물러나는 쪽(+x = SE)은 반대 — 뒷걸음
  const last = sitMotionAt(m, t0 + 6 * stepMs - 1);
  assert.ok(last && last.stage === 'walk' && last.step === 5 && close(last.at, stand));
  assert.equal(sitMotionAt(m, t0 + 6 * stepMs), null);
  assert.equal(sitMotionMs(m), 6 * stepMs + TURN_MS + 2 * DROP_MS); // 사무실 일 걸음: 0.66초
});

test('휴게실 소파에서 일어설 땐 이쪽(SW)을 본 채 앞으로 걸어 나온다(뒷걸음 아님), 앉으러 갈 땐 소파 쪽으로 걸어가 돌아선다', () => {
  const { at: stand, sit } = LOUNGE_SEATS[1];
  const up = sitMotionAt({ kind: 'up', start: 0, stand, seat: sit.at, dir: 'SW', pace: 'work' }, 2 * DROP_MS + TURN_MS + 1);
  assert.ok(up && up.stage === 'walk');
  assert.equal(up.dir, 'SW');
  assert.equal(up.back, false);
  const down = sitMotionAt({ kind: 'down', start: 0, stand, seat: sit.at, dir: 'SW', pace: 'free' }, 1);
  assert.ok(down && down.stage === 'walk' && down.dir === 'NE' && !down.back);
});

test('서는 자리 = 의자면 걷지 않고 돌아서기·내려앉기만', () => {
  const p = { x: 3, y: 4 };
  const m: SitMotion = { kind: 'down', start: 0, stand: p, seat: p, dir: 'SE', pace: 'free' };
  assert.deepEqual(sitMotionAt(m, 0), { stage: 'turn', at: p, dir: 'SE' });
  assert.equal(sitMotionMs(m), TURN_MS + 2 * DROP_MS);
});

// 배우 흐름: 의자에 앉은 사람은 떠날 길이 생겨도 먼저 일어선 뒤에 걷고, 자리에 닿으면 바로 앉기 시작한다
const office = { deskScreens: [], devScreens: [], racks: [] } as unknown as OfficeScene;
function fakeDocument(): Document {
  const el = () => ({ className: '', textContent: '', style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, append() {} });
  return { createElement: el } as unknown as Document;
}
const agent = (status: Status): Agent => ({
  id: 'claude:s1', kind: 'claude', sessionId: 's1', title: null, cwd: '/x', project: 'x', status, detail: null,
  since: 0, lastEventAt: 0, hat: 0, seat: 0, subagents: [], hookless: false, context: null, model: null,
});
type ActorView = { at: { x: number; y: number }; path: unknown[]; onSeat: unknown; motion: { kind: string } | null };
function withCast(reduced: boolean, run: (cast: Cast, actor: () => ActorView) => void, t: { mock: { method: (o: object, k: string, f: () => void) => void } }) {
  t.mock.method(console, 'warn', () => {}); // node엔 그림 불러오기가 없어 실패 — 이 테스트와 무관
  const saved = (globalThis as { document?: Document }).document;
  (globalThis as { document?: Document }).document = fakeDocument();
  try {
    const cast = new Cast(new THREE.Scene(), office, () => {}, () => 0, reduced, 'motion');
    run(cast, () => (cast as unknown as { actors: Map<string, ActorView> }).actors.get('claude:s1')!);
  } finally {
    (globalThis as { document?: Document }).document = saved;
  }
}

test('배우: 책상에 앉아 있다가 쉬러 가면 먼저 일어서고(그동안 제자리), 다 일어선 뒤 걷는다', (t) => {
  withCast(false, (cast, actor) => {
    cast.sync({ agents: [agent('running')], now: 0 } as never); // 첫 동기화 = 자리에 바로 앉아 있음
    assert.ok(actor().onSeat);
    const start = { ...actor().at };
    cast.sync({ agents: [agent('idle')], now: 1 } as never); // 쉬러 휴게실로
    cast.animate(1000, 0.1);
    assert.equal(actor().motion?.kind, 'up');
    assert.ok(actor().path.length > 1);
    cast.animate(1300, 0.3);
    assert.deepEqual(actor().at, start); // 일어서는 동안은 걷지 않는다
    assert.deepEqual(cast.poses(), ['walk']); // 그동안 자주 그린다
    cast.animate(1000 + 2000, 0.1); // 일어서기 끝(사무실 쉬러 가는 걸음 1.03초)
    assert.equal(actor().motion, null);
    assert.equal(actor().onSeat, null);
    cast.animate(3100, 0.1);
    assert.notDeepEqual(actor().at, start); // 이제 걷는다
  }, t);
});

test('배우: 걸어와 책상에 닿으면 같은 프레임에 앉기를 시작하고, 끝나면 앉아 있다', (t) => {
  withCast(false, (cast, actor) => {
    cast.sync({ agents: [], now: 0 } as never);
    cast.sync({ agents: [agent('running')], now: 1 } as never); // 문에서 걸어온다
    assert.equal(actor().onSeat, null);
    cast.animate(1000, 1000); // 한 프레임에 끝까지 걸음
    assert.equal(actor().path.length, 1);
    assert.equal(actor().motion?.kind, 'down');
    cast.animate(1000 + 1000, 0.1);
    assert.equal(actor().motion, null);
    assert.ok(actor().onSeat);
  }, t);
});

test('배우: 동작 줄이기면 전처럼 바로 일어서 바로 걷는다(전환 없음)', (t) => {
  withCast(true, (cast, actor) => {
    cast.sync({ agents: [agent('running')], now: 0 } as never);
    assert.ok(actor().onSeat);
    const start = { ...actor().at };
    cast.sync({ agents: [agent('idle')], now: 1 } as never);
    cast.animate(1000, 0.1);
    cast.animate(1100, 0.1);
    assert.equal(actor().motion, null);
    assert.equal(actor().onSeat, null);
    assert.notDeepEqual(actor().at, start);
  }, t);
});
