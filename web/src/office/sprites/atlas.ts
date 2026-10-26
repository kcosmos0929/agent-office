// (모습, 표정) 아틀라스를 three.js 텍스처로. 그림 합치기는 compose.ts(목록형도 같이 씀).
import * as THREE from 'three';
import { composeLook } from './compose.ts';
import type { Face, Look } from './look.ts';

const atlases = new Map<string, Promise<THREE.CanvasTexture>>();

export function atlasFor(look: Look, face: Face): Promise<THREE.CanvasTexture> {
  const key = `${look.hair}|${look.outfit}|${face}`;
  let p = atlases.get(key);
  if (!p) {
    p = composeLook(look, face).then((canvas) => {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.NearestFilter; // 키울 땐 도트 그대로
      t.minFilter = THREE.LinearFilter; // 줄일 땐(도트 하나 < 화면 점 하나) 줄이 빠지지 않게
      t.generateMipmaps = false;
      return t;
    });
    atlases.set(key, p);
  }
  return p;
}
