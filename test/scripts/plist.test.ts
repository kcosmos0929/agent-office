import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlist } from '../../scripts/lib/plist.ts';

test('renderPlist에 KeepAlive·SO_HOME·로그 경로', () => {
  const xml = renderPlist({
    label: 'com.synthetic-office.server',
    nodePath: '/opt/homebrew/bin/node',
    mainPath: '/Users/seop/developer/synthetic-office/src/server/main.ts',
    logPath: '/Users/seop/.synthetic-office/server.log',
    soHome: '/Users/seop/.synthetic-office',
  });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.synthetic-office\.server<\/string>/);
  assert.match(xml, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/opt\/homebrew\/bin\/node<\/string>\s*<string>\/Users\/seop\/developer\/synthetic-office\/src\/server\/main\.ts<\/string>\s*<\/array>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/seop\/\.synthetic-office\/server\.log<\/string>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/seop\/\.synthetic-office\/server\.log<\/string>/);
  assert.match(xml, /<key>SO_HOME<\/key>\s*<string>\/Users\/seop\/\.synthetic-office<\/string>/);
  assert.match(xml, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin:\/bin<\/string>/);
});

test('renderPlist는 경로의 특수문자를 이스케이프', () => {
  const xml = renderPlist({ label: 'l', nodePath: '/a&b/node', mainPath: '/x/<m>.ts', logPath: '/l', soHome: '/h' });
  assert.ok(xml.includes('/a&amp;b/node'));
  assert.ok(xml.includes('/x/&lt;m&gt;.ts'));
});
