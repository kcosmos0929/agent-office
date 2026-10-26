// 사무실 장면: 배경(backdrop.ts) + 가구. 모두 코드로 만든 상자들 — 그림 파일 없음.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildBackdrop, SLAB_H, type Backdrop } from './backdrop.ts';
import { armchair, beanBag, bigPlant, binders, bookshelf, boxStack, coatRack, copier, deskLamp, fileCabinet, fridge, FURN, lowCabinet, kitchenCounter, lowTable, officeChair, podDesk, podDivider, printer, receptionDesk, screenStand, shredder, smallPlant, sofa, stool, storageShelf, supplyCabinet, toilet, trashBin, vendingMachine, washbasin, waterCooler, whiteboard } from './furniture.ts';
import { buildRacks } from './rack.ts';
import { SCREEN } from './screens.ts';
import { ARIA_DESK, ARIA_DESK_XS, ARIA_DESK_Y, DEV_DESK, DEV_DESKS, DESK_DEPTH, FLOOR_X, DESK_WIDTH, DESKS, MEETING_TABLE, POD_X0, POD_YS, ROOMS, chairPosition, meetingSpot } from './layout.ts';

export const WALL_H = 3.0;

const materials = new Map<string, THREE.Material>();
function mat(color: string, opts: THREE.MeshLambertMaterialParameters = {}): THREE.Material {
  const key = color + JSON.stringify(opts);
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    materials.set(key, m);
  }
  return m;
}

/** 격자 좌표(x, y=깊이)와 높이로 상자 만들기: (x0, y0)부터 w×d, 바닥 높이 h0에서 높이 h */
export function block(x0: number, y0: number, w: number, d: number, h0: number, h: number, color: string, opts: THREE.MeshLambertMaterialParameters = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x0 + w / 2, h0 + h / 2, y0 + d / 2);
  m.castShadow = !opts.transparent;
  m.receiveShadow = true;
  // 픽셀아트 느낌의 외곽선(한 단계 어두운 색)
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), transparent: true, opacity: opts.transparent ? 0.5 : 0.9 }));
  m.add(edge);
  return m;
}

/** 방 팻말: 판(받침) 오른쪽 옆면, 각 방 가운데에 붙인 작은 판. 글자는 또렷하게 화면 글자(HTML)로 그리고,
 *  면이 뻗은 방향(격자 y = 화면 왼쪽 아래)만큼 기울여 붙어 보이게 한다 */
function roomSign(text: string, y: number): CSS2DObject {
  const el = document.createElement('div');
  el.className = 'room-sign along-y';
  const plate = document.createElement('span');
  plate.textContent = text;
  el.appendChild(plate);
  const sign = new CSS2DObject(el);
  sign.position.set(FLOOR_X + 0.02, -SLAB_H / 2, y);
  return sign;
}

export type OfficeScene = { group: THREE.Group; deskScreens: THREE.Mesh[]; devScreens: THREE.Mesh[]; racks: THREE.MeshLambertMaterial[][]; backdrop: Backdrop };

export function buildOffice(): OfficeScene {
  const g = new THREE.Group();
  const backdrop = buildBackdrop(g);

  // 사무실: 4인 책상 묶음 2개(두 자리씩 마주 보고 가운데 칸막이). 순서는 seatPosition과 같게(DESKS)
  const deskScreens = DESKS.map((d, seat) => podDesk(g, d.x0, d.y0, DESK_DEPTH, DESK_WIDTH, d.facing, seat, chairPosition(seat)));
  for (const y0 of POD_YS) {
    podDivider(g, POD_X0 + DESK_DEPTH, y0, 2 * DESK_WIDTH + 0.04);
    trashBin(g, POD_X0 + DESK_DEPTH - 0.11, y0 + 2 * DESK_WIDTH + 0.25);
  }
  // 사무실 집기: 창 아래 낮은 수납장 줄(바인더·화분·스탠드), TV 아래 낮은 장, 유리벽 쪽 복합기 코너와 비품장
  fileCabinet(g, 0.3, 0.2);
  for (const z0 of [0.95, 3.35, 5.75]) lowCabinet(g, 0.12, z0, 0.5, 2.0, 0.62, 'px');
  binders(g, 0.2, 1.15, 0.66, 6);
  smallPlant(g, 0.3, 4.2, 0.66);
  deskLamp(g, 0.25, 6.4, 0.66);
  binders(g, 0.2, 7.0, 0.66, 4);
  lowCabinet(g, 2.4, 0.1, 2.8, 0.42, 0.55, 'pz');
  smallPlant(g, 2.6, 0.2, 0.59);
  binders(g, 4.3, 0.15, 0.59, 5, 'x');
  // 유리벽에 등을 대고 사무실 쪽(-x)을 봄
  printer(g, 6.75, 0.2, 'nx');
  copier(g, 6.75, 1.15, 'nx');
  shredder(g, 6.9, 2.05);
  supplyCabinet(g, 6.85, 4.0, 'nx');
  // 사무실 앞쪽 로비: 입구 복도에서 곧게 들어오는 통로 오른쪽에 안내 데스크, 모서리마다 큰 화분
  receptionDesk(g, 4.5, 13.0, 1.8);
  // 로비 왼쪽: 창을 등진 대기 의자 둘 + 작은 테이블, 이동식 화이트보드, 입구 옆 옷걸이
  armchair(g, 0.45, 10.9);
  armchair(g, 0.45, 12.4);
  lowTable(g, 1.35, 11.55, 0.6, 0.9, 0.4);
  whiteboard(g, 0.9, 9.75, 1.7);
  coatRack(g, 3.0, 14.5);
  bigPlant(g, 0.35, 14.2);
  bigPlant(g, 0.35, 9.4);
  bigPlant(g, 6.75, 9.4);
  bigPlant(g, 6.75, 12.0); // 안내 데스크 옆(앞쪽은 대기 자리)

  // 창고(앞쪽 왼쪽 안): 뒷벽 철제 선반 + 바닥 상자 / 화장실(앞쪽 왼쪽 앞, 불투명 유리): 창가 쪽 변기 + 세면대·거울
  storageShelf(g, 0.2, 15.12, 1.9);
  boxStack(g, 2.25, 15.15);
  boxStack(g, 0.3, 15.75);
  washbasin(g, 0.15, 16.65);
  toilet(g, 0.15, 17.4);

  // 휴게실(앞쪽 오른쪽, 입구 복도에서 들어감): 자판기 + 러그(backdrop) 위 소파·낮은 테이블 + 뒷벽 책장 + 빈백 둘
  vendingMachine(g, 4.6, 15.1);
  sofa(g, 5.85, 15.22, 2.2, 0.75);
  lowTable(g, 6.45, 16.3, 1.0, 0.55);
  bookshelf(g, 8.6, 15.08, 2.0);
  beanBag(g, 9.0, 16.5, '#C9A04A');
  beanBag(g, 10.1, 16.5, '#46666D');

  // 탕비실(휴게실 안쪽): 뒷벽 주방 카운터·냉장고 + 정수기 + 카페 테이블과 스툴 둘 + 휴지통
  kitchenCounter(g, 11.3, 15.12, 2.5);
  fridge(g, 14.0, 15.1);
  waterCooler(g, 14.5, 16.2);
  lowTable(g, 12.4, 16.6, 0.9, 0.7, 0.62);
  stool(g, 12.15, 16.95);
  stool(g, 13.55, 16.95);
  trashBin(g, 14.6, 17.6);

  // 개발실(Codex): 서버랙 + 큰 모니터 책상 3개
  const racks = buildRacks(g);
  const devScreens: THREE.Mesh[] = [];
  for (const { x: x0, y: y0 } of DEV_DESKS) {
    const cx = x0 + DEV_DESK.w / 2;
    lowTable(g, x0, y0, DEV_DESK.w, DEV_DESK.d, 0.58);
    g.add(block(cx - 0.6, y0 + 0.08, 1.2, 0.12, 0.63, 0.7, FURN.monitor));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.53), new THREE.MeshBasicMaterial({ color: SCREEN.off }));
    screen.position.set(cx, 0.63 + 0.35, y0 + 0.205);
    g.add(screen);
    devScreens.push(screen); // 빈 개발실은 꺼진 화면, Codex가 앉으면 cast가 칠한다
    officeChair(g, cx, y0 + 1.2, 'pz');
  }

  // 비서실(ARIA): 스탠딩 책상 3개(높은 나무 상판 + 검은 다리 둘 + 모니터) + 큰 화분
  const sd = ARIA_DESK;
  for (const x0 of ARIA_DESK_XS) {
    const y0 = ARIA_DESK_Y;
    g.add(block(x0, y0, sd.w, sd.d, sd.h, 0.05, FURN.wood));
    g.add(block(x0 + 0.1, y0 + 0.25, 0.07, 0.1, 0.04, sd.h - 0.04, FURN.black));
    g.add(block(x0 + sd.w - 0.17, y0 + 0.25, 0.07, 0.1, 0.04, sd.h - 0.04, FURN.black));
    g.add(block(x0 + 0.1, y0 + 0.22, sd.w - 0.2, 0.16, 0.04, 0.03, FURN.black));
    g.add(block(x0 + 0.3, y0 + 0.06, sd.w - 0.6, 0.06, sd.h + 0.05, 0.4, FURN.monitor));
  }
  bigPlant(g, 14.25, 8.75);

  // 회의실: 나무 테이블 + 검은 의자 6개(테이블 쪽으로 반쯤 밀어 넣음) + 안쪽 벽 앞 화면
  const t = MEETING_TABLE;
  lowTable(g, t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0, 0.55);
  for (let i = 0; i < 6; i++) {
    const s = meetingSpot(i);
    if (i < 3) officeChair(g, s.x, s.y + 0.1, 'nz');
    else officeChair(g, s.x, s.y - 0.1, 'pz');
  }
  screenStand(g, 10.45, 9.65, 1.9);
  bigPlant(g, 14.3, 14.3);

  // 방 팻말: 오른쪽 방들(개발실·비서실·회의실)만, 판 오른쪽 옆면의 각 방 가운데
  for (const r of [ROOMS.codex, ROOMS.aria, ROOMS.meeting]) g.add(roomSign(r.label, (r.y0 + r.y1) / 2));

  return { group: g, deskScreens, devScreens, racks, backdrop };
}
