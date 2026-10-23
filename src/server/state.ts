// 상태 정리기: 이벤트를 받아 에이전트별 상태를 갱신한다. 화면·수집기·시계를 모르는 순수 로직(시간은 이벤트·tick 인자로만).
import { groupOf } from '../shared/labels.ts';
import type { Activity, Agent, OfficeEvent, Snapshot, Status, Usage, WaitKind } from '../shared/types.ts';

export type StateOptions = {
  idleMs: number;
  goneMs: number;
  stalledMs: number;
  /** 이 시간 동안 아무 신호가 없으면 상태와 상관없이 정리(종료 신호 없이 닫힌 세션) */
  forgetMs: number;
  resolveProject: (cwd: string) => string;
};

const SLOTS = 8;
/** 나를 기다리는 상태(❗·❓) */
const WAITS = new Set<Status>(['permission', 'question']);
/** 도구 끝 신호가 늦게 와도 바꾸지 않는 상태 */
const SETTLED = new Set<Status>(['done', 'idle', 'gone', 'quota', 'compacting']);

type OpenTool = { activity: Activity; detail: string };

type Entry = {
  agent: Agent;
  /** 시작했지만 아직 안 끝난 메인 도구 (승인 순간 그 도구의 활동으로 돌아가려고 활동·내용을 기억) */
  openTools: Map<string, OpenTool>;
  transcriptPath: string | null;
  /** 메인 대화가 기다리는 것(승인/질문) */
  waitingMain: WaitKind | null;
  /** 기다리는 하위 에이전트들과 그 종류 (여럿이 동시에 기다릴 수 있음) */
  waitingSubs: Map<string, WaitKind>;
  /** 대기가 하나도 없다가 처음 생긴 시각 — 모두 풀리면 null */
  waitSince: number | null;
};

export class OfficeState {
  private readonly opts: StateOptions;
  private readonly entries = new Map<string, Entry>();
  private usage: Usage | null = null;

  constructor(opts: StateOptions) {
    this.opts = opts;
  }

  apply(e: OfficeEvent): boolean {
    const before = this.fingerprint();
    const entry = this.entries.get(e.sessionId) ?? this.create(e);
    const a = entry.agent;
    a.lastEventAt = e.at;
    if (e.title) a.title = e.title;
    if (e.transcriptPath) entry.transcriptPath = e.transcriptPath;
    if (e.cwd && e.cwd !== a.cwd) {
      a.cwd = e.cwd;
      a.project = this.opts.resolveProject(e.cwd);
    }

    if (e.subagentId) {
      this.applySubagentEvent(entry, e, e.subagentId);
    } else {
      this.applyMainEvent(entry, e);
    }
    return this.fingerprint() !== before;
  }

  tick(now: number): boolean {
    let changed = false;
    for (const [id, { agent: a }] of this.entries) {
      if (now - a.lastEventAt >= this.opts.forgetMs) {
        this.entries.delete(id);
        changed = true;
      } else if (a.status === 'done' && now - a.since >= this.opts.idleMs) {
        this.setStatus(a, 'idle', now);
        changed = true;
      } else if ((a.status === 'thinking' || a.status === 'compacting') && now - a.lastEventAt >= this.opts.stalledMs) {
        this.setStatus(a, 'stalled', now);
        changed = true;
      } else if (a.status === 'gone' && now - a.since >= this.opts.goneMs) {
        this.entries.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  setUsage(u: Usage): boolean {
    const changed = JSON.stringify(u) !== JSON.stringify(this.usage);
    this.usage = u;
    return changed;
  }

  needsTitle(sessionId: string): string | null {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.agent.title) return null;
    return entry.transcriptPath;
  }

  snapshot(now: number): Snapshot {
    const agents = [...this.entries.values()].map(({ agent }) => ({ ...agent, subagents: agent.subagents.map((s) => ({ ...s })) }));
    return { agents, usage: this.usage, now };
  }

  private create(e: OfficeEvent): Entry {
    const used = [...this.entries.values()].map((x) => x.agent);
    const agent: Agent = {
      id: `claude:${e.sessionId}`,
      kind: 'claude',
      sessionId: e.sessionId,
      title: null,
      cwd: e.cwd,
      project: this.opts.resolveProject(e.cwd),
      status: 'thinking',
      detail: null,
      since: e.at,
      lastEventAt: e.at,
      hat: firstFree(used.map((a) => a.hat), used.length % SLOTS),
      seat: firstFree(used.map((a) => a.seat), -1),
      subagents: [],
    };
    const entry: Entry = { agent, openTools: new Map(), transcriptPath: null, waitingMain: null, waitingSubs: new Map(), waitSince: null };
    this.entries.set(e.sessionId, entry);
    if (e.type === 'session-start') {
      agent.status = 'done';
      agent.detail = '새 세션';
    }
    return entry;
  }

  private applyMainEvent(entry: Entry, e: OfficeEvent): void {
    const a = entry.agent;
    switch (e.type) {
      case 'session-start':
        if (a.status === 'gone') {
          this.setStatus(a, 'done', e.at);
          a.detail = '새 세션';
        }
        return;
      case 'prompt':
        this.clearWork(entry);
        this.setStatus(a, 'thinking', e.at);
        a.detail = null;
        return;
      case 'tool-start':
        entry.openTools.set(e.toolUseId, { activity: e.activity, detail: e.detail });
        if (WAITS.has(a.status)) return;
        this.setStatus(a, e.activity, e.at);
        a.detail = e.detail;
        return;
      case 'tool-end':
        entry.openTools.delete(e.toolUseId);
        if (SETTLED.has(a.status)) return;
        if (entry.openTools.size > 0) return;
        // 메인 도구가 모두 끝남 = 메인 대기도 끝남(대기 신호엔 도구 id가 없어 도구별로는 못 가린다)
        entry.waitingMain = null;
        if (WAITS.has(a.status)) {
          this.resolveWaiting(entry, e.at);
        } else {
          this.setStatus(a, 'thinking', e.at);
          a.detail = null;
        }
        return;
      case 'permission':
      case 'question':
        entry.waitingMain = e.type;
        this.enterWait(entry, e.type, e.detail, e.at);
        return;
      case 'stop':
        this.clearWork(entry);
        this.setStatus(a, 'done', e.at);
        a.detail = e.error ? `오류: ${e.error}` : null;
        return;
      case 'compact-start':
        this.setStatus(a, 'compacting', e.at);
        a.detail = e.trigger === 'manual' ? '/compact' : '자동 정리';
        return;
      case 'compact-end':
        // 직접 /compact는 끝나면 내 차례, 자동 정리는 차례 도중이라 이어서 일함
        if (e.trigger === 'manual') {
          this.clearWork(entry);
          this.setStatus(a, 'done', e.at);
        } else {
          this.setStatus(a, 'thinking', e.at);
        }
        a.detail = null;
        return;
      case 'quota-wait':
        this.clearWork(entry);
        this.setStatus(a, 'quota', e.at);
        a.detail = null;
        return;
      case 'resume':
        if (a.status === 'gone') return;
        this.setStatus(a, 'thinking', e.at);
        a.detail = null;
        return;
      case 'subagent-start':
        if (!a.subagents.some((s) => s.id === e.agentId)) a.subagents.push({ id: e.agentId, type: e.agentType, since: e.at });
        return;
      case 'subagent-stop':
        a.subagents = a.subagents.filter((s) => s.id !== e.agentId);
        if (entry.waitingSubs.delete(e.agentId)) this.resolveWaiting(entry, e.at);
        return;
      case 'session-end':
        this.clearWork(entry);
        a.subagents = [];
        this.setStatus(a, 'gone', e.at);
        a.detail = null;
        return;
      case 'title':
        a.title = e.title;
        return;
      case 'idle':
        // 입력을 기다린다는 알림: 일하던 중이었다면(Stop 없이 끝난 차례) 내 차례로. 승인 대기는 건드리지 않는다
        if (groupOf(a.status) !== 'working') return;
        this.clearWork(entry);
        this.setStatus(a, 'done', e.at);
        a.detail = null;
        return;
    }
  }

  /** 하위 에이전트 안의 이벤트: 승인·질문 대기와 그 대기 뒤 도구의 끝만 부모 상태에 영향 */
  private applySubagentEvent(entry: Entry, e: OfficeEvent, subagentId: string): void {
    if (e.type === 'permission' || e.type === 'question') {
      entry.waitingSubs.set(subagentId, e.type);
      this.enterWait(entry, e.type, e.detail, e.at);
    } else if (e.type === 'tool-end' && entry.waitingSubs.delete(subagentId)) {
      this.resolveWaiting(entry, e.at);
    }
  }

  /** 승인이 하나라도 걸려 있으면 ❗, 질문만 있으면 ❓ */
  private shownWait(entry: Entry): WaitKind | null {
    const kinds = [entry.waitingMain, ...entry.waitingSubs.values()];
    if (kinds.includes('permission')) return 'permission';
    if (kinds.includes('question')) return 'question';
    return null;
  }

  private enterWait(entry: Entry, kind: WaitKind, detail: string | null, at: number): void {
    const a = entry.agent;
    entry.waitSince ??= at;
    const shown = this.shownWait(entry) ?? kind;
    this.setStatus(a, shown, at);
    if (shown === kind) a.detail = detail;
  }

  /** 대기가 하나도 안 남았을 때만 대기 상태를 푼다. 남았으면 남은 종류로 */
  private resolveWaiting(entry: Entry, at: number): void {
    const a = entry.agent;
    if (!WAITS.has(a.status)) return;
    const shown = this.shownWait(entry);
    if (shown) {
      if (shown !== a.status) a.detail = null;
      this.setStatus(a, shown, at);
      return;
    }
    entry.waitSince = null;
    this.setStatus(a, entry.openTools.size > 0 ? 'delegating' : 'thinking', at);
    a.detail = null;
  }

  private clearWaits(entry: Entry): void {
    entry.waitingMain = null;
    entry.waitingSubs.clear();
    entry.waitSince = null;
  }

  private clearWork(entry: Entry): void {
    entry.openTools.clear();
    this.clearWaits(entry);
  }

  private setStatus(a: Agent, s: Status, at: number): void {
    if (groupOf(s) !== groupOf(a.status) || (a.status !== s && (s === 'idle' || s === 'stalled' || s === 'gone'))) a.since = at;
    a.status = s;
  }

  private fingerprint(): string {
    return JSON.stringify([...this.entries.values()].map((x) => x.agent));
  }
}

/** 0..SLOTS-1 중 안 쓰는 가장 작은 수, 다 쓰면 fallback */
function firstFree(used: number[], fallback: number): number {
  for (let i = 0; i < SLOTS; i++) if (!used.includes(i)) return i;
  return fallback;
}
