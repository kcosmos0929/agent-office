// 상태 정리기: 이벤트를 받아 에이전트별 상태를 갱신한다. 화면·수집기·시계를 모르는 순수 로직(시간은 이벤트·tick 인자로만).
import { groupOf } from '../shared/labels.ts';
import type { Agent, OfficeEvent, Snapshot, Status, Usage } from '../shared/types.ts';

export type StateOptions = {
  idleMs: number;
  goneMs: number;
  stalledMs: number;
  resolveProject: (cwd: string) => string;
};

const SLOTS = 8;

type Entry = {
  agent: Agent;
  openTools: Set<string>;
  transcriptPath: string | null;
  /** 하위 에이전트가 낸 권한 요청이면 그 id */
  permissionFrom: string | null;
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
      if (a.status === 'done' && now - a.since >= this.opts.idleMs) {
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
    const entry: Entry = { agent, openTools: new Set(), transcriptPath: null, permissionFrom: null };
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
        entry.openTools.clear();
        entry.permissionFrom = null;
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
        if (entry.openTools.size === 0) {
          entry.permissionFrom = null;
          this.setStatus(a, 'thinking', e.at);
          a.detail = null;
        }
        return;
      case 'permission':
        entry.permissionFrom = null;
        this.setStatus(a, 'permission', e.at);
        a.detail = e.detail;
        return;
      case 'stop':
        entry.openTools.clear();
        entry.permissionFrom = null;
        this.setStatus(a, 'done', e.at);
        a.detail = null;
        return;
      case 'subagent-start':
        if (!a.subagents.some((s) => s.id === e.agentId)) a.subagents.push({ id: e.agentId, type: e.agentType, since: e.at });
        return;
      case 'subagent-stop':
        a.subagents = a.subagents.filter((s) => s.id !== e.agentId);
        if (entry.permissionFrom === e.agentId) this.clearSubagentPermission(entry, e.at);
        return;
      case 'session-end':
        entry.openTools.clear();
        entry.permissionFrom = null;
        a.subagents = [];
        this.setStatus(a, 'gone', e.at);
        a.detail = null;
        return;
      case 'title':
        a.title = e.title;
        return;
    }
  }

  /** 하위 에이전트 안의 이벤트: 권한 요청만 부모 상태를 바꾼다 */
  private applySubagentEvent(entry: Entry, e: OfficeEvent, subagentId: string): void {
    const a = entry.agent;
    if (e.type === 'permission') {
      entry.permissionFrom = subagentId;
      this.setStatus(a, 'permission', e.at);
      a.detail = e.detail;
    } else if (e.type === 'tool-end' && entry.permissionFrom === subagentId) {
      // 승인된 하위 에이전트의 도구가 끝났다 → 부모는 다시 도우미 작업 중
      this.clearSubagentPermission(entry, e.at);
    }
  }

  private clearSubagentPermission(entry: Entry, at: number): void {
    entry.permissionFrom = null;
    if (entry.agent.status !== 'permission') return;
    this.setStatus(entry.agent, entry.openTools.size > 0 ? 'delegating' : 'thinking', at);
    entry.agent.detail = null;
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
