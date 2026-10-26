import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, Status } from '../../src/shared/types.ts';
import { direct, frontOf, hashId, restAssignments } from '../../web/src/office/director.ts';
import { DOOR, OVERFLOW_SPOTS, REST_SPOTS, devSpot, facingAt, meetingSpot, seatPosition, waitingSpot } from '../../web/src/office/layout.ts';
import { dirFor } from '../../web/src/office/sprites/look.ts';

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
