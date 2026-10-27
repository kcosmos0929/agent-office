// 책상 모니터가 일하는 모습: 작업 중이면 화면에 아주 작은 도트 애니메이션을 그린다.
// ▶ 실행 = 진행 막대(짝 랙과 같은 박자), ✏️ 고침 = 글줄이 하나씩, 📖 읽기 = 글줄이 위로 흐름, 💭·👥·🧹·🛡️ = 깜박이는 커서.
// 바탕색도 일 종류마다 달라 멀리서 화면 색만 봐도 무슨 일인지 보인다(WORK_TONE).
import * as THREE from 'three';
import type { Status } from '../../../src/shared/types.ts';
import { beat } from './rack.ts';

/** 모니터 바탕색: 꺼짐 / 급함 / 끝남 */
export const SCREEN = { off: '#3A404C', wait: '#FFE7B3', done: '#D7F0DF' };
/** 일하는 중 바탕·먹색: 일 종류(장면 모양)마다 한 쌍. 급함 노랑·끝남 초록과 겹치지 않게 고른 옅은 색 */
export const WORK_TONE = {
  bar: { bg: '#CFE6FF', ink: '#2F5B86' }, // ▶ 실행: 하늘
  lines: { bg: '#FFD9C7', ink: '#7A4A38' }, // ✏️ 고침: 복숭아
  scroll: { bg: '#E6DDFF', ink: '#5B4A8A' }, // 📖 읽기: 연보라
  cursor: { bg: '#DCE4EE', ink: '#46546A' }, // 💭·👥·🧹·🛡️: 회청
} as const;

export type ScreenFrame =
  | { kind: 'bar'; fill: number }
  | { kind: 'lines'; n: number }
  | { kind: 'scroll'; offset: number }
  | { kind: 'cursor'; on: boolean }
  | { kind: 'solid'; color: string };

const solid = (color: string): ScreenFrame => ({ kind: 'solid', color });

/** 상태 status(자리가 비면 null)와 시각 t(ms, rAF 시각)에서 모니터 한 장면을 순수하게 정한다 */
export function screenFrame(status: Status | null, t: number): ScreenFrame {
  switch (status) {
    case 'running': return { kind: 'bar', fill: ((beat(t) % 16) + 1) / 16 }; // 랙과 같은 박자 번호로 16칸
    case 'editing': return { kind: 'lines', n: (Math.floor(t / 500) % 6) + 1 };
    case 'reading': return { kind: 'scroll', offset: Math.floor(t / 250) % 8 };
    case 'thinking': case 'delegating': case 'compacting': case 'approving':
      return { kind: 'cursor', on: Math.floor(t / 500) % 2 === 0 };
    case 'permission': case 'question': return solid(SCREEN.wait);
    case 'done': return solid(SCREEN.done);
    default: return solid(SCREEN.off); // stalled·idle·quota·gone·빈 자리
  }
}

/** 글줄 길이(칸 폭 비율) — 같은 모양이 되풀이되지 않게 몇 가지로 섞는다 */
const LINE_LEN = [0.8, 0.5, 0.7, 0.35];

/** 모니터 판 하나에 작은 캔버스 텍스처를 붙여 장면을 그린다. 장면이 그대로면 다시 그리지 않는다 */
export class ScreenPainter {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private key = '';
  private readonly w: number;
  private readonly h: number;

  constructor(mesh: THREE.Mesh, w: number, h: number) {
    this.w = w;
    this.h = h;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    this.ctx = canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.magFilter = THREE.NearestFilter; // 도트가 번지지 않게
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.set('#FFFFFF'); // 색은 텍스처가 가진다
    mat.map = this.tex;
    mat.needsUpdate = true;
    this.draw(solid(SCREEN.off));
  }

  draw(f: ScreenFrame): void {
    const key = JSON.stringify(f);
    if (key === this.key) return;
    this.key = key;
    const { ctx, w, h } = this;
    if (f.kind === 'solid') {
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, w, h);
      this.tex.needsUpdate = true;
      return;
    }
    const tone = WORK_TONE[f.kind];
    ctx.fillStyle = tone.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = tone.ink;
    if (f.kind === 'bar') {
      const bh = Math.max(1, Math.floor(h / 5));
      ctx.fillRect(1, Math.floor((h - bh) / 2), Math.round(f.fill * (w - 2)), bh);
    } else if (f.kind === 'lines') {
      for (let i = 0; i < f.n; i++) ctx.fillRect(1, Math.round(1 + (i * (h - 3)) / 5), Math.round((w - 2) * LINE_LEN[i % LINE_LEN.length]), 1);
    } else if (f.kind === 'scroll') {
      for (let y = 0; y < h; y++) {
        const s = y + f.offset; // 위로 흐르니 y행에는 s행의 내용이 보인다
        if (s % 2 === 0) ctx.fillRect(1, y, Math.round((w - 2) * LINE_LEN[(s / 2) % LINE_LEN.length]), 1);
      }
    } else if (f.kind === 'cursor' && f.on) {
      ctx.fillRect(1, Math.floor(h / 2) - 1, Math.max(1, Math.floor(w / 8)), Math.max(2, Math.floor(h / 4)));
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
  }
}
