// 뒷벽 TV 전광판: 5시간 한도 %·리셋까지 남은 시간, 아래에 주간 %.
import * as THREE from 'three';
import type { Usage } from '../../../src/shared/types.ts';
import { formatReset } from '../format.ts';

const W = 512;
const H = 160;
const FONT = "-apple-system, 'Apple SD Gothic Neo', sans-serif";
const MONO = "'SF Mono', Menlo, monospace";

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
  // 뒷벽(z=0) Claude 작업실 위
  group.position.set(2.7, 1.63, 0.04);

  let last = '';
  function update(u: Usage | null, now: number) {
    const l = tvLines(u, now);
    const key = JSON.stringify(l);
    if (key === last) return;
    last = key;
    ctx.fillStyle = '#1E2430';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#7CE0A3';
    ctx.font = `700 44px ${FONT}`;
    ctx.fillText(l.main, 26, 62);
    ctx.fillStyle = '#2E3644';
    ctx.fillRect(26, 84, 300, 16);
    if (l.pct !== null) {
      ctx.fillStyle = '#7CE0A3';
      ctx.fillRect(26, 84, (300 * l.pct) / 100, 16);
    }
    ctx.fillStyle = '#9AA5B4';
    ctx.font = `500 30px ${MONO}`;
    ctx.fillText(l.reset, 344, 100);
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(l.week, 26, 142);
    texture.needsUpdate = true;
  }
  update(null, Date.now());
  return { group, update };
}
