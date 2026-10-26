// 도트 캐릭터 한 명: 발 위치에 세로로 선 판(카메라 쪽으로만 돌림)에 아틀라스 한 칸을 붙인다.
// 판은 FIGURE_LAYER에서 기기 해상도로 그리고(pixelPass), 발밑 그림자는 사무실과 같은 굵은 점으로 그린다.
import * as THREE from 'three';
import { atlasFor } from './atlas.ts';
import { cellOf, COLS, DIRS, IDLE_COL, planeOffset, planeSize, type Dir, type Face, type Look } from './look.ts';

export const FIGURE_LAYER = 1;
/** 사람을 그린 기기 점에 남기는 스텐실 값(pixelPass가 그 점에만 유리를 따로 덮는다) */
export const FIGURE_STENCIL = 1;

const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });

export class Figure {
  /** 발 위치에 붙일 묶음 */
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly material = new THREE.MeshBasicMaterial({ alphaTest: 0.5, visible: false, stencilWrite: true, stencilRef: FIGURE_STENCIL, stencilZPass: THREE.ReplaceStencilOp });
  private readonly look: Look;
  private readonly scale: number;
  private readonly onReady: () => void;
  private face: Face | null = null;
  private dir: Dir = 'SE';
  private col = IDLE_COL;
  private disposed = false;

  constructor(look: Look, face: Face, scale: number, onReady: () => void) {
    this.look = look;
    this.scale = scale;
    this.onReady = onReady;
    const { w, h } = planeSize(scale);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material);
    this.mesh.layers.set(FIGURE_LAYER);
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.PI / 4; // 판이 카메라(+x, +z) 쪽을 보게
    pivot.add(this.mesh);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.26 * scale, 20), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.y = 0.6;
    this.shadow.position.y = 0.012;
    this.root.add(this.shadow, pivot);
    this.setFace(face);
    this.show('SE', 'idle');
  }

  setFace(face: Face): void {
    if (face === this.face) return;
    this.face = face;
    void atlasFor(this.look, face).then(
      (atlas) => {
        if (this.disposed || this.face !== face) return;
        const t = atlas.clone(); // 같은 그림(source)을 나눠 쓰고, 칸 위치(offset)만 사람마다 따로
        t.repeat.set(1 / COLS, 1 / DIRS.length);
        this.material.map?.dispose();
        this.material.map = t;
        this.material.visible = true;
        this.material.needsUpdate = true;
        this.apply();
        this.onReady();
      },
      (err: unknown) => console.warn('[synthetic-office]', err),
    );
  }

  /** 방향과 그림(걷기 0~7 또는 서기) */
  show(dir: Dir, frame: number | 'idle'): void {
    this.dir = dir;
    this.col = frame === 'idle' ? IDLE_COL : frame;
    this.apply();
  }

  dispose(): void {
    this.disposed = true;
    this.material.map?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.shadow.geometry.dispose(); // 그림자 재질(shadowMat)은 모두 같이 쓰니 남긴다
  }

  private apply(): void {
    const o = planeOffset(this.dir, this.scale);
    this.mesh.position.set(o.x, o.y, 0);
    const t = this.material.map;
    if (!t) return;
    const { col, row } = cellOf(this.dir, this.col);
    t.offset.set(col / COLS, 1 - (row + 1) / DIRS.length); // 캔버스 그림은 위아래가 뒤집혀 올라간다(flipY)
  }
}
