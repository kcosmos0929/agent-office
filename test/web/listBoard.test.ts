import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderList } from '../../web/src/list/listBoard.ts';
import type { Agent, Health, Snapshot, Status } from '../../src/shared/types.ts';
import { FakeElement, fakeDocument } from './fakeDom.ts';
import { M } from '../helpers.ts';

const NOW = 100 * M;
function agent(id: string, status: Status, since: number, extra: Partial<Agent> = {}): Agent {
  return { id, kind: 'claude', sessionId: id, title: null, cwd: '/x', project: '성수 LST', status, detail: 'analysis.py', since, lastEventAt: since, hat: 0, seat: 0, subagents: [], hookless: false, context: null, ...extra };
}
const HEALTH: Health = { startedAt: 0, lastHookAt: null, registry: 'ok', sessions: 0, hookless: 0 };
function render(input: Omit<Snapshot, 'health'> & { health?: Health }): FakeElement {
  const snap: Snapshot = { health: HEALTH, ...input };
  const root = new FakeElement('div');
  renderList(root as unknown as HTMLElement, snap, fakeDocument as unknown as Document);
  return root;
}

test('renderList: <script> 제목이 글자로 들어가고 순서는 sortForBoard', () => {
  const root = render({ now: NOW, usage: null, agents: [
    agent('w', 'editing', 10 * M),
    agent('p', 'permission', 90 * M, { title: '<script>alert(1)</script>', hat: 1 }),
    agent('d', 'done', 50 * M),
  ] });
  const rows = root.byClass('row');
  assert.deepEqual(rows.map((r) => r.getAttribute('data-agent')), ['p', 'd', 'w']);
  assert.ok(root.all().every((e) => e.tagName !== 'script'));
  assert.equal(rows[0].byClass('name')[0].textContent, '<script>alert(1)</script>');
  assert.equal(rows[0].byClass('state')[0].textContent, '❗\uFE0F 승인 필요');
  assert.equal(rows[0].byClass('time')[0].textContent, '10분째');
  assert.ok(rows[0].className.includes('urgent'));
  assert.ok(rows[1].className.includes('waiting'));
  assert.equal(rows[2].byClass('name')[0].textContent, 'Claude · 세션 1');
  assert.equal(rows[2].byClass('chip')[0].textContent, '성수 LST');
  assert.equal(rows[2].byClass('detail')[0].textContent, 'analysis.py');
});

test('위 띠 배지: 기다리는 중 = permission + done, permission 있으면 urgent', () => {
  const urgent = render({ now: NOW, usage: null, agents: [agent('p', 'permission', 0), agent('d', 'done', 0), agent('w', 'running', 0)] });
  const badge = urgent.byClass('badge')[0];
  assert.equal(badge.textContent, '기다리는 중 2');
  assert.ok(badge.className.includes('urgent'));
  const calm = render({ now: NOW, usage: null, agents: [agent('d', 'done', 0)] });
  assert.ok(!calm.byClass('badge')[0].className.includes('urgent'));
  const none = render({ now: NOW, usage: null, agents: [agent('w', 'running', 0)] });
  assert.equal(none.byClass('badge').length, 0);
});

test('아래 사용량 띠: 값이 있으면 % · 리셋, 없으면 —', () => {
  const resets = NOW / 1000 + 3 * 3600 + 12 * 60;
  const withUsage = render({ now: NOW, agents: [], usage: { fiveHour: { pct: 62.4, resetsAt: resets }, sevenDay: null, at: NOW } });
  assert.equal(withUsage.byClass('usage-pct')[0].textContent, '사용량 62%');
  assert.equal(withUsage.byClass('usage-reset')[0].textContent, '리셋 3:12');
  assert.equal(withUsage.byClass('fill')[0].getAttribute('style'), 'width:62%');
  const empty = render({ now: NOW, agents: [], usage: null });
  assert.equal(empty.byClass('usage-pct')[0].textContent, '사용량 —');
});

test('에이전트가 없으면 안내 문구', () => {
  const root = render({ now: NOW, agents: [], usage: null });
  assert.equal(root.byClass('empty')[0].textContent, '지금 열린 세션이 없어요');
});
