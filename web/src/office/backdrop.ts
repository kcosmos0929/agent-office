// 사무실 배경(받침·바닥·벽·통창·방 벽·흰 테두리)과 조명. 색은 차가운 회색 시안(2026-10-23 사용자 선택).
import * as THREE from 'three';
import { FLOOR, ROOM_DOORS, ROOMS, SPLIT_X } from './layout.ts';
import { block, WALL_H } from './scene.ts';
import { carpet, cityView, planks, rug, speckle, tiles } from './textures.ts';

export const PALETTE = {
  bg: '#1C1C1F',
  outline: '#F2F2F0',
  slab: '#2A2C31',
  wall: { back: ['#80858E', '#7A7F88'], side: ['#6E737C', '#696E77'], cut: '#2C2E33', baseboard: '#34363C' },
  planks: { tones: ['#4E535C', '#555A63', '#494E57'], seam: '#363940', grain: '#5F646E' },
  lab: ['#5A5F68', '#555A63', '#3E4148', '#666B75'],
  rug: ['#46666D', '#334E54', '#6A8C93'],
  carpet: ['#46666D', '#4F7178'],
  glassWall: { base: '#3A3D44', glass: '#B9CCD8', frame: '#2B2D32' },
  frame: '#2B2D32',
} as const;

const MATS = new Map<string, THREE.MeshLambertMaterial>();
function plain(color: string): THREE.MeshLambertMaterial {
  let m = MATS.get(color);
  if (!m) MATS.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;
const DENSITY = 16; // 텍스처 칸 / 격자 1칸

/** 한 면에만 도트 무늬를 입힌 상자 (나머지 면은 side 색) */
function texBlock(x0: number, y0: number, w: number, d: number, h0: number, h: number, side: string, face: keyof typeof FACE, tex: THREE.CanvasTexture): THREE.Mesh {
  const t = tex.clone();
  t.needsUpdate = true;
  const img = tex.image as HTMLCanvasElement;
  const [fw, fh] = face === 'py' || face === 'ny' ? [w, d] : face === 'pz' || face === 'nz' ? [w, h] : [d, h];
  t.repeat.set((fw * DENSITY) / img.width, (fh * DENSITY) / img.height);
  const mats: THREE.Material[] = Array(6).fill(plain(side));
  mats[FACE[face]] = new THREE.MeshLambertMaterial({ map: t });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  m.position.set(x0 + w / 2, h0 + h / 2, y0 + d / 2);
  m.receiveShadow = true;
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(side).multiplyScalar(0.6), transparent: true, opacity: 0.8 })));
  return m;
}

/** 러그 한 장(바닥 위 얇은 판, 늘이지 않고 한 장 그림) */
function rugBlock(x0: number, y0: number, w: number, d: number, tex: THREE.CanvasTexture, edge: string): THREE.Mesh {
  const mats: THREE.Material[] = Array(6).fill(plain(edge));
  mats[FACE.py] = new THREE.MeshLambertMaterial({ map: tex });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.015, d), mats);
  m.position.set(x0 + w / 2, 0.04 + 0.0075, y0 + d / 2);
  m.receiveShadow = true;
  return m;
}

/** 방 벽: 낮은 받침 + 반투명 유리(너머 캐릭터가 비쳐 보이게) + 위 레일, 1.5칸마다 세로 기둥 */
const GLASS_H = 2.0;
const INNER_T = 0.1;
function glassWall(g: THREE.Group, x0: number, y0: number, w: number, d: number): void {
  const c = PALETTE.glassWall;
  g.add(block(x0, y0, w, d, 0.04, 0.22, c.base));
  g.add(block(x0, y0, w, d, 0.26, GLASS_H - 0.26, c.glass, { transparent: true, opacity: 0.22, depthWrite: false }));
  g.add(block(x0, y0, w, d, GLASS_H, 0.04, c.frame));
  const along = Math.max(w, d);
  const n = Math.max(1, Math.round(along / 1.5));
  for (let i = 0; i <= n; i++) {
    const t = Math.min(along - 0.05, (i * along) / n);
    if (w > d) g.add(block(x0 + Math.max(0, t - 0.025), y0, 0.05, d, 0.26, GLASS_H - 0.26, c.frame));
    else g.add(block(x0, y0 + Math.max(0, t - 0.025), w, 0.05, 0.26, GLASS_H - 0.26, c.frame));
  }
}

const SLAB_H = 0.3;
const P = PALETTE;

export function buildBackdrop(g: THREE.Group): void {
  const F = FLOOR;
  const { codex, aria, meeting } = ROOMS;
  // 받침(디오라마 판)
  g.add(block(-0.25, -0.25, F + 0.25, F + 0.25, -SLAB_H, SLAB_H, P.slab));

  // 바닥: 사무실·비서실·회의실 = 나무 판자, 개발실 = 타일
  const wood = planks([...P.planks.tones], P.planks.seam, P.planks.grain, 11);
  const [la, lb, grout, speck] = P.lab;
  g.add(texBlock(0, 0, SPLIT_X, F, 0, 0.04, P.planks.seam, 'py', wood));
  g.add(texBlock(codex.x0, codex.y0, codex.x1 - codex.x0, codex.y1 - codex.y0, 0, 0.04, grout, 'py', tiles(la, lb, grout, speck)));
  g.add(texBlock(aria.x0, aria.y0, aria.x1 - aria.x0, meeting.y1 - aria.y0, 0, 0.04, P.planks.seam, 'py', wood));
  const [rf, rb, ra] = P.rug;
  g.add(rugBlock(1.6, 11.4, 3.0, 2.0, rug(rf, rb, ra), rb));
  const [mc, md] = P.carpet;
  g.add(texBlock(8.9, 10.6, 5.0, 3.6, 0.04, 0.015, mc, 'py', carpet(mc, md)));

  // 뒷벽 두 면(안쪽 면에 무늬, 잘린 윗면은 진하게) + 걸레받이
  g.add(texBlock(-0.25, -0.25, F + 0.25, 0.25, 0, WALL_H, P.wall.cut, 'pz', speckle(P.wall.back[0], P.wall.back[1])));
  g.add(texBlock(-0.25, 0, 0.25, F, 0, WALL_H, P.wall.cut, 'px', speckle(P.wall.side[0], P.wall.side[1])));
  g.add(block(0, 0, F, 0.04, 0, 0.12, P.wall.baseboard));

  // 통창(왼쪽 벽 전체): 허리 높이 창턱 + 큰 유리(밖 풍경은 조명과 상관없이 밝게) + 세로 창틀 + 위 가로 창틀
  const SILL = 0.72;
  const HEAD = WALL_H - 0.2;
  const glassMats: THREE.Material[] = Array(6).fill(plain(P.frame));
  glassMats[FACE.px] = new THREE.MeshBasicMaterial({ map: cityView(F * DENSITY, Math.round((HEAD - SILL) * DENSITY)) });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.03, HEAD - SILL, F), glassMats);
  glass.position.set(0.015, (SILL + HEAD) / 2, F / 2);
  g.add(glass);
  g.add(block(0, 0, 0.04, F, 0, 0.12, P.wall.baseboard));
  g.add(block(0, 0, 0.14, F, SILL - 0.06, 0.06, P.frame));
  g.add(block(0, 0, 0.07, F, HEAD, 0.06, P.frame));
  g.add(block(0, 0, 0.06, F, HEAD - 0.4, 0.04, P.frame));
  for (let i = 0; i <= F / 1.25; i++) {
    const z = Math.min(F - 0.06, Math.max(0, i * 1.25 - 0.03));
    g.add(block(0, z, 0.07, 0.06, SILL, HEAD - SILL, P.frame));
  }

  // 방 벽(유리): 사무실과 오른쪽 방들 사이(방마다 문 하나) + 방끼리
  const x0 = SPLIT_X - INNER_T / 2;
  let from = 0;
  for (const door of [ROOM_DOORS.codex, ROOM_DOORS.aria, ROOM_DOORS.meeting]) {
    glassWall(g, x0, from, INNER_T, door.y - door.w / 2 - from);
    from = door.y + door.w / 2;
  }
  glassWall(g, x0, from, INNER_T, F - from);
  glassWall(g, SPLIT_X + INNER_T / 2, codex.y1 - INNER_T / 2, F - SPLIT_X - INNER_T / 2, INNER_T);
  glassWall(g, SPLIT_X + INNER_T / 2, aria.y1 - INNER_T / 2, F - SPLIT_X - INNER_T / 2, INNER_T);

  // 흰 육각 테두리: 디오라마를 조금 띄워 감싸는 가는 막대 6개(선은 픽셀로 줄이면 끊겨 보여서 막대로)
  const gap = 0.25;
  const o = -0.25 - gap;
  const e = F + gap;
  const top = WALL_H + gap;
  const bot = -SLAB_H - gap;
  const corners = [[o, top, o], [e, top, o], [e, bot, o], [e, bot, e], [o, bot, e], [o, top, e]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const lineMat = new THREE.MeshBasicMaterial({ color: P.outline });
  const T = 0.07;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const bar = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x) + T, Math.abs(b.y - a.y) + T, Math.abs(b.z - a.z) + T), lineMat);
    bar.position.addVectors(a, b).multiplyScalar(0.5);
    g.add(bar);
  });
}

/** 조명: 하늘빛 + 해(그림자) + 방마다 작은 전등 */
export function officeLights(): THREE.Object3D[] {
  const c = FLOOR / 2;
  const sun = new THREE.DirectionalLight('#F4F7FF', 0.9);
  sun.position.set(c - 4, 12, c + 4);
  sun.target.position.set(c, 0, c);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 34 });
  const spots: Array<[number, number]> = [[3.75, 3.5], [3.75, 10.5], [11.25, 2.2], [11.25, 7], [11.25, 12.25]];
  const lamps = spots.map(([x, z]) => {
    const p = new THREE.PointLight('#FFE2B8', 3, 8, 1.6);
    p.position.set(x, 2.5, z);
    return p;
  });
  return [new THREE.HemisphereLight('#DCE3EE', '#45454C', 2.4), sun, sun.target, ...lamps];
}
