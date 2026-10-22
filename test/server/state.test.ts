import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeState } from '../../src/server/state.ts';
import type { OfficeEvent } from '../../src/shared/types.ts';
import { M } from '../helpers.ts';

const CWD = '/Users/seop/developer/street-centrality-bus';

function make() {
  return new OfficeState({ idleMs: 30 * M, goneMs: 10 * M, stalledMs: 15 * M, resolveProject: (cwd) => (cwd === CWD ? '가로망 중심성' : 'x') });
}

type Ev = OfficeEvent;
const b = (sessionId: string, at: number, extra: Partial<Ev> = {}) => ({ sessionId, at, cwd: CWD, ...extra });
const ev = {
  start: (s: string, at: number): Ev => ({ ...b(s, at), type: 'session-start' }),
  prompt: (s: string, at: number): Ev => ({ ...b(s, at), type: 'prompt' }),
  tool: (s: string, at: number, id: string, activity: 'reading' | 'editing' | 'running' | 'delegating' = 'running', sub?: string): Ev =>
    ({ ...b(s, at), type: 'tool-start', toolUseId: id, activity, detail: `${activity} ${id}`, ...(sub ? { subagentId: sub } : {}) }),
  end: (s: string, at: number, id: string, sub?: string): Ev => ({ ...b(s, at), type: 'tool-end', toolUseId: id, ...(sub ? { subagentId: sub } : {}) }),
  perm: (s: string, at: number, sub?: string): Ev => ({ ...b(s, at), type: 'permission', detail: 'Bash: ls', ...(sub ? { subagentId: sub } : {}) }),
  stop: (s: string, at: number): Ev => ({ ...b(s, at), type: 'stop' }),
  end_: (s: string, at: number): Ev => ({ ...b(s, at), type: 'session-end' }),
  subStart: (s: string, at: number, id: string): Ev => ({ ...b(s, at), type: 'subagent-start', agentId: id, agentType: 'Explore' }),
  subStop: (s: string, at: number, id: string): Ev => ({ ...b(s, at), type: 'subagent-stop', agentId: id }),
};
const one = (st: OfficeState, now = 0) => st.snapshot(now).agents[0];

test('새 세션: done(새 세션), 프로젝트 이름표, 모자 0·자리 0', () => {
  const st = make();
  assert.equal(st.apply(ev.start('s1', 0)), true);
  const a = one(st);
  assert.equal(a.id, 'claude:s1');
  assert.equal(a.status, 'done');
  assert.equal(a.detail, '새 세션');
  assert.equal(a.project, '가로망 중심성');
  assert.equal(a.hat, 0);
  assert.equal(a.seat, 0);
});

test('권한 대기 중 병렬 도구 하나가 끝나도 permission 유지, 마지막 도구가 끝나면 thinking', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'A'));
  st.apply(ev.tool('s1', 2, 'B'));
  st.apply(ev.perm('s1', 3));
  assert.equal(one(st).status, 'permission');
  assert.equal(one(st).detail, 'Bash: ls');
  st.apply(ev.end('s1', 4, 'B'));
  assert.equal(one(st).status, 'permission');
  st.apply(ev.tool('s1', 5, 'C'));
  assert.equal(one(st).status, 'permission');
  st.apply(ev.end('s1', 6, 'C'));
  st.apply(ev.end('s1', 7, 'A'));
  assert.equal(one(st).status, 'thinking');
  assert.equal(one(st).detail, null);
});

test('session-start 중복(resume·compact)에도 에이전트 하나, 모자·자리·상태 그대로', () => {
  const st = make();
  st.apply(ev.start('s1', 0));
  st.apply(ev.start('s2', 1));
  st.apply(ev.prompt('s2', 2));
  st.apply(ev.tool('s2', 3, 'A', 'editing'));
  st.apply(ev.start('s2', 4));
  const agents = st.snapshot(5).agents;
  assert.equal(agents.length, 2);
  const s2 = agents.find((a) => a.sessionId === 's2')!;
  assert.equal(s2.hat, 1);
  assert.equal(s2.seat, 1);
  assert.equal(s2.status, 'editing');
});

test('시작 없는 tool-end와 서버 중간 기동: 예외 없이 thinking', () => {
  const st = make();
  assert.doesNotThrow(() => st.apply(ev.end('s9', 10, 'zz')));
  assert.equal(one(st).status, 'thinking');
});

test('done 30분 → idle', () => {
  const st = make();
  st.apply(ev.stop('s1', 0));
  assert.equal(st.tick(30 * M - 1), false);
  assert.equal(st.tick(30 * M), true);
  assert.equal(one(st).status, 'idle');
  assert.equal(one(st).since, 30 * M);
});

test('thinking 15분 → stalled, 새 이벤트가 오면 다시 일함', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.tick(15 * M);
  assert.equal(one(st).status, 'stalled');
  st.apply(ev.tool('s1', 16 * M, 'A', 'reading'));
  assert.equal(one(st).status, 'reading');
});

test('running은 2시간이 지나도 running', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'A'));
  st.tick(120 * M);
  assert.equal(one(st).status, 'running');
});

test('gone 10분 뒤 제거되고 모자 0이 다음 세션에 재사용', () => {
  const st = make();
  st.apply(ev.start('s1', 0));
  st.apply(ev.start('s2', 0));
  st.apply(ev.end_('s1', 1 * M));
  assert.equal(st.snapshot(1 * M).agents.find((a) => a.sessionId === 's1')!.status, 'gone');
  st.tick(11 * M - 1);
  assert.equal(st.snapshot(0).agents.length, 2);
  assert.equal(st.tick(11 * M), true);
  assert.equal(st.snapshot(0).agents.length, 1);
  st.apply(ev.start('s3', 12 * M));
  const s3 = st.snapshot(0).agents.find((a) => a.sessionId === 's3')!;
  assert.equal(s3.hat, 0);
  assert.equal(s3.seat, 0);
});

test('모자·자리가 8개를 넘으면 모자는 개수 % 8, 자리는 -1', () => {
  const st = make();
  for (let i = 0; i < 9; i++) st.apply(ev.start(`s${i}`, i));
  const ninth = st.snapshot(0).agents.find((a) => a.sessionId === 's8')!;
  assert.equal(ninth.hat, 0);
  assert.equal(ninth.seat, -1);
});

test('하위 에이전트의 tool-start는 부모 상태를 안 바꾸고, 하위 에이전트의 permission은 부모를 permission으로', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'AG', 'delegating'));
  st.apply(ev.subStart('s1', 2, 'a1'));
  assert.deepEqual(one(st).subagents.map((x) => x.id), ['a1']);
  st.apply(ev.tool('s1', 3, 'X', 'editing', 'a1'));
  assert.equal(one(st).status, 'delegating');
  st.apply(ev.perm('s1', 4, 'a1'));
  assert.equal(one(st).status, 'permission');
  st.apply(ev.end('s1', 5, 'X', 'a1'));
  assert.equal(one(st).status, 'delegating');
  st.apply(ev.subStop('s1', 6, 'a1'));
  assert.deepEqual(one(st).subagents, []);
});

test('reading→editing 전환 때 since 유지, thinking→done 때 since 갱신', () => {
  const st = make();
  st.apply(ev.prompt('s1', 100));
  st.apply(ev.tool('s1', 200, 'A', 'reading'));
  st.apply(ev.end('s1', 300, 'A'));
  st.apply(ev.tool('s1', 400, 'B', 'editing'));
  assert.equal(one(st).since, 100);
  st.apply(ev.stop('s1', 500));
  assert.equal(one(st).status, 'done');
  assert.equal(one(st).since, 500);
});

test('stop 뒤의 늦은 tool-end는 무시', () => {
  const st = make();
  st.apply(ev.stop('s1', 0));
  st.apply(ev.end('s1', 1, 'late'));
  assert.equal(one(st).status, 'done');
});

test('퇴근 뒤 다시 열면(session-start) done으로 살아남', () => {
  const st = make();
  st.apply(ev.start('s1', 0));
  st.apply(ev.end_('s1', 1));
  st.apply(ev.start('s1', 2));
  assert.equal(one(st).status, 'done');
});

test('제목: 이벤트의 title이 반영되고, 제목 없고 기록 경로를 알면 needsTitle이 그 경로', () => {
  const st = make();
  st.apply({ ...ev.start('s1', 0), transcriptPath: '/tmp/t.jsonl' });
  assert.equal(st.needsTitle('s1'), '/tmp/t.jsonl');
  st.apply({ ...b('s1', 1), type: 'title', title: '정류장 승하차 결합' });
  assert.equal(one(st).title, '정류장 승하차 결합');
  assert.equal(st.needsTitle('s1'), null);
  st.apply({ ...ev.prompt('s1', 2), title: '새 제목' });
  assert.equal(one(st).title, '새 제목');
  assert.equal(st.needsTitle('nope'), null);
});

test('setUsage: 바뀌면 true, 같으면 false', () => {
  const st = make();
  const u = { fiveHour: { pct: 62, resetsAt: 100 }, sevenDay: null, at: 1 };
  assert.equal(st.setUsage(u), true);
  assert.equal(st.setUsage({ ...u }), false);
  assert.deepEqual(st.snapshot(5).usage, u);
  assert.equal(st.snapshot(5).now, 5);
});
