import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableNodePath } from '../../scripts/lib/system.ts';

test('stableNodePath: Homebrew 버전 경로 대신 고정 링크', () => {
  const exists = (p: string) => p === '/opt/homebrew/bin/node';
  assert.equal(stableNodePath('/opt/homebrew/Cellar/node/26.3.0/bin/node', exists), '/opt/homebrew/bin/node');
  assert.equal(stableNodePath('/usr/local/Cellar/node/22.1.0/bin/node', (p) => p === '/usr/local/bin/node'), '/usr/local/bin/node');
});

test('stableNodePath: 링크가 없거나 Cellar가 아니면 그대로', () => {
  assert.equal(stableNodePath('/opt/homebrew/Cellar/node/26.3.0/bin/node', () => false), '/opt/homebrew/Cellar/node/26.3.0/bin/node');
  assert.equal(stableNodePath('/Users/seop/.nvm/versions/node/v26.3.0/bin/node', () => true), '/Users/seop/.nvm/versions/node/v26.3.0/bin/node');
});
