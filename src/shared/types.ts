// 서버와 화면이 함께 쓰는 데이터 형식.

export type Activity = 'reading' | 'editing' | 'running' | 'delegating';
export type Status = 'permission' | 'question' | 'done' | 'thinking' | Activity | 'compacting' | 'stalled' | 'quota' | 'idle' | 'gone';
/** 나를 기다리는 종류: 승인 / 질문 */
export type WaitKind = 'permission' | 'question';
/** 대화 정리를 누가 시작했나: /compact 직접 / 자동 */
export type CompactTrigger = 'manual' | 'auto';
export type Group = 'urgent' | 'waiting' | 'working' | 'rest';
export type AgentKind = 'claude';

type EventBase = {
  sessionId: string;
  at: number;
  cwd: string;
  title?: string;
  transcriptPath?: string;
  /** 하위 에이전트 안에서 난 이벤트면 그 하위 에이전트 id */
  subagentId?: string;
};

export type OfficeEvent = EventBase & (
  | { type: 'session-start' }
  | { type: 'prompt' }
  /** 차례가 끝남. error = 한도 말고 다른 API 오류로 멈춘 경우의 종류(overloaded 등) */
  | { type: 'stop'; error?: string }
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
};

/** resetsAt = epoch 초 */
export type UsageWindow = { pct: number; resetsAt: number };
export type Usage = { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; at: number };
export type Snapshot = { agents: Agent[]; usage: Usage | null; now: number };

/** Claude 앱 세션 목록 폴더 상태: 읽힘 / 폴더 없음 / 못 읽음 */
export type RegistryHealth = 'ok' | 'missing' | 'error';
