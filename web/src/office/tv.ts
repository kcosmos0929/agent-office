// 뒷벽 TV 전광판: 5시간 한도 %·리셋까지 남은 시간, 아래에 주간 %. 글자는 화면 그림 안에 픽셀 글꼴로 그린다.
import * as THREE from 'three';
import type { Usage } from '../../../src/shared/types.ts';
import { formatReset } from '../format.ts';

// 화면 그림 크기(칸) — 1440폭 창·px 1.5에서 한 칸이 그려지는 점 하나쯤(더 작으면 칸이 빠져 글씨가 뭉개짐)
const W = 160;
const H = 56;
const TV_W = 6.0;
const TV_H = 1.9;
const INK = { main: '#7CE0A3', sub: '#9AA5B4', bg: '#1E2430', track: '#2E3644' };

export function tvLines(u: Usage | null, now: number): { main: string; pct: number | null; reset: string; week: string } {
  const w = u?.fiveHour ?? null;
  return {
    main: w ? `사용량 ${Math.round(w.pct)}%` : '사용량 —',
    pct: w ? Math.min(100, Math.max(0, w.pct)) : null,
    reset: w ? `리셋 ${formatReset(w.resetsAt, now)}` : '',
    week: u?.sevenDay ? `주간 ${Math.round(u.sevenDay.pct)}%` : '',
  };
}

/** 캔버스 칸에 쓸 화면 색(sRGB) 바이트. THREE.Color의 r/g/b는 선형 값이라 그대로 쓰면 sRGB 텍스처에서 한 번 더 어두워진다 */
export function inkBytes(color: string): [number, number, number] {
  const c = new THREE.Color(color).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b].map((v) => Math.round(v * 255)) as [number, number, number];
}

/** 가운데 맞춘 픽셀 글씨: 캔버스 글자의 흐린 가장자리를 없애(반쯤 칠한 칸 → 꽉 채움/빈칸) 도트처럼 또렷하게 */
function pixelText(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, color: string): void {
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const t = tmp.getContext('2d', { willReadFrequently: true })!;
  t.font = font;
  t.textBaseline = 'top';
  t.fillStyle = '#FFFFFF';
  t.fillText(text, Math.round((W - t.measureText(text).width) / 2), y);
  const src = t.getImageData(0, 0, W, H).data;
  const out = ctx.getImageData(0, 0, W, H);
  const rgb = inkBytes(color);
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] < 110) continue;
    out.data[i] = rgb[0];
    out.data[i + 1] = rgb[1];
    out.data[i + 2] = rgb[2];
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

export function createTv(): { group: THREE.Group; update(u: Usage | null, now: number): void } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(TV_W + 0.12, TV_H + 0.12, 0.08), new THREE.MeshLambertMaterial({ color: '#11151C' }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(TV_W, TV_H), new THREE.MeshBasicMaterial({ map: texture }));
  screen.position.z = 0.041;
  group.add(frame, screen);
  // 뒷벽(z=0) 사무실 위
  group.position.set(3.75, 2.0, 0.05);

  let last = '';
  function update(u: Usage | null, now: number) {
    const l = tvLines(u, now);
    const key = JSON.stringify(l);
    if (key === last) return;
    last = key;
    ctx.fillStyle = INK.bg;
    ctx.fillRect(0, 0, W, H);
    pixelText(ctx, l.main, 4, '14px Galmuri14', INK.main);
    pixelText(ctx, [l.reset, l.week].filter(Boolean).join(' · '), 21, '11px Galmuri11', INK.sub);
    ctx.fillStyle = INK.track;
    ctx.fillRect(12, 42, W - 24, 7);
    if (l.pct !== null) {
      ctx.fillStyle = INK.main;
      ctx.fillRect(12, 42, Math.round(((W - 24) * l.pct) / 100), 7);
    }
    texture.needsUpdate = true;
  }
  update(null, Date.now());
  return { group, update };
}
