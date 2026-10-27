import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardAnchor, floatSummary, initialFloatOpen, isNarrow, renderFloat, type FloatView } from '../../web/src/list/floatingList.ts';
import type { Agent, Health, Snapshot, Status } from '../../src/shared/types.ts';
import { FakeElement, fakeDocument } from './fakeDom.ts';
import { M } from '../helpers.ts';

const NOW = 100 * M;
const HEALTH: Health = { startedAt: 0, lastHookAt: null, registry: 'ok', sessions: 0, hookless: 0, lastCodexHookAt: null };
function agent(id: string, status: Status, since: number, extra: Partial<Agent> = {}): Agent {
  return { id, kind: 'claude', sessionId: id, title: null, cwd: '/x', project: '성수 LST', status, detail: null, since, lastEventAt: since, hat: 0, seat: 0, subagents: [], hookless: false, context: null, model: null, ...extra };
}
const snap = (agents: Agent[]): Snapshot => ({ now: NOW, usage: null, health: HEALTH, agents });
function view(): FloatView & { [k: string]: FakeElement } {
  const el = (tag: string) => new FakeElement(tag);
  return { root: el('div'), summary: el('span'), caret: el('span'), rows: el('div') } as unknown as FloatView & { [k: string]: FakeElement };
}
const fake = (e: unknown) => e as FakeElement;
const hiddenOf = (e: unknown) => (e as { hidden?: boolean }).hidden;
const ids = (rows: unknown) => fake(rows).children.map((c) => c.getAttribute('data-agent'));

test('접은 줄 요약: 승인·질문·일하는 중·끝남 개수만(0은 뺌, ❗·❓는 도트 글꼴 흑백 대신 그림 문자 \\uFE0F), 쉬는 세션만이면 "모두 쉬는 중", 없으면 "세션 없음"', () => {
  assert.equal(floatSummary([
    agent('p', 'permission', 0), agent('q', 'question', 0), agent('r', 'running', 0), agent('a', 'approving', 0),
    agent('d', 'done', 0), agent('i', 'idle', 0), agent('g', 'gone', 0),
  ]), '❗\uFE0F1 · ❓\uFE0F1 · ▶2 · ✅1');
  assert.equal(floatSummary([agent('r', 'thinking', 0)]), '▶1');
  assert.equal(floatSummary([agent('i', 'idle', 0), agent('q', 'quota', 0)]), '모두 쉬는 중');
  assert.equal(floatSummary([]), '세션 없음');
});

test('처음 펼침: 이 브라우저에 기억한 값이 먼저("1"·"0"), 없으면 좁은 화면만 접힘', () => {
  assert.equal(initialFloatOpen('1', true), true);
  assert.equal(initialFloatOpen('0', false), false);
  assert.equal(initialFloatOpen(null, false), true);
  assert.equal(initialFloatOpen(null, true), false);
  assert.equal(initialFloatOpen('x', false), true);
  assert.equal(isNarrow(1440, 900), false);
  assert.equal(isNarrow(390, 844), true);
  assert.equal(isNarrow(1280, 480), true);
});

test('펼치면 목록 보기와 같은 줄을 같은 순서로(기다리는 세션 먼저), 제목은 글자 그대로', () => {
  const v = view();
  renderFloat(v, snap([
    agent('w', 'editing', 10 * M),
    agent('p', 'permission', 90 * M, { title: '<script>alert(1)</script>' }),
    agent('d', 'done', 50 * M),
  ]), true, fakeDocument as unknown as Document);
  assert.deepEqual(ids(v.rows), ['p', 'd', 'w']);
  assert.equal(hiddenOf(v.rows), false);
  assert.ok(fake(v.rows).textContent.includes('<script>alert(1)</script>'));
  assert.equal(fake(v.root).className, 'float-list');
  assert.equal(fake(v.summary).textContent, '❗\uFE0F1 · ▶1 · ✅1');
  assert.equal(fake(v.caret).textContent, '▾');
});

test('접으면 줄은 그리지 않고 숨김, 요약만 — 다시 펴면 줄이 돌아옴', () => {
  const v = view();
  const s = snap([agent('q', 'question', 0), agent('r', 'running', 0)]);
  renderFloat(v, s, false, fakeDocument as unknown as Document);
  assert.equal(fake(v.root).className, 'float-list closed');
  assert.equal(hiddenOf(v.rows), true);
  assert.deepEqual(ids(v.rows), []);
  assert.equal(fake(v.summary).textContent, '❓\uFE0F1 · ▶1');
  assert.equal(fake(v.caret).textContent, '▸');
  renderFloat(v, s, true, fakeDocument as unknown as Document);
  assert.deepEqual(ids(v.rows), ['q', 'r']);
});

test('세션이 없으면 안내 한 줄', () => {
  const v = view();
  renderFloat(v, snap([]), true, fakeDocument as unknown as Document);
  assert.equal(fake(v.rows).textContent, '지금 열린 세션이 없어요');
});

test('줄을 누르면 여는 카드 자리: 작은 목록 왼쪽(카드 폭만큼 비켜), 줄 높이, 사무실 화면 기준 좌표', () => {
  // 사무실 화면이 (0,0)에서 시작, 줄이 x 1120·y 90 → 카드 왼쪽이 줄보다 16px 왼쪽에 끝나게
  assert.deepEqual(cardAnchor({ left: 1120, top: 90 }, { left: 0, top: 0 }), { x: 1120 - 264 - 32, y: 130 });
  assert.deepEqual(cardAnchor({ left: 1120, top: 90 }, { left: 20, top: 10 }), { x: 1100 - 264 - 32, y: 120 });
});
