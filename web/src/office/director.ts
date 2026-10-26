// 연출 감독: 에이전트들과 서버 시각만으로 캐릭터마다 자리·방향·자세·걸음·효과를 정하는 순수 계산(three.js·DOM 없음).
// 같은 입력이면 같은 출력 → 화면끼리 같은 장면. cast.ts는 이 계획을 실행만 한다. (설계서 5-1~5-3)
import type { Agent } from '../../../src/shared/types.ts';
import { DOOR, OVERFLOW_SPOTS, REST_SPOTS, devSpot, facingAt, meetingSpot, seatPosition, waitingSpot, type Point, type RestSpot } from './layout.ts';
import { poseFor, type Pose } from './pose.ts';
import { dirFor, type Dir, type Pace } from './sprites/look.ts';

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

const NEXT_TO_LAST = 0.4;

/**
 * 쉬는 세션들의 쉼 자리. id를 정렬해 차례로 받는다:
 * 바라는 자리 (해시 + 시간 칸) mod 쉼 자리 수 → 차 있으면 다음 빈 쉼 자리 → 넘침 자리 → 마지막 넘침 자리 옆 0.4칸씩.
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
      const last = OVERFLOW_SPOTS[OVERFLOW_SPOTS.length - 1];
      beyond++;
      out.set(id, { at: { x: last.x + NEXT_TO_LAST * beyond, y: last.y }, face: overflowFace });
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
 * 에이전트(주어진 순서)마다 계획을 짠다. 키는 agent.id, 도우미는 `${agent.id}/${sub.id}`.
 * 로비 자리·회의실 자리는 종류와 상관없이 순서대로 이어서 센다.
 */
export function direct(agents: Agent[], now: number): Map<string, Plan> {
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
      plan = { spot: DOOR, facing: deskFacing, pose: 'walk', pace: 'free', effects: [], leave: true, agent: a, hat: a.hat, isSub: false };
    } else if (a.status === 'idle') {
      const r = resters.get(a.id)!;
      plan = { spot: r.at, facing: dirFor(r.face.x, r.face.y), pose: 'sleep', pace: 'free', effects: ['zzz'], leave: false, agent: a, hat: a.hat, isSub: false };
    } else {
      const wave = a.status === 'permission' || a.status === 'question';
      plan = {
        spot: desk, facing: wave ? frontOf(deskFacing) : deskFacing, pose: poseFor(a.status), pace: 'work',
        effects: deskEffects(a.status), leave: false, agent: a, hat: a.hat, isSub: false,
      };
    }
    plans.set(a.id, plan);

    for (const sub of a.subagents) {
      const spot = meetingSpot(meeting++);
      const mf = facingAt(spot);
      plans.set(`${a.id}/${sub.id}`, {
        spot, facing: dirFor(mf.x, mf.y), pose: 'type-fast', pace: 'work', effects: [], leave: false, agent: null, hat: a.hat, isSub: true,
      });
    }
  }
  return plans;
}
