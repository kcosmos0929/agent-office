// 가구: 밝은 나무 상판 + 검은 철제 + 검은 의자 + 화분 (레퍼런스: 현대식 오픈 오피스, 2026-10-23). 모두 상자 조합.
import * as THREE from 'three';
import { block } from './scene.ts';

export const FURN = {
  wood: '#B48B5E',
  black: '#1F2125',
  steel: '#2E3036',
  chair: '#26282D',
  monitor: '#16181C',
  screenOff: '#3A404C',
  panel: '#3F434B',
  keyboard: '#2A2D33',
  handle: '#5A5F68',
  pot: '#D9D4CC',
  potDark: '#3A3D44',
  leaf: '#5E8F4E',
  leafDark: '#476F3B',
  sofa: '#A85C3E',
  sofaDark: '#8A4A32',
  appliance: '#C9CDD3',
} as const;
const F = FURN;

type Side = 'px' | 'nx' | 'pz' | 'nz';

/** 사무용 의자(중심 cx, cz). back = 등받이가 붙는 쪽 */
export function officeChair(g: THREE.Group, cx: number, cz: number, back: Side): void {
  g.add(block(cx - 0.2, cz - 0.03, 0.4, 0.06, 0.04, 0.03, F.black));
  g.add(block(cx - 0.03, cz - 0.2, 0.06, 0.4, 0.04, 0.03, F.black));
  g.add(block(cx - 0.03, cz - 0.03, 0.06, 0.06, 0.07, 0.2, F.black));
  g.add(block(cx - 0.2, cz - 0.2, 0.4, 0.4, 0.27, 0.07, F.chair));
  const [bx, bz, bw, bd] = back === 'px' ? [cx + 0.14, cz - 0.19, 0.06, 0.38] : back === 'nx' ? [cx - 0.2, cz - 0.19, 0.06, 0.38] : back === 'pz' ? [cx - 0.19, cz + 0.14, 0.38, 0.06] : [cx - 0.19, cz - 0.2, 0.38, 0.06];
  g.add(block(bx, bz, bw, bd, 0.34, 0.34, F.chair));
}

/** 작은 화분(책상 위 등): 바닥 높이 h0 */
export function smallPlant(g: THREE.Group, x0: number, z0: number, h0: number): void {
  g.add(block(x0, z0, 0.14, 0.14, h0, 0.1, F.pot));
  g.add(block(x0 - 0.03, z0 - 0.03, 0.2, 0.2, h0 + 0.1, 0.12, F.leaf));
  g.add(block(x0 + 0.02, z0 + 0.02, 0.1, 0.1, h0 + 0.22, 0.08, F.leafDark));
}

/** 큰 화분(바닥): 진한 화분 + 층층이 잎 */
export function bigPlant(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.45, 0.45, 0.04, 0.4, F.potDark));
  g.add(block(x0 - 0.08, z0 - 0.08, 0.61, 0.61, 0.44, 0.38, F.leaf));
  g.add(block(x0 + 0.02, z0 + 0.02, 0.41, 0.41, 0.82, 0.32, F.leafDark));
  g.add(block(x0 + 0.1, z0 + 0.1, 0.25, 0.25, 1.14, 0.22, F.leaf));
}

/**
 * 책상 묶음의 책상 하나: 나무 상판 + 검은 다리 + 모니터(사람 쪽을 봄) + 키보드 + 서랍장 + 의자.
 * x0..x0+w(깊이), z0..z0+d(폭). facing = 사람이 앉는 쪽(px: +x, nx: -x). 모니터 화면(상태 색을 칠할 면)을 돌려준다.
 */
export function podDesk(g: THREE.Group, x0: number, z0: number, w: number, d: number, facing: 'px' | 'nx', withPlant: boolean): THREE.Mesh {
  const zc = z0 + d / 2;
  const top = 0.58;
  // u = 칸막이 쪽 가장자리에서 사람 쪽으로 잰 거리 → 세계 x(크기 size인 상자의 시작)
  const X = (u: number, size: number) => (facing === 'px' ? x0 + u : x0 + w - u - size);
  g.add(block(x0, z0, w, d, top, 0.05, F.wood));
  for (const z of [z0 + 0.03, z0 + d - 0.09]) {
    g.add(block(x0 + 0.05, z, 0.06, 0.06, 0.04, top - 0.04, F.black));
    g.add(block(x0 + w - 0.11, z, 0.06, 0.06, 0.04, top - 0.04, F.black));
    g.add(block(x0 + 0.05, z, w - 0.1, 0.06, 0.04, 0.04, F.black));
  }
  // 모니터
  g.add(block(X(0.2, 0.06), zc - 0.05, 0.06, 0.1, top + 0.05, 0.08, F.black));
  g.add(block(X(0.14, 0.05), zc - 0.3, 0.05, 0.6, top + 0.12, 0.36, F.monitor));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.28), new THREE.MeshBasicMaterial({ color: F.screenOff }));
  screen.rotation.y = facing === 'px' ? Math.PI / 2 : -Math.PI / 2;
  screen.position.set(facing === 'px' ? x0 + 0.192 : x0 + w - 0.192, top + 0.12 + 0.18, zc);
  g.add(screen);
  g.add(block(X(0.42, 0.14), zc - 0.2, 0.14, 0.4, top + 0.05, 0.015, F.keyboard));
  // 서랍장(자리 옆 아래)
  g.add(block(X(0.12, 0.5), zc + 0.2, 0.5, 0.4, 0.04, 0.46, F.steel));
  for (const h of [0.2, 0.36]) g.add(block(X(0.62, 0.01), zc + 0.29, 0.01, 0.22, h, 0.02, F.handle));
  if (withPlant) smallPlant(g, X(0.06, 0.14), zc + 0.42, top + 0.05);
  // 의자: 책상 밑으로 반쯤 밀어 넣어 캐릭터 자리 바로 뒤에
  officeChair(g, facing === 'px' ? x0 + w - 0.02 : x0 + 0.02, zc, facing);
  return screen;
}

/** 책상 묶음 가운데 칸막이(x 위치, z0부터 len): 반투명 판 + 검은 윗테 + 양끝 기둥 */
export function podDivider(g: THREE.Group, x: number, z0: number, len: number): void {
  g.add(block(x - 0.025, z0, 0.05, len, 0.63, 0.4, '#AFC2CC', { transparent: true, opacity: 0.5, depthWrite: false }));
  g.add(block(x - 0.03, z0, 0.06, len, 1.03, 0.03, F.black));
  for (const z of [z0, z0 + len - 0.05]) g.add(block(x - 0.03, z, 0.06, 0.05, 0.63, 0.4, F.black));
}

/** 안내 데스크(로비): 높은 카운터(앞면이 +z, 입구 쪽) + 뒤쪽 낮은 책상 + 모니터 + 의자 */
export function receptionDesk(g: THREE.Group, x0: number, z0: number, w: number): void {
  g.add(block(x0, z0, w, 0.45, 0.04, 0.82, F.steel));
  g.add(block(x0 - 0.05, z0 - 0.05, w + 0.1, 0.55, 0.86, 0.05, F.wood));
  g.add(block(x0, z0 + 0.45, w, 0.02, 0.5, 0.06, F.wood));
  g.add(block(x0, z0 - 0.55, w, 0.55, 0.58, 0.05, F.wood));
  g.add(block(x0 + 0.05, z0 - 0.5, 0.06, 0.06, 0.04, 0.54, F.black));
  g.add(block(x0 + w - 0.11, z0 - 0.5, 0.06, 0.06, 0.04, 0.54, F.black));
  g.add(block(x0 + w / 2 - 0.3, z0 - 0.12, 0.6, 0.05, 0.63, 0.34, F.monitor));
  officeChair(g, x0 + w / 2, z0 - 0.85, 'nz');
}

/** 소파: 받침 + 방석 + 등받이 + 팔걸이. facing = 앉는 면이 보는 쪽(pz: +z, px: +x) */
export function sofa(g: THREE.Group, x0: number, z0: number, w: number, d: number, facing: 'pz' | 'px' = 'pz'): void {
  g.add(block(x0, z0, w, d, 0.04, 0.22, F.sofaDark));
  if (facing === 'pz') {
    g.add(block(x0 + 0.14, z0 + 0.16, w - 0.28, d - 0.18, 0.26, 0.08, F.sofa));
    g.add(block(x0, z0, w, 0.18, 0.26, 0.36, F.sofa));
    g.add(block(x0, z0, 0.14, d, 0.26, 0.16, F.sofa));
    g.add(block(x0 + w - 0.14, z0, 0.14, d, 0.26, 0.16, F.sofa));
  } else {
    g.add(block(x0 + 0.16, z0 + 0.14, w - 0.18, d - 0.28, 0.26, 0.08, F.sofa));
    g.add(block(x0, z0, 0.18, d, 0.26, 0.36, F.sofa));
    g.add(block(x0, z0, w, 0.14, 0.26, 0.16, F.sofa));
    g.add(block(x0, z0 + d - 0.14, w, 0.14, 0.26, 0.16, F.sofa));
  }
}

/** 낮은 테이블: 나무 상판 + 검은 다리 넷 */
export function lowTable(g: THREE.Group, x0: number, z0: number, w: number, d: number, h = 0.32): void {
  g.add(block(x0, z0, w, d, h, 0.05, F.wood));
  for (const [x, z] of [[x0 + 0.04, z0 + 0.04], [x0 + w - 0.1, z0 + 0.04], [x0 + 0.04, z0 + d - 0.1], [x0 + w - 0.1, z0 + d - 0.1]]) {
    g.add(block(x, z, 0.06, 0.06, 0.04, h - 0.04, F.black));
  }
}

/** 정수기: 흰 몸통 + 파란 물통 */
export function waterCooler(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.36, 0.36, 0.04, 0.78, F.appliance));
  g.add(block(x0 + 0.05, z0 + 0.05, 0.26, 0.26, 0.82, 0.32, '#7FB8D9', { transparent: true, opacity: 0.85 }));
}

/** 복합기: 회색 몸통 + 진한 조작판 */
export function printer(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.6, 0.85, 0.04, 0.72, F.appliance));
  g.add(block(x0 + 0.05, z0 + 0.05, 0.5, 0.75, 0.76, 0.06, '#9EA3AA'));
  g.add(block(x0 + 0.45, z0 + 0.55, 0.12, 0.25, 0.82, 0.03, F.steel));
}

/** 서류 캐비닛: 진한 회색 + 손잡이 3단 */
export function fileCabinet(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.5, 0.6, 0.04, 0.95, F.potDark));
  for (const h of [0.3, 0.6, 0.88]) g.add(block(x0 + 0.5, z0 + 0.2, 0.01, 0.2, h - 0.06, 0.03, F.handle));
}

/** 휴지통 */
export function trashBin(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.22, 0.22, 0.04, 0.28, F.steel));
}

/** 화면 거치대: 검은 받침·기둥 + 큰 화면. +z(보는 사람 쪽)를 봄, x0부터 폭 w */
export function screenStand(g: THREE.Group, x0: number, z0: number, w: number): void {
  g.add(block(x0 + w / 2 - 0.25, z0, 0.5, 0.4, 0.04, 0.05, F.black));
  g.add(block(x0 + w / 2 - 0.04, z0 + 0.17, 0.08, 0.06, 0.09, 0.8, F.black));
  g.add(block(x0, z0 + 0.22, w, 0.08, 0.8, 0.75, F.monitor));
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, 0.63), new THREE.MeshBasicMaterial({ color: '#4C6A8A' }));
  s.position.set(x0 + w / 2, 0.8 + 0.375, z0 + 0.302);
  g.add(s);
}

/** 둥근 의자(스툴) */
export function stool(g: THREE.Group, cx: number, cz: number): void {
  g.add(block(cx - 0.03, cz - 0.03, 0.06, 0.06, 0.04, 0.38, F.black));
  g.add(block(cx - 0.17, cz - 0.17, 0.34, 0.34, 0.42, 0.06, F.wood));
}

/** 책장(뒤가 -z 벽, 앞이 +z): 나무 틀 + 선반 3단 + 알록달록한 책 */
export function bookshelf(g: THREE.Group, x0: number, z0: number, w: number): void {
  const wood = '#6E4E36';
  g.add(block(x0, z0, w, 0.38, 0.04, 1.5, wood));
  const books = ['#C0563F', '#3E6E8E', '#D9B44A', '#5E8F4E', '#8B6CC9', '#E8E2D6'];
  for (let shelf = 0; shelf < 3; shelf++) {
    const h0 = 0.12 + shelf * 0.46;
    let x = x0 + 0.08;
    let k = shelf * 2;
    while (x < x0 + w - 0.2) {
      const bw = 0.08 + ((k * 37) % 5) * 0.02;
      g.add(block(x, z0 + 0.38, bw, 0.02, h0, 0.26 + ((k * 13) % 3) * 0.04, books[k % books.length]));
      x += bw + 0.02;
      k++;
    }
  }
}

/** 빈백(푹신한 의자): 층층이 쌓은 둥근 덩어리 */
export function beanBag(g: THREE.Group, cx: number, cz: number, color: string): void {
  g.add(block(cx - 0.32, cz - 0.32, 0.64, 0.64, 0.04, 0.2, color));
  g.add(block(cx - 0.26, cz - 0.26, 0.52, 0.52, 0.24, 0.12, color));
  g.add(block(cx - 0.3, cz - 0.32, 0.6, 0.22, 0.24, 0.28, color));
}

/** 주방 카운터(뒤가 -z 벽, 사람은 +z 쪽): 흰 하부장 + 진한 상판 + 커피머신 + 싱크 + 수도꼭지. x0부터 길이 len */
export function kitchenCounter(g: THREE.Group, x0: number, z0: number, len: number): void {
  g.add(block(x0, z0, len, 0.65, 0.04, 0.62, '#D9DCE1'));
  g.add(block(x0 - 0.02, z0 - 0.02, len + 0.04, 0.69, 0.66, 0.05, F.potDark));
  for (let x = x0 + 0.25; x < x0 + len - 0.2; x += 0.5) g.add(block(x, z0 + 0.65, 0.2, 0.01, 0.45, 0.02, F.handle));
  g.add(block(x0 + 0.1, z0 + 0.08, 0.3, 0.32, 0.71, 0.38, F.black));
  g.add(block(x0 + 0.2, z0 + 0.4, 0.06, 0.01, 0.95, 0.04, '#E0533D'));
  g.add(block(x0 + len * 0.5, z0 + 0.15, 0.45, 0.35, 0.69, 0.02, '#8A9099'));
  g.add(block(x0 + len * 0.5 + 0.18, z0 + 0.04, 0.08, 0.05, 0.71, 0.18, '#9EA3AA'));
}

/** 냉장고(문이 +z 쪽) */
export function fridge(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.62, 0.7, 0.04, 1.75, F.appliance));
  g.add(block(x0, z0 + 0.7, 0.62, 0.005, 1.15, 0.015, '#8A9099'));
  g.add(block(x0 + 0.45, z0 + 0.7, 0.05, 0.025, 0.6, 0.45, '#8A9099'));
  g.add(block(x0 + 0.45, z0 + 0.7, 0.05, 0.025, 1.3, 0.3, '#8A9099'));
}

/** 자판기(앞면이 +z): 빨간 몸통 + 밝은 진열창 + 버튼 줄 */
export function vendingMachine(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.7, 0.6, 0.04, 1.8, '#B8433A'));
  g.add(block(x0 + 0.07, z0 + 0.6, 0.4, 0.01, 0.75, 0.9, '#DCEAF2', { emissive: '#7A8A96' }));
  g.add(block(x0 + 0.52, z0 + 0.6, 0.1, 0.01, 0.9, 0.5, F.steel));
  g.add(block(x0 + 0.1, z0 + 0.6, 0.5, 0.01, 0.2, 0.15, F.steel));
}

/** 창고 철제 선반(뒤가 -z 벽): 기둥 넷 + 선반 3단 + 상자·생수 */
export function storageShelf(g: THREE.Group, x0: number, z0: number, w: number): void {
  const d = 0.45;
  for (const [x, z] of [[x0, z0], [x0 + w - 0.05, z0], [x0, z0 + d - 0.05], [x0 + w - 0.05, z0 + d - 0.05]]) g.add(block(x, z, 0.05, 0.05, 0.04, 1.4, F.steel));
  const items = ['#B08A5E', '#C79E6C', '#7FB8D9', '#B08A5E', '#E8E2D6'];
  for (let shelf = 0; shelf < 3; shelf++) {
    const h = 0.12 + shelf * 0.45;
    g.add(block(x0, z0, w, d, h, 0.03, '#5A5F68'));
    let x = x0 + 0.08;
    let k = shelf;
    while (x < x0 + w - 0.35) {
      const bw = 0.26 + (k % 2) * 0.08;
      g.add(block(x, z0 + 0.06, bw, d - 0.12, h + 0.03, 0.22 + (k % 3) * 0.04, items[k % items.length]));
      x += bw + 0.06;
      k++;
    }
  }
}

/** 바닥에 쌓은 상자 */
export function boxStack(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.5, 0.45, 0.04, 0.32, '#B08A5E'));
  g.add(block(x0 + 0.06, z0 + 0.04, 0.38, 0.36, 0.36, 0.28, '#C79E6C'));
  g.add(block(x0 + 0.04, z0 + 0.17, 0.4, 0.02, 0.36, 0.005, '#8A6A4A'));
}

/** 변기(등이 -x 벽, 앞이 +x): 물탱크 + 몸통 + 시트 */
export function toilet(g: THREE.Group, x0: number, z0: number): void {
  const white = '#E8ECEF';
  g.add(block(x0, z0, 0.18, 0.42, 0.04, 0.72, white));
  g.add(block(x0 + 0.18, z0 + 0.06, 0.4, 0.3, 0.04, 0.34, white));
  g.add(block(x0 + 0.16, z0 + 0.04, 0.46, 0.34, 0.38, 0.03, '#C9CDD3'));
}

/** 세면대(등이 -x 벽): 흰 하부장 + 세면볼 + 수도꼭지 + 위쪽 거울 */
export function washbasin(g: THREE.Group, x0: number, z0: number): void {
  g.add(block(x0, z0, 0.5, 0.6, 0.04, 0.72, '#D9DCE1'));
  g.add(block(x0 + 0.12, z0 + 0.12, 0.3, 0.36, 0.76, 0.02, '#A9B3BA'));
  g.add(block(x0 + 0.02, z0 + 0.27, 0.06, 0.06, 0.76, 0.14, '#9EA3AA'));
  g.add(block(x0 + 0.02, z0 + 0.06, 0.04, 0.48, 1.0, 0.5, '#C9DCE6', { emissive: '#3A4A54' }));
}
