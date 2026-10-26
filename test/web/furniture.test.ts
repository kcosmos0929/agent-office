import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { binders, copier, printer, supplyCabinet } from '../../web/src/office/furniture.ts';

/** 소수 둘째 자리(-0은 0으로) */
const r = (v: number) => Math.round(v * 100) / 100 + 0;
/** 상자마다 [x0, x1, z0, z1, 높이] */
function boxes(g: THREE.Group): number[][] {
  const out: number[][] = [];
  g.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    out.push([b.min.x, b.max.x, b.min.z, b.max.z, b.min.y].map(r));
  });
  return out;
}
const build = (f: (g: THREE.Group) => void) => {
  const g = new THREE.Group();
  f(g);
  g.updateMatrixWorld(true);
  return boxes(g);
};

for (const [name, make, depth] of [
  ['복합기', (g: THREE.Group, front: 'px' | 'nx') => printer(g, 0, 0, front), 0.6],
  ['복사기', (g: THREE.Group, front: 'px' | 'nx') => copier(g, 0, 0, front), 0.6],
  ['비품장', (g: THREE.Group, front: 'px' | 'nx') => supplyCabinet(g, 0, 0, front), 0.5],
] as const) {
  test(`${name}: 앞을 -x로 두면 +x로 둔 모양을 몸통 가운데에서 좌우로 뒤집은 것과 같다`, () => {
    const px = build((g) => make(g, 'px'));
    const nx = build((g) => make(g, 'nx'));
    const mirrored = px.map(([x0, x1, ...rest]) => [r(depth - x1), r(depth - x0), ...rest]);
    assert.deepEqual(nx, mirrored);
    // 앞쪽 장식(조작판·서랍 줄·손잡이)은 앞면 쪽 절반에 있다
    const details = nx.slice(1).filter(([x0, x1]) => x1 - x0 < depth - 0.1);
    assert.ok(details.length > 0 && details.every(([x0, x1]) => (x0 + x1) / 2 < depth / 2));
  });
}

test('바인더: 뒷벽에 둘 땐 x를 따라 늘어서고 등(얇은 쪽)이 +z를 본다', () => {
  const along = build((g) => binders(g, 0, 0, 0.6, 5, 'x'));
  assert.equal(along.length, 5);
  for (const [i, [x0, x1, z0, z1]] of along.entries()) {
    assert.deepEqual([x0, r(x1 - x0), z0, z1], [r(i * 0.08), 0.07, 0, 0.26]);
  }
  // 기본(창가 벽)은 지금처럼 z를 따라
  const byWindow = build((g) => binders(g, 0, 0, 0.6, 2));
  assert.deepEqual(byWindow.map(([x0, x1, z0]) => [x0, x1, z0]), [[0, 0.26, 0], [0, 0.26, 0.08]]);
});
