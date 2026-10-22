// CnC 위키 프로젝트 허브의 frontmatter(project, project_path)로 "세션 폴더 → 프로젝트 이름표"를 만든다. 위키는 읽기만.
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

export async function loadProjects(vaultPath: string): Promise<ProjectEntry[]> {
  const root = path.join(vaultPath, 'AI-Sessions', 'wiki', 'projects');
  let dirs: string[];
  try {
    dirs = await fs.readdir(root);
  } catch {
    return [];
  }
  const entries: ProjectEntry[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await fs.readdir(path.join(root, dir));
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.startsWith('00 ') && f.endsWith(' 허브.md'))) {
      try {
        const entry = parseHub(await fs.readFile(path.join(root, dir, file), 'utf8'));
        if (entry) entries.push(entry);
      } catch {
        // 읽기 실패한 허브는 건너뛴다
      }
    }
  }
  return entries;
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + '/');
}

export function makeResolver(entries: ProjectEntry[], names: Record<string, string>, vaultPath: string): (cwd: string) => string {
  const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);
  const vault = normalize(vaultPath);
  return (cwd: string) => {
    if (!cwd) return UNKNOWN;
    const c = normalize(cwd);
    const hit = sorted.find((e) => within(c, e.path));
    if (hit) return names[hit.slug] ?? hit.slug;
    if (within(c, vault)) return VAULT_NAME;
    return path.basename(cwd.replace(/\/+$/, '')) || UNKNOWN;
  };
}
