import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeAgents } from '../../web/src/office/visible.ts';
import type { Agent } from '../../src/shared/types.ts';

const a = (id: string, kind: Agent['kind']) => ({ id, kind }) as Agent;

test('officeAgents: 3단계 전까지 Codex는 오피스에 안 그림, 순서 유지', () => {
  assert.deepEqual(officeAgents([a('c1', 'claude'), a('x1', 'codex'), a('c2', 'claude')]).map((x) => x.id), ['c1', 'c2']);
  assert.deepEqual(officeAgents([]), []);
});
