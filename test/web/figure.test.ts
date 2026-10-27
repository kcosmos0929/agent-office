import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARM_PULL, FIGURE_LAYER, Figure } from '../../web/src/office/sprites/figure.ts';
import { DOT, UPRIGHT, lookFor, seatedPlaneOffset } from '../../web/src/office/sprites/look.ts';
import { VIEW_DIR } from '../../web/src/office/layout.ts';
import { GLASS_LAYER, LINE_LAYER, splitTransparent } from '../../web/src/office/pixelPass.ts';
import { FIGURE_STENCIL } from '../../web/src/office/sprites/figure.ts';

test('Figure.dispose: 서기 판·앉은 세 판·그림자 geometry와 재질을 모두 해제(공용 그림자 재질은 남김)', (t) => {
  t.mock.method(console, 'warn', () => {}); // node엔 document가 없어 그림 불러오기는 실패 — 이 테스트와 무관
  const f = new Figure(lookFor(0), 'neutral', 1, () => {});
  const geos: THREE.BufferGeometry[] = [];
  const mats = new Set<THREE.Material>();
  f.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geos.push(o.geometry);
      mats.add(o.material as THREE.Material);
    }
  });
  assert.equal(geos.length, 5);
  const disposed = new Set<THREE.BufferGeometry>();
  for (const g of geos) g.addEventListener('dispose', () => disposed.add(g));
  const shared = [...mats].find((m) => m.transparent)!; // 그림자 재질만 반투명
  const own = [...mats].filter((m) => m !== shared);
  assert.equal(own.length, 4);
  const ownDisposed = new Set<THREE.Material>();
  for (const m of own) m.addEventListener('dispose', () => ownDisposed.add(m));
  let sharedDisposed = false;
  shared.addEventListener('dispose', () => (sharedDisposed = true));
  f.dispose();
  assert.equal(disposed.size, 5);
  assert.equal(ownDisposed.size, 4);
  assert.equal(sharedDisposed, false);
});

/** 사람이 그리는 판(그림자 빼고)과 그 판을 담은 맨 위 묶음 */
function planes(f: Figure): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  f.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.layers.isEnabled(FIGURE_LAYER)) out.push(o);
  });
  return out;
}

test('Figure 앉은 판: 세 판 모두 인물 레이어·스텐실, 팔 두 판만 보는 방향으로 당겨 화면 위치는 그대로', (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = new Figure(lookFor(0), 'neutral', 1, () => {});
  const seated = planes(f).filter((m) => m !== f.mesh);
  assert.equal(seated.length, 3);
  const view = new THREE.Vector3(...VIEW_DIR).normalize();
  const pulls = seated.map((m) => {
    const mat = m.material as THREE.Material;
    assert.equal(mat.stencilWrite, true);
    assert.equal(mat.alphaTest, 0.5);
    const hold = m.parent!.parent!.position; // mesh → 돌림 묶음 → 당김 묶음
    assert.ok(hold.clone().cross(view).length() < 1e-12, '보는 방향과 나란해야 화면 위치가 안 바뀐다');
    return hold.dot(view);
  });
  assert.deepEqual(pulls.map((d) => Math.round(d * 1e9) / 1e9), [0, ARM_PULL, ARM_PULL]); // body, nearArm, farArm
});

test('Figure.sit: 그림이 오기 전엔 서 있고 false, 오면 세 판을 같은 칸으로 보이고 true, show로 다시 선다', async (t) => {
  t.mock.method(console, 'warn', () => {}); // 서기 그림(캔버스 합치기)은 node에 document가 없어 실패 — 이 테스트와 무관
  const saved = (globalThis as { Image?: unknown }).Image;
  (globalThis as { Image?: unknown }).Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 512;
    height = 864;
    set src(_: string) {
      setTimeout(() => this.onload?.());
    }
  };
  try {
    let ready = 0;
    const f = new Figure(lookFor(0), 'neutral', 1, () => ready++);
    assert.equal(f.sit('SE', 39), false);
    assert.deepEqual(f.pickables(), [f.mesh]);
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(ready > 0);
    assert.equal(f.sit('SE', 39), true); // 39 = 손4·상체1·눈0 → 7열 4행
    const seated = planes(f).filter((m) => m !== f.mesh);
    assert.deepEqual(f.pickables(), seated);
    assert.equal(f.mesh.visible, false);
    const o = seatedPlaneOffset('SE');
    for (const m of seated) {
      const map = (m.material as THREE.MeshBasicMaterial).map!;
      assert.ok(Math.abs(map.offset.x - 7 / 8) < 1e-12 && Math.abs(map.offset.y - (1 - 5 / 9)) < 1e-12);
      assert.ok(Math.abs(map.repeat.x - 1 / 8) < 1e-12 && Math.abs(map.repeat.y - 1 / 9) < 1e-12);
      assert.ok(Math.abs(m.position.x - o.x) < 1e-12 && Math.abs(m.position.y - o.y) < 1e-12);
    }
    // 사람마다 칸 위치를 따로 가진다(같은 그림의 offset을 함께 바꾸지 않는다)
    const g = new Figure(lookFor(0), 'neutral', 1, () => {});
    g.sit('SE', 0);
    await new Promise((r) => setTimeout(r, 10));
    g.sit('SE', 0);
    const mapOf = (x: Figure) => (planes(x).find((m) => m !== x.mesh)!.material as THREE.MeshBasicMaterial).map!;
    assert.notEqual(mapOf(f), mapOf(g));
    assert.ok(Math.abs(mapOf(f).offset.x - 7 / 8) < 1e-12);
    f.show('SE', 'idle');
    assert.deepEqual(f.pickables(), [f.mesh]);
    assert.equal(f.mesh.visible, true);
  } finally {
    (globalThis as { Image?: unknown }).Image = saved;
  }
});

test('Figure: 그린 점에 스텐실을 남긴다(유리를 사람 점에만 따로 덮는 데 씀)', (t) => {
  t.mock.method(console, 'warn', () => {});
  const m = new Figure(lookFor(0), 'neutral', 1, () => {}).mesh.material as THREE.Material;
  assert.equal(m.stencilWrite, true);
  assert.equal(m.stencilRef, FIGURE_STENCIL);
  assert.equal(m.stencilZPass, THREE.ReplaceStencilOp);
});

test('splitTransparent: 투명한 면은 유리 레이어, 투명한 선은 선 레이어로 옮기고 깊이를 쓰게 한다', () => {
  const root = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.2, depthWrite: false }));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  const edge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }));
  glass.add(edge);
  root.add(glass, wall);
  assert.equal(splitTransparent(root), 2);
  assert.ok(glass.layers.isEnabled(GLASS_LAYER) && !glass.layers.isEnabled(0));
  assert.ok(edge.layers.isEnabled(LINE_LAYER) && !edge.layers.isEnabled(GLASS_LAYER));
  assert.ok(wall.layers.isEnabled(0) && !wall.layers.isEnabled(GLASS_LAYER));
  const gm = glass.material as THREE.Material;
  assert.equal(gm.depthWrite, true);
  // 기기 해상도에선 사람 점(스텐실)에만 다시 그린다
  assert.equal(gm.stencilWrite, true);
  assert.equal(gm.stencilRef, FIGURE_STENCIL);
  assert.equal(gm.stencilFunc, THREE.EqualStencilFunc);
  assert.equal((edge.material as THREE.Material).stencilWrite, false);
});

test('Figure.lift: 판을 도트 단위로 위로 올리고 0이면 제자리', (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = new Figure(lookFor(0), 'neutral', 1, () => {});
  const y0 = f.mesh.position.y;
  f.lift(2);
  assert.ok(Math.abs(f.mesh.position.y - (y0 + (2 * DOT) / UPRIGHT)) < 1e-9);
  f.show('SW', 'idle'); // 그림을 바꿔도 올린 높이는 유지
  assert.ok(Math.abs(f.mesh.position.y - (y0 + (2 * DOT) / UPRIGHT)) < 1e-9);
  f.lift(0);
  assert.ok(Math.abs(f.mesh.position.y - y0) < 1e-9);
});
