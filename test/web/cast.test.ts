import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Cast } from '../../web/src/office/cast.ts';
import type { OfficeScene } from '../../web/src/office/scene.ts';
import type { Figure } from '../../web/src/office/sprites/figure.ts';
import { lookFor } from '../../web/src/office/sprites/look.ts';
import type { Agent } from '../../src/shared/types.ts';

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

/** 말풍선·이름표·Z가 쓰는 만큼만 흉내 낸 document(배우를 만들 수 있게) */
function fakeDocument(): Document {
  const el = () => ({ className: '', textContent: '', style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, append() {} });
  return { createElement: el } as unknown as Document;
}

// 자리·모습 무작위(PR #30) 뒤로, 숨겼다 돌아온 세션은 거의 늘 다른 모습을 받는다. 탭이 숨어 프레임이 멈췄거나 아직 문까지 못 갔으면
// 나가던 배우가 남아 그대로 쓰이는데, 그림은 처음 모습 그대로였다(Codex 리뷰 P2)
test('남아 있던 배우가 새 모습(모자 번호)을 받으면 그림을 그 모습으로 바꿔 끼운다', (t) => {
  t.mock.method(console, 'warn', () => {}); // node엔 그림 불러오기가 없어 실패 — 이 테스트와 무관
  const saved = (globalThis as { document?: Document }).document;
  (globalThis as { document?: Document }).document = fakeDocument();
  try {
    const cast = new Cast(new THREE.Scene(), emptyOffice, () => {});
    const agent = (hat: number): Agent => ({
      id: 'claude:s1', kind: 'claude', sessionId: 's1', title: null, cwd: '/x', project: 'x', status: 'thinking', detail: null,
      since: 0, lastEventAt: 0, hat, seat: 0, subagents: [], hookless: false, context: null, model: null,
    });
    const look = () => (cast as unknown as { actors: Map<string, { figure: Figure }> }).actors.get('claude:s1')!.figure.look;
    cast.sync({ agents: [agent(0)], now: 0 } as never);
    assert.equal(look(), lookFor(0));
    cast.sync({ agents: [], now: 1000 } as never); // 숨김 — 배우는 문으로 나가는 중
    cast.sync({ agents: [agent(4)], now: 2000 } as never);
    assert.equal(look(), lookFor(4));
  } finally {
    (globalThis as { document?: Document }).document = saved;
  }
});
