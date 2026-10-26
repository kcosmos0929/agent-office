import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHub, loadProjects, loadProjectIndex, makeResolver, makeWorkResolver, makeLabel, hubTitle, DEFAULT_PROJECT_NAMES } from '../../src/server/projects.ts';

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
  assert.equal(r('/Users/seop/developer/lst_ss/a'), 'lst ss'); // 이름이 없으면 폴더 이름을 띄어쓰기로(2026-10-26)
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

// ---------- 세션이 만지는 경로로 프로젝트 이름표 (2026-10-26) ----------
test('hubTitle: 첫 제목줄의 — 앞부분, 길면 20자로 자름, 없으면 null', () => {
  assert.equal(hubTitle('---\nproject: a\n---\n\n# Synthetic Office — CnC 에이전트 상황판 오피스\n## 진행'), 'Synthetic Office');
  assert.equal(hubTitle('# 한국 도시조직 taxonomy\n'), '한국 도시조직 taxonomy');
  assert.equal(hubTitle('# 가로망 중심성 × 정류장 버스 승하차 (서울·경기)'), '가로망 중심성 × 정류장 버스 승하차…');
  assert.equal(hubTitle('---\nproject: a\n---\n본문만'), null);
});

test('makeLabel: 설정의 짧은 이름 → 허브 제목 → 폴더 이름 띄어쓰기', () => {
  const label = makeLabel({ 'lst-seongsu': '성수 LST' }, { 'lst-seongsu': '성수동 준공업지역', 'cs1-mcp': 'cs1-mcp' });
  assert.equal(label('lst-seongsu'), '성수 LST');
  assert.equal(label('cs1-mcp'), 'cs1-mcp');
  assert.equal(label('urban-math_modeling'), 'urban math modeling');
  const r = makeResolver([{ slug: 'pres', path: '/x/pres' }], {}, VAULT, { pres: 'Discord Rich Presence' });
  assert.equal(r('/x/pres/src'), 'Discord Rich Presence');
});

test('loadProjectIndex: 코드 폴더 허브·허브 제목·위키 안 프로젝트 이름(허브 폴더 + workspace/projects 폴더)', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'so-idx-'));
  const hub = (dir: string, body: string) => {
    fs.mkdirSync(path.join(vault, 'AI-Sessions/wiki/projects', dir), { recursive: true });
    fs.writeFileSync(path.join(vault, 'AI-Sessions/wiki/projects', dir, `00 ${dir} 허브.md`), body);
  };
  hub('so', '---\nproject: so\nproject_path: /x/so/\n---\n# Synthetic Office — 상황판');
  hub('win', '---\nproject: win\nproject_path: C:\\w\n---\n# 윈도우 프로젝트 — 설명');
  fs.mkdirSync(path.join(vault, 'AI-Sessions/workspace/projects/urban-math'), { recursive: true });
  const idx = await loadProjectIndex(vault);
  assert.deepEqual(idx.entries.map((e) => e.slug), ['so']);
  assert.deepEqual(idx.titles, { so: 'Synthetic Office', win: '윈도우 프로젝트' });
  assert.deepEqual([...idx.known].sort(), ['so', 'urban-math', 'win']);
});

test('makeWorkResolver: 위키 안 프로젝트 폴더 4종·코드 폴더·작업 트리·상대 경로, 공통 파일·모르는 폴더는 null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-work-'));
  const vault = path.join(root, 'CnC Wiki');
  const main = path.join(root, 'dev', 'so');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  const wt = path.join(root, 'dev', 'so-wt');
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${main}/.git/worktrees/so-wt\n`);
  fs.mkdirSync(path.join(root, 'dev', 'other', '.git'), { recursive: true });
  const work = makeWorkResolver({ entries: [{ slug: 'so', path: main.toLowerCase() }], titles: { so: 'Synthetic Office' }, known: new Set(['so', 'urban-math']) }, { 'urban-math': '도시수리' }, vault);
  const v = (rel: string) => path.join(vault, rel);
  assert.equal(work(v('AI-Sessions/wiki/projects/so/00 so 허브.md'), vault), 'Synthetic Office');
  assert.equal(work(v('AI-Sessions/workspace/projects/urban-math/메모.md'), vault), '도시수리');
  assert.equal(work(v('AI-Sessions/raw/conversations/so/2026-10-26.md'), vault), 'Synthetic Office');
  assert.equal(work(v('AI-Sessions/wiki/sources/so/카드.md'), vault), 'Synthetic Office');
  assert.equal(work(v('AI-Sessions/raw/conversations/aria/x.md'), vault), null);
  for (const common of ['CLAUDE.md', 'index.md', 'AI-Sessions/workspace/handoff.md', 'AI-Sessions/wiki/library/global/x.md', 'AI-Sessions/wiki/projects']) assert.equal(work(v(common), vault), null, common);
  assert.equal(work(path.join(main, 'src/a.ts'), vault), 'Synthetic Office');
  assert.equal(work(path.join(wt, 'src/b.ts'), vault), 'Synthetic Office');
  assert.equal(work(wt, vault), 'Synthetic Office'); // 작업 트리 폴더 자체(cd 대상)
  assert.equal(work(path.join(root, 'dev', 'other', 'x.ts'), vault), null);
  assert.equal(work('AI-Sessions/wiki/projects/so/a.md', vault), 'Synthetic Office');
  assert.equal(work('src/b.ts', wt), 'Synthetic Office');
  assert.equal(work('~/없는/폴더/x', vault), null);
  assert.equal(work('', vault), null);
});

test('makeWorkResolver: ~ 경로의 ..를 풀고, 심볼릭 링크는 실제 대상으로 판정, 없는 경로는 글자대로 (리뷰 P2)', () => {
  const home = os.homedir();
  const homeWork = makeWorkResolver({ entries: [{ slug: 'so', path: path.join(home, 'so-fake-proj').toLowerCase() }], titles: {}, known: new Set() }, { so: 'SO' }, VAULT);
  assert.equal(homeWork('~/so-fake-proj/a.ts', VAULT), 'SO');
  assert.equal(homeWork('~/so-fake-proj/../so-fake-other/a.py', VAULT), null);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-link-'));
  const so = path.join(root, 'dev', 'so');
  const lst = path.join(root, 'dev', 'lst');
  fs.mkdirSync(path.join(so, 'src'), { recursive: true });
  fs.mkdirSync(path.join(lst, 'src'), { recursive: true });
  fs.symlinkSync(lst, path.join(so, 'lst-link')); // 프로젝트 안에서 다른 저장소를 가리킴
  fs.mkdirSync(path.join(root, 'elsewhere'));
  fs.symlinkSync(so, path.join(root, 'elsewhere', 'so-link')); // 밖에서 프로젝트를 가리킴
  const work = makeWorkResolver({ entries: [{ slug: 'so', path: so.toLowerCase() }, { slug: 'lst', path: lst.toLowerCase() }], titles: {}, known: new Set() }, { so: 'SO', lst: 'LST' }, path.join(root, 'vault'));
  assert.equal(work(path.join(so, 'lst-link', 'src', 'a.py'), root), 'LST');
  assert.equal(work(path.join(root, 'elsewhere', 'so-link', 'src', 'b.ts'), root), 'SO');
  assert.equal(work(path.join(so, 'src', '새파일.ts'), root), 'SO'); // 아직 없는 파일(부모 폴더는 있음)
});
