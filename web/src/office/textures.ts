// 도트 무늬 텍스처: 캔버스에 한 칸씩 찍어 만든다(그림 파일 없음). 늘 같은 무늬가 나오게 씨앗 고정 난수.
import * as THREE from 'three';

type Put = (x: number, y: number, color: string) => void;

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pixelTexture(w: number, h: number, seed: number, draw: (put: Put, rand: () => number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const put: Put = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  draw(put, seeded(seed));
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 나무 판자: 4칸 폭 판자가 가로로, 이음매는 줄마다 엇갈림 */
export function planks(tones: string[], seam: string, grain: string, seed = 1): THREE.CanvasTexture {
  return pixelTexture(32, 32, seed, (put, rand) => {
    for (let row = 0; row < 8; row++) {
      const y0 = row * 4;
      const joint = Math.floor(rand() * 32);
      const toneA = tones[Math.floor(rand() * tones.length)];
      const toneB = tones[Math.floor(rand() * tones.length)];
      for (let x = 0; x < 32; x++) {
        const board = (x - joint + 32) % 32 < 16 ? toneA : toneB;
        const isJoint = x === joint || x === (joint + 16) % 32;
        for (let y = y0; y < y0 + 3; y++) put(x, y, isJoint ? seam : rand() < 0.05 ? grain : board);
        put(x, y0 + 3, seam);
      }
    }
  });
}

/** 바닥 타일: 8칸 타일 + 줄눈, 두 색 바둑판 */
export function tiles(a: string, b: string, grout: string, speck: string, seed = 2): THREE.CanvasTexture {
  return pixelTexture(16, 16, seed, (put, rand) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const tile = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? a : b;
        put(x, y, x % 8 === 7 || y % 8 === 7 ? grout : rand() < 0.04 ? speck : tile);
      }
    }
  });
}

/** 카펫: 바탕 + 점점이 섞인 결 */
export function carpet(base: string, dot: string, seed = 3): THREE.CanvasTexture {
  return pixelTexture(16, 16, seed, (put, rand) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(x, y, (x + y) % 4 === 0 && rand() < 0.7 ? dot : base);
  });
}

/** 칠한 벽: 바탕에 아주 옅은 얼룩 */
export function speckle(base: string, dot: string, seed = 4): THREE.CanvasTexture {
  return pixelTexture(16, 16, seed, (put, rand) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(x, y, rand() < 0.12 ? dot : base);
  });
}

/** 통창 밖 풍경: 낮 하늘(띠 3개) + 먼 빌딩·가까운 빌딩과 창문 점. w×h칸 한 장 */
export function cityView(w: number, h: number, seed = 7): THREE.CanvasTexture {
  const t = pixelTexture(w, h, seed, (put, rand) => {
    const sky = ['#A4CDEA', '#B8DAF0', '#CDE6F4'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, sky[Math.min(2, Math.floor((y / h) * 3))]);
    const layer = (minH: number, maxH: number, tones: string[], lit: string, dark: string) => {
      let x = Math.floor(rand() * 4) - 4;
      while (x < w) {
        const bw = 5 + Math.floor(rand() * 9);
        const bh = minH + Math.floor(rand() * (maxH - minH));
        const tone = tones[Math.floor(rand() * tones.length)];
        for (let yy = h - bh; yy < h; yy++) {
          for (let xx = Math.max(0, x); xx < Math.min(w, x + bw); xx++) {
            const inner = xx > x && xx < x + bw - 1 && yy > h - bh;
            const win = inner && (xx - x) % 2 === 0 && (yy - (h - bh)) % 2 === 0;
            put(xx, yy, win ? (rand() < 0.3 ? lit : dark) : tone);
          }
        }
        x += bw + (rand() < 0.3 ? 1 : 0);
      }
    };
    layer(Math.floor(h * 0.45), Math.floor(h * 0.9), ['#93AFC8', '#9DB8CF', '#88A5BF'], '#C9DCEB', '#7F9CB7');
    layer(Math.floor(h * 0.2), Math.floor(h * 0.6), ['#6E8CA8', '#7895B0', '#64829E'], '#BFD6E8', '#5A7894');
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** 러그 한 장: 테두리 + 가운데 마름모 */
export function rug(field: string, border: string, accent: string): THREE.CanvasTexture {
  const W = 40;
  const H = 32;
  const t = pixelTexture(W, H, 6, (put) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
        const diamond = Math.abs(x - W / 2 + 0.5) / (W / 2) + Math.abs(y - H / 2 + 0.5) / (H / 2);
        let c = field;
        if (edge < 2) c = border;
        else if (edge === 3) c = accent;
        else if (diamond < 0.42 && diamond > 0.3) c = border;
        else if (diamond < 0.16) c = accent;
        put(x, y, c);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
