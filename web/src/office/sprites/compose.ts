// v15 부품을 레이어 순서로 합쳐 (모습, 표정)마다 576×384 아틀라스 캔버스를 만든다(행 SE/SW/NE/NW, 열 0~7 걷기·8 서기).
// three.js 없이 캔버스만 써서 목록형 아바타도 같이 쓴다. 한 번 만든 건 캐시.
import { CELL, COLS, DIRS, IDLE_COL, LAYERS, partPath, type Face, type Look } from './look.ts';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}characters/v15/`; // 테스트(node)엔 import.meta.env가 없다
const images = new Map<string, Promise<HTMLImageElement>>();
const looks = new Map<string, Promise<HTMLCanvasElement>>();
const avatars = new Map<string, string>();
const waiters = new Map<string, Set<(url: string) => void>>();

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

export function composeLook(look: Look, face: Face): Promise<HTMLCanvasElement> {
  const key = `${look.hair}|${look.outfit}|${face}`;
  let p = looks.get(key);
  if (!p) {
    p = (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = CELL.w * COLS;
      canvas.height = CELL.h * DIRS.length;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      for (const [row, dir] of DIRS.entries()) {
        const parts = await Promise.all(LAYERS.map((layer) => loadImage(partPath(layer, look, face, dir))));
        for (const img of parts) ctx.drawImage(img, 0, row * CELL.h);
      }
      return canvas;
    })();
    looks.set(key, p);
  }
  return p;
}

/** 목록형 아바타: 정면(SE) 서기 그림의 머리·어깨 46×46 도트 */
export const AVATAR = { x: 9, y: 0, size: 46 };

/** 아바타 그림 주소(data URL). 아직 없으면 null을 돌려주고(만들기 시작) 다 되면 onReady(url) */
export function avatarUrl(look: Look, face: Face, onReady: (url: string) => void): string | null {
  const key = `${look.hair}|${look.outfit}|${face}`;
  const url = avatars.get(key);
  if (url) return url;
  if (typeof Image === 'undefined') return null; // 테스트(가짜 DOM)
  let set = waiters.get(key);
  if (set) {
    set.add(onReady);
    return null;
  }
  set = new Set([onReady]);
  waiters.set(key, set);
  void composeLook(look, face).then(
    (atlas) => {
      const c = document.createElement('canvas');
      c.width = AVATAR.size;
      c.height = AVATAR.size;
      c.getContext('2d')!.drawImage(atlas, IDLE_COL * CELL.w + AVATAR.x, AVATAR.y, AVATAR.size, AVATAR.size, 0, 0, AVATAR.size, AVATAR.size);
      const made = c.toDataURL();
      avatars.set(key, made);
      for (const cb of waiters.get(key) ?? []) cb(made);
      waiters.delete(key);
    },
    (err: unknown) => {
      waiters.delete(key);
      console.warn('[synthetic-office]', err);
    },
  );
  return null;
}
