// 상태 정리기: 이벤트를 받아 에이전트별 상태를 갱신한다. 화면·수집기·시계를 모르는 순수 로직(시간은 이벤트·tick 인자로만).
import { groupOf } from '../shared/labels.ts';
import type { Activity, Agent, Health, OfficeEvent, RegistryHealth, Snapshot, Status, Usage, WaitKind } from '../shared/types.ts';
import type { RegistryEntry, RegistryRead, RegistryStatus } from './collectors/sessionRegistry.ts';
import type { ContextReading } from './collectors/contextUsage.ts';
import { contextWindow } from '../shared/contextWindow.ts';

export type StateOptions = {
  idleMs: number;
  goneMs: number;
  stalledMs: number;
  /** 이 시간 동안 아무 신호가 없으면 상태와 상관없이 정리(종료 신호 없이 닫힌 세션) */
  forgetMs: number;
  resolveProject: (cwd: string) => string;
  /** 서버가 켜진 시각 — '훅 없음' 2분을 이때부터 잰다 */
  startedAt: number;
  /** 등록부 waiting을 '사용자 입력 기다림'으로 믿어도 되나(설계 R2·늦은 알림 무시). Task 0 실제 확인으로 정함 */
  registryWaitRule: boolean;
};

const SLOTS = 8;
/** 나를 기다리는 상태(❗·❓) */
const WAITS = new Set<Status>(['permission', 'question']);
/** 도구 끝 신호가 늦게 와도 바꾸지 않는 상태 */
const SETTLED = new Set<Status>(['done', 'idle', 'gone', 'quota', 'compacting']);
/** 등록부만 있고 훅이 없는 세션이 이만큼 일하는 중이면 '훅 없음' */
const HOOKLESS_MS = 2 * 60_000;
/** 등록부 waiting 뒤 이만큼 훅이 없으면 질문 대기로(R2) */
const WAIT_GRACE_MS = 2_000;
/** 훅 없는 세션: 등록부 값 → 화면 상태 */
const MIRROR: Record<RegistryStatus, Status> = { busy: 'thinking', waiting: 'question', idle: 'done' };

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
  /** 서버가 켜진 뒤 이 세션의 훅을 받은 적 있나 / 마지막 훅 시각 */
  hookSeen: boolean;
  lastHookAt: number | null;
  /** 등록부의 마지막 값. activeSince = busy/waiting이 이어진 시작(서버 켜진 시각보다 이르지 않게) */
  reg: { status: RegistryStatus; updatedAt: number; activeSince: number | null } | null;
  /** 등록부에서 본 적 있나 / 마지막 읽기에 있었나 / 연속으로 안 보인 횟수 */
  everInRegistry: boolean;
  inRegistry: boolean;
  missingReads: number;
  /** 등록부의 이름 — 있으면 훅 제목보다 우선 */
  regName: string | null;
  /** 지금 대기가 훅이 아니라 등록부만 보고 짐작한 것(R2·훅 없는 세션)인가 — 그렇다면 알림이 종류를 바로잡을 수 있다 */
  waitGuessed: boolean;
  /** 메인 차례가 오류(StopFailure)로 끝났으면 그 종류 — 도우미 대기가 풀린 뒤에도 '오류'로 보이게 */
  stopError: string | null;
};

export class OfficeState {
  private readonly opts: StateOptions;
  private readonly entries = new Map<string, Entry>();
  private usage: Usage | null = null;
  private registry: RegistryHealth = 'missing';
  private lastHook: number | null = null;

  constructor(opts: StateOptions) {
    this.opts = opts;
  }

  get registryHealth(): RegistryHealth {
    return this.registry;
  }

  get lastHookAt(): number | null {
    return this.lastHook;
  }

  apply(e: OfficeEvent): boolean {
    const before = this.fingerprint();
    const entry = this.entries.get(e.sessionId) ?? this.create(e);
    const a = entry.agent;
    a.lastEventAt = e.at;
    if (e.type !== 'title') {
      entry.hookSeen = true;
      entry.lastHookAt = e.at;
      this.lastHook = e.at;
      a.hookless = false;
    }
    if (e.title && !entry.regName) a.title = e.title;
    if ((e.type === 'permission' || e.type === 'question') && e.viaNotification && this.ignoreNotice(entry)) {
      return this.fingerprint() !== before;
    }
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
    for (const [id, entry] of this.entries) {
      const a = entry.agent;
      // 등록부에 살아 있는 세션은 오래 조용해도 지우지 않는다
      if (now - a.lastEventAt >= this.opts.forgetMs && !entry.inRegistry) {
        this.entries.delete(id);
        changed = true;
      } else if (a.status === 'done' && now - a.since >= this.opts.idleMs) {
        this.setStatus(a, 'idle', now);
        changed = true;
      } else if ((a.status === 'thinking' || a.status === 'compacting') && entry.hookSeen && now - a.lastEventAt >= this.opts.stalledMs) {
        // 훅 없는 세션은 등록부가 기준이라 '응답 없음'으로 바꾸지 않는다
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

  /** 트랜스크립트에서 읽은 대화 게이지를 넣는다. 바뀌었을 때만 true */
  setContext(sessionId: string, r: ContextReading): boolean {
    const a = this.entries.get(sessionId)?.agent;
    if (!a) return false;
    const next = r === null ? null : r.state === 'ok' ? { ...r, window: contextWindow(r.model) } : r;
    if (JSON.stringify(next) === JSON.stringify(a.context)) return false;
    a.context = next;
    return true;
  }

  transcriptPathOf(sessionId: string): string | null {
    return this.entries.get(sessionId)?.transcriptPath ?? null;
  }

  needsTitle(sessionId: string): string | null {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.agent.title) return null;
    return entry.transcriptPath;
  }

  snapshot(now: number): Snapshot {
    const agents = [...this.entries.values()].map(({ agent }) => ({ ...agent, subagents: agent.subagents.map((s) => ({ ...s })) }));
    return { agents, usage: this.usage, now, health: this.health(agents) };
  }

  /**
   * 등록부(Claude 앱 세션 목록)의 지금 목록을 반영한다. 화면에 보이는 게 바뀌었을 때만 true.
   * R1 승인·답변 순간 · R2 연달아 대기 · R3 훅 없는 세션 · R4 퇴근 · R5 제목 · R6 거절·중단 뒤 내 차례 (설계서 4-1)
   */
  applyRegistry(r: RegistryRead, now: number): boolean {
    const before = this.fingerprint();
    this.registry = r.health;
    if (r.health !== 'ok') return this.fingerprint() !== before; // 읽기 실패 땐 아무것도 안 바꿈
    const ids = new Set(r.entries.map((x) => x.sessionId));
    for (const [id, entry] of this.entries) {
      if (!entry.everInRegistry || ids.has(id)) continue;
      entry.inRegistry = false;
      entry.missingReads++;
      // 파일을 쓰는 도중 잠깐 안 읽힐 수 있어 두 번 연속일 때만 퇴근
      if (entry.missingReads >= 2 && entry.agent.status !== 'gone') {
        this.clearWork(entry);
        entry.agent.subagents = [];
        entry.agent.hookless = false;
        this.setStatus(entry.agent, 'gone', now);
        entry.agent.detail = null;
      }
    }
    for (const x of r.entries) this.applyRegistryEntry(x, now);
    return this.fingerprint() !== before;
  }

  private applyRegistryEntry(x: RegistryEntry, now: number): void {
    const entry = this.entries.get(x.sessionId) ?? this.newEntry(x.sessionId, x.cwd, x.statusUpdatedAt, now);
    const a = entry.agent;
    entry.everInRegistry = true;
    entry.inRegistry = true;
    entry.missingReads = 0;
    const activeSince = x.status === 'idle' ? null : (entry.reg?.activeSince ?? Math.max(x.statusUpdatedAt, this.opts.startedAt));
    entry.reg = { status: x.status, updatedAt: x.statusUpdatedAt, activeSince };
    if (x.name) {
      entry.regName = x.name;
      a.title = x.name;
    }
    if (x.cwd && x.cwd !== a.cwd) {
      a.cwd = x.cwd;
      a.project = this.opts.resolveProject(x.cwd);
    }
    // 퇴근(SessionEnd) 직후 잠깐 남은 파일로 되살리지 않는다 — 그 뒤에 새로 쓰인 기록(이어서 열기)만
    if (!entry.hookSeen || (a.status === 'gone' && x.statusUpdatedAt > a.since)) {
      this.mirror(entry, x);
    } else {
      const w = this.shownWait(entry);
      if (w && x.status === 'busy' && entry.waitSince !== null && x.statusUpdatedAt > entry.waitSince) {
        // R1: 대기에 들어간 뒤 일하기 시작 = 사용자가 답했다(승인·거절·질문 답)
        const tools = [...entry.openTools.values()];
        this.clearWaits(entry);
        const helping = a.subagents.length > 0;
        if (entry.stopError) {
          this.finishTurn(entry, x.statusUpdatedAt);
        } else if (w === 'permission') {
          const last = tools.at(-1);
          this.setStatus(a, last?.activity ?? (helping ? 'delegating' : 'running'), x.statusUpdatedAt);
          a.detail = last?.detail ?? null;
        } else {
          this.setStatus(a, helping || tools.some((t) => t.activity === 'delegating') ? 'delegating' : 'thinking', x.statusUpdatedAt);
          a.detail = null;
        }
      } else if (x.status === 'idle' && x.statusUpdatedAt > (entry.lastHookAt ?? 0) && (w || groupOf(a.status) === 'working')) {
        // R6: 마지막 훅 뒤에 등록부가 쉼 = Stop 훅 없이 차례가 끝남(승인 거절·중단 등) → 내 차례.
        // 등록부는 백그라운드 도우미가 일하는 동안 busy라서(실측) 쉼이면 도우미 목록도 비운다
        this.clearWork(entry);
        a.subagents = [];
        this.setStatus(a, 'done', x.statusUpdatedAt);
        a.detail = null;
      } else if (this.opts.registryWaitRule && !w && groupOf(a.status) === 'working' && x.status === 'waiting'
        && now - x.statusUpdatedAt >= WAIT_GRACE_MS && (entry.lastHookAt ?? 0) < x.statusUpdatedAt) {
        // R2: 훅 없이 나를 기다림(앱이 질문·승인을 차례로 묻는 경우 등)
        entry.waitingMain = 'question';
        entry.waitSince = x.statusUpdatedAt;
        entry.waitGuessed = true;
        this.setStatus(a, 'question', x.statusUpdatedAt);
        a.detail = null;
      }
    }
    a.hookless = !entry.hookSeen && activeSince !== null && now - activeSince >= HOOKLESS_MS;
  }

  /** 훅 없는 세션(또는 퇴근 뒤 다시 나타난 세션): 등록부 값을 그대로 보여 준다 */
  private mirror(entry: Entry, x: RegistryEntry): void {
    const a = entry.agent;
    const s = MIRROR[x.status];
    if (a.status === s || (s === 'done' && a.status === 'idle')) return; // 30분 뒤 😴를 되돌리지 않음
    if (WAITS.has(s)) {
      entry.waitingMain = 'question';
      entry.waitSince = x.statusUpdatedAt;
      entry.waitGuessed = true;
    } else {
      this.clearWork(entry);
    }
    this.setStatus(a, s, x.statusUpdatedAt);
    a.detail = null;
  }

  /**
   * 알림(Notification)에서 온 대기 신호를 버릴까:
   * 이미 훅으로 받은 대기가 걸려 있음(같은 창의 6초 뒤 알림) · 등록부가 일하는 중이라는데 늦게 온 알림.
   * 알림은 창이 6초 넘게 떠 있을 때만 오므로 답한 뒤 오는 건 경합뿐 — 알림 전용 승인(샌드박스 네트워크)은 막지 않는다
   */
  private ignoreNotice(entry: Entry): boolean {
    if (this.shownWait(entry) !== null && !entry.waitGuessed) return true;
    // 낡은 값 금지: 마지막 읽기가 성공했고 이 세션이 그 목록에 있을 때만 등록부 busy를 믿는다
    return this.opts.registryWaitRule && this.registry === 'ok' && entry.inRegistry && entry.reg?.status === 'busy';
  }

  private health(agents: Agent[]): Health {
    return {
      startedAt: this.opts.startedAt,
      lastHookAt: this.lastHook,
      registry: this.registry,
      sessions: agents.filter((a) => a.status !== 'gone').length,
      hookless: agents.filter((a) => a.hookless).length,
    };
  }

  private create(e: OfficeEvent): Entry {
    const entry = this.newEntry(e.sessionId, e.cwd, e.at, e.at);
    if (e.type === 'session-start') {
      entry.agent.status = 'done';
      entry.agent.detail = '새 세션';
    }
    return entry;
  }

  private newEntry(sessionId: string, cwd: string, since: number, now: number): Entry {
    const used = [...this.entries.values()].map((x) => x.agent);
    const agent: Agent = {
      id: `claude:${sessionId}`,
      kind: 'claude',
      sessionId,
      title: null,
      cwd,
      project: this.opts.resolveProject(cwd),
      status: 'thinking',
      detail: null,
      since,
      lastEventAt: now,
      hat: firstFree(used.map((a) => a.hat), used.length % SLOTS),
      seat: firstFree(used.map((a) => a.seat), -1),
      subagents: [],
      hookless: false,
      context: null,
    };
    const entry: Entry = {
      agent, openTools: new Map(), transcriptPath: null, waitingMain: null, waitingSubs: new Map(), waitSince: null,
      hookSeen: false, lastHookAt: null, reg: null, everInRegistry: false, inRegistry: false, missingReads: 0, regName: null, waitGuessed: false, stopError: null,
    };
    this.entries.set(sessionId, entry);
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
        entry.stopError = null; // 메인이 다시 일함
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
      case 'stop': {
        // 메인 차례만 끝남 — 백그라운드 도우미의 대기는 남기고, 도우미가 아직 일하면 👥. 오류로 멈췄으면 오류가 먼저
        entry.openTools.clear();
        entry.waitingMain = null;
        entry.stopError = e.error ?? null;
        const wait = this.shownWait(entry);
        if (wait) {
          this.setStatus(a, wait, e.at);
        } else {
          this.clearWaits(entry);
          this.finishTurn(entry, e.at);
        }
        return;
      }
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
        entry.stopError = null;
        this.setStatus(a, 'thinking', e.at);
        a.detail = null;
        return;
      case 'subagent-start':
        if (!a.subagents.some((s) => s.id === e.agentId)) a.subagents.push({ id: e.agentId, type: e.agentType, since: e.at });
        return;
      case 'subagent-stop':
        a.subagents = a.subagents.filter((s) => s.id !== e.agentId);
        if (entry.waitingSubs.delete(e.agentId)) this.resolveWaiting(entry, e.at);
        if (a.status === 'delegating' && a.subagents.length === 0 && entry.openTools.size === 0) {
          // 메인 차례가 끝난 뒤 도우미가 다 끝남 → 메인이 결과를 받아 이어 감(안 이어 가면 등록부 idle·idle 알림이 ✅로)
          this.setStatus(a, 'thinking', e.at);
          a.detail = null;
        }
        return;
      case 'session-end':
        this.clearWork(entry);
        a.subagents = [];
        this.setStatus(a, 'gone', e.at);
        a.detail = null;
        return;
      case 'title':
        if (!entry.regName) a.title = e.title;
        return;
      case 'idle':
        // idle_prompt는 백그라운드 도우미가 없을 때만 온다(공식 문서) → 남은 도우미 목록은 낡은 것
        a.subagents = [];
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
    entry.waitGuessed = false;
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
    if (entry.stopError) {
      this.finishTurn(entry, at);
      return;
    }
    this.setStatus(a, entry.openTools.size > 0 || a.subagents.length > 0 ? 'delegating' : 'thinking', at);
    a.detail = null;
  }

  /** 메인 차례가 끝났을 때의 표시: 오류로 멈췄으면 ✅ + 오류, 도우미가 일하면 👥, 아니면 ✅ */
  private finishTurn(entry: Entry, at: number): void {
    const a = entry.agent;
    if (entry.stopError) {
      this.setStatus(a, 'done', at);
      a.detail = `오류: ${entry.stopError}`;
    } else {
      this.setStatus(a, a.subagents.length > 0 ? 'delegating' : 'done', at);
      a.detail = null;
    }
  }

  private clearWaits(entry: Entry): void {
    entry.waitingMain = null;
    entry.waitGuessed = false;
    entry.waitingSubs.clear();
    entry.waitSince = null;
  }

  private clearWork(entry: Entry): void {
    entry.openTools.clear();
    entry.stopError = null;
    this.clearWaits(entry);
  }

  private setStatus(a: Agent, s: Status, at: number): void {
    if (groupOf(s) !== groupOf(a.status) || (a.status !== s && (s === 'idle' || s === 'stalled' || s === 'gone'))) a.since = at;
    a.status = s;
  }

  /** 화면에 보이는 것: 에이전트들 + 등록부 상태(연결 띠 패널) */
  private fingerprint(): string {
    return JSON.stringify([this.registry, ...[...this.entries.values()].map((x) => x.agent)]);
  }
}

/** 0..SLOTS-1 중 안 쓰는 가장 작은 수, 다 쓰면 fallback */
function firstFree(used: number[], fallback: number): number {
  for (let i = 0; i < SLOTS; i++) if (!used.includes(i)) return i;
  return fallback;
}
