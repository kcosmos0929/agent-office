import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Figure } from '../../web/src/office/sprites/figure.ts';
import { lookFor } from '../../web/src/office/sprites/look.ts';

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
