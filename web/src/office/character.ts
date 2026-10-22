// 블록 캐릭터: 큰 머리·짧은 팔다리·모자 아래 머리카락·볼터치. 얼굴은 +Z(보는 사람 쪽).
import * as THREE from 'three';
import type { Pose } from './pose.ts';

type Parts = { inner: THREE.Group; head: THREE.Group; armL: THREE.Group; armR: THREE.Group };

const SKIN = '#F6DCC4';
const HAIR = '#4A3428';
const PANTS = '#4A4038';
const INK = '#2B211C';

const mats = new Map<string, THREE.MeshLambertMaterial>();
function lambert(color: string): THREE.MeshLambertMaterial {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    mats.set(color, m);
  }
  return m;
}
const lineMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 });

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  if (outline) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), lineMat));
  return m;
}

/** 어깨에 매달린 팔(회전 중심 = 어깨) */
function arm(color: string, x: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.47, 0);
  pivot.add(box(0.1, 0.26, 0.12, color, 0, -0.13, 0));
  pivot.add(box(0.1, 0.07, 0.12, SKIN, 0, -0.28, 0, false)); // 손
  return pivot;
}

export function createCharacter(bodyColor: string, hatColor: string | null, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  // 다리
  inner.add(box(0.14, 0.16, 0.15, PANTS, -0.09, 0.08, 0));
  inner.add(box(0.14, 0.16, 0.15, PANTS, 0.09, 0.08, 0));
  // 몸
  inner.add(box(0.4, 0.34, 0.3, bodyColor, 0, 0.33, 0));
  const armL = arm(bodyColor, -0.25);
  const armR = arm(bodyColor, 0.25);
  inner.add(armL, armR);

  // 머리
  const head = new THREE.Group();
  head.position.y = 0.5;
  head.add(box(0.56, 0.5, 0.5, SKIN, 0, 0.25, 0));
  head.add(box(0.07, 0.24, 0.44, HAIR, -0.29, 0.31, -0.02, false)); // 옆머리
  head.add(box(0.07, 0.24, 0.44, HAIR, 0.29, 0.31, -0.02, false));
  head.add(box(0.58, 0.36, 0.08, HAIR, 0, 0.3, -0.26, false)); // 뒷머리
  head.add(box(0.5, 0.08, 0.04, HAIR, 0, 0.45, 0.25, false)); // 앞머리
  // 얼굴
  head.add(box(0.07, 0.1, 0.02, INK, -0.12, 0.25, 0.255, false));
  head.add(box(0.07, 0.1, 0.02, INK, 0.12, 0.25, 0.255, false));
  head.add(box(0.09, 0.045, 0.02, '#F09A9A', -0.19, 0.16, 0.255, false));
  head.add(box(0.09, 0.045, 0.02, '#F09A9A', 0.19, 0.16, 0.255, false));
  head.add(box(0.07, 0.025, 0.02, '#B5615A', 0, 0.13, 0.255, false));
  // 모자(세션 색) + 챙
  if (hatColor) {
    head.add(box(0.62, 0.13, 0.56, hatColor, 0, 0.555, -0.01));
    head.add(box(0.44, 0.04, 0.16, hatColor, 0, 0.5, 0.31));
  } else {
    head.add(box(0.6, 0.1, 0.54, HAIR, 0, 0.54, -0.01, false));
  }
  inner.add(head);

  g.scale.setScalar(scale);
  g.userData.parts = { inner, head, armL, armR } satisfies Parts;
  return g;
}

/** t = ms. 자세마다 작은 움직임 */
export function setPose(char: THREE.Group, pose: Pose, t: number): void {
  const { inner, head, armL, armR } = char.userData.parts as Parts;
  inner.position.y = 0;
  inner.rotation.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  head.position.y = 0.5;
  armL.rotation.set(0, 0, 0);
  armR.rotation.set(0, 0, 0);
  switch (pose) {
    case 'type-fast': {
      const k = Math.sin(t / 70);
      armL.rotation.x = -0.9 + k * 0.15;
      armR.rotation.x = -0.9 - k * 0.15;
      head.rotation.x = 0.1;
      break;
    }
    case 'scroll':
      armR.rotation.x = -0.8;
      head.rotation.x = 0.14 + Math.sin(t / 600) * 0.05;
      break;
    case 'think':
      armR.rotation.x = -2.2; // 턱 괴기
      armR.rotation.z = 0.35;
      head.rotation.z = Math.sin(t / 900) * 0.1;
      break;
    case 'wave':
      inner.position.y = Math.abs(Math.sin(t / 220)) * 0.08;
      armR.rotation.z = 2.6 + Math.sin(t / 120) * 0.35; // 팔을 들어 흔들기
      break;
    case 'lean-back':
      inner.rotation.x = -0.12;
      head.rotation.x = -0.12;
      armL.rotation.z = -0.25;
      armR.rotation.z = 0.25;
      break;
    case 'sleep':
      head.rotation.x = 0.5;
      head.position.y = 0.46;
      armL.rotation.x = -0.4;
      armR.rotation.x = -0.4;
      break;
    case 'walk': {
      const k = Math.sin(t / 110);
      inner.position.y = Math.abs(k) * 0.05;
      armL.rotation.x = k * 0.6;
      armR.rotation.x = -k * 0.6;
      break;
    }
    case 'stand':
      break;
  }
}
