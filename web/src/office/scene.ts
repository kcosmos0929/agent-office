// 사무실 장면: 배경(backdrop.ts) + 가구. 모두 코드로 만든 상자들 — 그림 파일 없음.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildBackdrop } from './backdrop.ts';
import { ARIA_DESK, ARIA_DESK_XS, ARIA_DESK_Y, DESK_COLS, DESK_D, DESK_W, DESK_YS, MEETING_TABLE, ROOMS, meetingSpot } from './layout.ts';

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
  buildBackdrop(g);

  // 사무실 책상 8개(2열 × 4) + 모니터(+x 쪽 통로를 향함). 순서는 seatPosition과 같게: 열을 번갈아
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

  // 개발실(Codex): 서버랙 + 책상과 큰 모니터
  for (const x0 of [12.0, 13.0, 14.0]) {
    g.add(block(x0, 0.2, 0.8, 0.8, 0, 1.7, '#3C4656'));
    for (let k = 0; k < 4; k++) g.add(block(x0 + 0.15, 1.0, 0.08, 0.02, 0.35 + k * 0.36, 0.06, k % 2 ? '#7CE0A3' : '#5BC0EB', { emissive: k % 2 ? '#7CE0A3' : '#5BC0EB' }));
  }
  g.add(block(8.8, 1.8, 2.0, 0.9, 0, 0.62, '#F2F0EC'));
  g.add(block(9.2, 1.88, 1.2, 0.12, 0.62, 0.7, '#2A2F38'));
  const codexScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.53), new THREE.MeshBasicMaterial({ color: '#CFF1E6' }));
  codexScreen.position.set(9.8, 0.62 + 0.35, 2.005);
  g.add(codexScreen);

  // 비서실(ARIA): 스탠딩 책상 3개(높은 상판 + 가는 다리 둘 + 모니터) + 화분
  const sd = ARIA_DESK;
  for (const x0 of ARIA_DESK_XS) {
    const y0 = ARIA_DESK_Y;
    g.add(block(x0, y0, sd.w, sd.d, sd.h, 0.05, '#F2F0EC'));
    g.add(block(x0 + 0.1, y0 + 0.25, 0.07, 0.1, 0.04, sd.h - 0.04, '#2A2F38'));
    g.add(block(x0 + sd.w - 0.17, y0 + 0.25, 0.07, 0.1, 0.04, sd.h - 0.04, '#2A2F38'));
    g.add(block(x0 + 0.1, y0 + 0.22, sd.w - 0.2, 0.16, 0.04, 0.03, '#2A2F38'));
    g.add(block(x0 + 0.3, y0 + 0.06, sd.w - 0.6, 0.06, sd.h + 0.05, 0.4, '#2A2F38'));
  }
  g.add(block(14.3, 8.8, 0.5, 0.5, 0, 0.45, '#B07A54'));
  g.add(block(14.32, 8.82, 0.46, 0.46, 0.45, 0.5, '#6FAF6B'));

  // 회의실: 테이블 + 의자
  const t = MEETING_TABLE;
  g.add(block(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0, 0, 0.55, '#D7C3A6'));
  for (let i = 0; i < 6; i++) {
    const s = meetingSpot(i);
    g.add(block(s.x - 0.22, s.y - 0.22, 0.44, 0.44, 0, 0.4, '#8E8A84'));
  }

  // 방 이름 (각 방 앞쪽 가장자리 근처)
  g.add(roomLabel(ROOMS.claude.label, 1.4, 14.6));
  g.add(roomLabel(ROOMS.codex.label, 12.2, 2.6));
  g.add(roomLabel(ROOMS.aria.label, 11.25, 9.15));
  g.add(roomLabel(ROOMS.meeting.label, 11.25, 14.6));

  return { group: g, deskScreens };
}
