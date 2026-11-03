// 도트 캐릭터 한 명: 발 위치에 세로로 선 판(카메라 쪽으로만 돌림)에 아틀라스 한 칸을 붙인다.
// 판은 FIGURE_LAYER에서 기기 해상도로 그리고(pixelPass), 발밑 그림자는 사무실과 같은 굵은 점으로 그린다.
// 앉으면 서 있는 판을 숨기고 몸·가까운 팔·먼 팔 세 판(같은 칸)으로 그린다 — 팔 두 판만 카메라 쪽으로 당겨 책상 앞 모서리에 손이 묻히지 않게.
import * as THREE from 'three';
import { VIEW_DIR } from '../layout.ts';
import { atlasFor, seatedAtlasFor } from './atlas.ts';
import { cellOf, COLS, DIRS, DOT, UPRIGHT, IDLE_COL, planeOffset, planeSize, SEATED_SOURCE, seatedPlaneOffset, type Dir, type Face, type Look, type SeatedDir } from './look.ts';
import { SEATED_ATLAS, SEATED_PARTS, seatedCell, type SeatedPart } from './seated.ts';

export const FIGURE_LAYER = 1;
/** 사람을 그린 기기 점에 남기는 스텐실 값(pixelPass가 그 점에만 유리를 따로 덮는다) */
export const FIGURE_STENCIL = 1;

const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });

/** 앉은 팔 두 판을 카메라 쪽으로 당기는 거리(월드). 보는 방향 그대로 옮기니 화면 위치는 그대로다 */
export const ARM_PULL = 0.4;
/** 바닥판 윗면 높이 — 서기 그림은 여기에 발을 딛고, 앉은 그림의 기준점은 월드 0(의자 가운데 바닥) */
const FLOOR_TOP = 0.04;
const TOWARD_CAMERA = new THREE.Vector3(...VIEW_DIR).normalize();

/** 사람이 그린 점에 스텐실을 남기는 판 재질(유리를 사람 점에만 따로 덮는 데 씀) */
function figureMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ alphaTest: 0.5, visible: false, stencilWrite: true, stencilRef: FIGURE_STENCIL, stencilZPass: THREE.ReplaceStencilOp });
}

type SeatedPlane = { part: SeatedPart; mesh: THREE.Mesh; material: THREE.MeshBasicMaterial };

export class Figure {
  /** 발 위치에 붙일 묶음 */
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly material = figureMaterial();
  /** 앉은 세 판(몸·가까운 팔·먼 팔)을 담는 묶음 — 앉을 때만 보인다 */
  private readonly seatedRoot = new THREE.Group();
  private readonly seatedPlanes: SeatedPlane[];
  /** 앉은 방향(그림을 불러 둔 방향)과 칸 번호. 서 있으면 null */
  private seated: { dir: SeatedDir; index: number } | null = null;
  private seatedLoaded: SeatedDir | null = null;
  /** 이 그림의 모습 — 모습이 바뀌면 배우가 그림을 새로 만들어 바꿔 끼운다(cast.ts reshape) */
  readonly look: Look;
  private readonly scale: number;
  private readonly onReady: () => void;
  private face: Face | null = null;
  private dir: Dir = 'SE';
  private col = IDLE_COL;
  /** 폴짝으로 판을 띄운 도트 수 */
  private lifted = 0;
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
    // 앉은 세 판: 기준점(의자 가운데 바닥, 월드 0)을 원점에. 팔은 카메라 쪽으로 당긴 묶음에 따로 둔다
    this.seatedRoot.position.y = -FLOOR_TOP;
    this.seatedRoot.visible = false;
    this.seatedPlanes = SEATED_PARTS.map((part) => {
      const material = figureMaterial();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
      mesh.layers.set(FIGURE_LAYER);
      const turn = new THREE.Group();
      turn.rotation.y = Math.PI / 4;
      turn.add(mesh);
      const hold = new THREE.Group();
      if (part !== 'body') hold.position.copy(TOWARD_CAMERA).multiplyScalar(ARM_PULL * scale);
      hold.add(turn);
      this.seatedRoot.add(hold);
      return { part, mesh, material };
    });
    this.root.add(this.seatedRoot);
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

  /** 방향과 그림(걷기 0~7 또는 서기). 앉아 있었으면 일어선다 */
  show(dir: Dir, frame: number | 'idle'): void {
    this.dir = dir;
    this.col = frame === 'idle' ? IDLE_COL : frame;
    this.seated = null;
    this.apply();
  }

  /** 앉은 그림: 방향(SE·SW 얼굴, NW·NE 등 — SW·NE는 SE·NW 그림 좌우 뒤집기)과 칸 번호(seatedFrame). 그림을 다 불러오기 전엔 서 있는 그림 그대로이고 false */
  sit(dir: SeatedDir, index: number): boolean {
    this.seated = { dir, index };
    if (this.seatedLoaded !== dir) this.loadSeated(dir);
    this.apply();
    return this.seatedRoot.visible;
  }

  /** 지금 보이는 판들(누르기 판정용) */
  pickables(): THREE.Mesh[] {
    return this.seatedRoot.visible ? this.seatedPlanes.map((p) => p.mesh) : [this.mesh];
  }

  /** 판만 도트 단위로 위로 띄운다(그림자는 땅에 그대로). 앉은 그림도 같이 — 의자에서 들썩(질문·승인 통통) */
  lift(dots: number): void {
    if (dots === this.lifted) return;
    this.lifted = dots;
    this.apply();
  }

  dispose(): void {
    this.disposed = true;
    this.material.map?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    for (const p of this.seatedPlanes) {
      p.material.map?.dispose();
      p.material.dispose();
      p.mesh.geometry.dispose();
    }
    this.shadow.geometry.dispose(); // 그림자 재질(shadowMat)은 모두 같이 쓰니 남긴다
  }

  /** 방향 하나의 세 장을 불러 사람마다 복제(같은 그림을 나눠 쓰고 칸 위치만 따로)해 붙인다 */
  private loadSeated(dir: SeatedDir): void {
    this.seatedLoaded = dir;
    for (const p of this.seatedPlanes) p.material.visible = false; // 다른 방향 그림이 남아 보이지 않게
    void Promise.all(SEATED_PARTS.map((part) => seatedAtlasFor(this.look, dir, part))).then(
      (atlases) => {
        if (this.disposed || this.seatedLoaded !== dir) return;
        atlases.forEach((atlas, i) => {
          const { material } = this.seatedPlanes[i];
          const t = atlas.clone();
          t.repeat.set((SEATED_SOURCE[dir].mirror ? -1 : 1) / SEATED_ATLAS.cols, 1 / SEATED_ATLAS.rows); // SW·NE: 좌우 뒤집기
          material.map?.dispose();
          material.map = t;
          material.visible = true;
          material.needsUpdate = true;
        });
        this.apply();
        this.onReady();
      },
      (err: unknown) => console.warn('[synthetic-office]', err),
    );
  }

  private apply(): void {
    const s = this.seated;
    // 앉은 그림이 준비됐을 때만 바꿔 든다(불러오는 동안 사람이 사라지지 않게)
    const sitting = s !== null && this.seatedLoaded === s.dir && this.seatedPlanes[0].material.visible;
    this.mesh.visible = !sitting;
    this.seatedRoot.visible = sitting;
    const lift = (this.lifted * DOT * this.scale) / UPRIGHT;
    if (sitting) {
      const o = seatedPlaneOffset(s.dir, this.scale);
      const { col, row } = seatedCell(s.index);
      for (const p of this.seatedPlanes) {
        p.mesh.position.set(o.x, o.y + lift, 0);
        const u = SEATED_SOURCE[s.dir].mirror ? col + 1 : col; // 뒤집은 그림은 칸 오른쪽 끝에서 왼쪽으로 읽는다
        p.material.map?.offset.set(u / SEATED_ATLAS.cols, 1 - (row + 1) / SEATED_ATLAS.rows); // 위 기준 행 → 아래 기준 UV
      }
      return;
    }
    const o = planeOffset(this.dir, this.scale);
    this.mesh.position.set(o.x, o.y + lift, 0);
    const t = this.material.map;
    if (!t) return;
    const { col, row } = cellOf(this.dir, this.col);
    t.offset.set(col / COLS, 1 - (row + 1) / DIRS.length); // 캔버스 그림은 위아래가 뒤집혀 올라간다(flipY)
  }
}
