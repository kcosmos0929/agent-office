// 뒷벽 TV 전광판: 5시간 한도 %·리셋까지 남은 시간, 아래에 주간 %.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Usage } from '../../../src/shared/types.ts';
import { formatReset } from '../format.ts';

const W = 512;
const H = 160;

export function tvLines(u: Usage | null, now: number): { main: string; pct: number | null; reset: string; week: string } {
  const w = u?.fiveHour ?? null;
  return {
    main: w ? `사용량 ${Math.round(w.pct)}%` : '사용량 —',
    pct: w ? Math.min(100, Math.max(0, w.pct)) : null,
    reset: w ? `리셋 ${formatReset(w.resetsAt, now)}` : '',
    week: u?.sevenDay ? `주간 ${Math.round(u.sevenDay.pct)}%` : '',
  };
}

export function createTv(): { group: THREE.Group; update(u: Usage | null, now: number): void } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.1, 1.04, 0.06), new THREE.MeshLambertMaterial({ color: '#11151C' }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.94), new THREE.MeshBasicMaterial({ map: texture }));
  screen.position.z = 0.031;
  group.add(frame, screen);
  // 글자는 픽셀로 줄이면 뭉개져서 화면 글자(HTML)로 TV 위에 띄운다. 화면 그림엔 막대만
  const labelEl = document.createElement('div');
  labelEl.className = 'tv-label';
  const mainLine = document.createElement('div');
  const subLine = document.createElement('div');
  subLine.className = 'tv-sub';
  labelEl.append(mainLine, subLine);
  const label = new CSS2DObject(labelEl);
  label.position.set(0, 0.12, 0.05);
  group.add(label);
  // 뒷벽(z=0) Claude 작업실 위
  group.position.set(2.7, 1.63, 0.04);

  let last = '';
  function update(u: Usage | null, now: number) {
    const l = tvLines(u, now);
    const key = JSON.stringify(l);
    if (key === last) return;
    last = key;
    mainLine.textContent = l.main;
    subLine.textContent = [l.reset, l.week].filter(Boolean).join(' · ');
    ctx.fillStyle = '#1E2430';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2E3644';
    ctx.fillRect(40, 118, W - 80, 18);
    if (l.pct !== null) {
      ctx.fillStyle = '#7CE0A3';
      ctx.fillRect(40, 118, ((W - 80) * l.pct) / 100, 18);
    }
    texture.needsUpdate = true;
  }
  update(null, Date.now());
  return { group, update };
}
