// v15 부품을 레이어 순서로 합쳐 (모습, 표정)마다 아틀라스를 만든다: 576×384 = 행 SE/SW/NE/NW, 열 0~7 걷기·8 서기. 한 번 만든 건 캐시.
import * as THREE from 'three';
import { CELL, COLS, DIRS, LAYERS, partPath, type Face, type Look } from './look.ts';

const BASE = `${import.meta.env.BASE_URL}characters/v15/`;
const images = new Map<string, Promise<HTMLImageElement>>();
const atlases = new Map<string, Promise<THREE.CanvasTexture>>();

function loadImage(rel: string): Promise<HTMLImageElement> {
  let p = images.get(rel);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`캐릭터 부품을 못 읽음: ${rel}`));
      img.src = BASE + rel;
    });
    images.set(rel, p);
  }
  return p;
}

async function build(look: Look, face: Face): Promise<THREE.CanvasTexture> {
  const canvas = document.createElement('canvas');
  canvas.width = CELL.w * COLS;
  canvas.height = CELL.h * DIRS.length;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const [row, dir] of DIRS.entries()) {
    const parts = await Promise.all(LAYERS.map((layer) => loadImage(partPath(layer, look, face, dir))));
    for (const img of parts) ctx.drawImage(img, 0, row * CELL.h);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; // 키울 땐 도트 그대로
  t.minFilter = THREE.LinearFilter; // 줄일 땐(도트 하나 < 화면 점 하나) 줄이 빠지지 않게
  t.generateMipmaps = false;
  return t;
}

export function atlasFor(look: Look, face: Face): Promise<THREE.CanvasTexture> {
  const key = `${look.hair}|${look.outfit}|${face}`;
  let p = atlases.get(key);
  if (!p) {
    p = build(look, face);
    atlases.set(key, p);
  }
  return p;
}
