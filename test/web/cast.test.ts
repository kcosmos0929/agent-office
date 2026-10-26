import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Cast } from '../../web/src/office/cast.ts';
import type { OfficeScene } from '../../web/src/office/scene.ts';

// 책상·개발 화면이 없는 빈 사무실이면 사람 없이도 sync/settle 흐름만 확인할 수 있다
const emptyOffice = { deskScreens: [], devScreens: [] } as unknown as OfficeScene;

function castWith(onChange: () => void): Cast {
  const cast = new Cast(new THREE.Scene(), emptyOffice, onChange);
  cast.sync({ agents: [], now: Date.now() } as never);
  return cast;
}

test('settle: 기본은 다시 그리기를 요청하고, settle(false)는 요청하지 않는다(그리는 프레임 안에서 쓰려고)', () => {
  let calls = 0;
  const cast = castWith(() => calls++);
  const before = calls;
  cast.settle(false);
  assert.equal(calls, before);
  cast.settle();
  assert.equal(calls, before + 1);
});
