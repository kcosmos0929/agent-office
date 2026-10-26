import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Figure } from '../../web/src/office/sprites/figure.ts';
import { DOT, UPRIGHT, lookFor } from '../../web/src/office/sprites/look.ts';
import { GLASS_LAYER, LINE_LAYER, splitTransparent } from '../../web/src/office/pixelPass.ts';
import { FIGURE_STENCIL } from '../../web/src/office/sprites/figure.ts';

test('Figure.dispose: 본체 판과 그림자 geometry를 모두 해제(공용 그림자 재질은 남김)', (t) => {
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
  assert.equal(geos.length, 2);
  const disposed = new Set<THREE.BufferGeometry>();
  for (const g of geos) g.addEventListener('dispose', () => disposed.add(g));
  const shared = [...mats].find((m) => m !== f.mesh.material)!;
  let sharedDisposed = false;
  shared.addEventListener('dispose', () => (sharedDisposed = true));
  f.dispose();
  assert.equal(disposed.size, 2);
  assert.equal(sharedDisposed, false);
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
