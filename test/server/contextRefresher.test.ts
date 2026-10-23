import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeContextRefresher } from '../../src/server/contextRefresher.ts';
import { OfficeState } from '../../src/server/state.ts';
import type { ContextReading } from '../../src/server/collectors/contextUsage.ts';
import { M } from '../helpers.ts';

const flush = () => new Promise((r) => setImmediate(r));
function stateWith(transcriptPath: string) {
  const st = new OfficeState({ idleMs: 30 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, resolveProject: () => 'x', startedAt: 0, registryWaitRule: false });
  st.apply({ type: 'prompt', sessionId: 's1', at: 0, cwd: '/x', transcriptPath });
  return st;
}

test('refresher: 5초 안 두 번 → 즉시 1번 + 5초 뒤 1번, force는 즉시, 경로 없으면 안 읽음', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  let changes = 0;
  const reads: string[] = [];
  const st = stateWith('/t/a.jsonl');
  const refresh = makeContextRefresher({
    state: st, now: () => clock, onChange: () => changes++,
    read: async (f): Promise<ContextReading> => { reads.push(f); return { state: 'ok', used: 100 + reads.length, model: 'claude-opus-5-5' }; },
  });
  refresh('s1');
  await flush();
  assert.deepEqual(reads, ['/t/a.jsonl']);
  assert.equal(changes, 1);
  clock = 2000;
  refresh('s1');
  await flush();
  assert.equal(reads.length, 1);
  clock = 5000;
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(reads.length, 2);
  clock = 6000;
  refresh('s1', true);
  await flush();
  assert.equal(reads.length, 3);
  refresh('nope');
  await flush();
  assert.equal(reads.length, 3);
  assert.equal(st.snapshot(0).agents[0].context?.state, 'ok');
});

test('refresher: 읽기가 실패해도 예외 없이 그대로', async () => {
  const st = stateWith('/t/a.jsonl');
  let changes = 0;
  const refresh = makeContextRefresher({ state: st, onChange: () => changes++, read: async () => { throw new Error('EACCES'); } });
  refresh('s1');
  await flush();
  assert.equal(changes, 0);
  assert.equal(st.snapshot(0).agents[0].context, null);
});
