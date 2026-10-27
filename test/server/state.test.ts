import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeState } from '../../src/server/state.ts';
import type { OfficeEvent } from '../../src/shared/types.ts';
import type { RegistryEntry, RegistryRead } from '../../src/server/collectors/sessionRegistry.ts';
import { M } from '../helpers.ts';

const CWD = '/Users/seop/developer/street-centrality-bus';

function make(o: { startedAt?: number; rule?: boolean; rest?: number; leave?: number } = {}) {
  return new OfficeState({
    restMs: o.rest ?? 30 * M, leaveMs: o.leave ?? 120 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, resolveProject: (cwd) => (cwd === CWD ? '가로망 중심성' : 'x'),
    startedAt: o.startedAt ?? 0, registryWaitRule: o.rule ?? false,
  });
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
  question: (s: string, at: number, sub?: string): Ev => ({ ...b(s, at), type: 'question', detail: null, ...(sub ? { subagentId: sub } : {}) }),
  compactStart: (s: string, at: number, trigger: 'manual' | 'auto'): Ev => ({ ...b(s, at), type: 'compact-start', trigger }),
  compactEnd: (s: string, at: number, trigger: 'manual' | 'auto'): Ev => ({ ...b(s, at), type: 'compact-end', trigger }),
  quota: (s: string, at: number): Ev => ({ ...b(s, at), type: 'quota-wait' }),
  resume: (s: string, at: number): Ev => ({ ...b(s, at), type: 'resume' }),
  wrapUp: (s: string, at: number, asks = true): Ev => ({ ...b(s, at), type: 'wrap-up', asks }),
  idle: (s: string, at: number): Ev => ({ ...b(s, at), type: 'idle' }),
  stopErr: (s: string, at: number, error: string): Ev => ({ ...b(s, at), type: 'stop', error }),
};
const one = (st: OfficeState, now = 0) => st.snapshot(now).agents[0];

test('새 세션: 시작 신호만으론 안 보이고(열기만 한 세션), 첫 메시지부터 💭 · 프로젝트 이름표, 모자 0·자리 0', () => {
  const st = make();
  st.apply(ev.start('s1', 0));
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.prompt('s1', 1));
  const a = one(st);
  assert.equal(a.id, 'claude:s1');
  assert.equal(a.status, 'thinking');
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
  st.apply(ev.prompt('s1', 0));
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
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.prompt('s2', 0));
  st.apply(ev.end_('s1', 1 * M));
  assert.equal(st.snapshot(1 * M).agents.find((a) => a.sessionId === 's1')!.status, 'gone');
  st.tick(11 * M - 1);
  assert.equal(st.snapshot(0).agents.length, 2);
  assert.equal(st.tick(11 * M), true);
  assert.equal(st.snapshot(0).agents.length, 1);
  st.apply(ev.prompt('s3', 12 * M));
  const s3 = st.snapshot(0).agents.find((a) => a.sessionId === 's3')!;
  assert.equal(s3.hat, 0);
  assert.equal(s3.seat, 0);
});

test('모자·자리가 8개를 넘으면 모자는 개수 % 8, 자리는 -1', () => {
  const st = make();
  for (let i = 0; i < 9; i++) st.apply(ev.prompt(`s${i}`, i));
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

test('퇴근 뒤 다시 열기만 하면(session-start) 안 보이고, 메시지를 보내면 다시 보임', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.end_('s1', 1));
  assert.equal(one(st).status, 'gone');
  st.apply(ev.start('s1', 2));
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.prompt('s1', 3));
  assert.equal(one(st).status, 'thinking');
});

test('제목: 이벤트의 title이 반영되고, 제목 없고 기록 경로를 알면 needsTitle이 그 경로', () => {
  const st = make();
  st.apply({ ...ev.prompt('s1', 0), transcriptPath: '/tmp/t.jsonl' });
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

test('idle(입력 기다림 알림): 일하던 중·응답 없음이면 done, 승인 대기·done은 그대로', () => {
  const idle = (s: string, at: number): Ev => ({ ...b(s, at), type: 'idle' });
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'A', 'editing'));
  st.apply(idle('s1', 2));
  assert.equal(one(st).status, 'done');
  assert.equal(one(st).since, 2);
  st.apply(ev.prompt('s1', 3));
  st.tick(3 + 15 * M);
  assert.equal(one(st).status, 'stalled');
  st.apply(idle('s1', 4 + 15 * M));
  assert.equal(one(st).status, 'done');
  st.apply(ev.prompt('s1', 5 + 15 * M));
  st.apply(ev.perm('s1', 6 + 15 * M));
  st.apply(idle('s1', 7 + 15 * M));
  assert.equal(one(st).status, 'permission');
});

test('12시간 동안 아무 신호가 없으면(닫혔는데 종료 신호가 없던 세션) 상태와 상관없이 정리하고 자리를 비움', () => {
  const st = make();
  st.apply(ev.stop('s1', 0));
  st.apply(ev.prompt('s2', 0));
  st.apply(ev.perm('s2', 0));
  st.apply(ev.prompt('s3', 6 * 60 * M));
  st.tick(12 * 60 * M - 1);
  assert.equal(st.snapshot(0).agents.length, 3);
  assert.equal(st.tick(12 * 60 * M), true);
  assert.deepEqual(st.snapshot(0).agents.map((a) => a.sessionId), ['s3']);
  st.apply(ev.prompt('s4', 12 * 60 * M + 1));
  assert.equal(st.snapshot(0).agents.find((a) => a.sessionId === 's4')!.hat, 0);
});

test('하위 에이전트 A·B가 동시에 승인을 기다리다 B가 먼저 끝나도 A가 남아 있으면 permission 유지', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'AG', 'delegating'));
  st.apply(ev.subStart('s1', 2, 'a'));
  st.apply(ev.subStart('s1', 3, 'b'));
  st.apply(ev.tool('s1', 4, 'XA', 'running', 'a'));
  st.apply(ev.perm('s1', 5, 'a'));
  st.apply(ev.tool('s1', 6, 'XB', 'running', 'b'));
  st.apply(ev.perm('s1', 7, 'b'));
  st.apply(ev.end('s1', 8, 'XB', 'b'));
  assert.equal(one(st).status, 'permission', 'A는 아직 기다리는 중');
  st.apply(ev.subStop('s1', 9, 'b'));
  assert.equal(one(st).status, 'permission');
  st.apply(ev.end('s1', 10, 'XA', 'a'));
  assert.equal(one(st).status, 'delegating', '모든 대기가 풀리면 도우미 작업 중으로');
});

test('메인 승인 대기 중에 하위 에이전트 승인이 오고 먼저 풀려도 메인 대기는 유지', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'AG', 'delegating'));
  st.apply(ev.subStart('s1', 2, 'a'));
  st.apply(ev.tool('s1', 3, 'M', 'running'));
  st.apply(ev.perm('s1', 4));
  st.apply(ev.tool('s1', 5, 'XA', 'running', 'a'));
  st.apply(ev.perm('s1', 6, 'a'));
  st.apply(ev.end('s1', 7, 'XA', 'a'));
  assert.equal(one(st).status, 'permission', '메인 도구 승인은 아직');
  st.apply(ev.end('s1', 8, 'M'));
  st.apply(ev.subStop('s1', 9, 'a')); // 실제 순서: 도우미가 끝나면 SubagentStop이 Agent 도구 끝보다 먼저 온다
  st.apply(ev.end('s1', 10, 'AG'));
  assert.equal(one(st).status, 'thinking');
});

test('질문: AskUserQuestion 도구 + question → ❓, 그 도구가 끝나면 💭', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'q1'));
  st.apply(ev.question('s1', 1));
  assert.equal(one(st).status, 'question');
  st.apply(ev.end('s1', 5, 'q1'));
  assert.equal(one(st).status, 'thinking');
});

test('다음 할 일 상자 질문: 차례 중엔 그대로, 차례가 끝나면 ✅ 대신 ❓(30분 지나도·입력 대기 알림에도 유지), 다음 메시지면 💭', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'w1'));
  st.apply(ev.end('s1', 2, 'w1'));
  st.apply(ev.wrapUp('s1', 2));
  assert.equal(one(st).status, 'thinking');
  st.apply(ev.stop('s1', 3));
  assert.equal(one(st).status, 'question');
  assert.equal(one(st).detail, null);
  st.apply(ev.idle('s1', 60_000));
  st.tick(31 * M);
  assert.equal(one(st, 31 * M).status, 'question');
  st.apply(ev.prompt('s1', 40 * M));
  assert.equal(one(st).status, 'thinking');
  st.apply(ev.stop('s1', 41 * M));
  assert.equal(one(st).status, 'done'); // 질문 없는 다음 차례는 ✅
});

test('다음 할 일 상자 질문: 오류로 멈추면 ✅ + 오류가 먼저, 도우미가 아직 일해도 ❓가 먼저', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.wrapUp('s1', 1));
  st.apply(ev.stopErr('s1', 2, 'overloaded'));
  assert.equal(one(st).status, 'done');
  assert.equal(one(st).detail, '오류: overloaded');

  st.apply(ev.prompt('s2', 10));
  st.apply(ev.subStart('s2', 11, 'a'));
  st.apply(ev.wrapUp('s2', 12));
  st.apply(ev.stop('s2', 13));
  assert.equal(st.snapshot(13).agents.find((x) => x.id === 'claude:s2')?.status, 'question');
});

test('다음 할 일 상자 질문: 차례 끝 뒤 등록부가 쉼(idle)으로 바뀌어도 ❓ 유지, 도우미 질문이 풀려도 ❓로', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.wrapUp('s1', 1));
  st.apply(ev.stop('s1', 2));
  st.applyRegistry(read(reg('s1', 'idle', 5)), 6);
  assert.equal(one(st).status, 'question');

  // 도우미가 질문하는 사이 메인 차례가 상자 질문으로 끝남 → 도우미 질문이 풀려도 ✅가 아니라 ❓
  st.apply(ev.prompt('s1', 10));
  st.apply(ev.subStart('s1', 11, 'a'));
  st.apply(ev.tool('s1', 12, 'x', 'running', 'a'));
  st.apply(ev.question('s1', 12, 'a'));
  st.apply(ev.wrapUp('s1', 13));
  st.apply(ev.stop('s1', 14));
  st.apply(ev.end('s1', 15, 'x', 'a'));
  assert.equal(one(st).status, 'question');
});

test('다음 할 일 상자 질문: 도우미 승인 대기를 등록부(R1)로 풀어도, 그 도우미가 끝나 등록부가 쉼이 돼도 ❓ (리뷰 P2)', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.subStart('s1', 1, 'a'));
  st.apply(ev.tool('s1', 2, 'x', 'running', 'a'));
  st.apply(ev.perm('s1', 3, 'a'));
  st.apply(ev.wrapUp('s1', 4));
  st.apply(ev.stop('s1', 5));
  assert.equal(one(st).status, 'permission');
  st.applyRegistry(read(reg('s1', 'busy', 10)), 11); // 도우미 승인 → 등록부 일함
  assert.equal(one(st).status, 'question');
  st.apply(ev.subStop('s1', 20, 'a'));
  st.applyRegistry(read(reg('s1', 'idle', 30)), 31);
  assert.equal(one(st).status, 'question');
});

test('다음 할 일 상자 질문: Stop보다 등록부 쉼(R6)·입력 대기 알림이 먼저 와도 ❓, 늦은 Stop에도 ❓ (리뷰 P2)', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'w1'));
  st.apply(ev.end('s1', 2, 'w1'));
  st.apply(ev.wrapUp('s1', 2));
  st.applyRegistry(read(reg('s1', 'idle', 5)), 6);
  assert.equal(one(st).status, 'question');
  st.apply(ev.stop('s1', 7));
  assert.equal(one(st).status, 'question');

  st.apply(ev.prompt('s2', 10));
  st.apply(ev.wrapUp('s2', 11));
  st.apply(ev.idle('s2', 12));
  assert.equal(st.snapshot(12).agents.find((x) => x.id === 'claude:s2')?.status, 'question');
  st.apply(ev.stop('s2', 13));
  assert.equal(st.snapshot(13).agents.find((x) => x.id === 'claude:s2')?.status, 'question');
});

test('다음 할 일 상자 질문: Stop 없이 차례 끝 보정(R6)이 성공 PostToolUse보다 먼저 와도 ❓ (재검토 P2)', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'w1'));
  st.applyRegistry(read(reg('s1', 'idle', 5)), 6);
  assert.equal(one(st).status, 'done');
  st.apply(ev.end('s1', 7, 'w1'));
  st.apply(ev.wrapUp('s1', 7));
  assert.equal(one(st).status, 'question');
});

test('다음 할 일 상자 질문: 등록부로 퇴근(R4)하면 질문 표시도 지움 → 다시 나타나 질문 없이 끝나면 ✅ (재검토 P2)', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.applyRegistry(read(reg('s1', 'busy', 0)), 1);
  st.apply(ev.wrapUp('s1', 2));
  st.apply(ev.stop('s1', 3));
  assert.equal(one(st).status, 'question');
  st.applyRegistry(read(), 10);
  st.applyRegistry(read(), 11);
  assert.equal(one(st).status, 'gone');
  st.applyRegistry(read(reg('s1', 'busy', 20)), 21); // 이어서 열기
  st.apply(ev.stop('s1', 30));
  assert.equal(one(st).status, 'done');
});

test('다음 할 일 상자: 한 차례에 상자를 다시 띄우면 마지막 것이 기준(질문 없음이면 ✅)', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.wrapUp('s1', 1));
  st.apply(ev.wrapUp('s1', 2, false));
  st.apply(ev.stop('s1', 3));
  assert.equal(one(st).status, 'done');
});

test('다음 할 일 상자 질문 뒤 메시지 없이 다시 일함(백그라운드 작업이 끝나 이어 감 등) → 그 일을 보여 주고, 끝나면 ✅', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.wrapUp('s1', 1));
  st.apply(ev.stop('s1', 2));
  assert.equal(one(st).status, 'question');
  st.apply(ev.tool('s1', 10, 'r1', 'reading'));
  assert.equal(one(st).status, 'reading');
  st.apply(ev.end('s1', 11, 'r1'));
  st.apply(ev.stop('s1', 12));
  assert.equal(one(st).status, 'done');
});

test('❗와 ❓가 함께면 ❗, 승인한 도구가 끝나면 남은 ❓', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 't1'));
  st.apply(ev.perm('s1', 2));
  st.apply(ev.question('s1', 3, 'A'));
  assert.equal(one(st).status, 'permission');
  st.apply(ev.end('s1', 4, 't1'));
  assert.equal(one(st).status, 'question');
});

test('대화 정리: manual은 끝나면 ✅, auto는 💭', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.compactStart('s1', 1, 'manual'));
  assert.deepEqual([one(st).status, one(st).detail], ['compacting', '/compact']);
  st.apply(ev.compactEnd('s1', 2, 'manual'));
  assert.deepEqual([one(st).status, one(st).detail], ['done', null]);
  st.apply(ev.prompt('s1', 3));
  st.apply(ev.compactStart('s1', 4, 'auto'));
  assert.deepEqual([one(st).status, one(st).detail], ['compacting', '자동 정리']);
  st.apply(ev.compactEnd('s1', 5, 'auto'));
  assert.deepEqual([one(st).status, one(st).detail], ['thinking', null]);
});

test('🧹도 15분 무신호면 응답 없음', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.compactStart('s1', 0, 'auto'));
  st.tick(14 * M);
  assert.equal(one(st).status, 'compacting');
  st.tick(15 * M);
  assert.equal(one(st).status, 'stalled');
});

// 미리 정리(Claude Code 2.1.308 실측): 쉬는 동안·도구를 돌리는 동안 다음 정리본을 뒤에서 미리 만들며 자동 PreCompact만 보낸다.
// PostCompact는 다음에 실제로 바꿔 낄 때(차례 안) 온다
test('미리 정리: 차례가 끝난 뒤 온 자동 정리 시작은 ✅ 그대로, 20분 지나도 응답 없음 아님 → 다음 차례에 바꿔 끼우면 💭', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.stop('s1', 1));
  st.apply(ev.compactStart('s1', 2 * M, 'auto'));
  assert.equal(one(st).status, 'done');
  st.tick(20 * M);
  assert.equal(one(st).status, 'done');
  st.apply(ev.prompt('s1', 21 * M));
  st.apply(ev.compactEnd('s1', 22 * M, 'auto'));
  assert.equal(one(st).status, 'thinking');
});

test('미리 정리: ❓ 기다림 중에 온 자동 정리 시작은 ❓ 그대로', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.question('s1', 1));
  st.apply(ev.compactStart('s1', 2, 'auto'));
  assert.equal(one(st).status, 'question');
});

test('미리 정리: 도구를 돌리는 중에 온 자동 정리 시작은 ▶ 그대로, 20분 돌아도 응답 없음 아님', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 't1'));
  st.apply(ev.compactStart('s1', 2, 'auto'));
  assert.equal(one(st).status, 'running');
  st.tick(20 * M);
  assert.equal(one(st).status, 'running');
});

test('미리 정리: 자동 퇴근해 숨은 세션은 다시 나타나지 않음', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.stop('s1', 1));
  st.tick(31 * M); // 😴
  st.tick(140 * M); // 👋 퇴근이 늦게 걸려 바로 숨김
  assert.deepEqual(st.snapshot(140 * M).agents, []);
  st.apply(ev.compactStart('s1', 141 * M, 'auto'));
  assert.deepEqual(st.snapshot(141 * M).agents, []);
});

test('미리 정리: 서버를 다시 켠 뒤 등록부로만 아는 쉬는 세션(실측 B 세션)도 그대로, 응답 없음 아님', () => {
  const st = make();
  st.applyRegistry(read(reg('s1', 'idle', 5)), 6);
  const before = [one(st).status, one(st).hookless];
  st.apply(ev.compactStart('s1', 7, 'auto'));
  assert.deepEqual([one(st).status, one(st).hookless], before);
  st.tick(30 * M);
  assert.notEqual(one(st).status, 'stalled');
});

test('한도: ⏳(쉼 묶음), 1시간 지나도 ⏳, resume → 💭', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 't1'));
  st.apply(ev.quota('s1', 2));
  assert.deepEqual([one(st).status, one(st).detail], ['quota', null]);
  st.tick(60 * M);
  assert.equal(one(st).status, 'quota');
  st.apply(ev.resume('s1', 61 * M));
  assert.equal(one(st).status, 'thinking');
});

test('다른 오류로 멈춤: ✅ + "오류: overloaded"', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.stopErr('s1', 1, 'overloaded'));
  assert.deepEqual([one(st).status, one(st).detail], ['done', '오류: overloaded']);
});

test('⏳·🧹 중에 늦게 온 도구 끝 신호는 상태를 바꾸지 않음', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 't1'));
  st.apply(ev.quota('s1', 2));
  st.apply(ev.end('s1', 3, 't1'));
  assert.equal(one(st).status, 'quota');
  st.apply(ev.prompt('s1', 4));
  st.apply(ev.compactStart('s1', 5, 'auto'));
  st.apply(ev.end('s1', 6, 'late'));
  assert.equal(one(st).status, 'compacting');
});

// ---------- 등록부(세션 목록 파일) ----------
const reg = (sessionId: string, status: 'busy' | 'waiting' | 'idle', statusUpdatedAt: number, extra: Partial<RegistryEntry> = {}): RegistryEntry =>
  ({ sessionId, pid: 1, cwd: CWD, name: null, status, statusUpdatedAt, ...extra });
const read = (...entries: RegistryEntry[]): RegistryRead => ({ health: 'ok', entries });
const notice = (e: Ev): Ev => ({ ...e, viaNotification: true }) as Ev;

test('R3: 훅 없는 세션 busy→💭, waiting→❓, idle→✅; 30분 뒤 😴는 되돌리지 않음; 훅이 오면 훅 기준', () => {
  const st = make();
  st.applyRegistry(read(reg('r1', 'busy', 1000)), 2000);
  assert.deepEqual([one(st).status, one(st).since, one(st).hookless, one(st).project], ['thinking', 1000, false, '가로망 중심성']);
  st.applyRegistry(read(reg('r1', 'waiting', 3000)), 4000);
  assert.equal(one(st).status, 'question');
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 6000);
  assert.equal(one(st).status, 'done');
  st.tick(5000 + 30 * M);
  assert.equal(one(st).status, 'idle');
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 5000 + 31 * M);
  assert.equal(one(st).status, 'idle');
  st.apply(ev.prompt('r1', 40 * M));
  assert.equal(one(st).status, 'thinking');
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 41 * M);
  assert.equal(one(st).status, 'thinking');
});

test('R3 훅 없음: 서버 켜진 뒤 busy 2분·훅 0번 → hookless, 1분 59초는 false, idle이면 false', () => {
  const st = make({ startedAt: 10 * M });
  st.applyRegistry(read(reg('r1', 'busy', 0)), 10 * M);
  st.applyRegistry(read(reg('r1', 'busy', 0)), 11 * M + 59_000);
  assert.equal(one(st).hookless, false);
  st.applyRegistry(read(reg('r1', 'busy', 0)), 12 * M);
  assert.equal(one(st).hookless, true);
  st.applyRegistry(read(reg('r1', 'idle', 12 * M)), 12 * M + 1000);
  assert.equal(one(st).hookless, false);
  st.applyRegistry(read(reg('i1', 'idle', 0), reg('r1', 'idle', 12 * M)), 30 * M);
  assert.ok(st.snapshot(0).agents.every((a) => !a.hookless));
});

test('긴 도구 실행: 시작 훅이 왔으면 busy 10분이어도 hookless 아님', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1000, 't1'));
  st.applyRegistry(read(reg('s1', 'busy', 0)), 10 * M);
  assert.deepEqual([one(st).status, one(st).hookless], ['running', false]);
});

test('R1: ❗(10초) 뒤 busy(12초) → 승인한 도구의 활동·내용, busy(9초)는 무시', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 8_000, 't1', 'editing'));
  st.apply(ev.perm('s1', 10_000));
  st.applyRegistry(read(reg('s1', 'busy', 9_000)), 10_500);
  assert.equal(one(st).status, 'permission');
  st.applyRegistry(read(reg('s1', 'waiting', 10_100)), 11_000);
  assert.equal(one(st).status, 'permission');
  st.applyRegistry(read(reg('s1', 'busy', 12_000)), 12_100);
  assert.deepEqual([one(st).status, one(st).detail], ['editing', 'editing t1']);
  st.apply(ev.end('s1', 20_000, 't1'));
  assert.equal(one(st).status, 'thinking');
});

test('R1: ❓ 뒤 busy → 💭(도우미가 일하는 중이면 👥), 메인·하위 대기 모두 지움', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 'a1', 'delegating'));
  st.apply(ev.question('s1', 2_000, 'A'));
  st.apply(ev.question('s1', 2_500, 'B'));
  assert.equal(one(st).status, 'question');
  st.applyRegistry(read(reg('s1', 'busy', 3_000)), 3_100);
  assert.equal(one(st).status, 'delegating');
  st.apply(ev.end('s1', 4_000, 'x', 'A'));
  assert.equal(one(st).status, 'delegating');
  const st2 = make();
  st2.apply(ev.prompt('s2', 0));
  st2.apply(ev.tool('s2', 1_000, 'q1'));
  st2.apply(ev.question('s2', 1_000));
  st2.applyRegistry(read(reg('s2', 'busy', 2_000)), 2_100);
  assert.equal(one(st2).status, 'thinking');
});

test('R2: 규칙 켜짐 + 일함 + waiting 2초 + 그 뒤 훅 없음 → ❓; 1.5초면 그대로; 그 뒤 훅이 왔으면 그대로; 규칙 꺼짐이면 안 함', () => {
  const on = make({ rule: true });
  on.apply(ev.prompt('s1', 0));
  on.applyRegistry(read(reg('s1', 'waiting', 10_000)), 11_500);
  assert.equal(one(on).status, 'thinking');
  on.applyRegistry(read(reg('s1', 'waiting', 10_000)), 12_000);
  assert.equal(one(on).status, 'question');
  on.applyRegistry(read(reg('s1', 'busy', 14_000)), 14_100);
  assert.equal(one(on).status, 'thinking');
  const late = make({ rule: true });
  late.apply(ev.prompt('s1', 0));
  late.apply(ev.tool('s1', 10_500, 't1'));
  late.applyRegistry(read(reg('s1', 'waiting', 10_000)), 13_000);
  assert.equal(one(late).status, 'running');
  const off = make();
  off.apply(ev.prompt('s1', 0));
  off.applyRegistry(read(reg('s1', 'waiting', 10_000)), 13_000);
  assert.equal(one(off).status, 'thinking');
});

test('알림: 이미 걸린 ❓를 permission_prompt 알림이 ❗로 바꾸지 않음, 대기가 없으면 알림으로 ❗', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1, 'q1'));
  st.apply(ev.question('s1', 1));
  st.apply(notice(ev.perm('s1', 6_000)));
  assert.equal(one(st).status, 'question');
  const st2 = make();
  st2.apply(ev.prompt('s2', 0));
  st2.apply(ev.tool('s2', 1, 't1'));
  st2.apply(notice(ev.perm('s2', 6_000)));
  assert.equal(one(st2).status, 'permission');
});

test('늦은 알림: 규칙 켜짐 + 등록부 busy면 알림 ❗ 무시, waiting이면 받음', () => {
  const st = make({ rule: true });
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 't1'));
  st.applyRegistry(read(reg('s1', 'busy', 500)), 1_100);
  st.apply(notice(ev.perm('s1', 7_000)));
  assert.equal(one(st).status, 'running');
  st.applyRegistry(read(reg('s1', 'waiting', 7_500)), 7_600);
  st.apply(notice(ev.perm('s1', 8_000)));
  assert.equal(one(st).status, 'permission');
});

test('R4: 한 번 안 보이면 그대로, 두 번이면 👋; 읽기 실패는 그대로; 등록부에 없던 세션은 영향 없음; 다시 나타나면 되살아남', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.prompt('h1', 0));
  const status = (id: string) => st.snapshot(0).agents.find((a) => a.sessionId === id)?.status;
  st.applyRegistry(read(reg('s1', 'busy', 0)), 1_000);
  st.applyRegistry(read(), 3_000);
  assert.equal(status('s1'), 'thinking');
  st.applyRegistry({ health: 'error', entries: [] }, 5_000);
  assert.equal(status('s1'), 'thinking');
  st.applyRegistry(read(), 7_000);
  assert.equal(status('s1'), 'gone');
  assert.equal(status('h1'), 'thinking');
  st.applyRegistry(read(reg('s1', 'busy', 8_000)), 9_000);
  assert.equal(status('s1'), 'thinking');
});

test('R5: 등록부 name이 제목이고, 그 뒤 훅의 제목이 덮어쓰지 않음', () => {
  const st = make();
  st.apply({ ...ev.prompt('s1', 0), title: '훅 제목' });
  st.applyRegistry(read(reg('s1', 'busy', 0, { name: '앱 제목' })), 1_000);
  assert.equal(one(st).title, '앱 제목');
  st.apply({ ...ev.prompt('s1', 2_000), title: '옛 훅 제목' });
  assert.equal(one(st).title, '앱 제목');
});

test('등록부에 있으면 12시간 무신호여도 안 지움', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.applyRegistry(read(reg('s1', 'idle', 0)), 1_000);
  st.tick(13 * 60 * M);
  assert.equal(st.snapshot(0).agents.length, 1);
});

test('같은 목록을 두 번 넣으면 두 번째는 false(화면 재전송 없음)', () => {
  const st = make();
  assert.equal(st.applyRegistry(read(reg('r1', 'busy', 0)), 1_000), true);
  assert.equal(st.applyRegistry(read(reg('r1', 'busy', 0)), 3_000), false);
});

test('registryHealth·lastHookAt: 처음엔 missing·null, 읽고 훅 받으면 갱신(제목 이벤트는 훅 아님)', () => {
  const st = make();
  assert.deepEqual([st.registryHealth, st.lastHookAt], ['missing', null]);
  st.applyRegistry(read(), 1_000);
  st.apply(ev.prompt('s1', 2_000));
  st.apply({ type: 'title', sessionId: 's1', at: 3_000, cwd: '', title: 't' });
  assert.deepEqual([st.registryHealth, st.lastHookAt], ['ok', 2_000]);
});

test('setContext: 창 = contextWindow(model), haiku-4-5면 20만, 모르는 모델 null, 같은 값이면 false, compacted, null', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  assert.equal(one(st).context, null);
  assert.equal(st.setContext('s1', { state: 'ok', used: 234560, model: 'claude-opus-5-5' }), true);
  assert.deepEqual(one(st).context, { state: 'ok', used: 234560, window: 1_000_000, model: 'claude-opus-5-5' });
  assert.equal(st.setContext('s1', { state: 'ok', used: 234560, model: 'claude-opus-5-5' }), false);
  st.setContext('s1', { state: 'ok', used: 150_000, model: 'claude-haiku-4-5-20251001' });
  assert.deepEqual(one(st).context, { state: 'ok', used: 150_000, window: 200_000, model: 'claude-haiku-4-5-20251001' });
  st.setContext('s1', { state: 'ok', used: 10, model: 'mystery' });
  assert.deepEqual(one(st).context, { state: 'ok', used: 10, window: null, model: 'mystery' });
  st.setContext('s1', { state: 'compacted' });
  assert.deepEqual(one(st).context, { state: 'compacted' });
  st.setContext('s1', null);
  assert.equal(one(st).context, null);
  assert.equal(st.setContext('zzz', null), false);
});

test('transcriptPathOf: 훅이 준 경로, 모르면 null', () => {
  const st = make();
  st.apply({ ...ev.prompt('s1', 0), transcriptPath: '/t/s1.jsonl' });
  assert.equal(st.transcriptPathOf('s1'), '/t/s1.jsonl');
  assert.equal(st.transcriptPathOf('nope'), null);
});

test('health: 시작 시각·마지막 훅·등록부 상태·세션 수(퇴근 제외)·훅 없음 수', () => {
  const st = make({ startedAt: 5 });
  assert.deepEqual(st.snapshot(0).health, { startedAt: 5, lastHookAt: null, registry: 'missing', sessions: 0, hookless: 0, lastCodexHookAt: null });
  st.apply(ev.prompt('s1', 1_000));
  st.apply(ev.prompt('s2', 2_000));
  st.apply(ev.end_('s2', 3_000));
  st.applyRegistry(read(reg('r1', 'busy', 0)), 3 * M);
  assert.deepEqual(st.snapshot(0).health, { startedAt: 5, lastHookAt: 3_000, registry: 'ok', sessions: 2, hookless: 1, lastCodexHookAt: null });
});

// ---------- 최종 리뷰에서 나온 순서 문제 ----------
test('훅 없는 busy 세션은 15분이 지나도 응답 없음으로 바뀌지 않고, 다시 읽어도 화면 재전송 없음', () => {
  const st = make();
  st.applyRegistry(read(reg('r1', 'busy', 0)), 1_000);
  st.applyRegistry(read(reg('r1', 'busy', 0)), 3 * M);
  assert.equal(st.tick(16 * M), false);
  assert.equal(one(st).status, 'thinking');
  assert.equal(st.applyRegistry(read(reg('r1', 'busy', 0)), 16 * M + 2_000), false);
});

test('R4: 훅 없는 세션이 등록부에서 사라지면 훅 없음 태그와 경보도 내려감', () => {
  const st = make();
  st.applyRegistry(read(reg('r1', 'busy', 0)), 3 * M);
  assert.equal(one(st).hookless, true);
  st.applyRegistry(read(), 3 * M + 2_000);
  st.applyRegistry(read(), 3 * M + 4_000);
  assert.deepEqual([one(st).status, one(st).hookless, st.snapshot(0).health.hookless], ['gone', false, 0]);
});

test('SessionEnd 뒤 잠깐 남은 등록부 파일은 퇴근을 되돌리지 않고, 새로 쓰인 파일이면 되살림', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.applyRegistry(read(reg('s1', 'busy', 500)), 1_000);
  st.apply(ev.end_('s1', 5_000));
  st.applyRegistry(read(reg('s1', 'idle', 4_000)), 6_000);
  assert.equal(one(st).status, 'gone');
  st.applyRegistry(read(reg('s1', 'busy', 9_000)), 10_000);
  assert.equal(one(st).status, 'thinking');
});

test('승인 뒤 늦게 온 permission_prompt 알림: 등록부가 일하는 중이면 ❗를 다시 띄우지 않음, 대기가 없던 세션은 대비용 유지', () => {
  const st = make({ rule: true });
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 't1', 'editing'));
  st.apply(ev.perm('s1', 1_200));
  st.applyRegistry(read(reg('s1', 'busy', 3_000)), 3_100);
  assert.equal(one(st).status, 'editing');
  st.apply(notice(ev.perm('s1', 7_000)));
  assert.equal(one(st).status, 'editing');
  const old = make();
  old.apply(ev.prompt('s2', 0));
  old.apply(ev.tool('s2', 1_000, 't1'));
  old.apply(notice(ev.perm('s2', 7_000)));
  assert.equal(one(old).status, 'permission');
});

// ---------- Task 0 실제 확인에서 나온 것: 거절하면 등록부가 busy가 아니라 idle ----------
test('R6: 거절·중단으로 차례가 끝나면(등록부 idle) ✅ 내 차례 — 등록부 값이 마지막 훅보다 나중일 때만', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 't1'));
  st.apply(ev.perm('s1', 1_200));
  st.applyRegistry(read(reg('s1', 'waiting', 1_100)), 1_300);
  assert.equal(one(st).status, 'permission');
  st.applyRegistry(read(reg('s1', 'idle', 2_000)), 2_100);
  assert.deepEqual([one(st).status, one(st).detail], ['done', null]);
  const stalled = make();
  stalled.apply(ev.prompt('s2', 0));
  stalled.tick(16 * M);
  assert.equal(one(stalled).status, 'stalled');
  stalled.applyRegistry(read(reg('s2', 'idle', 16 * M + 1_000)), 16 * M + 1_100);
  assert.equal(one(stalled).status, 'done');
  const old = make();
  old.apply(ev.prompt('s3', 5_000));
  old.applyRegistry(read(reg('s3', 'idle', 4_000)), 5_100);
  assert.equal(one(old).status, 'thinking');
  const quota = make();
  quota.apply(ev.prompt('s4', 0));
  quota.apply(ev.quota('s4', 1_000));
  quota.applyRegistry(read(reg('s4', 'idle', 2_000)), 2_100);
  assert.equal(one(quota).status, 'quota');
});

// ---------- Codex 리뷰(PR #2) ----------
test('직접 승인→해소 뒤, 같은 세션의 알림 전용 승인(샌드박스 네트워크)은 ❗로 보임 — 등록부 있는/없는 세션 모두', () => {
  const st = make({ rule: true });
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 't1'));
  st.apply(ev.perm('s1', 1_200));
  st.applyRegistry(read(reg('s1', 'busy', 3_000)), 3_100);
  assert.equal(one(st).status, 'running');
  st.applyRegistry(read(reg('s1', 'waiting', 4_000)), 6_100);
  assert.equal(one(st).status, 'question');
  st.apply(notice(ev.perm('s1', 10_000)));
  assert.equal(one(st).status, 'permission');
  st.applyRegistry(read(reg('s1', 'busy', 12_000)), 12_100);
  assert.equal(one(st).status, 'running');
  const cli = make({ rule: true });
  cli.apply(ev.prompt('c1', 0));
  cli.apply(ev.tool('c1', 1_000, 't1'));
  cli.apply(ev.perm('c1', 1_200));
  cli.apply(ev.end('c1', 2_000, 't1'));
  cli.apply(ev.tool('c1', 3_000, 't2'));
  cli.apply(notice(ev.perm('c1', 9_000)));
  assert.equal(one(cli).status, 'permission');
});

test('applyRegistry: 세션이 같아도 등록부 상태(missing/error ↔ ok)만 바뀌면 true', () => {
  const st = make();
  assert.equal(st.applyRegistry({ health: 'missing', entries: [] }, 0), false);
  assert.equal(st.applyRegistry(read(), 1_000), true);
  assert.equal(st.applyRegistry(read(), 2_000), false);
  assert.equal(st.applyRegistry({ health: 'error', entries: [] }, 3_000), true);
});

test('늦은 알림 무시는 지금 유효한 등록부 값일 때만 — 읽기 실패·폴더 없음·파일 일시 누락이면 알림 전용 승인을 받음', () => {
  const broken: RegistryRead[] = [{ health: 'error', entries: [] }, { health: 'missing', entries: [] }, read()];
  for (const r of broken) {
    const st = make({ rule: true });
    st.apply(ev.prompt('s1', 0));
    st.apply(ev.tool('s1', 1_000, 't1'));
    st.applyRegistry(read(reg('s1', 'busy', 500)), 1_100);
    st.applyRegistry(r, 3_000);
    st.apply(notice(ev.perm('s1', 9_000)));
    assert.equal(one(st).status, 'permission', `${r.health} · 항목 ${r.entries.length}개`);
  }
});

// ---------- 다시 설치 뒤 실제 확인(2026-10-23): 도우미가 백그라운드로 돌 때 ----------
// 실측: Agent 도구가 0.14초 만에 끝나고(백그라운드), 도우미가 승인을 요청한 2초 뒤 메인이 Stop → ❗가 지워지고 ✅로 보였음
test('A: 메인 차례가 끝나도(Stop) 백그라운드 도우미의 승인 대기는 남고, 승인하면 👥', () => {
  const st = make({ rule: true });
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 'ag1', 'delegating'));
  st.apply(ev.subStart('s1', 1_100, 'A'));
  st.apply(ev.end('s1', 1_140, 'ag1'));
  st.apply(ev.perm('s1', 3_000, 'A'));
  st.apply(ev.stop('s1', 5_000));
  assert.equal(one(st).status, 'permission');
  st.applyRegistry(read(reg('s1', 'busy', 7_000)), 7_100);
  assert.equal(one(st).status, 'delegating');
});

test('A: 메인 차례가 끝난 뒤 도우미의 승인된 도구가 끝나도 👥 (도우미가 아직 일함)', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 'ag1', 'delegating'));
  st.apply(ev.subStart('s1', 1_100, 'A'));
  st.apply(ev.end('s1', 1_140, 'ag1'));
  st.apply(ev.perm('s1', 3_000, 'A'));
  st.apply(ev.stop('s1', 5_000));
  st.apply(ev.end('s1', 6_000, 'x', 'A'));
  assert.equal(one(st).status, 'delegating');
});

test('B: 메인 차례가 끝났는데 도우미가 일하면 👥, 도우미가 끝나면 💭, 그 뒤 등록부 idle이면 ✅', () => {
  const st = make({ rule: true });
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.tool('s1', 1_000, 'ag1', 'delegating'));
  st.apply(ev.subStart('s1', 1_100, 'A'));
  st.apply(ev.end('s1', 1_140, 'ag1'));
  st.apply(ev.stop('s1', 2_000));
  assert.deepEqual([one(st).status, one(st).detail], ['delegating', null]);
  st.apply(ev.subStop('s1', 9_000, 'A'));
  assert.equal(one(st).status, 'thinking');
  st.applyRegistry(read(reg('s1', 'idle', 9_500)), 9_600);
  assert.equal(one(st).status, 'done');
});

test('B: 도우미 없이 차례가 끝나면 지금처럼 ✅, 등록부 idle은 남은 도우미 목록도 비움', () => {
  const plain = make();
  plain.apply(ev.prompt('s1', 0));
  plain.apply(ev.stop('s1', 1_000));
  assert.equal(one(plain).status, 'done');
  const st = make({ rule: true });
  st.apply(ev.prompt('s2', 0));
  st.apply(ev.subStart('s2', 500, 'A'));
  st.apply(ev.stop('s2', 1_000));
  assert.equal(one(st).status, 'delegating');
  st.applyRegistry(read(reg('s2', 'idle', 2_000)), 2_100);
  assert.deepEqual([one(st).status, one(st).subagents.length], ['done', 0]);
});

// ---------- Codex 리뷰(PR #3) ----------
test('StopFailure(오류)는 도우미가 일해도 ✅ + 오류로 보이고, 도우미 승인 대기가 있으면 ❗ 뒤 풀릴 때 오류로', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.subStart('s1', 500, 'A'));
  st.apply(ev.stopErr('s1', 1_000, 'overloaded'));
  assert.deepEqual([one(st).status, one(st).detail], ['done', '오류: overloaded']);
  st.apply(ev.subStop('s1', 2_000, 'A'));
  assert.deepEqual([one(st).status, one(st).detail], ['done', '오류: overloaded']);
  const waiting = make();
  waiting.apply(ev.prompt('s2', 0));
  waiting.apply(ev.subStart('s2', 500, 'A'));
  waiting.apply(ev.perm('s2', 800, 'A'));
  waiting.apply(ev.stopErr('s2', 1_000, 'overloaded'));
  assert.equal(one(waiting).status, 'permission');
  waiting.apply(ev.end('s2', 2_000, 'x', 'A'));
  assert.deepEqual([one(waiting).status, one(waiting).detail], ['done', '오류: overloaded']);
});

test('idle 알림(입력 기다림)도 남은 도우미 목록을 비워, 다음 차례 Stop이 낡은 도우미로 👥를 되살리지 않음', () => {
  const st = make();
  st.apply(ev.prompt('s1', 0));
  st.apply(ev.subStart('s1', 500, 'A'));
  st.apply(ev.stop('s1', 1_000));
  assert.equal(one(st).status, 'delegating');
  st.apply({ sessionId: 's1', at: 61_000, cwd: CWD, type: 'idle' });
  assert.deepEqual([one(st).status, one(st).subagents.length], ['done', 0]);
  st.apply(ev.prompt('s1', 70_000));
  st.apply(ev.stop('s1', 71_000));
  assert.equal(one(st).status, 'done');
});

// ---------- 2단계 Codex ----------
test('Codex 이벤트: id codex:<세션>, kind codex, Claude와 같은 상태 규칙', () => {
  const st = make();
  st.apply({ ...ev.prompt('x1', 0), kind: 'codex' });
  assert.deepEqual([one(st).id, one(st).kind, one(st).status], ['codex:x1', 'codex', 'thinking']);
});

test('health: lastCodexHookAt은 Codex 신호만, lastHookAt은 둘 다', () => {
  const st = make();
  st.apply(ev.prompt('c1', 1_000));
  st.apply({ ...ev.prompt('x1', 2_000), kind: 'codex' });
  st.apply(ev.prompt('c1', 3_000));
  assert.deepEqual([st.snapshot(0).health.lastHookAt, st.snapshot(0).health.lastCodexHookAt], [3_000, 2_000]);
});

test('Codex 중단(Interrupt) 뒤 늦은 도구 끝은 ✅를 바꾸지 않음, transcriptPathOf는 null', async () => {
  const { codexHookToEvents } = await import('../../src/server/collectors/codexHook.ts');
  const st = make();
  const send = (o: Record<string, unknown>, at: number) => { for (const e of codexHookToEvents({ session_id: 'x1', cwd: CWD, transcript_path: '/r.jsonl', ...o }, at)) st.apply(e); };
  send({ hook_event_name: 'UserPromptSubmit' }, 0);
  send({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'sleep 30' } }, 1_000);
  send({ hook_event_name: 'Interrupt' }, 2_000);
  assert.equal(one(st).status, 'done');
  send({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'u1' }, 3_000);
  assert.equal(one(st).status, 'done');
  assert.equal(st.transcriptPathOf('x1'), null);
});

// Codex 도우미는 그 차례에 묶인다(2026-10-24 사용자 결정) — Codex엔 등록부·idle 알림 같은 바로잡는 장치가 없어서
async function codexSender() {
  const { codexHookToEvents } = await import('../../src/server/collectors/codexHook.ts');
  const st = make();
  const send = (o: Record<string, unknown>, at: number) => { for (const e of codexHookToEvents({ session_id: 'x1', cwd: CWD, ...o }, at)) st.apply(e); };
  return { st, send };
}

test('Codex 도우미 중 중단 → ✅, 도우미 표시 지움, 늦은 기다림 끝·도우미 끝에도 ✅, 15분 뒤에도 ⚠ 아님', async () => {
  const { st, send } = await codexSender();
  send({ hook_event_name: 'UserPromptSubmit' }, 0);
  send({ hook_event_name: 'PreToolUse', tool_name: 'collaborationspawn_agent', tool_use_id: 'u1', tool_input: { task_name: 'count_md' } }, 1_000);
  send({ hook_event_name: 'PostToolUse', tool_name: 'collaborationspawn_agent', tool_use_id: 'u1' }, 1_100);
  send({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'default' }, 1_200);
  send({ hook_event_name: 'PreToolUse', tool_name: 'collaborationwait_agent', tool_use_id: 'u2', tool_input: {} }, 1_300);
  assert.equal(one(st).status, 'delegating');
  send({ hook_event_name: 'Interrupt' }, 2_000);
  assert.deepEqual([one(st).status, one(st).subagents.length], ['done', 0]);
  send({ hook_event_name: 'PostToolUse', tool_name: 'collaborationwait_agent', tool_use_id: 'u2' }, 3_000);
  send({ hook_event_name: 'SubagentStop', agent_id: 'A', agent_type: 'default' }, 4_000);
  assert.equal(one(st).status, 'done');
  st.tick(4_000 + 16 * M);
  assert.equal(one(st).status, 'done');
});

// Codex 도우미는 차례를 넘어 살아 있을 수 있다(followup_task·send_message로 재사용, 일이 끝나도 SubagentStop 없음) → 차례 끝은 ✅
test('Codex: 차례가 끝나면 도우미가 남아 있어도 ✅(목록엔 도우미 수), 나중에 도우미가 끝나도 ✅ (Claude는 👥 → 💭)', async () => {
  const { st, send } = await codexSender();
  send({ hook_event_name: 'UserPromptSubmit' }, 0);
  send({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'default' }, 1_000);
  send({ hook_event_name: 'Stop' }, 2_000);
  assert.deepEqual([one(st).status, one(st).subagents.length], ['done', 1]);
  send({ hook_event_name: 'SubagentStop', agent_id: 'A', agent_type: 'default' }, 3_000);
  assert.deepEqual([one(st).status, one(st).subagents.length], ['done', 0]);
  const claude = make();
  for (const e of [ev.prompt('c1', 0), ev.subStart('c1', 1_000, 'A'), ev.stop('c1', 2_000), ev.subStop('c1', 3_000, 'A')]) claude.apply(e);
  assert.equal(one(claude).status, 'thinking');
});

test('Codex: 새 질문이면 남은 도우미 표시를 지워, 놓친 SubagentStop이 다음 차례 끝을 👥로 만들지 않음 (Claude는 도우미 유지)', async () => {
  const { st, send } = await codexSender();
  send({ hook_event_name: 'UserPromptSubmit' }, 0);
  send({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'default' }, 1_000);
  send({ hook_event_name: 'Stop' }, 2_000);
  send({ hook_event_name: 'UserPromptSubmit' }, 3_000);
  assert.deepEqual([one(st).status, one(st).subagents.length], ['thinking', 0]);
  send({ hook_event_name: 'Stop' }, 4_000);
  assert.equal(one(st).status, 'done');
  const claude = make();
  for (const e of [ev.prompt('c1', 0), ev.subStart('c1', 1_000, 'A'), ev.stop('c1', 2_000), ev.prompt('c1', 3_000), ev.stop('c1', 4_000)]) claude.apply(e);
  assert.equal(one(claude).status, 'delegating');
});

test('자리 번호는 종류별로 따로: 숨겨진 Codex가 사무실 자리를 차지하지 않음', () => {
  const st = make();
  st.apply(ev.prompt('c1', 0));
  st.apply({ ...ev.prompt('x1', 1), kind: 'codex' });
  st.apply(ev.prompt('c2', 2));
  const seat = (id: string) => st.snapshot(0).agents.find((a) => a.sessionId === id)!.seat;
  assert.deepEqual([seat('c1'), seat('x1'), seat('c2')], [0, 0, 1]);
});

test('모델: 사건에 실려 오면 기억, 모델 없는 사건은 그대로 둠, 새 세션은 null', () => {
  const st = make();
  st.apply(ev.prompt('c1', 0));
  assert.equal(one(st).model, null);
  st.apply({ ...ev.prompt('c1', 1), model: 'gpt-5.5' });
  st.apply(ev.stop('c1', 2));
  assert.equal(one(st).model, 'gpt-5.5');
});

// Codex 앱의 자동 승인(AutoReview)은 승인 요청 신호를 먼저 보낸 뒤 AI가 허용한다 → 처음 5초는 조용히 '승인 확인 중'
test('Codex 승인 요청: 5초 동안은 🛡️ approving, 5초가 지나면 tick에서 ❗, 그 전에 도구가 끝나면 ❗ 없이 💭', () => {
  const st = make();
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx(ev.tool('x1', 500, 'u1')));
  st.apply(cx(ev.perm('x1', 1_000)));
  assert.deepEqual([one(st).status, one(st).detail], ['approving', 'Bash: ls']);
  assert.equal(st.tick(5_900), false);
  assert.equal(one(st).status, 'approving');
  assert.equal(st.tick(6_000), true);
  assert.deepEqual([one(st).status, one(st).detail], ['permission', 'Bash: ls']);
  st.apply(cx(ev.end('x1', 7_000, 'u1')));
  assert.equal(one(st).status, 'thinking');
  const fast = make();
  fast.apply(cx(ev.prompt('x2', 0)));
  fast.apply(cx(ev.tool('x2', 500, 'u1')));
  fast.apply(cx(ev.perm('x2', 1_000)));
  fast.apply(cx(ev.end('x2', 3_000, 'u1')));
  fast.tick(10_000);
  assert.equal(one(fast).status, 'thinking');
});

test('Codex 도우미의 승인 요청·차례 끝(Stop) 뒤 남은 승인도 처음 5초는 approving', () => {
  const st = make();
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx(ev.subStart('x1', 100, 'A')));
  st.apply(cx(ev.perm('x1', 1_000, 'A')));
  assert.equal(one(st).status, 'approving');
  st.apply(cx(ev.stop('x1', 2_000)));
  assert.equal(one(st).status, 'approving');
  st.tick(6_000);
  assert.equal(one(st).status, 'permission');
});

test('Claude 승인 요청은 지금처럼 바로 ❗', () => {
  const st = make();
  st.apply(ev.prompt('c1', 0));
  st.apply(ev.tool('c1', 500, 'u1'));
  st.apply(ev.perm('c1', 1_000));
  assert.equal(one(st).status, 'permission');
});

test('겹친 Codex 승인: 오래된 요청이 풀리고 새 요청만 남으면 새 요청 기준으로 다시 🛡️, 5초 뒤 ❗ (리뷰 P2)', () => {
  const st = make();
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx(ev.subStart('x1', 0, 'A')));
  st.apply(cx(ev.subStart('x1', 0, 'B')));
  st.apply(cx(ev.perm('x1', 0, 'A')));
  st.apply(cx(ev.perm('x1', 4_000, 'B')));
  assert.equal(one(st).status, 'approving');
  st.tick(5_000);
  assert.equal(one(st).status, 'permission');
  st.apply(cx(ev.perm('x1', 5_500, 'B'))); // 같은 대기가 다시 와도 B의 시작 시각(4초)은 그대로
  st.apply(cx(ev.end('x1', 6_000, 'tA', 'A')));
  assert.equal(one(st).status, 'approving');
  st.tick(8_900);
  assert.equal(one(st).status, 'approving');
  st.tick(9_000);
  assert.equal(one(st).status, 'permission');
});

// Codex 앱의 자동 승인(AutoReview)은 승인된 순간 신호가 없어, 긴 명령이 끝날 때까지 대기로 보였다 → 스위치를 켜면 승인 요청을 무시
test('Codex 자동 승인 스위치가 켜져 있으면 Codex 승인 요청(메인·도우미)은 무시하고 하던 일을 그대로, Claude는 그대로 ❗', () => {
  let auto = true;
  const st = new OfficeState({
    restMs: 30 * M, leaveMs: 120 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, startedAt: 0, registryWaitRule: false,
    resolveProject: () => 'x', codexAutoApprove: () => auto,
  });
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx(ev.tool('x1', 100, 'u1')));
  st.apply(cx(ev.perm('x1', 200)));
  st.apply(cx(ev.subStart('x1', 300, 'A')));
  st.apply(cx(ev.perm('x1', 400, 'A')));
  st.tick(60_000);
  const x = st.snapshot(0).agents.find((a) => a.sessionId === 'x1')!;
  assert.deepEqual([x.status, x.detail], ['running', 'running u1']);
  st.apply(cx(ev.end('x1', 61_000, 'u1')));
  assert.equal(st.snapshot(0).agents.find((a) => a.sessionId === 'x1')!.status, 'thinking');
  st.apply(ev.prompt('c1', 0));
  st.apply(ev.tool('c1', 100, 'u1'));
  st.apply(ev.perm('c1', 200));
  assert.equal(st.snapshot(0).agents.find((a) => a.sessionId === 'c1')!.status, 'permission');
  auto = false; // 끄면 바로 지금처럼(🛡️ → 5초 뒤 ❗)
  st.apply(cx(ev.tool('x1', 62_000, 'u2')));
  st.apply(cx(ev.perm('x1', 62_100)));
  assert.equal(st.snapshot(0).agents.find((a) => a.sessionId === 'x1')!.status, 'approving');
});

// 열기만 하고 메시지는 안 보낸 세션은 보드에 안 보인다(2026-10-26 사용자 결정) — 앱이 지난 세션을 열면 시작 신호만 옴
test('열기만 한 세션: 시작·제목·idle 알림·퇴근만으론 안 보이고, 도구·승인 같은 일 신호부터 보임', () => {
  const st = make();
  st.apply(ev.start('s1', 0));
  st.apply({ ...b('s1', 1), type: 'title', title: '지난 작업' });
  st.apply({ ...b('s1', 2), type: 'idle' });
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.end_('s1', 3));
  assert.deepEqual(st.snapshot(0).agents, []);
  const cx = make();
  cx.apply({ ...ev.start('x1', 0), kind: 'codex' });
  assert.deepEqual(cx.snapshot(0).agents, []);
  cx.apply({ ...ev.tool('x1', 1, 'u1'), kind: 'codex' });
  assert.equal(one(cx).status, 'running');
});

test('열기만 한 세션은 모자·자리를 차지하지 않음: 나중에 일을 시작하면 그때 빈 것을 받음', () => {
  const st = make();
  st.apply(ev.start('hidden', 0));
  st.apply(ev.prompt('c1', 1));
  const c1 = st.snapshot(0).agents.find((a) => a.sessionId === 'c1')!;
  assert.deepEqual([c1.hat, c1.seat], [0, 0]);
  st.apply(ev.prompt('hidden', 2));
  const h = st.snapshot(0).agents.find((a) => a.sessionId === 'hidden')!;
  assert.deepEqual([h.hat, h.seat], [1, 1]);
});

test('훅 없이 등록부로만 보는 세션: 일하는 중·기다림은 보이고, idle은 시작 뒤 한 차례라도 했을 때만(startedAt과 10초 넘게 차이)', () => {
  const st = make();
  st.applyRegistry(read(
    reg('opened', 'idle', 100_000, { startedAt: 99_000 }),
    reg('worked', 'idle', 100_000, { startedAt: 10_000 }),
    reg('busy', 'busy', 100_000, { startedAt: 99_500 }),
    reg('old', 'idle', 100_000),
  ), 100_500);
  assert.deepEqual(st.snapshot(0).agents.map((a) => a.sessionId).sort(), ['busy', 'old', 'worked']);
});

test('시작 신호를 받은 세션은 등록부 idle로는 보이지 않음(열기만 함), 메시지를 보내면 보임', () => {
  const st = make();
  st.apply(ev.start('s1', 1_000));
  st.applyRegistry(read(reg('s1', 'idle', 30_000, { startedAt: 1_000 })), 30_000);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.prompt('s1', 31_000));
  assert.equal(one(st).status, 'thinking');
});

test('touchPaths: 만진 경로로 알아낸 마지막 프로젝트가 이름표, 못 알아내면 그대로, 시작 폴더가 바뀌어도 유지', () => {
  const st = new OfficeState({
    restMs: 30 * M, leaveMs: 120 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, startedAt: 0, registryWaitRule: false,
    resolveProject: (cwd) => (cwd === CWD ? '가로망 중심성' : 'CnC Wiki'),
    resolveWork: (p) => (p.includes('/alpha/') ? 'Alpha' : p.includes('/beta/') ? 'Beta' : null),
  });
  st.apply(ev.prompt('c1', 0));
  assert.equal(st.touchPaths('c1', ['/x/none'], CWD), false);
  assert.equal(one(st).project, '가로망 중심성');
  assert.equal(st.touchPaths('c1', ['/x/none', '/w/alpha/a.ts', '/w/beta/b.ts'], CWD), true);
  assert.equal(one(st).project, 'Alpha');
  st.touchPaths('c1', ['/w/beta/c.ts'], CWD);
  assert.equal(one(st).project, 'Beta');
  st.apply({ ...ev.prompt('c1', 1), cwd: '/Users/seop/Documents/CnC Wiki' });
  assert.equal(one(st).project, 'Beta');
  assert.equal(st.touchPaths('없음', ['/w/alpha/a.ts'], CWD), false);
});

test('스위치를 켜면 이미 떠 있던 Codex 승인 대기(메인·도우미)만 지우고 하던 일로 되돌림, 질문 대기·Claude는 그대로 (리뷰 P2)', () => {
  const st = make();
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx(ev.tool('x1', 100, 'u1')));
  st.apply(cx(ev.perm('x1', 200)));
  st.tick(6_000);
  const find = (id: string) => st.snapshot(0).agents.find((a) => a.sessionId === id)!;
  assert.equal(find('x1').status, 'permission');
  st.apply(cx(ev.prompt('x2', 0)));
  st.apply(cx(ev.subStart('x2', 100, 'A')));
  st.apply(cx(ev.perm('x2', 200, 'A')));
  st.apply(cx(ev.question('x2', 300)));
  st.apply(ev.prompt('c1', 0));
  st.apply(ev.tool('c1', 100, 'u1'));
  st.apply(ev.perm('c1', 200));
  assert.equal(st.dropCodexApprovals(7_000), true);
  assert.deepEqual([find('x1').status, find('x1').detail], ['running', 'running u1']);
  assert.equal(find('x2').status, 'question');
  assert.equal(find('c1').status, 'permission');
  st.apply(cx(ev.end('x1', 8_000, 'u1')));
  assert.equal(find('x1').status, 'thinking');
  assert.equal(st.dropCodexApprovals(9_000), false);
});

test('Codex 도우미를 여러 차례 다시 써도(SubagentStop 없음) 각 차례가 끝나면 ✅, 기다리는 동안만 👥 (리뷰 중 실제로 본 경우)', async () => {
  const { st, send } = await codexSender();
  send({ hook_event_name: 'UserPromptSubmit' }, 0);
  send({ hook_event_name: 'PreToolUse', tool_name: 'collaborationspawn_agent', tool_use_id: 's1', tool_input: { task_name: 'reviewer' } }, 100);
  send({ hook_event_name: 'PostToolUse', tool_name: 'collaborationspawn_agent', tool_use_id: 's1' }, 200);
  send({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'default' }, 300);
  send({ hook_event_name: 'PreToolUse', tool_name: 'collaborationwait_agent', tool_use_id: 'w1', tool_input: {} }, 400);
  assert.equal(one(st).status, 'delegating');
  send({ hook_event_name: 'PostToolUse', tool_name: 'collaborationwait_agent', tool_use_id: 'w1' }, 5_000);
  send({ hook_event_name: 'Stop' }, 6_000);
  assert.equal(one(st).status, 'done');
  st.tick(6_000 + 20 * M);
  assert.equal(one(st).status, 'done');
});

test('Codex 차례가 끝난 뒤 도우미 승인이 풀려도(도구 끝·스위치로 지움) ✅로 돌아감, 영구 👥 아님 (리뷰 P2)', () => {
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  const st = make();
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx(ev.subStart('x1', 100, 'A')));
  st.apply(cx(ev.stop('x1', 200)));
  assert.equal(one(st).status, 'done');
  st.apply(cx(ev.perm('x1', 300, 'A')));
  assert.equal(one(st).status, 'approving');
  st.apply(cx(ev.end('x1', 400, 'tA', 'A')));
  assert.equal(one(st).status, 'done');
  const sw = make();
  sw.apply(cx(ev.prompt('x2', 0)));
  sw.apply(cx(ev.subStart('x2', 100, 'A')));
  sw.apply(cx(ev.stop('x2', 200)));
  sw.apply(cx(ev.perm('x2', 300, 'A')));
  sw.tick(6_000);
  assert.equal(one(sw).status, 'permission');
  assert.equal(sw.dropCodexApprovals(7_000), true);
  assert.equal(one(sw).status, 'done');
  // 다음 차례가 시작되면 다시 평소대로(메시지 → 💭)
  sw.apply(cx(ev.prompt('x2', 8_000)));
  assert.equal(one(sw).status, 'thinking');
});

test('✅ 10분 → 😴, 차례가 끝나고 2시간 → 👋, 10분 뒤 숨김(지우지 않음)', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.stop('s1', 1 * M));
  st.tick(11 * M); assert.equal(one(st).status, 'idle');
  assert.equal(st.tick(121 * M - 1), false);
  assert.equal(st.tick(121 * M), true); assert.equal(one(st).status, 'gone');
  st.tick(131 * M); assert.deepEqual(st.snapshot(0).agents, []);
});

for (const kind of ['claude', 'codex'] as const) {
  test(`자동 퇴근해 숨은 세션은 다시 일하면 새 모자·자리로 돌아옴(${kind})`, () => {
    const st = make({ rest: 10 * M, leave: 120 * M });
    const k = { kind };
    st.apply({ ...ev.prompt('s1', 0), ...k, title: '내 제목' } as Ev); st.apply({ ...ev.stop('s1', 1 * M), ...k });
    st.tick(11 * M); st.tick(121 * M); st.tick(131 * M);
    assert.deepEqual(st.snapshot(0).agents, []);
    st.apply({ ...ev.prompt('s2', 132 * M), ...k });
    assert.deepEqual([one(st).id, one(st).hat, one(st).seat], [`${kind}:s2`, 0, 0]);
    st.apply({ ...ev.prompt('s1', 133 * M), ...k });
    const s1 = st.snapshot(0).agents.find((a) => a.sessionId === 's1')!;
    assert.deepEqual([s1.status, s1.hat, s1.seat], ['thinking', 1, 1]);
    assert.equal(s1.title, '내 제목', '숨기만 했지 지우지 않았다');
    // 다시 일한 뒤에는 보통 세션처럼: 이번엔 지금처럼 SessionEnd 퇴근이면 지움
    st.apply({ ...ev.end_('s1', 134 * M), ...k });
    st.tick(145 * M);
    assert.equal(st.snapshot(0).agents.some((a) => a.sessionId === 's1'), false);
  });
}

test('숨긴 뒤의 tick은 아무것도 안 바꿈(1초마다 화면을 다시 보내지 않게)', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.stop('s1', 1 * M));
  st.tick(11 * M); st.tick(121 * M); assert.equal(st.tick(131 * M), true);
  assert.equal(st.tick(132 * M), false);
});

test('창 닫은 퇴근(SessionEnd)은 지금처럼 10분 뒤 지움', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply({ ...ev.prompt('s1', 0), title: '옛 제목' } as Ev); st.apply(ev.end_('s1', 1 * M));
  assert.equal(one(st).status, 'gone');
  st.tick(11 * M); assert.deepEqual(st.snapshot(0).agents, []);
  // 지워졌다는 증거: 같은 id가 다시 시작해도 앞서 붙은 제목이 없다
  st.apply(ev.prompt('s1', 12 * M)); assert.equal(one(st).title, null);
});

test('⏳ 토큰 기다림·… 응답 없음은 쉬기·퇴근 규칙을 타지 않음', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('q', 0)); st.apply(ev.quota('q', 1 * M));
  st.apply(ev.prompt('t', 0));
  st.tick(16 * M); st.tick(200 * M);
  const by = (id: string) => st.snapshot(0).agents.find((a) => a.sessionId === id)!;
  assert.equal(by('q').status, 'quota');
  assert.equal(by('t').status, 'stalled');
});

test('등록부 idle은 자동 퇴근을 되돌리지 않음(훅 없는 세션 포함)', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.applyRegistry(read(reg('r1', 'busy', 1000)), 2000);
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 6000);
  st.tick(5000 + 10 * M); assert.equal(one(st).status, 'idle');
  st.tick(5000 + 120 * M); assert.equal(one(st).status, 'gone');
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 5000 + 121 * M);
  assert.equal(one(st).status, 'gone');
  st.tick(5000 + 131 * M); assert.deepEqual(st.snapshot(0).agents, []);
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 5000 + 132 * M);
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 5000 + 134 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.applyRegistry(read(reg('r1', 'busy', 5000 + 140 * M)), 5000 + 140 * M + 1000);
  assert.equal(one(st).status, 'thinking');
});

test('등록부 busy는 훅이 있던 자동 퇴근 세션도 다시 보이게 함', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.stop('s1', 1 * M));
  st.applyRegistry(read(reg('s1', 'idle', 1 * M)), 2 * M);
  st.tick(11 * M); st.tick(121 * M); st.tick(131 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.applyRegistry(read(reg('s1', 'idle', 1 * M)), 132 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.applyRegistry(read(reg('s1', 'busy', 140 * M)), 140 * M + 1000);
  assert.equal(one(st).status, 'thinking');
});

test('자동 퇴근 뒤 SessionEnd는 숨기지 않고 10분 뒤 지움', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply({ ...ev.prompt('s1', 0), title: '옛 제목' } as Ev); st.apply(ev.stop('s1', 1 * M));
  st.tick(11 * M); st.tick(121 * M);
  assert.equal(one(st).status, 'gone');
  st.apply(ev.end_('s1', 122 * M));
  st.tick(132 * M);
  st.apply(ev.prompt('s1', 133 * M));
  assert.equal(one(st).title, null, '지워졌다가 새로 시작');
});

test('숨은 자동 퇴근 세션은 낡은 도구 끝 신호로 되살아나거나 지워지지 않고, 일 신호에야 돌아옴', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply({ ...ev.prompt('s1', 0), title: '내 제목' } as Ev); st.apply(ev.stop('s1', 1 * M));
  st.tick(11 * M); st.tick(121 * M); st.tick(131 * M);
  st.apply(ev.end('s1', 140 * M, 't9'));
  st.apply(ev.subStop('s1', 141 * M, 'x'));
  st.tick(150 * M); st.tick(300 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.prompt('s1', 301 * M));
  assert.deepEqual([one(st).status, one(st).title], ['thinking', '내 제목']);
});

test('숨은 훅 없는 세션은 퇴근보다 오래된 busy를 두 번 받아도 숨은 채', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.applyRegistry(read(reg('r1', 'busy', 1000)), 2000);
  st.applyRegistry(read(reg('r1', 'idle', 5000)), 6000);
  st.tick(5000 + 10 * M); st.tick(5000 + 120 * M); st.tick(5000 + 131 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.applyRegistry(read(reg('r1', 'busy', 2000)), 5000 + 132 * M);
  st.applyRegistry(read(reg('r1', 'busy', 2000)), 5000 + 134 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
});

// spawn_agent가 끝나도 wait_agent가 시작되기 전까지 👥를 유지한다(Codex만) — 사이의 💭 깜빡임 방지
test('Codex 도우미 띄우기 → 기다리기 사이에 💭 없음(도우미 시작이 띄우기 끝 앞이든 뒤든)', () => {
  for (const subBefore of [true, false]) {
    const st = make();
    const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
    const spawn = { ...ev.tool('x1', 100, 'S', 'delegating'), spawn: true } as Ev;
    const seen: string[] = [];
    st.apply(cx(ev.prompt('x1', 0)));
    st.apply(cx(spawn)); seen.push(one(st).status);
    if (subBefore) st.apply(cx(ev.subStart('x1', 150, 'A')));
    st.apply(cx(ev.end('x1', 200, 'S')));
    if (!subBefore) st.apply(cx(ev.subStart('x1', 250, 'A')));
    seen.push(one(st).status);
    st.apply(cx(ev.tool('x1', 300, 'W', 'delegating'))); seen.push(one(st).status);
    st.apply(cx(ev.end('x1', 400, 'W'))); seen.push(one(st).status);
    assert.deepEqual(seen, ['delegating', 'delegating', 'delegating', 'thinking'], `subBefore=${subBefore}`);
  }
});

test('Claude Agent 도구 끝은 지금처럼 💭(spawn 표시 없음)', () => {
  const st = make();
  st.apply(ev.prompt('c1', 0));
  st.apply(ev.tool('c1', 100, 'S', 'delegating'));
  st.apply(ev.end('c1', 200, 'S'));
  assert.equal(one(st).status, 'thinking');
});

test('Codex 띄우기 끝 → 도우미 시작·끝(차례 안 끝남) → 💭, 차례 끝 뒤 도우미 끝은 ✅', () => {
  const st = make();
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx({ ...ev.tool('x1', 100, 'S', 'delegating'), spawn: true } as Ev));
  st.apply(cx(ev.end('x1', 200, 'S')));
  st.apply(cx(ev.subStart('x1', 250, 'A')));
  assert.equal(one(st).status, 'delegating');
  st.apply(cx(ev.subStop('x1', 300, 'A')));
  assert.equal(one(st).status, 'thinking');
  // 차례가 끝난 뒤 도우미가 끝나면 ✅
  const st2 = make();
  st2.apply(cx(ev.prompt('x2', 0)));
  st2.apply(cx(ev.subStart('x2', 100, 'A')));
  st2.apply(cx(ev.stop('x2', 200)));
  st2.apply(cx(ev.subStop('x2', 300, 'A')));
  assert.equal(one(st2).status, 'done');
});

test('퇴근이 한참 늦게 걸리면(서버 재시작·잠자기 뒤) 👋 없이 곧바로 숨김', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.stop('s1', 1 * M));
  const seen: string[] = [];
  for (const t of [181 * M, 182 * M, 183 * M]) {
    st.tick(t);
    seen.push(...st.snapshot(0).agents.map((a) => a.status));
  }
  assert.deepEqual(seen, ['idle'], '😴 한 번 보인 뒤로는 👋 없이 숨음');
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.prompt('s1', 184 * M));
  assert.equal(one(st).status, 'thinking', '숨기만 했으니 일하면 돌아옴');
});

test('도우미 없이 👥만 남은 Codex 세션(띄운 뒤 Codex가 죽음)은 응답 없음 …', () => {
  const st = make();
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx({ ...ev.tool('x1', 100, 'S', 'delegating'), spawn: true } as Ev));
  st.apply(cx(ev.end('x1', 200, 'S')));
  assert.equal(one(st).status, 'delegating');
  st.tick(200 + 15 * M); assert.equal(one(st).status, 'stalled');
});

test('살아 있는 도우미가 있는 👥는 응답 없음으로 바꾸지 않음', () => {
  const st = make();
  const cx = (e: Ev): Ev => ({ ...e, kind: 'codex' });
  st.apply(cx(ev.prompt('x1', 0)));
  st.apply(cx({ ...ev.tool('x1', 100, 'S', 'delegating'), spawn: true } as Ev));
  st.apply(cx(ev.subStart('x1', 150, 'A')));
  st.apply(cx(ev.end('x1', 200, 'S')));
  st.tick(200 + 30 * M); assert.equal(one(st).status, 'delegating');
});

test('숨은 자동 퇴근 세션에 온 도우미 시작 신호는 무시(다시 일할 때 낡은 도우미가 안 딸려 옴)', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.stop('s1', 1 * M));
  st.tick(11 * M); st.tick(121 * M); st.tick(131 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.subStart('s1', 140 * M, 'ghost'));
  assert.deepEqual(st.snapshot(0).agents, [], '도우미 신호로는 돌아오지 않음');
  st.apply(ev.prompt('s1', 150 * M));
  assert.equal(one(st).status, 'thinking');
  assert.equal(one(st).subagents.length, 0);
});

// 두 기능이 만나는 곳(main 병합): 쉬기·퇴근(생동감)과 다음 할 일 상자 질문(turn-ask)
test('다음 할 일 상자 ❓는 쉬기·퇴근 규칙을 타지 않음(답할 때까지 그대로), 답하고 질문 없이 끝나면 ✅', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.wrapUp('s1', 1)); st.apply(ev.stop('s1', 2));
  for (const t of [11 * M, 121 * M, 131 * M, 300 * M]) st.tick(t);
  assert.equal(one(st).status, 'question');
  st.apply(ev.prompt('s1', 301 * M)); st.apply(ev.stop('s1', 302 * M));
  assert.equal(one(st).status, 'done');
});

test('자동 퇴근은 남은 상자 질문 표시도 지움(오류 ✅로 끝난 차례) → 등록부로 돌아와 차례가 끝나면 ❓ 아닌 ✅', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.wrapUp('s1', 1)); st.apply(ev.stopErr('s1', 2, 'overloaded'));
  assert.equal(one(st).status, 'done');
  st.tick(11 * M); st.tick(200 * M); // 😴 → 늦게 걸린 퇴근이라 곧바로 숨김
  assert.deepEqual(st.snapshot(0).agents, []);
  st.applyRegistry(read(reg('s1', 'busy', 201 * M)), 201 * M + 1000); // 이어서 일함
  assert.equal(one(st).status, 'thinking');
  st.applyRegistry(read(reg('s1', 'idle', 202 * M)), 202 * M + 1000); // R6: Stop 없이 차례 끝
  assert.equal(one(st).status, 'done');
});

test('자동 퇴근 뒤 등록부 대기(❓ 추측) → busy로 돌아오면 ✅ 아닌 💭(끝난 차례 표시가 남지 않음)', () => {
  for (const hidden of [false, true]) {
    const st = make({ rest: 10 * M, leave: 120 * M });
    st.apply(ev.prompt('s1', 0)); st.apply(ev.stop('s1', 1 * M));
    st.tick(11 * M); st.tick(121 * M);
    if (hidden) st.tick(131 * M);
    st.applyRegistry(read(reg('s1', 'waiting', 140 * M)), 140 * M + 1000);
    assert.equal(one(st).status, 'question', `대기 추측(숨김=${hidden})`);
    st.applyRegistry(read(reg('s1', 'busy', 141 * M)), 141 * M + 1000);
    assert.equal(one(st).status, 'thinking', `일하는 중(숨김=${hidden})`);
  }
});

test('숨은 자동 퇴근 세션에 늦게 온 상자 신호는 무시 → 돌아와도 낡은 ❓ 없음', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply(ev.prompt('s1', 0)); st.apply(ev.stop('s1', 1 * M));
  st.tick(11 * M); st.tick(121 * M); st.tick(131 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.wrapUp('s1', 140 * M, true));
  assert.deepEqual(st.snapshot(0).agents, [], '상자 신호만으로는 안 돌아옴');
  st.applyRegistry(read(reg('s1', 'busy', 150 * M)), 150 * M + 1000);
  assert.equal(one(st).status, 'thinking');
  st.applyRegistry(read(reg('s1', 'idle', 151 * M)), 151 * M + 1000);
  assert.equal(one(st).status, 'done');
});

test('숨은 자동 퇴근 세션에 SessionEnd가 오면 10분 뒤 지움(옛 제목이 남지 않음)', () => {
  const st = make({ rest: 10 * M, leave: 120 * M });
  st.apply({ ...ev.prompt('s1', 0), title: '옛 제목' } as Ev); st.apply(ev.stop('s1', 1 * M));
  st.tick(11 * M); st.tick(121 * M); st.tick(131 * M);
  assert.deepEqual(st.snapshot(0).agents, []);
  st.apply(ev.end_('s1', 140 * M));
  st.tick(151 * M);
  st.apply(ev.prompt('s1', 152 * M));
  assert.equal(one(st).title, null, '지워졌다가 새로 시작');
});
