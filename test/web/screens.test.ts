import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREEN, screenFrame } from '../../web/src/office/screens.ts';
import { BEAT_MS } from '../../web/src/office/rack.ts';

test('실행 중: 막대가 한 박자마다 1/16씩 차고 16박자에 한 바퀴', () => {
  assert.deepEqual(screenFrame('running', 0), { kind: 'bar', fill: 1 / 16 });
  assert.deepEqual(screenFrame('running', BEAT_MS * 15), { kind: 'bar', fill: 1 });
  assert.deepEqual(screenFrame('running', BEAT_MS * 16), { kind: 'bar', fill: 1 / 16 });
});

test('실행 막대는 랙과 같은 박자에 바뀐다(박자 안에서는 그대로)', () => {
  const a = screenFrame('running', BEAT_MS * 3);
  assert.deepEqual(screenFrame('running', BEAT_MS * 3 + BEAT_MS - 1), a);
  assert.notDeepEqual(screenFrame('running', BEAT_MS * 4), a);
});

test('고치는 중: 글줄이 0.5초마다 하나씩 늘어 6줄 뒤 다시 1줄', () => {
  assert.deepEqual(screenFrame('editing', 0), { kind: 'lines', n: 1 });
  assert.deepEqual(screenFrame('editing', 2999), { kind: 'lines', n: 6 });
  assert.deepEqual(screenFrame('editing', 3000), { kind: 'lines', n: 1 });
});

test('읽는 중: 0.25초마다 한 칸 흐르고 8칸 뒤 처음', () => {
  assert.deepEqual(screenFrame('reading', 0), { kind: 'scroll', offset: 0 });
  assert.deepEqual(screenFrame('reading', 250), { kind: 'scroll', offset: 1 });
  assert.deepEqual(screenFrame('reading', 2000), { kind: 'scroll', offset: 0 });
});

test('생각·위임·정리·승인 확인: 커서가 0.5초마다 깜박', () => {
  for (const s of ['thinking', 'delegating', 'compacting', 'approving'] as const) {
    assert.deepEqual(screenFrame(s, 0), { kind: 'cursor', on: true });
    assert.deepEqual(screenFrame(s, 500), { kind: 'cursor', on: false });
    assert.deepEqual(screenFrame(s, 1000), { kind: 'cursor', on: true });
  }
});

test('급한 상태는 노란 단색, 끝남은 초록 단색', () => {
  assert.deepEqual(screenFrame('permission', 0), { kind: 'solid', color: SCREEN.wait });
  assert.deepEqual(screenFrame('question', 777), { kind: 'solid', color: SCREEN.wait });
  assert.deepEqual(screenFrame('done', 0), { kind: 'solid', color: SCREEN.done });
});

test('멈춤·쉼·빈 자리는 꺼진 단색', () => {
  for (const s of ['stalled', 'idle', 'quota', 'gone', null] as const) {
    assert.deepEqual(screenFrame(s, 123), { kind: 'solid', color: SCREEN.off });
  }
});
