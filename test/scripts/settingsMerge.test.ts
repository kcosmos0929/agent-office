import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeClaudeSettings, removeClaudeSettings, HOOK_EVENTS } from '../../scripts/lib/settingsMerge.ts';

const CMD = { hook: 'node "/Users/seop/.synthetic-office/bin/claude-hook.mjs"', statusline: 'node "/Users/seop/.synthetic-office/bin/statusline.mjs"' };
const PIXEL = { type: 'command', command: 'node "/Users/seop/.pixel-agents/hooks/claude-hook.js"', timeout: 5 };

function withPixel() {
  return {
    model: 'opus',
    enabledPlugins: { a: true },
    hooks: {
      PreToolUse: [{ matcher: '', hooks: [PIXEL] }],
      TeammateIdle: [{ matcher: '', hooks: [PIXEL] }],
    },
  };
}

test('Pixel Agents 훅과 다른 키를 보존하고 우리 훅만 추가', () => {
  const before = withPixel();
  const { settings, changed, conflict } = mergeClaudeSettings(before, CMD);
  assert.equal(changed, true);
  assert.equal(conflict, null);
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.enabledPlugins, { a: true });
  const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>>;
  assert.deepEqual(hooks.PreToolUse[0].hooks[0], PIXEL);
  assert.equal(hooks.PreToolUse[1].hooks[0].command, CMD.hook);
  assert.equal(hooks.PreToolUse[1].hooks[0].timeout, 5);
  assert.deepEqual(hooks.TeammateIdle, [{ matcher: '', hooks: [PIXEL] }]);
  for (const ev of HOOK_EVENTS) assert.ok(JSON.stringify(hooks[ev]).includes('/.synthetic-office/bin/'), ev);
  assert.deepEqual(settings.statusLine, { type: 'command', command: CMD.statusline });
  assert.equal((before.hooks.PreToolUse as unknown[]).length, 1, '원본은 바꾸지 않음');
});

test('두 번 설치해도 중복 없음(changed=false)', () => {
  const once = mergeClaudeSettings(withPixel(), CMD).settings;
  const twice = mergeClaudeSettings(once, CMD);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.settings, once);
});

test('다시 설치하면 우리 항목의 명령을 새 경로로 바꾸고 중복은 만들지 않음', () => {
  const old = mergeClaudeSettings(withPixel(), { hook: 'node "/old/.synthetic-office/bin/claude-hook.mjs"', statusline: 'node "/old/.synthetic-office/bin/statusline.mjs"' }).settings;
  const r = mergeClaudeSettings(old, CMD);
  assert.equal(r.changed, true);
  const hooks = r.settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  for (const ev of HOOK_EVENTS) {
    const ours = hooks[ev].flatMap((g) => g.hooks).filter((h) => h.command.includes('/.synthetic-office/bin/'));
    assert.deepEqual(ours.map((h) => h.command), [CMD.hook], ev);
  }
  assert.deepEqual(hooks.PreToolUse[0].hooks[0], PIXEL);
  assert.deepEqual(r.settings.statusLine, { type: 'command', command: CMD.statusline });
});

test('남의 statusLine이 있으면 conflict, settings 그대로', () => {
  const before = { ...withPixel(), statusLine: { type: 'command', command: '~/my-status.sh' } };
  const r = mergeClaudeSettings(before, CMD);
  assert.ok(r.conflict && r.conflict.includes('~/my-status.sh'));
  assert.equal(r.changed, false);
  assert.deepEqual(r.settings, before);
});

test('hooks 형식이 이상하면 conflict', () => {
  assert.ok(mergeClaudeSettings({ hooks: 'x' }, CMD).conflict);
  assert.ok(mergeClaudeSettings({ hooks: { Stop: 'x' } }, CMD).conflict);
});

test('remove는 우리 항목만 빼고 빈 이벤트 배열은 키째 삭제', () => {
  const installed = mergeClaudeSettings(withPixel(), CMD).settings;
  const mixed = structuredClone(installed) as { hooks: Record<string, Array<{ hooks: unknown[] }>> };
  mixed.hooks.Stop[0].hooks.push({ type: 'command', command: 'echo 남의 것' });
  const r = removeClaudeSettings(mixed);
  assert.equal(r.changed, true);
  const hooks = r.settings.hooks as Record<string, unknown>;
  assert.deepEqual(hooks.PreToolUse, [{ matcher: '', hooks: [PIXEL] }]);
  assert.deepEqual(hooks.TeammateIdle, [{ matcher: '', hooks: [PIXEL] }]);
  assert.deepEqual(hooks.Stop, [{ matcher: '', hooks: [{ type: 'command', command: 'echo 남의 것' }] }]);
  assert.equal('SessionStart' in hooks, false);
  assert.equal('statusLine' in r.settings, false);
  assert.equal(r.settings.model, 'opus');
  assert.equal(removeClaudeSettings(r.settings).changed, false);
});

test('remove: hooks가 전부 우리 것이면 hooks 키도 삭제, 남의 statusLine은 그대로', () => {
  const installed = mergeClaudeSettings({ model: 'x' }, CMD).settings;
  const r = removeClaudeSettings(installed);
  assert.deepEqual(r.settings, { model: 'x' });
  const other = removeClaudeSettings({ statusLine: { type: 'command', command: '~/my.sh' } });
  assert.equal(other.changed, false);
});

test('HOOK_EVENTS 14개: 기존 11개 설치본에 새 3개만 더함', () => {
  assert.equal(HOOK_EVENTS.length, 14);
  const added = ['PreCompact', 'PostCompact', 'StopFailure'];
  for (const ev of added) assert.ok((HOOK_EVENTS as readonly string[]).includes(ev), ev);
  const ours = { type: 'command', command: CMD.hook, timeout: 5 };
  const old = { hooks: Object.fromEntries(HOOK_EVENTS.filter((ev) => !added.includes(ev)).map((ev) => [ev, [{ matcher: '', hooks: [ours] }]])) };
  const r = mergeClaudeSettings(old, CMD);
  assert.equal(r.changed, true);
  const hooks = r.settings.hooks as Record<string, Array<{ hooks: unknown[] }>>;
  for (const ev of HOOK_EVENTS) assert.equal(hooks[ev].length, 1, ev);
  for (const ev of added) assert.deepEqual(hooks[ev][0].hooks, [ours]);
});
