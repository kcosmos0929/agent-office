// 상태 정리기: 이벤트를 받아 에이전트별 상태를 갱신한다. 화면·수집기·시계를 모르는 순수 로직(시간은 이벤트·tick 인자로만).
import { groupOf } from '../shared/labels.ts';
import type { Agent, OfficeEvent, Snapshot, Status, Usage } from '../shared/types.ts';

export type StateOptions = {
  idleMs: number;
  goneMs: number;
  stalledMs: number;
  /** 이 시간 동안 아무 신호가 없으면 상태와 상관없이 정리(종료 신호 없이 닫힌 세션) */
  forgetMs: number;
  resolveProject: (cwd: string) => string;
};

const SLOTS = 8;

type Entry = {
  agent: Agent;
  openTools: Set<string>;
  transcriptPath: string | null;
  /** 메인 대화가 승인을 기다리는 중 */
  waitingMain: boolean;
  /** 승인을 기다리는 하위 에이전트들 (여럿이 동시에 기다릴 수 있음) */
  waitingSubs: Set<string>;
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
      } else if (a.status === 'thinking' && now - a.lastEventAt >= this.opts.stalledMs) {
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
    const entry: Entry = { agent, openTools: new Set(), transcriptPath: null, waitingMain: false, waitingSubs: new Set() };
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
        entry.openTools.add(e.toolUseId);
        if (a.status === 'permission') return;
        this.setStatus(a, e.activity, e.at);
        a.detail = e.detail;
        return;
      case 'tool-end':
        entry.openTools.delete(e.toolUseId);
        if (a.status === 'done' || a.status === 'idle' || a.status === 'gone') return;
        if (entry.openTools.size > 0) return;
        // 메인 도구가 모두 끝남 = 메인 승인 대기도 끝남(승인 요청엔 도구 id가 없어 도구별로는 못 가린다)
        entry.waitingMain = false;
        if (a.status === 'permission') {
          this.resolveWaiting(entry, e.at);
        } else {
          this.setStatus(a, 'thinking', e.at);
          a.detail = null;
        }
        return;
      case 'permission':
        entry.waitingMain = true;
        this.setStatus(a, 'permission', e.at);
        a.detail = e.detail;
        return;
      case 'stop':
        this.clearWork(entry);
        this.setStatus(a, 'done', e.at);
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

  /** 하위 에이전트 안의 이벤트: 승인 요청과 그 승인된 도구의 끝만 부모 상태에 영향 */
  private applySubagentEvent(entry: Entry, e: OfficeEvent, subagentId: string): void {
    const a = entry.agent;
    if (e.type === 'permission') {
      entry.waitingSubs.add(subagentId);
      this.setStatus(a, 'permission', e.at);
      a.detail = e.detail;
    } else if (e.type === 'tool-end' && entry.waitingSubs.delete(subagentId)) {
      this.resolveWaiting(entry, e.at);
    }
  }

  /** 기다리는 곳이 하나도 안 남았을 때만 승인 필요를 푼다 */
  private resolveWaiting(entry: Entry, at: number): void {
    const a = entry.agent;
    if (a.status !== 'permission' || entry.waitingMain || entry.waitingSubs.size > 0) return;
    this.setStatus(a, entry.openTools.size > 0 ? 'delegating' : 'thinking', at);
    a.detail = null;
  }

  private clearWork(entry: Entry): void {
    entry.openTools.clear();
    entry.waitingMain = false;
    entry.waitingSubs.clear();
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
