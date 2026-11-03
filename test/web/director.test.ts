import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, Status } from '../../src/shared/types.ts';
import { direct, frontOf, hashId, restAssignments } from '../../web/src/office/director.ts';
import { DESKS, DOOR, OVERFLOW_SPOTS, REST_SPOTS, chairPosition, devChairPosition, devSpot, facingAt, meetingChairPosition, meetingSpot, seatPosition, waitingSpot } from '../../web/src/office/layout.ts';
import { dirFor, seatedDir } from '../../web/src/office/sprites/look.ts';

function agent(id: string, status: Status, extra: Partial<Agent> = {}): Agent {
  return {
    id, kind: 'claude', sessionId: id, title: null, cwd: '/x', project: 'p', status, detail: null,
    since: 0, lastEventAt: 0, hat: 2, seat: 0, subagents: [], hookless: false, context: null, model: null, ...extra,
  };
}
const planOf = (a: Agent) => direct([a], 1_000_000).get(a.id)!;
const f0 = facingAt(seatPosition(0));
const deskDir = dirFor(f0.x, f0.y);

test('상태 → 계획 표: 책상에서 일하는 상태들', () => {
  const rows: [Status, string, string[]][] = [
    ['thinking', 'think', ['monitor', 'dots']],
    ['reading', 'scroll', ['monitor']],
    ['editing', 'type-fast', ['monitor']],
    ['running', 'type-fast', ['monitor']],
    ['delegating', 'think', ['monitor']],
    ['compacting', 'think', ['monitor']],
    ['approving', 'think', ['monitor']],
    ['done', 'lean-back', []],
    ['quota', 'sleep', ['zzz']],
    ['stalled', 'stand', []],
  ];
  for (const [status, pose, effects] of rows) {
    const p = planOf(agent('a', status));
    assert.deepEqual(p.spot, seatPosition(0), status);
    assert.equal(p.facing, deskDir, status);
    assert.equal(p.pose, pose, status);
    assert.deepEqual(p.effects, effects, status);
    assert.equal(p.pace, 'work', status);
    assert.equal(p.leave, false);
    assert.equal(p.isSub, false);
    assert.equal(p.hat, 2);
  }
});

test('승인·질문은 앞 방향을 보고 손을 흔든다', () => {
  for (const s of ['permission', 'question'] as const) {
    const p = planOf(agent('a', s));
    assert.equal(p.facing, frontOf(deskDir));
    assert.equal(p.pose, 'wave');
    assert.deepEqual(p.effects, ['wave', 'ring']);
  }
});

test('frontOf: NW→SW, NE→SE, SE·SW 그대로', () => {
  assert.equal(frontOf('NW'), 'SW');
  assert.equal(frontOf('NE'), 'SE');
  assert.equal(frontOf('SE'), 'SE');
  assert.equal(frontOf('SW'), 'SW');
});

test('쉬는 중은 쉼 자리나 넘침 자리, 자유 걸음, zzz', () => {
  const p = planOf(agent('a', 'idle'));
  const all = [...REST_SPOTS.map((r) => r.at), ...OVERFLOW_SPOTS];
  assert.ok(all.some((s) => s.x === p.spot.x && s.y === p.spot.y));
  assert.equal(p.pace, 'free');
  assert.equal(p.pose, 'sleep');
  assert.deepEqual(p.effects, ['zzz']);
});

test('퇴근은 입구로 나간다', () => {
  const p = planOf(agent('a', 'gone'));
  assert.deepEqual(p.spot, DOOR);
  assert.equal(p.leave, true);
  assert.equal(p.pace, 'free');
  assert.equal(p.pose, 'walk');
  assert.deepEqual(p.effects, []);
});

test('Codex 자리 0~2 = 개발실, 3 이상 = 로비', () => {
  const dev = planOf(agent('c', 'editing', { kind: 'codex', seat: 0 }));
  assert.deepEqual(dev.spot, devSpot(0));
  assert.equal(dev.facing, 'NE');
  const lobby = planOf(agent('c', 'editing', { kind: 'codex', seat: 3 }));
  assert.deepEqual(lobby.spot, waitingSpot(0));
});

test('로비 자리는 종류가 달라도 이어서', () => {
  const list = [
    agent('a', 'editing', { seat: -1 }),
    agent('b', 'editing', { kind: 'codex', seat: 3 }),
    agent('c', 'editing', { seat: -1 }),
  ];
  const m = direct(list, 0);
  assert.deepEqual(m.get('a')!.spot, waitingSpot(0));
  assert.deepEqual(m.get('b')!.spot, waitingSpot(1));
  assert.deepEqual(m.get('c')!.spot, waitingSpot(2));
});

test('도우미는 회의실 자리를 모두 이어서', () => {
  const sub = (id: string) => ({ id, type: null, since: 0 });
  const m = direct([
    agent('a', 'delegating', { seat: 0, subagents: [sub('s1'), sub('s2')] }),
    agent('b', 'delegating', { seat: 1, subagents: [sub('s3')] }),
  ], 0);
  ['a/s1', 'a/s2', 'b/s3'].forEach((k, i) => {
    const p = m.get(k)!;
    assert.deepEqual(p.spot, meetingSpot(i));
    assert.equal(p.pose, 'type-fast');
    assert.equal(p.isSub, true);
    assert.equal(p.agent, null);
    assert.equal(p.hat, 2);
  });
});

test('hashId: FNV-1a 표준값', () => {
  assert.equal(hashId('a'), 0xe40c292c);
});

test('restAssignments: 같은 입력이면 같은 출력, 3~6분마다 바뀜', () => {
  const id = 'solo-session';
  let prev = restAssignments([id], 0).get(id)!;
  const changes: number[] = [];
  for (let t = 1000; t <= 1_800_000; t += 1000) {
    const cur = restAssignments([id], t).get(id)!;
    if (cur.at.x !== prev.at.x || cur.at.y !== prev.at.y) changes.push(t);
    prev = cur;
  }
  assert.ok(changes.length >= 1);
  for (let i = 1; i < changes.length; i++) {
    const gap = changes[i] - changes[i - 1];
    assert.ok(gap >= 180_000 && gap <= 361_000, `gap ${gap}`);
  }
  assert.deepEqual(restAssignments([id], 777_000), restAssignments([id], 777_000));
});

test('restAssignments: 쉬는 사람끼리 안 겹침', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
  const m = restAssignments(ids, 123_456);
  assert.equal(m.size, 12);
  const keys = new Set([...m.values()].map((r) => `${r.at.x},${r.at.y}`));
  assert.equal(keys.size, 12);
});

test('restAssignments: 25명이어도 모두 다른 자리, 휴게실·탕비실 띠 안, 서로 0.3 이상', () => {
  const ids = Array.from({ length: 25 }, (_, i) => `r${i}`);
  const pts = [...restAssignments(ids, 99_000).values()].map((r) => r.at);
  assert.equal(pts.length, 25);
  pts.forEach((p, i) => {
    assert.ok(p.x > 4.4 && p.x <= 14.3 && p.y > 15 && p.y < 18, JSON.stringify(p));
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(p.x - pts[j].x, p.y - pts[j].y) >= 0.3, `${i}/${j}`);
  });
});

test('앉기(?seated): 사무실 책상의 여덟 모습, 실행·고침은 타이핑·읽기·생각류는 손 멈춤·끝남은 쉬기, 나머지는 서기', () => {
  const sitOf = (a: Agent, seated = true) => direct([a], 1_000_000, seated).get(a.id)!.sit;
  for (let seat = 0; seat < 8; seat++) {
    const p = direct([agent('a', 'running', { hat: 0, seat })], 1_000_000, true).get('a')!;
    assert.deepEqual(p.sit, { at: chairPosition(seat), dir: seatedDir(DESKS[seat].facing), mode: 'work' }, `seat ${seat}`);
    assert.deepEqual(p.spot, seatPosition(seat), '걸어가는 곳은 그대로 서는 자리');
  }
  assert.equal(sitOf(agent('a', 'editing', { hat: 0 }))?.mode, 'work');
  for (const s of ['reading', 'thinking', 'approving', 'delegating', 'compacting'] as const) assert.equal(sitOf(agent('a', s, { hat: 0 }))?.mode, 'upper', s);
  assert.deepEqual(sitOf(agent('a', 'done', { hat: 0, seat: 3 })), { at: chairPosition(3), dir: seatedDir(DESKS[3].facing), mode: 'rest' });
  for (const s of ['permission', 'question', 'stalled', 'quota', 'idle', 'gone'] as const) assert.equal(sitOf(agent('a', s, { hat: 0 })), null, s);
  assert.equal(sitOf(agent('a', 'running', { hat: 0 }), false), null, '미리 보기가 꺼져 있으면 서 있는다');
  for (let hat = 0; hat < 8; hat++) assert.equal(sitOf(agent('a', 'running', { hat }))?.mode, 'work', `hat ${hat}: 여덟 모습 모두 앉은 그림이 있다`);
  assert.equal(sitOf(agent('a', 'running', { hat: 8 }))?.mode, 'work', 'hat 8 = JP01');
  assert.equal(sitOf(agent('a', 'running', { hat: 0, seat: 8 })), null, '책상 없는 자리(로비)');
});

test('앉기(?seated) 개발실: Codex 0~2는 책상 의자에 등이 보이게(NE = NW 그림 뒤집기), 상태 규칙은 사무실과 같다', () => {
  const sitOf = (a: Agent, seated = true) => direct([a], 1_000_000, seated).get(a.id)!.sit;
  for (let seat = 0; seat < 3; seat++) {
    const p = direct([agent('c', 'running', { kind: 'codex', hat: 4, seat })], 1_000_000, true).get('c')!;
    assert.deepEqual(p.sit, { at: devChairPosition(seat), dir: 'NE', mode: 'work' }, `seat ${seat}`);
    assert.deepEqual(p.spot, devSpot(seat), '걸어가는 곳은 그대로 의자 뒤 길');
  }
  assert.equal(sitOf(agent('c', 'reading', { kind: 'codex', seat: 1 }))?.mode, 'upper');
  assert.deepEqual(sitOf(agent('c', 'done', { kind: 'codex', seat: 2 })), { at: devChairPosition(2), dir: 'NE', mode: 'rest' }, '끝남은 의자에서 쉬기');
  assert.equal(sitOf(agent('c', 'permission', { kind: 'codex', seat: 1 })), null, '손 흔드는 상태는 서 있다');
  assert.equal(sitOf(agent('c', 'running', { kind: 'codex', seat: 3 })), null, '개발실 책상은 셋뿐(그 밖은 로비)');
  assert.equal(sitOf(agent('c', 'running', { kind: 'codex', seat: 0 }), false), null, '미리 보기가 꺼져 있으면 서 있다');
});

test('앉기(?seated) 회의실: 도우미 1~6번째는 의자에 손 멈춤으로 — 테이블 너머 SW(얼굴)·이쪽 NE(등), 7번째부터 둘러섬', () => {
  const subs = Array.from({ length: 7 }, (_, k) => ({ id: 's' + k }) as never);
  const plans = direct([agent('a', 'running', { hat: 5, subagents: subs })], 1_000_000, true);
  for (let i = 0; i < 6; i++) {
    const p = plans.get('a/s' + i)!;
    assert.deepEqual(p.sit, { at: meetingChairPosition(i), dir: i < 3 ? 'SW' : 'NE', mode: 'upper' }, `도우미 ${i}`);
    assert.deepEqual(p.spot, meetingSpot(i), '걸어가는 곳은 그대로 의자 앞');
  }
  assert.equal(plans.get('a/s6')!.sit, null, '의자가 여섯뿐 — 7번째는 서 있다');
  assert.equal(direct([agent('a', 'running', { hat: 5, subagents: subs })], 1_000_000, false).get('a/s0')!.sit, null, '미리 보기가 꺼져 있으면 서 있다');
});
