// 개발실 서버랙 불빛: 짝 책상의 Codex가 ▶ 실행 중이면 빠르게 깜박이고, 평소엔 천천히 숨 쉬고, 빈 자리 랙은 어둡다.
import * as THREE from 'three';
import type { Agent } from '../../../src/shared/types.ts';
import { hashId } from './director.ts';
import { block } from './scene.ts';

/** 한 박자(ms). 모니터 진행 막대(Task 10)도 같은 박자를 쓴다 */
export const BEAT_MS = 125;
/** 시각 t(ms, rAF 시각)의 박자 번호 */
export const beat = (t: number): number => Math.floor(t / BEAT_MS);

export type RackState = 'running' | 'idle' | 'empty';
export const RACKS = 3;
const LIGHTS = 4;

/** 불 4개의 발광 세기 */
export function rackLevels(state: RackState, seat: number, t: number): number[] {
  if (state === 'running') return Array.from({ length: LIGHTS }, (_, i) => (hashId(`${seat}:${i}:${beat(t)}`) & 1 ? 1.0 : 0.25));
  if (state === 'idle') return new Array<number>(LIGHTS).fill(Math.floor(t / 1000) % 2 ? 0.6 : 0.35); // 1초 단위 계단 숨쉬기
  return new Array<number>(LIGHTS).fill(0.15);
}

/** 랙 k의 상태 = 개발실 자리 k의 Codex (실행 중 → running, 앉아 있음 → idle, 없거나 gone → empty) */
export function rackStates(agents: Agent[]): RackState[] {
  const states: RackState[] = new Array<RackState>(RACKS).fill('empty');
  for (const a of agents) {
    if (a.kind !== 'codex' || a.seat < 0 || a.seat >= RACKS || a.status === 'gone') continue;
    if (a.status === 'running') states[a.seat] = 'running';
    else if (states[a.seat] !== 'running') states[a.seat] = 'idle';
  }
  return states;
}

/** 랙 3개(x 12·13·14)와 불 4개씩. 불 재질은 따로 들고 있다가 paintRacks가 세기만 바꾼다 */
export function buildRacks(g: THREE.Group): THREE.MeshLambertMaterial[][] {
  const racks: THREE.MeshLambertMaterial[][] = [];
  for (const x0 of [12.0, 13.0, 14.0]) {
    g.add(block(x0, 0.2, 0.8, 0.8, 0, 1.7, '#3C4656'));
    const lights: THREE.MeshLambertMaterial[] = [];
    for (let k = 0; k < LIGHTS; k++) {
      const color = k % 2 ? '#7CE0A3' : '#5BC0EB';
      const light = block(x0 + 0.15, 1.0, 0.08, 0.02, 0.35 + k * 0.36, 0.06, color, { emissive: color });
      // block()은 같은 색 재질을 캐시해 공유하니, 불마다 따로 깜박이게 자기 재질을 갖는다
      const own = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.25), emissive: color }); // 겉색은 어둡게 — 발광 세기 차이가 눈에 보이게
      light.material = own;
      g.add(light);
      lights.push(own);
    }
    racks.push(lights);
  }
  return racks;
}

/** 매 프레임 호출 — 값이 바뀐 불만 emissiveIntensity를 쓴다 */
export function paintRacks(mats: THREE.MeshLambertMaterial[][], states: RackState[], t: number): void {
  mats.forEach((lights, seat) => {
    const lv = rackLevels(states[seat] ?? 'empty', seat, t);
    lights.forEach((m, i) => { if (m.emissiveIntensity !== lv[i]) m.emissiveIntensity = lv[i]; });
  });
}
