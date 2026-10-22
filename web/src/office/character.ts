// 블록 캐릭터(시안 A 비율): 몸 0.48×0.62×0.4, 머리 0.44, 모자 0.12. 얼굴은 +Z(보는 사람 쪽)를 향한다.
import * as THREE from 'three';
import type { Pose } from './pose.ts';

type Parts = { inner: THREE.Group; head: THREE.Group; armPivot: THREE.Group };

const mats = new Map<string, THREE.MeshLambertMaterial>();
function lambert(color: string): THREE.MeshLambertMaterial {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    mats.set(color, m);
  }
  return m;
}

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function createCharacter(bodyColor: string, hatColor: string | null, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  inner.add(box(0.48, 0.62, 0.4, bodyColor, 0, 0.31, 0));

  const head = new THREE.Group();
  head.position.y = 0.62;
  head.add(box(0.44, 0.42, 0.44, '#F3E2D2', 0, 0.21, 0));
  head.add(box(0.06, 0.07, 0.02, '#2A2A2A', -0.09, 0.24, 0.225));
  head.add(box(0.06, 0.07, 0.02, '#2A2A2A', 0.09, 0.24, 0.225));
  if (hatColor) head.add(box(0.48, 0.12, 0.48, hatColor, 0, 0.48, 0));
  inner.add(head);

  const armPivot = new THREE.Group();
  armPivot.position.set(0.27, 0.55, 0);
  armPivot.add(box(0.1, 0.34, 0.1, bodyColor, 0, 0.17, 0));
  armPivot.visible = false;
  inner.add(armPivot);

  g.scale.setScalar(scale);
  g.userData.parts = { inner, head, armPivot } satisfies Parts;
  return g;
}

/** t = ms. 자세마다 작은 움직임 */
export function setPose(char: THREE.Group, pose: Pose, t: number): void {
  const { inner, head, armPivot } = char.userData.parts as Parts;
  inner.position.y = 0;
  inner.rotation.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  head.position.y = 0.62;
  armPivot.visible = false;
  switch (pose) {
    case 'type-fast':
      inner.position.y = Math.abs(Math.sin(t / 90)) * 0.02;
      head.rotation.x = 0.08;
      break;
    case 'scroll':
      head.rotation.x = 0.12 + Math.sin(t / 600) * 0.05;
      break;
    case 'think':
      head.rotation.z = Math.sin(t / 900) * 0.12;
      break;
    case 'wave':
      inner.position.y = Math.abs(Math.sin(t / 220)) * 0.1;
      armPivot.visible = true;
      armPivot.rotation.z = -0.5 + Math.sin(t / 120) * 0.5;
      break;
    case 'lean-back':
      inner.rotation.x = -0.12;
      head.rotation.x = -0.15;
      break;
    case 'sleep':
      head.rotation.x = 0.55;
      head.position.y = 0.58;
      break;
    case 'walk':
      inner.position.y = Math.abs(Math.sin(t / 110)) * 0.06;
      break;
    case 'stand':
      break;
  }
}
