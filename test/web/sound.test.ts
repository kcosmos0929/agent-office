import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundEvents } from '../../web/src/sound.ts';
import type { Agent, Snapshot, Status } from '../../src/shared/types.ts';

const agent = (id: string, status: Status) => ({ id, status }) as Agent;
const snap = (...agents: Agent[]): Snapshot => ({ agents, usage: null, now: 0, health: { startedAt: 0, lastHookAt: null, registry: 'ok', sessions: 0, hookless: 0, lastCodexHookAt: null } });

test('soundEvents: 새로 permission이면 urgent, 새로 done이면 soft', () => {
  assert.deepEqual(soundEvents(snap(agent('a', 'running')), snap(agent('a', 'permission'))), ['urgent']);
  assert.deepEqual(soundEvents(snap(agent('a', 'running')), snap(agent('a', 'done'))), ['soft']);
  assert.deepEqual(soundEvents(snap(agent('a', 'running'), agent('b', 'thinking')), snap(agent('a', 'permission'), agent('b', 'permission'))), ['urgent', 'urgent']);
});

test('soundEvents: 이미 permission이던 건 다시 안 울림, 첫 스냅샷도 안 울림', () => {
  assert.deepEqual(soundEvents(snap(agent('a', 'permission')), snap(agent('a', 'permission'))), []);
  assert.deepEqual(soundEvents(null, snap(agent('a', 'permission'))), []);
});

test('soundEvents: 새로 나타난 세션이 바로 done(새 세션)이면 안 울림, 바로 permission이면 울림', () => {
  assert.deepEqual(soundEvents(snap(), snap(agent('n', 'done'))), []);
  assert.deepEqual(soundEvents(snap(), snap(agent('n', 'permission'))), ['urgent']);
});

test('soundEvents: ❓도 urgent, ❗↔❓는 다시 안 울림, ⏳·🧹는 조용히', () => {
  assert.deepEqual(soundEvents(snap(agent('a', 'running')), snap(agent('a', 'question'))), ['urgent']);
  assert.deepEqual(soundEvents(snap(agent('a', 'permission')), snap(agent('a', 'question'))), []);
  assert.deepEqual(soundEvents(snap(agent('a', 'question')), snap(agent('a', 'permission'))), []);
  assert.deepEqual(soundEvents(snap(agent('a', 'running')), snap(agent('a', 'quota'))), []);
  assert.deepEqual(soundEvents(snap(agent('a', 'running')), snap(agent('a', 'compacting'))), []);
});

test('soundEvents: 🛡️ 승인 확인 중은 조용, 5초 뒤 ❗가 될 때 울림', () => {
  assert.deepEqual(soundEvents(snap(agent('a', 'running')), snap(agent('a', 'approving'))), []);
  assert.deepEqual(soundEvents(snap(agent('a', 'approving')), snap(agent('a', 'permission'))), ['urgent']);
});
