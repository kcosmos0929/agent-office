import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortForBoard } from '../../src/shared/sort.ts';
import type { Agent, Status } from '../../src/shared/types.ts';

function agent(id: string, status: Status, since: number): Agent {
  return { id, kind: 'claude', sessionId: id, title: null, cwd: '/', project: 'x', status, detail: null, since, lastEventAt: since, hat: 0, seat: 0, subagents: [] };
}

test('sortForBoard: permission, done, working, stalled, idle, gone 순 + since 오래된 순', () => {
  const input = [
    agent('gone', 'gone', 1),
    agent('idle', 'idle', 1),
    agent('stalled', 'stalled', 1),
    agent('edit-late', 'editing', 50),
    agent('think-early', 'thinking', 10),
    agent('done', 'done', 5),
    agent('perm-late', 'permission', 40),
    agent('perm-early', 'permission', 20),
  ];
  assert.deepEqual(sortForBoard(input).map((a) => a.id), ['perm-early', 'perm-late', 'done', 'think-early', 'edit-late', 'stalled', 'idle', 'gone']);
  assert.equal(input[0].id, 'gone', '원본 배열은 그대로');
});

test('정렬: ❗·❓ → ✅ → 일함(🧹 포함) → 응답 없음 → ⏳ → 😴 → 👋', () => {
  const order: Status[] = ['gone', 'idle', 'quota', 'stalled', 'compacting', 'done', 'question', 'permission'];
  const input = order.map((s, i) => agent(s, s, i));
  assert.deepEqual(sortForBoard(input).map((a) => a.status), ['question', 'permission', 'done', 'compacting', 'stalled', 'quota', 'idle', 'gone']);
});
