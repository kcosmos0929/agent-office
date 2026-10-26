import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Figure } from '../../web/src/office/sprites/figure.ts';
import { lookFor } from '../../web/src/office/sprites/look.ts';
import { GLASS_LAYER, splitTransparent } from '../../web/src/office/pixelPass.ts';

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

test('splitTransparent: 투명 재질만 유리 레이어로 옮기고 깊이를 쓰게 한다', () => {
  const root = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.2, depthWrite: false }));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  const edge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }));
  glass.add(edge);
  root.add(glass, wall);
  assert.equal(splitTransparent(root), 2);
  assert.ok(glass.layers.isEnabled(GLASS_LAYER) && !glass.layers.isEnabled(0));
  assert.ok(edge.layers.isEnabled(GLASS_LAYER));
  assert.ok(wall.layers.isEnabled(0) && !wall.layers.isEnabled(GLASS_LAYER));
  assert.equal((glass.material as THREE.Material).depthWrite, true);
});
