import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeState } from '../../src/server/state.ts';
import type { OfficeEvent } from '../../src/shared/types.ts';
import type { RegistryEntry, RegistryRead } from '../../src/server/collectors/sessionRegistry.ts';
import { M } from '../helpers.ts';

const CWD = '/Users/seop/developer/street-centrality-bus';

function make(o: { startedAt?: number; rule?: boolean } = {}) {
  return new OfficeState({
    idleMs: 30 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, resolveProject: (cwd) => (cwd === CWD ? '가로망 중심성' : 'x'),
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
  stopErr: (s: string, at: number, error: string): Ev => ({ ...b(s, at), type: 'stop', error }),
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
  st.apply(ev.start('s3', 6 * 60 * M));
  st.tick(12 * 60 * M - 1);
  assert.equal(st.snapshot(0).agents.length, 3);
  assert.equal(st.tick(12 * 60 * M), true);
  assert.deepEqual(st.snapshot(0).agents.map((a) => a.sessionId), ['s3']);
  st.apply(ev.start('s4', 12 * 60 * M + 1));
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
  st.apply(ev.end('s1', 9, 'AG'));
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
  st.apply(ev.start('s1', 0));
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
  assert.deepEqual(st.snapshot(0).health, { startedAt: 5, lastHookAt: null, registry: 'missing', sessions: 0, hookless: 0 });
  st.apply(ev.prompt('s1', 1_000));
  st.apply(ev.prompt('s2', 2_000));
  st.apply(ev.end_('s2', 3_000));
  st.applyRegistry(read(reg('r1', 'busy', 0)), 3 * M);
  assert.deepEqual(st.snapshot(0).health, { startedAt: 5, lastHookAt: 3_000, registry: 'ok', sessions: 2, hookless: 1 });
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
