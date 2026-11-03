// (모습, 표정) 아틀라스를 three.js 텍스처로. 그림 합치기는 compose.ts(목록형도 같이 씀).
import * as THREE from 'three';
import { composeLook } from './compose.ts';
import type { Face, Look, SeatedDir } from './look.ts';
import { seatedFiles, type SeatedPart } from './seated.ts';

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

const seated = new Map<string, Promise<THREE.Texture>>();

/** 후보를 앞부터 읽고, 못 읽으면 경고 후 다음(seated-v26부터는 후보가 하나) */
function loadSeatedImage(files: readonly string[]): Promise<HTMLImageElement> {
  const [first, ...rest] = files;
  if (first === undefined) return Promise.reject(new Error('앉은 그림이 없는 모습'));
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`앉은 그림을 못 읽음: ${first}`));
    img.src = `${import.meta.env?.BASE_URL ?? '/'}characters/${first}`;
  });
  if (rest.length === 0) return p;
  return p.catch((err: unknown) => {
    console.warn('[synthetic-office]', err);
    return loadSeatedImage(rest);
  });
}

/** 앉은 그림 한 장(방향 × 몸·가까운 팔·먼 팔). 세 장이 픽셀을 나눠 가지니 칸 경계가 번지지 않게 줄일 때도 Nearest */
export function seatedAtlasFor(look: Look, dir: SeatedDir, part: SeatedPart): Promise<THREE.Texture> {
  const files = seatedFiles(look, dir, part);
  const key = files[0] ?? `${look.hair}+${look.outfit}/${dir}/${part}`;
  let p = seated.get(key);
  if (!p) {
    p = loadSeatedImage(files).then((img) => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    });
    seated.set(key, p);
  }
  return p;
}
