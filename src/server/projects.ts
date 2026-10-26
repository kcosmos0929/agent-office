// CnC 위키 프로젝트 허브의 frontmatter(project, project_path)로 "세션 폴더 → 프로젝트 이름표"를 만든다. 위키는 읽기만.
// 세션이 만지는 파일 경로로도 프로젝트를 알아낸다(makeWorkResolver) — CnC Wiki에서 연 세션도 실제 프로젝트로 보이게.
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type ProjectEntry = { slug: string; path: string };

/** 설정 파일을 처음 만들 때 넣는 짧은 이름표 (설정에서 바꿀 수 있음) */
export const DEFAULT_PROJECT_NAMES: Record<string, string> = {
  'lst-seongsu': '성수 LST',
  'street-centrality-bus': '가로망 중심성',
  'blog-textmining': '블로그 텍스트마이닝',
  'korea-urban-taxonomy': '도시조직 분류',
  'morphology-commerce': '형태×상권',
  'synthetic-office': 'Synthetic Office',
};

const VAULT_NAME = 'CnC Wiki';
const UNKNOWN = '알 수 없음';

/** ~ 확장 + 꼬리 / 제거 + 소문자 (macOS 파일 시스템은 대소문자를 구분하지 않음) */
function normalize(p: string): string {
  let out = p.trim();
  if (out === '~' || out.startsWith('~/')) out = path.join(os.homedir(), out.slice(1));
  out = out.replace(/\/+$/, '');
  return out.toLowerCase();
}

function field(frontmatter: string, name: string): string | null {
  const m = new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'm').exec(frontmatter);
  return m ? m[1] : null;
}

export function parseHub(markdown: string): ProjectEntry | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!fm) return null;
  const slug = field(fm[1], 'project');
  const raw = field(fm[1], 'project_path');
  if (!slug || !raw) return null;
  if (!raw.startsWith('/') && !raw.startsWith('~')) return null;
  return { slug, path: normalize(raw) };
}

const TITLE_MAX = 20;

/** 허브의 첫 제목줄(# …)에서 '—' 앞부분. 길면 자른다. 이름표에 설정 이름이 없을 때 쓴다 */
export function hubTitle(markdown: string): string | null {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const m = /^# (.+)$/m.exec(body);
  if (!m) return null;
  const t = m[1].split(' — ')[0].trim();
  if (!t) return null;
  return [...t].length > TITLE_MAX ? [...t].slice(0, TITLE_MAX).join('') + '…' : t;
}

/** entries = 코드 폴더(project_path)가 있는 허브, titles = 프로젝트 이름 → 허브 제목, known = 위키 안 프로젝트 폴더로 인정할 이름 */
export type ProjectIndex = { entries: ProjectEntry[]; titles: Record<string, string>; known: Set<string> };

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

export async function loadProjectIndex(vaultPath: string): Promise<ProjectIndex> {
  const root = path.join(vaultPath, 'AI-Sessions', 'wiki', 'projects');
  const dirs = await subdirs(root);
  const entries: ProjectEntry[] = [];
  const titles: Record<string, string> = {};
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await fs.readdir(path.join(root, dir));
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.startsWith('00 ') && f.endsWith(' 허브.md'))) {
      try {
        const markdown = await fs.readFile(path.join(root, dir, file), 'utf8');
        const entry = parseHub(markdown);
        if (entry) entries.push(entry);
        const title = hubTitle(markdown);
        if (title) titles[entry?.slug ?? dir] = title;
      } catch {
        // 읽기 실패한 허브는 건너뛴다
      }
    }
  }
  const known = new Set([...dirs, ...(await subdirs(path.join(vaultPath, 'AI-Sessions', 'workspace', 'projects')))].map((d) => d.toLowerCase()));
  return { entries, titles, known };
}

export async function loadProjects(vaultPath: string): Promise<ProjectEntry[]> {
  return (await loadProjectIndex(vaultPath)).entries;
}

/** 이름표 글자: 설정의 짧은 이름 → 허브 제목('—' 앞부분) → 폴더 이름(-·_를 띄어쓰기로) */
export function makeLabel(names: Record<string, string>, titles: Record<string, string>): (slug: string) => string {
  return (slug) => names[slug] ?? titles[slug] ?? slug.replace(/[-_]+/g, ' ');
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + '/');
}

export function makeResolver(entries: ProjectEntry[], names: Record<string, string>, vaultPath: string, titles: Record<string, string> = {}): (cwd: string) => string {
  const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);
  const vault = normalize(vaultPath);
  const label = makeLabel(names, titles);
  return (cwd: string) => {
    if (!cwd) return UNKNOWN;
    const c = normalize(cwd);
    const hit = sorted.find((e) => within(c, e.path));
    if (hit) return label(hit.slug);
    if (within(c, vault)) return VAULT_NAME;
    return path.basename(cwd.replace(/\/+$/, '')) || UNKNOWN;
  };
}

/** 위키 안에서 한 프로젝트에 딸린 폴더: wiki/projects·workspace/projects·raw/conversations·wiki/sources 아래 <이름>/… */
const VAULT_PROJECT_DIR = /^ai-sessions\/(?:wiki\/projects|workspace\/projects|raw\/conversations|wiki\/sources)\/([^/]+)\//;

/** 작업 트리 폴더(.git이 'gitdir: <원래 저장소>/.git/worktrees/…' 파일) → 원래 저장소 폴더. 아니면 null. 폴더별로 기억 */
function makeMainRepoFinder(): (p: string) => string | null {
  const cache = new Map<string, string | null>();
  const look = (dir: string): string | null | undefined => {
    if (cache.has(dir)) return cache.get(dir);
    let found: string | null | undefined;
    try {
      const git = path.join(dir, '.git');
      const st = fsSync.statSync(git);
      if (st.isDirectory()) found = null; // 그 자체가 원래 저장소
      else if (st.isFile()) {
        const m = /^gitdir:\s*(.+?)\/\.git\/worktrees\//m.exec(fsSync.readFileSync(git, 'utf8'));
        found = m ? realNormalize(m[1]) : null;
      }
    } catch {
      found = undefined; // .git 없음 → 위로 계속
    }
    if (found !== undefined) cache.set(dir, found);
    return found;
  };
  return (p) => {
    let dir = p; // 경로 자체(폴더일 수 있음, 예: cd 대상)부터 위로
    for (let i = 0; i < 12 && dir !== path.dirname(dir); i++, dir = path.dirname(dir)) {
      const found = look(dir);
      if (found !== undefined) return found === null ? null : found + p.slice(dir.length);
    }
    return null;
  };
}

/** 실제 경로(심볼릭 링크를 따라감) — 아직 없는 경로는 있는 가장 가까운 윗폴더의 실제 경로에 나머지를 붙임. 그 뒤 normalize */
function realNormalize(p: string): string {
  let dir = path.resolve(p);
  const rest: string[] = [];
  for (let i = 0; i < 40; i++) {
    try {
      return normalize(path.join(fsSync.realpathSync.native(dir), ...rest));
    } catch {
      if (dir === path.dirname(dir)) break;
      rest.unshift(path.basename(dir));
      dir = path.dirname(dir);
    }
  }
  return normalize(p);
}

/**
 * 세션이 만진 경로 → 프로젝트 이름표(모르면 null = 이름표를 바꾸지 않음).
 * 위키 안은 프로젝트 폴더만(공통 파일·library·handoff는 null), 밖은 허브의 project_path(작업 트리는 원래 저장소로).
 */
export function makeWorkResolver(index: ProjectIndex, names: Record<string, string>, vaultPath: string): (p: string, cwd: string) => string | null {
  // 비교는 모두 실제 경로로: 프로젝트 안에서 다른 저장소를 가리키는 링크·밖에서 프로젝트를 가리키는 링크를 바르게
  const sorted = index.entries.map((e) => ({ ...e, path: realNormalize(e.path) })).sort((a, b) => b.path.length - a.path.length);
  const vault = realNormalize(vaultPath);
  const label = makeLabel(names, index.titles);
  const mainRepo = makeMainRepoFinder();
  const byPath = (p: string) => sorted.find((e) => within(p, e.path));
  return (raw, cwd) => {
    if (!raw.trim()) return null;
    const home = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
    const p = realNormalize(path.resolve(cwd || '/', home)); // ~ 풀고 . · .. 정리 → 링크 따라감
    if (within(p, vault)) {
      const m = VAULT_PROJECT_DIR.exec(p.slice(vault.length + 1) + '/');
      return m && index.known.has(m[1]) ? label(m[1]) : null;
    }
    const hit = byPath(p);
    if (hit) return label(hit.slug);
    const main = mainRepo(p);
    const wt = main ? byPath(main) : undefined;
    return wt ? label(wt.slug) : null;
  };
}

