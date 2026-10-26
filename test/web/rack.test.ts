import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, Status } from '../../src/shared/types.ts';
import { BEAT_MS, beat, rackLevels, rackStates } from '../../web/src/office/rack.ts';

function agent(id: string, status: Status, extra: Partial<Agent> = {}): Agent {
  return {
    id, kind: 'codex', sessionId: id, title: null, cwd: '/x', project: 'p', status, detail: null,
    since: 0, lastEventAt: 0, hat: 2, seat: 0, subagents: [], hookless: false, context: null, model: null, ...extra,
  };
}

test('beat: 125ms마다 한 박자', () => {
  assert.equal(BEAT_MS, 125);
  assert.equal(beat(0), 0);
  assert.equal(beat(124), 0);
  assert.equal(beat(125), 1);
  assert.equal(beat(1000), 8);
});

test('rackLevels running: 같은 박자 안에선 같고, 박자가 바뀌면 달라지는 때가 있다', () => {
  assert.deepEqual(rackLevels('running', 1, 1000), rackLevels('running', 1, 1100));
  let changed = false;
  for (let b = 0; b < 16; b++) {
    const a = rackLevels('running', 1, b * BEAT_MS), c = rackLevels('running', 1, (b + 1) * BEAT_MS);
    if (a.some((v, i) => v !== c[i])) changed = true;
  }
  assert.ok(changed);
});

test('rackLevels running: 불 값은 1.0 또는 0.25, 넷이 모두 같지 않은 박자가 있다', () => {
  let mixed = false;
  for (let b = 0; b < 32; b++) {
    const lv = rackLevels('running', 0, b * BEAT_MS);
    assert.equal(lv.length, 4);
    for (const v of lv) assert.ok(v === 1 || v === 0.25);
    if (new Set(lv).size > 1) mixed = true;
  }
  assert.ok(mixed);
});

test('rackLevels idle: 1초마다 0.35 ↔ 0.6, 넷이 같다', () => {
  assert.deepEqual(rackLevels('idle', 0, 0), [0.35, 0.35, 0.35, 0.35]);
  assert.deepEqual(rackLevels('idle', 0, 999), [0.35, 0.35, 0.35, 0.35]);
  assert.deepEqual(rackLevels('idle', 0, 1000), [0.6, 0.6, 0.6, 0.6]);
  assert.deepEqual(rackLevels('idle', 0, 1999), [0.6, 0.6, 0.6, 0.6]);
  assert.deepEqual(rackLevels('idle', 0, 2000), [0.35, 0.35, 0.35, 0.35]);
});

test('rackLevels empty: 0.15로 어둡다', () => {
  assert.deepEqual(rackLevels('empty', 2, 12345), [0.15, 0.15, 0.15, 0.15]);
});

test('rackStates: Codex 자리 1이 running, Claude 자리 0은 영향 없음', () => {
  const s = rackStates([agent('c1', 'running', { seat: 1 }), agent('cl0', 'running', { kind: 'claude', seat: 0 })]);
  assert.deepEqual(s, ['empty', 'running', 'empty']);
});

test('rackStates: 앉아 있되 실행 중이 아니면 idle, gone은 빈 자리, 범위 밖 자리는 무시', () => {
  const s = rackStates([agent('a', 'reading', { seat: 0 }), agent('b', 'gone', { seat: 1 }), agent('c', 'running', { seat: 3 })]);
  assert.deepEqual(s, ['idle', 'empty', 'empty']);
});

test('buildRacks: 랙 3개 × 불 4개, 재질이 모두 따로다(불마다 따로 깜박이려고)', async () => {
  const THREE = await import('three');
  const { buildRacks, paintRacks } = await import('../../web/src/office/rack.ts');
  const mats = buildRacks(new THREE.Group());
  assert.equal(mats.length, 3);
  assert.ok(mats.every((r) => r.length === 4));
  assert.equal(new Set(mats.flat()).size, 12);
  paintRacks(mats, ['running', 'idle', 'empty'], 0);
  assert.equal(mats[1][0].emissiveIntensity, 0.35);
  assert.equal(mats[2][3].emissiveIntensity, 0.15);
});
