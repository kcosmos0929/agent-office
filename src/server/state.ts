// 상태 정리기: 이벤트를 받아 에이전트별 상태를 갱신한다. 화면·수집기·시계를 모르는 순수 로직(시간은 이벤트·tick 인자로만).
import { groupOf } from '../shared/labels.ts';
import type { Activity, Agent, AgentKind, Health, OfficeEvent, RegistryHealth, Snapshot, Status, Usage, WaitKind } from '../shared/types.ts';
import type { RegistryEntry, RegistryRead, RegistryStatus } from './collectors/sessionRegistry.ts';
import type { ContextReading } from './collectors/contextUsage.ts';
import { contextWindow } from '../shared/contextWindow.ts';

export type StateOptions = {
  /** ✅ 차례가 끝나고 이만큼 지나면 😴(쉬는 중) */
  restMs: number;
  /** 차례가 끝난 때부터 이만큼 지나면 👋(자동 퇴근) — 😴 시간도 포함한 총 시간 */
  leaveMs: number;
  goneMs: number;
  stalledMs: number;
  /** 이 시간 동안 아무 신호가 없으면 상태와 상관없이 정리(종료 신호 없이 닫힌 세션) */
  forgetMs: number;
  resolveProject: (cwd: string) => string;
  /** 서버가 켜진 시각 — '훅 없음' 2분을 이때부터 잰다 */
  startedAt: number;
  /** 등록부 waiting을 '사용자 입력 기다림'으로 믿어도 되나(설계 R2·늦은 알림 무시). Task 0 실제 확인으로 정함 */
  registryWaitRule: boolean;
  /** Codex 승인 요청을 이만큼 '승인 확인 중'으로 보여 준 뒤 ❗(기본 5초) — 자동 승인(AutoReview)은 그 사이에 풀림 */
  approvalDelayMs?: number;
  /** Codex 앱 자동 승인을 쓰나(설정 창 스위치, 바로 반영되게 함수) — 켜져 있으면 Codex 승인 요청을 무시 */
  codexAutoApprove?: () => boolean;
  /** 세션이 만진 경로 → 프로젝트 이름표(모르면 null). 없으면 시작 폴더로만 정함 */
  resolveWork?: (p: string, cwd: string) => string | null;
};

const SLOTS = 8;
/** 나를 기다리는 상태(❗·❓, 그리고 ❗가 되기 전의 🛡️) */
const WAITS = new Set<Status>(['permission', 'approving', 'question']);
const APPROVAL_DELAY_MS = 5_000;
/** 열기만 한 세션: 이 신호들만으로는 보드에 올리지 않는다(앱이 지난 세션을 열 때 시작 신호만 옴) */
const NOT_WORK = new Set<OfficeEvent['type']>(['session-start', 'title', 'idle', 'session-end']);
/** 훅 없이 등록부로만 보는 idle 세션: 프로세스 시작 뒤 이만큼 넘어 상태가 바뀌었으면 한 차례라도 일한 것 */
const OPENED_ONLY_MS = 10_000;
/** 도구 끝 신호가 늦게 와도 바꾸지 않는 상태 */
const SETTLED = new Set<Status>(['done', 'idle', 'gone', 'quota', 'compacting']);
/** 등록부만 있고 훅이 없는 세션이 이만큼 일하는 중이면 '훅 없음' */
const HOOKLESS_MS = 2 * 60_000;
/** 등록부 waiting 뒤 이만큼 훅이 없으면 질문 대기로(R2) */
const WAIT_GRACE_MS = 2_000;
/** 훅 없는 세션: 등록부 값 → 화면 상태 */
const MIRROR: Record<RegistryStatus, Status> = { busy: 'thinking', waiting: 'question', idle: 'done' };

type OpenTool = { activity: Activity; detail: string; spawn?: true };

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
  /** 승인 대기마다 시작 시각('main' 또는 도우미 id) — Codex 🛡️→❗를 남은 승인 중 가장 오래된 것 기준으로 */
  approvalSince: Map<string, number>;
  /** 일을 한 번이라도 했나 — 아니면(열기만 함) 보드에 안 보이고 모자·자리도 안 받음 */
  engaged: boolean;
  /** 메인 차례가 끝났나(Stop) — 그 뒤 도우미 대기가 풀리면 차례 끝 표시(finishTurn)로 돌아간다. 메시지·메인 도구·이어 감이면 false */
  turnEnded: boolean;
  /** 이 차례가 다음 할 일 상자에 질문을 남겼나 — 차례가 끝나면 ✅ 대신 ❓. 메시지·메시지 없이 다시 일함이면 false */
  turnAsk: boolean;
  /** 만진 경로로 알아낸 마지막 프로젝트 — 있으면 시작 폴더 이름표보다 우선 */
  workProject: string | null;
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
  /** 차례가 끝난(✅) 시각 — 😴가 될 때 기억해 두고 퇴근까지 잰다 */
  restFrom: number | null;
  /** 오래 쉬어서 자동으로 퇴근했나(창을 닫은 퇴근과 구분) — 그렇다면 지우지 않고 숨겨 두었다가 다시 일하면 돌아온다 */
  autoGone: boolean;
};

export class OfficeState {
  private readonly opts: StateOptions;
  private readonly entries = new Map<string, Entry>();
  private usage: Usage | null = null;
  private registry: RegistryHealth = 'missing';
  private lastHook: number | null = null;
  private lastCodexHook: number | null = null;

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
    const known = this.entries.get(e.sessionId);
    // 메인이 정리 중이 아닌 PreCompact — 상태·자리·세션의 마지막 신호 시각을 그대로(등록부 보정 R6도 이 신호에 막히지 않게)
    if (this.quietCompact(known, e)) {
      this.lastHook = e.at;
      return this.fingerprint() !== before;
    }
    const entry = known ?? this.create(e);
    const a = entry.agent;
    a.lastEventAt = e.at;
    if (e.type !== 'title') {
      entry.hookSeen = true;
      entry.lastHookAt = e.at;
      this.lastHook = e.at;
      if (a.kind === 'codex') this.lastCodexHook = e.at;
      a.hookless = false;
    }
    if (e.title && !entry.regName) a.title = e.title;
    if (e.model) a.model = e.model;
    if ((e.type === 'permission' || e.type === 'question') && e.viaNotification && this.ignoreNotice(entry)) {
      return this.fingerprint() !== before;
    }
    if (e.transcriptPath) entry.transcriptPath = e.transcriptPath;
    if (e.cwd && e.cwd !== a.cwd) {
      a.cwd = e.cwd;
      a.project = entry.workProject ?? this.opts.resolveProject(e.cwd);
    }

    const hiddenAuto = entry.autoGone && !entry.engaged; // 자동 퇴근해 숨은 세션
    // 숨은 세션에 홀로 온 도우미 신호는 일 신호가 아니다 — 낡은 도우미가 다시 일할 때 딸려 오지 않게 무시
    if (hiddenAuto && (e.type === 'subagent-start' || e.type === 'subagent-stop')) return this.fingerprint() !== before;
    if (!NOT_WORK.has(e.type)) this.engage(entry);
    // Codex 자동 승인: AI가 곧 허용하는데 '승인됐다'는 신호가 없어 긴 명령 내내 대기로 보이므로 무시하고 하던 일을 그대로
    if (e.type === 'permission' && a.kind === 'codex' && this.opts.codexAutoApprove?.()) {
      this.settleAutoGone(entry, hiddenAuto);
      return this.fingerprint() !== before;
    }
    if (e.subagentId) {
      this.applySubagentEvent(entry, e, e.subagentId);
    } else {
      this.applyMainEvent(entry, e);
    }
    // SessionEnd는 숨은 세션도 숨기지 않고 지움(다시 숨기면 forgetMs까지 낡은 제목으로 남는다)
    this.settleAutoGone(entry, hiddenAuto && e.type !== 'session-end');
    return this.fingerprint() !== before;
  }

  /** 사건 뒤 자동 퇴근 표시 정리: 아직 gone이면(도구 끝 같은 낡은 신호) 숨은 채로 두고, 일하는 상태로 나왔으면 자동 퇴근을 푼다 */
  /**
   * 메인이 정리 중이 아닌 PreCompact인가.
   * 미리 정리(Claude Code 2.1.308 실측): 쉬는 동안·도구를 돌리는 동안 다음 정리본을 뒤에서 미리 만들며 자동 PreCompact만 보낸다
   * (PostCompact는 다음에 실제로 바꿔 낄 때, 차례 안에서). 진짜 자동 정리는 메인 차례 도중 도구가 다 끝난 뒤에만 일어나므로
   * 일하는 중이 아니거나(쉼·기다림·퇴근)·메인 도구가 열려 있거나·차례가 끝나 도우미만 일하면 미리 정리로 본다.
   * 처음 보는 세션(서버를 막 켬)도 이 신호만으로 올리지 않는다 — 등록부·다음 신호가 데려온다.
   * 도우미의 정리는 메인 상태를 바꾸지 않으니 메인의 보정 기준 시각도 건드리지 않는다
   */
  private quietCompact(entry: Entry | undefined, e: OfficeEvent): boolean {
    if (e.type !== 'compact-start') return false;
    if (e.subagentId) return true;
    if (e.trigger !== 'auto') return false;
    if (!entry) return true;
    const a = entry.agent;
    return groupOf(a.status) !== 'working' || entry.openTools.size > 0 || (entry.turnEnded && a.subagents.length > 0);
  }

  private settleAutoGone(entry: Entry, hiddenAuto: boolean): void {
    if (entry.agent.status !== 'gone') {
      entry.autoGone = false;
    } else if (hiddenAuto) {
      entry.engaged = false;
      entry.autoGone = true;
    }
  }

  /** 세션이 만진 경로들(한 신호분)에서 처음 알아낸 프로젝트를 이름표로. 못 알아내면 그대로(마지막 것이 남음) */
  touchPaths(sessionId: string, paths: string[], cwd: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry || !this.opts.resolveWork) return false;
    for (const p of paths) {
      const project = this.opts.resolveWork(p, cwd || entry.agent.cwd);
      if (!project) continue;
      entry.workProject = project;
      if (entry.agent.project === project) return false;
      entry.agent.project = project;
      return true;
    }
    return false;
  }

  /** 'Codex 자동 승인'을 켤 때: 이미 걸린 Codex 승인 대기(메인·도우미)만 지우고 하던 일로 되돌린다. 질문 대기는 그대로 */
  dropCodexApprovals(now: number): boolean {
    const before = this.fingerprint();
    for (const entry of this.entries.values()) {
      if (entry.agent.kind !== 'codex') continue;
      let dropped = false;
      if (entry.waitingMain === 'permission') {
        entry.waitingMain = null;
        dropped = true;
      }
      for (const [id, kind] of entry.waitingSubs) {
        if (kind !== 'permission') continue;
        entry.waitingSubs.delete(id);
        dropped = true;
      }
      if (!dropped || !WAITS.has(entry.agent.status)) continue;
      const a = entry.agent;
      const shown = this.shownWait(entry);
      if (shown) {
        this.setStatus(a, this.waitStatus(entry, shown, now), now);
        a.detail = null;
        continue;
      }
      entry.waitSince = null;
      if (entry.stopError || entry.turnEnded) {
        this.finishTurn(entry, now);
        continue;
      }
      // 하던 일로: 열린 메인 도구가 있으면 그 활동·내용, 없으면 도우미가 일하면 👥, 아니면 💭
      const open = [...entry.openTools.values()].at(-1);
      this.setStatus(a, open ? open.activity : a.subagents.length > 0 ? 'delegating' : 'thinking', now);
      a.detail = open ? open.detail : null;
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
      } else if (a.status === 'done' && now - a.since >= this.opts.restMs) {
        entry.restFrom = a.since;
        this.setStatus(a, 'idle', now);
        changed = true;
      } else if (a.status === 'idle' && entry.restFrom !== null && now - entry.restFrom >= this.opts.leaveMs) {
        // 오래 쉬면 자동 퇴근 — 화면엔 👋로 잠깐 보이고, 아래에서 숨긴다
        this.clearWork(entry);
        entry.turnAsk = false; // 퇴근(SessionEnd·R4와 같이) — 돌아와 끝난 차례가 낡은 상자 질문으로 ❓가 되지 않게
        a.subagents = [];
        a.hookless = false;
        entry.autoGone = true;
        this.setStatus(a, 'gone', now);
        a.detail = null;
        // 서버 재시작·잠자기 뒤처럼 퇴근이 한참 늦게 걸렸으면 👋를 또 10분 보이지 않고 바로 숨긴다
        if (now - entry.restFrom >= this.opts.leaveMs + this.opts.goneMs) entry.engaged = false;
        changed = true;
      } else if (
        entry.hookSeen && now - a.lastEventAt >= this.opts.stalledMs && (
          a.status === 'thinking' || a.status === 'compacting' ||
          // Codex 도우미를 띄운 뒤 유지하던 👥인데 열린 도구도 도우미도 없이 조용 = 기다리기 전에 Codex가 멈춤
          (a.status === 'delegating' && entry.openTools.size === 0 && a.subagents.length === 0)
        )
      ) {
        // 훅 없는 세션은 등록부가 기준이라 '응답 없음'으로 바꾸지 않는다
        this.setStatus(a, 'stalled', now);
        changed = true;
      } else if (a.status === 'approving' && this.waitStatus(entry, 'permission', now) === 'permission') {
        // 몇 초가 지나도 승인이 안 풀림 = 정말 나를 기다림 → ❗(이때 알림음)
        this.setStatus(a, 'permission', now);
        changed = true;
      } else if (a.status === 'gone' && now - a.since >= this.opts.goneMs) {
        if (!entry.autoGone) {
          this.entries.delete(id);
          changed = true;
        } else if (entry.engaged) {
          // 자동 퇴근은 지우지 않고 숨긴다(모자·자리를 놓음) — 다시 일하면 새 모자·자리로 돌아옴
          entry.engaged = false;
          changed = true;
        }
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

  /** 보드에 보이는 세션(일을 한 번이라도 한 것) */
  private visible(): Agent[] {
    return [...this.entries.values()].filter((x) => x.engaged).map((x) => x.agent);
  }

  /** 처음 일을 시작한 순간 보드에 올리고, 그때 비어 있는 모자·자리를 준다(열기만 한 세션이 자리를 막지 않게) */
  private engage(entry: Entry): void {
    if (entry.engaged) return;
    const used = this.visible();
    const a = entry.agent;
    a.hat = firstFree(used.map((x) => x.hat), used.length % SLOTS);
    a.seat = firstFree(used.filter((x) => x.kind === a.kind).map((x) => x.seat), -1);
    entry.engaged = true;
    entry.autoGone = false;
  }

  snapshot(now: number): Snapshot {
    const agents = this.visible().map((agent) => ({ ...agent, subagents: agent.subagents.map((s) => ({ ...s })) }));
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
        entry.turnAsk = false; // SessionEnd와 같이
        entry.autoGone = false; // SessionEnd와 같이 창을 닫은 퇴근 — 숨기지 않고 10분 뒤 지운다
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
    // 훅 없이 등록부로만 보는 세션: 일하는 중·기다림이거나, 프로세스 시작 뒤 한 차례라도 했으면 보드에(열기만 한 세션은 숨김).
    // 훅을 받은 세션은 훅이 일을 알려 준다
    // 자동 퇴근해 숨은 세션은 퇴근 뒤에 바뀐 일하는 중·기다림 값이 있을 때만 돌아온다(같은 idle 값이 반복돼도 숨김 유지)
    if (entry.autoGone && !entry.engaged && x.status !== 'idle' && x.statusUpdatedAt > a.since) this.engage(entry);
    if (!entry.autoGone && !entry.hookSeen && (x.status !== 'idle' || x.startedAt === undefined || x.statusUpdatedAt - x.startedAt > OPENED_ONLY_MS)) this.engage(entry);
    entry.missingReads = 0;
    const activeSince = x.status === 'idle' ? null : (entry.reg?.activeSince ?? Math.max(x.statusUpdatedAt, this.opts.startedAt));
    entry.reg = { status: x.status, updatedAt: x.statusUpdatedAt, activeSince };
    if (x.name) {
      entry.regName = x.name;
      a.title = x.name;
    }
    if (x.cwd && x.cwd !== a.cwd) {
      a.cwd = x.cwd;
      a.project = entry.workProject ?? this.opts.resolveProject(x.cwd);
    }
    // 퇴근(SessionEnd) 직후 잠깐 남은 파일로 되살리지 않는다 — 그 뒤에 새로 쓰인 기록(이어서 열기)만
    if (entry.autoGone && !entry.engaged) {
      // 숨은 세션은 돌아오는 값(위에서 engage)이 아니면 건드리지 않는다
    } else if (!entry.hookSeen || (a.status === 'gone' && x.statusUpdatedAt > a.since)) {
      this.mirror(entry, x);
    } else {
      const w = this.shownWait(entry);
      if (w && x.status === 'busy' && entry.waitSince !== null && x.statusUpdatedAt > entry.waitSince) {
        // R1: 대기에 들어간 뒤 일하기 시작 = 사용자가 답했다(승인·거절·질문 답)
        const tools = [...entry.openTools.values()];
        this.clearWaits(entry);
        const helping = a.subagents.length > 0;
        if (entry.stopError || entry.turnEnded) {
          // 메인 차례가 이미 끝남(도우미 대기만 풀림) → 차례 끝 표시(상자 질문이면 ❓, 도우미가 일하면 👥)
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
        // Stop보다 먼저 올 수 있다 → 상자 질문은 남겨 두고 차례 끝 표시로(❓ 또는 ✅)
        entry.turnEnded = true;
        this.finishTurn(entry, x.statusUpdatedAt);
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
    // 쉬어서 생긴 😴·자동 퇴근을 등록부의 같은 idle 값으로 되돌리지 않음
    if (a.status === s || (s === 'done' && (a.status === 'idle' || (a.status === 'gone' && entry.autoGone)))) return;
    entry.autoGone = false;
    if (s !== 'done' || a.status === 'gone') entry.turnEnded = false; // 되돌아와 다시 일하거나 기다림 = 새 차례(낡은 '차례 끝'이 R1에서 ✅를 만들지 않게)
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
      lastCodexHookAt: this.lastCodexHook,
    };
  }

  private create(e: OfficeEvent): Entry {
    const entry = this.newEntry(e.sessionId, e.cwd, e.at, e.at, e.kind ?? 'claude');
    if (e.type === 'session-start') {
      entry.agent.status = 'done';
      entry.agent.detail = '새 세션';
    }
    return entry;
  }

  private newEntry(sessionId: string, cwd: string, since: number, now: number, kind: AgentKind = 'claude'): Entry {
    const used = this.visible();
    // 자리는 종류별로 따로 매긴다(Codex는 3단계 개발실 자리) — 모자 색은 세션 구분용이라 같이 쓴다
    const sameKind = used.filter((a) => a.kind === kind);
    const agent: Agent = {
      id: `${kind}:${sessionId}`,
      kind,
      sessionId,
      title: null,
      cwd,
      project: this.opts.resolveProject(cwd),
      status: 'thinking',
      detail: null,
      since,
      lastEventAt: now,
      hat: firstFree(used.map((a) => a.hat), used.length % SLOTS),
      seat: firstFree(sameKind.map((a) => a.seat), -1),
      subagents: [],
      hookless: false,
      context: null,
      model: null,
    };
    const entry: Entry = {
      agent, openTools: new Map(), transcriptPath: null, waitingMain: null, waitingSubs: new Map(), waitSince: null, approvalSince: new Map(), engaged: false, workProject: null, turnEnded: false, turnAsk: false,
      hookSeen: false, lastHookAt: null, reg: null, everInRegistry: false, inRegistry: false, missingReads: 0, regName: null, waitGuessed: false, stopError: null, restFrom: null, autoGone: false,
    };
    this.entries.set(sessionId, entry);
    return entry;
  }

  private applyMainEvent(entry: Entry, e: OfficeEvent): void {
    const a = entry.agent;
    switch (e.type) {
      case 'session-start':
        if (a.status === 'gone') {
          // 퇴근한 세션을 다시 열기만 함 → 메시지를 보낼 때까지 안 보임(모자·자리도 그때 다시)
          this.setStatus(a, 'done', e.at);
          a.detail = '새 세션';
          entry.engaged = false;
        }
        return;
      case 'prompt':
        entry.turnEnded = false;
        entry.turnAsk = false; // 내가 답함
        this.clearWork(entry);
        // Codex 도우미는 그 차례에 묶인다 — Codex엔 등록부·idle 알림이 없어, 놓친 SubagentStop을 여기서 거둔다
        if (a.kind === 'codex') a.subagents = [];
        this.setStatus(a, 'thinking', e.at);
        a.detail = null;
        return;
      case 'tool-start':
        // 차례가 끝난 뒤 메시지 없이 다시 일함(백그라운드 작업이 끝나 이어 감 등) → 상자 질문은 지난 것
        if (entry.turnEnded) entry.turnAsk = false;
        entry.turnEnded = false;
        entry.openTools.set(e.toolUseId, { activity: e.activity, detail: e.detail, ...(e.spawn ? { spawn: true } : {}) });
        entry.stopError = null; // 메인이 다시 일함
        if (WAITS.has(a.status) && this.shownWait(entry)) return;
        this.setStatus(a, e.activity, e.at);
        a.detail = e.detail;
        return;
      case 'tool-end': {
        const wasSpawn = entry.openTools.get(e.toolUseId)?.spawn === true;
        entry.openTools.delete(e.toolUseId);
        if (SETTLED.has(a.status)) return;
        if (entry.openTools.size > 0) return;
        // 메인 도구가 모두 끝남 = 메인 대기도 끝남(대기 신호엔 도구 id가 없어 도구별로는 못 가린다)
        entry.waitingMain = null;
        if (WAITS.has(a.status)) {
          this.resolveWaiting(entry, e.at);
        } else if (wasSpawn && a.kind === 'codex') {
          // Codex 도우미를 띄운 직후엔 곧 기다리기(wait_agent)가 이어진다 — 사이에 💭로 깜빡이지 않게 👥 유지(detail도 그대로)
          this.setStatus(a, 'delegating', e.at);
        } else {
          this.setStatus(a, 'thinking', e.at);
          a.detail = null;
        }
        return;
      }
      case 'permission':
      case 'question':
        this.noteApproval(entry, 'main', entry.waitingMain, e.type, e.at);
        entry.waitingMain = e.type;
        this.enterWait(entry, e.type, e.detail, e.at);
        return;
      case 'wrap-up':
        if (a.status === 'gone') return; // 퇴근·자동 퇴근·숨은 세션에 늦게 온 상자 신호는 낡은 것 → 돌아와도 ❓가 남지 않게
        entry.turnAsk = e.asks; // 한 차례에 상자를 다시 띄우면 마지막 것이 기준
        // Stop 없이 차례 끝 보정(R6·idle)이 이 PostToolUse보다 먼저 왔으면 끝 표시를 다시 정한다(대기가 걸려 있으면 그대로)
        if (entry.turnEnded && !this.shownWait(entry)) this.finishTurn(entry, e.at);
        return;
      case 'stop': {
        entry.turnEnded = true;
        // 메인 차례만 끝남 — 백그라운드 도우미의 대기는 남기고, 도우미가 아직 일하면 👥. 오류로 멈췄으면 오류가 먼저
        entry.openTools.clear();
        entry.waitingMain = null;
        entry.stopError = e.error ?? null;
        if (e.interrupted) {
          // Codex 중단: 사용자가 멈춘 차례의 도우미와 그 대기도 끝난 것으로
          a.subagents = [];
          entry.waitingSubs.clear();
        }
        const wait = this.shownWait(entry);
        if (wait) {
          this.setStatus(a, this.waitStatus(entry, wait, e.at), e.at);
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
          entry.turnAsk = false; // 내가 /compact를 침 = 답함
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
        entry.turnEnded = false;
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
          // 메인 차례가 끝난 뒤 도우미가 다 끝남 → Claude는 메인이 결과를 받아 이어 감(안 이어 가면 등록부 idle·idle 알림이 ✅로).
          // Codex는 이어 가지 않고 사용자 차례 — 이어 가면 다음 도구 사건이 다시 일하는 중으로 바꾼다.
          // 단 Codex 메인 차례가 아직 안 끝났으면(띄우기 뒤 👥 유지 중 도우미 끝) 계속 생각 중 💭
          this.setStatus(a, a.kind === 'codex' && entry.turnEnded ? 'done' : 'thinking', e.at);
          a.detail = null;
        }
        return;
      case 'session-end':
        entry.autoGone = false; // 창을 닫은 퇴근은 숨기지 않고 지운다
        this.clearWork(entry);
        entry.turnAsk = false;
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
        // Stop보다 먼저 올 수 있다 → 상자 질문은 남겨 두고 차례 끝 표시로(❓ 또는 ✅)
        entry.turnEnded = true;
        this.finishTurn(entry, e.at);
        return;
    }
  }

  /** 하위 에이전트 안의 이벤트: 승인·질문 대기와 그 대기 뒤 도구의 끝만 부모 상태에 영향 */
  private applySubagentEvent(entry: Entry, e: OfficeEvent, subagentId: string): void {
    if (e.type === 'permission' || e.type === 'question') {
      this.noteApproval(entry, subagentId, entry.waitingSubs.get(subagentId) ?? null, e.type, e.at);
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

  /** 새 승인 대기면(그 자리가 승인 대기가 아니었으면) 시작 시각을 적는다. 같은 대기가 다시 와도 처음 시각을 지킴 */
  private noteApproval(entry: Entry, key: string, before: WaitKind | null, kind: WaitKind, at: number): void {
    if (kind === 'permission' && before !== 'permission') entry.approvalSince.set(key, at);
  }

  /** 아직 걸려 있는 승인 대기 중 가장 오래된 시작 시각(풀린 대기의 기록은 버림) */
  private oldestApproval(entry: Entry): number | null {
    let oldest: number | null = null;
    for (const [key, since] of entry.approvalSince) {
      const active = key === 'main' ? entry.waitingMain === 'permission' : entry.waitingSubs.get(key) === 'permission';
      if (!active) entry.approvalSince.delete(key);
      else if (oldest === null || since < oldest) oldest = since;
    }
    return oldest;
  }

  /** 화면에 보일 대기 상태: Codex 승인은 남은 승인 중 가장 오래된 것이 몇 초 안 됐으면 🛡️(자동 승인이면 그 사이 풀림), 넘으면 ❗ */
  private waitStatus(entry: Entry, kind: WaitKind, at: number): Status {
    if (kind !== 'permission' || entry.agent.kind !== 'codex') return kind;
    const since = this.oldestApproval(entry) ?? entry.waitSince;
    return since !== null && at - since < (this.opts.approvalDelayMs ?? APPROVAL_DELAY_MS) ? 'approving' : kind;
  }

  private enterWait(entry: Entry, kind: WaitKind, detail: string | null, at: number): void {
    const a = entry.agent;
    entry.waitSince ??= at;
    entry.waitGuessed = false;
    const shown = this.shownWait(entry) ?? kind;
    this.setStatus(a, this.waitStatus(entry, shown, at), at);
    if (shown === kind) a.detail = detail;
  }

  /** 대기가 하나도 안 남았을 때만 대기 상태를 푼다. 남았으면 남은 종류로 */
  private resolveWaiting(entry: Entry, at: number): void {
    const a = entry.agent;
    if (!WAITS.has(a.status)) return;
    const shown = this.shownWait(entry);
    if (shown) {
      if (shown !== (a.status === 'approving' ? 'permission' : a.status)) a.detail = null;
      this.setStatus(a, this.waitStatus(entry, shown, at), at);
      return;
    }
    entry.waitSince = null;
    // 차례가 이미 끝났으면(Stop·오류) 차례 끝 표시로 — Codex는 도우미가 남아도 ✅, Claude는 도우미가 일하면 👥
    if (entry.stopError || entry.turnEnded) {
      this.finishTurn(entry, at);
      return;
    }
    this.setStatus(a, entry.openTools.size > 0 || a.subagents.length > 0 ? 'delegating' : 'thinking', at);
    a.detail = null;
  }

  /** 메인 차례가 끝났을 때의 표시: 오류로 멈췄으면 ✅ + 오류, 상자 질문을 남겼으면 ❓, (Claude) 도우미가 일하면 👥, 아니면 ✅ */
  private finishTurn(entry: Entry, at: number): void {
    const a = entry.agent;
    if (entry.stopError) {
      this.setStatus(a, 'done', at);
      a.detail = `오류: ${entry.stopError}`;
    } else if (entry.turnAsk) {
      // 다음 할 일 상자에 질문을 남기고 끝남 = 내 답을 기다림(도우미가 일해도 먼저). 다음 메시지까지 그대로
      this.setStatus(a, 'question', at);
      a.detail = null;
    } else {
      // Claude 도우미는 백그라운드에서 이어 일하면 👥. Codex 도우미는 일이 끝나도 살아 있다가 다음 차례에 다시 쓰여서
      // (followup_task·send_message, SubagentStop 없음) 차례 끝은 ✅ — 살아 있는 도우미 수는 목록의 '도우미 N'으로
      this.setStatus(a, a.subagents.length > 0 && a.kind !== 'codex' ? 'delegating' : 'done', at);
      a.detail = null;
    }
  }

  private clearWaits(entry: Entry): void {
    entry.waitingMain = null;
    entry.waitGuessed = false;
    entry.waitingSubs.clear();
    entry.waitSince = null;
    entry.approvalSince.clear();
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
    return JSON.stringify([this.registry, ...this.visible()]);
  }
}

/** 0..SLOTS-1 중 안 쓰는 가장 작은 수, 다 쓰면 fallback */
function firstFree(used: number[], fallback: number): number {
  for (let i = 0; i < SLOTS; i++) if (!used.includes(i)) return i;
  return fallback;
}
