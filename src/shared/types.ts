// 서버와 화면이 함께 쓰는 데이터 형식.

export type Activity = 'reading' | 'editing' | 'running' | 'delegating';
export type Status = 'permission' | 'question' | 'done' | 'thinking' | Activity | 'compacting' | 'stalled' | 'quota' | 'idle' | 'gone';
/** 나를 기다리는 종류: 승인 / 질문 */
export type WaitKind = 'permission' | 'question';
/** 대화 정리를 누가 시작했나: /compact 직접 / 자동 */
export type CompactTrigger = 'manual' | 'auto';
export type Group = 'urgent' | 'waiting' | 'working' | 'rest';
export type AgentKind = 'claude' | 'codex';

type EventBase = {
  sessionId: string;
  at: number;
  cwd: string;
  title?: string;
  transcriptPath?: string;
  /** 하위 에이전트 안에서 난 이벤트면 그 하위 에이전트 id */
  subagentId?: string;
  /** 어느 에이전트의 신호인가 (없으면 claude) */
  kind?: AgentKind;
  /** 훅이 알려 준 모델 id(Codex는 모든 사건, Claude는 SessionStart에만 가끔) */
  model?: string;
};

export type OfficeEvent = EventBase & (
  | { type: 'session-start' }
  | { type: 'prompt' }
  /** 차례가 끝남. error = 한도 말고 다른 API 오류로 멈춘 경우의 종류(overloaded 등), interrupted = Codex 중단(Interrupt) */
  | { type: 'stop'; error?: string; interrupted?: boolean }
  | { type: 'session-end' }
  /** 입력을 기다린다는 알림(Stop 없이 끝난 차례 대비) */
  | { type: 'idle' }
  | { type: 'tool-start'; toolUseId: string; activity: Activity; detail: string }
  | { type: 'tool-end'; toolUseId: string }
  /** viaNotification: 늦게 올 수 있는 Notification 훅에서 왔음(PermissionRequest가 아니라) */
  | { type: 'permission'; detail: string; viaNotification?: true }
  | { type: 'question'; detail: string | null; viaNotification?: true }
  | { type: 'compact-start'; trigger: CompactTrigger }
  | { type: 'compact-end'; trigger: CompactTrigger }
  /** 사용량 한도에 걸려 멈춤 */
  | { type: 'quota-wait' }
  /** 한도가 풀려 자동으로 이어 감 */
  | { type: 'resume' }
  | { type: 'subagent-start'; agentId: string; agentType: string | null }
  | { type: 'subagent-stop'; agentId: string }
  | { type: 'title'; title: string }
);

export type Subagent = { id: string; type: string | null; since: number };

export type Agent = {
  id: string;
  kind: AgentKind;
  sessionId: string;
  title: string | null;
  cwd: string;
  project: string;
  status: Status;
  detail: string | null;
  since: number;
  lastEventAt: number;
  hat: number;
  seat: number;
  subagents: Subagent[];
  /** 등록부엔 일하는 중인데 서버가 켜진 뒤 훅이 한 번도 안 옴(2분 넘게) → '훅 없음' 태그 */
  hookless: boolean;
  /** 대화 게이지: 이 세션 대화가 모델의 기억 창을 얼마나 채웠나 (모르면 null) */
  context: AgentContext | null;
  /** 훅이 마지막으로 알려 준 모델 id (모르면 null — 화면은 대화 게이지의 모델로 대신함) */
  model: string | null;
};

/** ok = 마지막 답 기준 사용 토큰과 창 크기(모르는 모델이면 null) / compacted = 정리 직후라 다음 답부터 다시 계산 */
export type AgentContext = { state: 'ok'; used: number; window: number | null; model: string } | { state: 'compacted' };

/** resetsAt = epoch 초 */
export type UsageWindow = { pct: number; resetsAt: number };
export type Usage = { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; at: number };
/** 연결 띠·npm run doctor용: 서버가 제대로 듣고 있나 */
export type Health = { startedAt: number; lastHookAt: number | null; registry: RegistryHealth; sessions: number; hookless: number; lastCodexHookAt: number | null };
export type Snapshot = { agents: Agent[]; usage: Usage | null; now: number; health: Health };

/** Claude 앱 세션 목록 폴더 상태: 읽힘 / 폴더 없음 / 못 읽음 */
export type RegistryHealth = 'ok' | 'missing' | 'error';
