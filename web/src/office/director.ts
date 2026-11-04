// 연출 감독: 에이전트들과 서버 시각만으로 캐릭터마다 자리·방향·자세·걸음·효과를 정하는 순수 계산(three.js·DOM 없음).
// 같은 입력이면 같은 출력 → 화면끼리 같은 장면. cast.ts는 이 계획을 실행만 한다. (설계서 5-1~5-3)
import type { Agent } from '../../../src/shared/types.ts';
import { DESKS, DOOR, EXTRA_REST_SPOTS, OVERFLOW_SPOTS, REST_SPOTS, MEETING_CHAIRS, chairPosition, devChairPosition, devSpot, facingAt, meetingChairPosition, meetingSpot, seatPosition, waitingSpot, type Point, type RestSpot } from './layout.ts';
import { poseFor, type Pose } from './pose.ts';
import { dirFor, lookFor, seatedDir, type Dir, type Pace, type SeatedDir } from './sprites/look.ts';
import { canSit, seatedMode, type SeatedMode } from './sprites/seated.ts';

export type Effect = 'monitor' | 'zzz' | 'dots' | 'wave' | 'ring';
export type Plan = {
  spot: Point;
  facing: Dir;
  pose: Pose;
  pace: Pace;
  effects: Effect[];
  /** 퇴근: 도착하면 사라진다 */
  leave: boolean;
  /** 도우미는 null */
  agent: Agent | null;
  hat: number;
  isSub: boolean;
  /** 자리에 닿으면 의자에 앉는다(의자 가운데 바닥점·방향·움직임, pull = 그림을 카메라 쪽으로 당기는 거리 — 휴게실 소파·빈백). 서 있으면 null */
  sit: { at: Point; dir: SeatedDir; mode: SeatedMode; pull?: number } | null;
};

/** FNV-1a 32비트(부호 없음) — 세션 id로 쉬는 시간·자리를 정하는 고정 해시 */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(id)) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 앞 방향: 등이 보이는 NW·NE는 앞(SW·SE)으로 돌리고, 이미 앞이면 그대로 */
export function frontOf(dir: Dir): Dir {
  if (dir === 'NW') return 'SW';
  if (dir === 'NE') return 'SE';
  return dir;
}

/**
 * 쉬는 세션들의 쉼 자리. id를 정렬해 차례로 받는다:
 * 바라는 자리 (해시 + 시간 칸) mod 쉼 자리 수 → 차 있으면 다음 빈 쉼 자리 → 넘침 자리 → 그 너머 자리(EXTRA_REST_SPOTS, 다 쓰면 처음부터 다시).
 * 머무는 시간은 id마다 3~6분(고정), 세션별 어긋남으로 칸 경계를 흩뜨린다.
 */
export function restAssignments(ids: string[], now: number): Map<string, RestSpot> {
  const out = new Map<string, RestSpot>();
  const taken = new Set<number>();
  const overflowFace = { x: 1, y: 0 };
  let beyond = 0;
  for (const id of [...ids].sort()) {
    const h = hashId(id);
    const dwell = (180 + (h % 181)) * 1000;
    const offset = (h >>> 8) % dwell;
    const slot = Math.floor((now + offset) / dwell);
    const want = (h + slot) % REST_SPOTS.length;
    let pick = -1;
    for (let k = 0; k < REST_SPOTS.length; k++) {
      const i = (want + k) % REST_SPOTS.length;
      if (!taken.has(i)) { pick = i; break; }
    }
    if (pick >= 0) {
      taken.add(pick);
      out.set(id, REST_SPOTS[pick]);
      continue;
    }
    const o = taken.size - REST_SPOTS.length; // 쓴 넘침 자리 수
    if (o < OVERFLOW_SPOTS.length) {
      taken.add(REST_SPOTS.length + o);
      out.set(id, { at: OVERFLOW_SPOTS[o], face: overflowFace });
    } else {
      out.set(id, { at: EXTRA_REST_SPOTS[beyond++ % EXTRA_REST_SPOTS.length], face: overflowFace });
    }
  }
  return out;
}

/** 책상 상태 → 효과 (쉬는 중·퇴근은 따로) */
function deskEffects(status: Agent['status']): Effect[] {
  switch (status) {
    case 'thinking': return ['monitor', 'dots'];
    case 'permission':
    case 'question': return ['wave', 'ring'];
    case 'done':
    case 'stalled': return [];
    case 'quota': return ['zzz'];
    default: return ['monitor'];
  }
}

/**
 * 자기 책상에서 앉는가: 앉는 상태이고 앉은 그림이 있는 모습(seated-v29: 여덟 모습 모두)일 때.
 * Claude 0~7 = 사무실 의자(SE·NW), Codex 0~2 = 개발실 의자(NE — 사무실과 다른 대각선이라 NW 그림을 뒤집어 쓴다).
 */
function sitAt(a: Agent): Plan['sit'] {
  const mode = seatedMode(a.status);
  if (!mode || !canSit(lookFor(a.hat))) return null;
  if (a.kind === 'codex') return a.seat >= 0 && a.seat <= 2 ? { at: devChairPosition(a.seat), dir: 'NE', mode } : null;
  if (a.kind !== 'claude' || a.seat < 0 || a.seat > 7) return null;
  return { at: chairPosition(a.seat), dir: seatedDir(DESKS[a.seat].facing), mode };
}

/** 회의실 도우미: 의자 0~5에 앉는다 — 테이블 너머는 얼굴(SW = SE 뒤집기), 이쪽은 등(NE = NW 뒤집기). 테이블에 키보드가 없어 손은 멈춤. 7번째부터는 둘러선다 */
function meetingSit(i: number, hat: number): Plan['sit'] {
  if (i >= MEETING_CHAIRS || !canSit(lookFor(hat))) return null;
  return { at: meetingChairPosition(i), dir: i < 3 ? 'SW' : 'NE', mode: 'upper' };
}

/**
 * 에이전트(주어진 순서)마다 계획을 짠다. 키는 agent.id, 도우미는 `${agent.id}/${sub.id}`.
 * 로비 자리·회의실 자리는 종류와 상관없이 순서대로 이어서 센다. seated(앱 기본 켜짐, `?seated=off`면 끔)면 책상·회의실 의자,
 * 쉬는 중엔 휴게실 소파·빈백(쉼 자리가 앉는 자리일 때)에 앉는다.
 */
export function direct(agents: Agent[], now: number, seated = false): Map<string, Plan> {
  const plans = new Map<string, Plan>();
  const resters = restAssignments(agents.filter((a) => a.status === 'idle').map((a) => a.id), now);
  let lobby = 0;
  let meeting = 0;
  for (const a of agents) {
    // 자기 책상: Claude 0~7 사무실, Codex 0~2 개발실, 그 밖은 로비
    const dev = a.kind === 'codex';
    const hasDesk = dev ? a.seat >= 0 && a.seat <= 2 : a.seat >= 0 && a.seat <= 7;
    // 책상을 안 쓰는 상태(쉼·퇴근)는 로비 번호를 먹지 않는다
    const usesDesk = a.status !== 'gone' && a.status !== 'idle';
    const desk = hasDesk ? (dev ? devSpot(a.seat) : seatPosition(a.seat)) : waitingSpot(usesDesk ? lobby++ : lobby);
    const f = facingAt(desk);
    const deskFacing = dirFor(f.x, f.y);

    let plan: Plan;
    if (a.status === 'gone') {
      plan = { spot: DOOR, facing: deskFacing, pose: 'walk', pace: 'free', effects: [], leave: true, agent: a, hat: a.hat, isSub: false, sit: null };
    } else if (a.status === 'idle') {
      const r = resters.get(a.id)!;
      // 소파·빈백 자리면 손을 무릎에 내린 쉬기 자세로 앉는다(머리 위 Z는 그대로 — 조는 모습)
      const sit = seated && r.sit && canSit(lookFor(a.hat)) ? { at: r.sit.at, dir: r.sit.dir, mode: 'rest' as const, pull: r.sit.pull } : null;
      plan = { spot: r.at, facing: dirFor(r.face.x, r.face.y), pose: 'sleep', pace: 'free', effects: ['zzz'], leave: false, agent: a, hat: a.hat, isSub: false, sit };
    } else {
      const wave = a.status === 'permission' || a.status === 'question';
      plan = {
        spot: desk, facing: wave ? frontOf(deskFacing) : deskFacing, pose: poseFor(a.status), pace: 'work',
        effects: deskEffects(a.status), leave: false, agent: a, hat: a.hat, isSub: false, sit: seated ? sitAt(a) : null,
      };
    }
    plans.set(a.id, plan);

    for (const sub of a.subagents) {
      const m = meeting++;
      const spot = meetingSpot(m);
      const mf = facingAt(spot);
      plans.set(`${a.id}/${sub.id}`, {
        spot, facing: dirFor(mf.x, mf.y), pose: 'type-fast', pace: 'work', effects: [], leave: false, agent: null, hat: a.hat, isSub: true,
        sit: seated ? meetingSit(m, a.hat) : null,
      });
    }
  }
  return plans;
}
