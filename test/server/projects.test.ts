import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHub, loadProjects, makeResolver, DEFAULT_PROJECT_NAMES } from '../../src/server/projects.ts';

const VAULT = '/Users/seop/Documents/CnC Wiki';

test('대소문자·꼬리 슬래시가 달라도 같은 프로젝트', () => {
  const r = makeResolver([{ slug: 'blog-textmining', path: '/users/seop/developer/txt_mining' }], { 'blog-textmining': '블로그 텍스트마이닝' }, VAULT);
  assert.equal(r('/Users/seop/Developer/txt_mining/scripts'), '블로그 텍스트마이닝');
  assert.equal(r('/Users/seop/developer/txt_mining/'), '블로그 텍스트마이닝');
});

test('parseHub: 경로 정규화, Windows 경로·TBD·경로 없음은 버림', () => {
  assert.deepEqual(parseHub('---\ntype: project\nproject: lst-seongsu\nproject_path: /Users/seop/developer/lst_ss/\n---\n# 제목'), { slug: 'lst-seongsu', path: '/users/seop/developer/lst_ss' });
  assert.equal(parseHub('---\nproject: cs1\nproject_path: C:\\Users\\kcosm\\dev\\cs1-mcp\\\n---'), null);
  assert.equal(parseHub('---\nproject: standdeck\nproject_path: TBD\n---'), null);
  assert.equal(parseHub('---\nproject: x\n---'), null);
  assert.equal(parseHub('frontmatter 없음'), null);
  assert.deepEqual(parseHub(`---\nproject: h\nproject_path: ~/developer/h\n---`), { slug: 'h', path: path.join(os.homedir(), 'developer/h').toLowerCase() });
});

test('가장 긴 경로가 이기고, 이름이 비슷한 형제 폴더는 섞이지 않음', () => {
  const r = makeResolver([
    { slug: 'lst', path: '/users/seop/developer/lst' },
    { slug: 'lst-ss', path: '/users/seop/developer/lst_ss' },
    { slug: 'nested', path: '/users/seop/developer/lst/sub' },
  ], {}, VAULT);
  assert.equal(r('/Users/seop/developer/lst_ss/a'), 'lst-ss');
  assert.equal(r('/Users/seop/developer/lst/sub/x'), 'nested');
  assert.equal(r('/Users/seop/developer/lst'), 'lst');
});

test('vault 안은 CnC Wiki, 모르는 폴더는 폴더 이름, 빈 cwd는 "알 수 없음"', () => {
  const r = makeResolver([], {}, VAULT);
  assert.equal(r('/Users/seop/Documents/CnC Wiki'), 'CnC Wiki');
  assert.equal(r('/Users/seop/Documents/CnC Wiki/AI-Sessions/wiki'), 'CnC Wiki');
  assert.equal(r('/Users/seop/Desktop/임시폴더/'), '임시폴더');
  assert.equal(r(''), '알 수 없음');
});

test('loadProjects: 가짜 허브 2개 읽고, 허브 아닌 파일·Windows 허브는 건너뜀', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'so-vault-'));
  const proj = path.join(vault, 'AI-Sessions/wiki/projects');
  const write = (dir: string, file: string, body: string) => {
    fs.mkdirSync(path.join(proj, dir), { recursive: true });
    fs.writeFileSync(path.join(proj, dir, file), body);
  };
  write('a', '00 a 허브.md', '---\nproject: a\nproject_path: /x/a/\n---');
  write('b', '00 b 허브.md', '---\nproject: b\nproject_path: /x/b\n---');
  write('b', 'b-log.md', '---\nproject: nope\nproject_path: /x/nope\n---');
  write('w', '00 w 허브.md', '---\nproject: w\nproject_path: C:\\w\n---');
  const entries = await loadProjects(vault);
  assert.deepEqual(entries.map((e) => e.slug).sort(), ['a', 'b']);
  assert.deepEqual(await loadProjects(path.join(vault, '없는폴더')), []);
});

test('기본 이름표', () => {
  assert.equal(DEFAULT_PROJECT_NAMES['lst-seongsu'], '성수 LST');
  assert.equal(DEFAULT_PROJECT_NAMES['street-centrality-bus'], '가로망 중심성');
  assert.equal(DEFAULT_PROJECT_NAMES['synthetic-office'], 'Synthetic Office');
});
