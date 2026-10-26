import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_HOOK_EVENTS, mergeCodexHooks, removeCodexHooks } from '../../scripts/lib/codexHooksMerge.ts';

const CMD = '"/opt/homebrew/bin/node" "/Users/seop/.synthetic-office/bin/claude-hook.mjs" codex';
type Groups = Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout: number }> }>>;
const OTHER = { type: 'command', command: 'python3 ~/.codex/hooks/audit.py', timeout: 10 };

test('빈 파일에 12개 사건(이 순서), Interrupt·SessionEnd 타임아웃 3(Codex 최대값)·나머지 5', () => {
  const r = mergeCodexHooks({}, CMD);
  assert.equal(r.changed, true);
  assert.equal(r.conflict, null);
  const hooks = r.next.hooks as Groups;
  assert.deepEqual(Object.keys(hooks), [...CODEX_HOOK_EVENTS]);
  assert.equal(CODEX_HOOK_EVENTS.length, 12);
  assert.deepEqual(hooks.Interrupt[0].hooks[0], { type: 'command', command: CMD, timeout: 3 });
  assert.deepEqual(hooks.SessionEnd[0].hooks[0], { type: 'command', command: CMD, timeout: 3 });
  assert.deepEqual(hooks.Stop[0].hooks[0], { type: 'command', command: CMD, timeout: 5 });
});

test('남의 훅·description 보존, 다시 넣어도 중복 없음(changed false), node 경로가 바뀌면 명령만 갱신', () => {
  const before = { description: '내 훅', hooks: { Stop: [{ hooks: [OTHER] }], PreToolUse: [{ matcher: 'Bash', hooks: [OTHER] }] } };
  const once = mergeCodexHooks(before, CMD);
  const hooks = once.next.hooks as Groups;
  assert.equal(once.next.description, '내 훅');
  assert.deepEqual(hooks.Stop[0], { hooks: [OTHER] });
  assert.equal(hooks.Stop.length, 2);
  assert.deepEqual(before.hooks.Stop, [{ hooks: [OTHER] }], '원본은 그대로');
  assert.equal(mergeCodexHooks(once.next, CMD).changed, false);
  const moved = mergeCodexHooks(once.next, CMD.replace('/opt/homebrew/bin/node', '/usr/local/bin/node'));
  assert.equal(moved.changed, true);
  assert.equal(((moved.next.hooks as Groups).Stop[1]).hooks[0].command.startsWith('"/usr/local/bin/node"'), true);
});

test('hooks가 객체가 아니거나 사건 값이 배열이 아니면 conflict, 파일 그대로', () => {
  assert.notEqual(mergeCodexHooks({ hooks: [] }, CMD).conflict, null);
  assert.notEqual(mergeCodexHooks({ hooks: { Stop: 'x' } }, CMD).conflict, null);
  assert.equal(mergeCodexHooks({ hooks: { Stop: 'x' } }, CMD).changed, false);
});

test('remove: 우리 것만 빼고, 다 빠지면 {}', () => {
  const mine = mergeCodexHooks({}, CMD).next;
  const r = removeCodexHooks(mine);
  assert.deepEqual([r.changed, r.next], [true, {}]);
  const mixed = mergeCodexHooks({ description: 'x', hooks: { Stop: [{ hooks: [OTHER] }] } }, CMD).next;
  const r2 = removeCodexHooks(mixed);
  assert.equal(r2.changed, true);
  assert.deepEqual(r2.next, { description: 'x', hooks: { Stop: [{ hooks: [OTHER] }] } });
  assert.deepEqual(removeCodexHooks({}).changed, false);
});
