// 사무실 장면(바닥·벽·창·유리 칸막이·가구). 모두 코드로 만든 상자들 — 그림 파일 없음. 색은 시안 A.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { DESK_COLS, DESK_D, DESK_W, DESK_YS, MEETING_TABLE, ROOMS, meetingSpot } from './layout.ts';

export const WALL_H = 2.4;

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

/** 방 이름: 픽셀로 줄이면 흐려져서 화면 글자(HTML)로 바닥에 띄운다 */
function roomLabel(text: string, x: number, y: number): CSS2DObject {
  const el = document.createElement('div');
  el.className = 'room-label';
  el.textContent = text;
  const label = new CSS2DObject(el);
  label.position.set(x, 0.05, y);
  return label;
}

export type OfficeScene = { group: THREE.Group; deskScreens: THREE.Mesh[] };

export function buildOffice(): OfficeScene {
  const g = new THREE.Group();
  // 받침과 바닥
  g.add(block(-0.25, -0.25, 10.25, 10.25, -0.3, 0.3, '#D9CFC2'));
  const floors: Array<[keyof typeof ROOMS, string]> = [['claude', '#EAD7BD'], ['codex', '#D9E6E2'], ['aria', '#E6DDEE'], ['meeting', '#E9E3D8']];
  for (const [key, color] of floors) {
    const r = ROOMS[key];
    g.add(block(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 0, 0.04, color));
  }
  for (let i = 1; i < 6; i++) g.add(block(i - 0.01, 0, 0.02, 5, 0.04, 0.003, '#DCC6A8')); // 나무결

  // 뒷벽 두 면 + 창문
  g.add(block(-0.25, -0.25, 10.25, 0.25, 0, WALL_H, '#F7F3EC'));
  g.add(block(-0.25, 0, 0.25, 10, 0, WALL_H, '#ECE4D8'));
  for (const y0 of [5.6, 7.8]) {
    g.add(block(-0.02, y0, 0.06, 1.6, 0.9, 1.2, '#B9C7D0'));
    g.add(block(0.0, y0 + 0.06, 0.06, 1.48, 0.96, 1.08, '#CFE6F2'));
  }

  // 유리 칸막이 (낮게)
  const glass = { transparent: true, opacity: 0.45 };
  const glassColor = '#BFE0EE';
  g.add(block(0, 4.95, 2.6, 0.1, 0, 0.55, glassColor, glass));
  g.add(block(3.6, 4.95, 6.4, 0.1, 0, 0.55, glassColor, glass));
  g.add(block(5.95, 0, 0.1, 1.6, 0, 0.55, glassColor, glass));
  g.add(block(5.95, 2.8, 0.1, 2.15, 0, 0.55, glassColor, glass));
  g.add(block(3.95, 5.05, 0.1, 1.4, 0, 0.55, glassColor, glass));
  g.add(block(3.95, 7.6, 0.1, 2.4, 0, 0.55, glassColor, glass));

  // Claude 작업실 책상 8개(2열 × 4) + 모니터(+x 쪽 통로를 향함). 순서는 seatPosition과 같게: 열을 번갈아
  const deskScreens: THREE.Mesh[] = [];
  for (let seat = 0; seat < 8; seat++) {
    const x0 = DESK_COLS[seat % 2];
    const y0 = DESK_YS[Math.floor(seat / 2)];
    g.add(block(x0, y0, DESK_W, DESK_D, 0, 0.62, '#F2F0EC'));
    g.add(block(x0 + 0.08, y0 + 0.08, 0.1, DESK_D - 0.16, 0.62, 0.5, '#2A2F38'));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(DESK_D - 0.28, 0.4), new THREE.MeshBasicMaterial({ color: '#3A404C' }));
    screen.rotation.y = Math.PI / 2;
    screen.position.set(x0 + 0.185, 0.62 + 0.25, y0 + DESK_D / 2);
    g.add(screen);
    deskScreens.push(screen);
  }

  // Codex 실험실: 서버랙 + 책상과 큰 모니터
  for (const x0 of [6.5, 7.5, 8.5]) {
    g.add(block(x0, 0.2, 0.8, 0.8, 0, 1.7, '#3C4656'));
    for (let k = 0; k < 4; k++) g.add(block(x0 + 0.15, 1.0, 0.08, 0.02, 0.35 + k * 0.36, 0.06, k % 2 ? '#7CE0A3' : '#5BC0EB', { emissive: k % 2 ? '#7CE0A3' : '#5BC0EB' }));
  }
  g.add(block(7.2, 1.9, 2.0, 0.9, 0, 0.62, '#F2F0EC'));
  g.add(block(7.6, 1.98, 1.2, 0.12, 0.62, 0.7, '#2A2F38'));
  const codexScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.53), new THREE.MeshBasicMaterial({ color: '#CFF1E6' }));
  codexScreen.position.set(8.2, 0.62 + 0.35, 2.105);
  g.add(codexScreen);

  // ARIA 비서실: 책상, 화분
  g.add(block(0.8, 6.0, 1.8, 0.9, 0, 0.62, '#F2F0EC'));
  g.add(block(0.3, 8.6, 0.5, 0.5, 0, 0.45, '#B07A54'));
  g.add(block(0.32, 8.62, 0.46, 0.46, 0.45, 0.5, '#6FAF6B'));

  // 회의실: 테이블 + 의자
  const t = MEETING_TABLE;
  g.add(block(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0, 0, 0.55, '#D7C3A6'));
  for (let i = 0; i < 6; i++) {
    const s = meetingSpot(i);
    g.add(block(s.x - 0.22, s.y - 0.22, 0.44, 0.44, 0, 0.4, '#8E8A84'));
  }

  // 바닥 방 이름
  // 방 이름 (각 방 앞쪽 가장자리 근처)
  g.add(roomLabel(ROOMS.claude.label, 1.9, 4.6));
  g.add(roomLabel(ROOMS.codex.label, 7.6, 4.6));
  g.add(roomLabel(ROOMS.aria.label, 1.6, 9.6));
  g.add(roomLabel(ROOMS.meeting.label, 6.6, 9.6));

  return { group: g, deskScreens };
}
