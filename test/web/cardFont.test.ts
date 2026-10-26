import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 갈무리 도트 글꼴은 설계된 크기에서만 또렷하다. 1px만 작아도 획이 빠져 "Claude"가 "Clεude"처럼 깨진다.
// 카드가 만드는 요소마다 CSS 규칙(구체성·순서·상속)을 따라 실제로 받는 글꼴과 크기를 계산해 확인한다.
const DESIGN: Record<string, number> = { Galmuri11: 12, GalmuriMono11: 12, Galmuri14: 15 };
const css = readFileSync(new URL('../../web/src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const cardSrc = readFileSync(new URL('../../web/src/office/card.ts', import.meta.url), 'utf8');

type Node = { tag: string; cls: string[]; children?: Node[] };
const el = (tag: string, cls: string, children?: Node[]): Node => ({ tag, cls: cls ? [cls] : [], children });
/** card.ts가 만드는 구조 */
const CARD = el('div', 'card', [
  el('div', 'card-head', [el('div', 'card-swatch'), el('div', 'card-kind'), el('span', 'tag-hookless'), el('button', 'card-close')]),
  el('div', 'card-title'),
  el('div', 'card-state', [el('span', 'card-pill')]),
  el('div', 'card-context'),
  el('div', 'card-detail'),
  el('div', 'card-project', [el('b', '')]),
  el('div', 'card-cwd'),
]);

type Rule = { parts: { tag?: string; cls: string[] }[]; spec: number; order: number; size?: string; family?: string };
function parseRules(): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const [, sels, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decl = new Map<string, string>();
    for (const d of body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decl.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    let size: string | undefined;
    let family: string | undefined;
    const font = decl.get('font');
    if (font === 'inherit') size = family = 'inherit';
    else if (font) {
      const m = /(\d+(?:\.\d+)?)px(?:\/\S+)?\s+(.+)$/.exec(font);
      if (m) [size, family] = [m[1], m[2]];
    }
    size = decl.get('font-size')?.replace('px', '') ?? size;
    family = decl.get('font-family') ?? family;
    if (family && family !== 'inherit') family = family.split(',')[0].trim().replace(/['"]/g, '');
    if (!size && !family) continue;
    for (const sel of sels.split(',')) {
      const words = sel.trim().split(/\s+/);
      if (!words.every((w) => /^[a-z]*(\.[\w-]+)*$/i.test(w) && w)) continue; // 카드 안을 고르는 단순한 꼴(.a, b, .a .b)만
      const parts = words.map((w) => {
        const [tag, ...cls] = w.split('.');
        return { tag: tag || undefined, cls };
      });
      const spec = parts.reduce((n, p) => n + p.cls.length * 10 + (p.tag ? 1 : 0), 0);
      rules.push({ parts, spec, order: order++, size, family });
    }
  }
  return rules;
}

const fits = (p: Rule['parts'][number], n: Node) => (!p.tag || p.tag === n.tag) && p.cls.every((c) => n.cls.includes(c));
function matches(r: Rule, path: Node[]): boolean {
  const last = r.parts.length - 1;
  if (!fits(r.parts[last], path[path.length - 1])) return false;
  let i = path.length - 2;
  for (let k = last - 1; k >= 0; k--) {
    while (i >= 0 && !fits(r.parts[k], path[i])) i--;
    if (i < 0) return false;
    i--;
  }
  return true;
}

/** 요소마다 [글꼴, 크기]. 버튼은 브라우저 기본이 상속하지 않으므로 규칙이 정해 줘야 한다 */
function resolve(rules: Rule[]): { name: string; family: string; size: string }[] {
  const out: { name: string; family: string; size: string }[] = [];
  const walk = (n: Node, path: Node[], parent: { family: string; size: string }) => {
    const here = [...path, n];
    const hit = rules.filter((r) => matches(r, here)).sort((a, b) => a.spec - b.spec || a.order - b.order);
    const pick = (k: 'size' | 'family') => hit.filter((r) => r[k]).pop()?.[k];
    const ua = n.tag === 'button' ? 'UA' : undefined; // 브라우저 기본 버튼 글꼴
    const own = { family: pick('family') ?? ua, size: pick('size') ?? ua };
    const cur = {
      family: own.family === undefined || own.family === 'inherit' ? parent.family : own.family,
      size: own.size === undefined || own.size === 'inherit' ? parent.size : own.size,
    };
    out.push({ name: [n.tag, ...n.cls].join('.'), ...cur });
    for (const c of n.children ?? []) walk(c, here, cur);
  };
  walk(CARD, [], { family: 'page', size: 'page' });
  return out;
}

test('세션 카드: 카드 안 모든 요소가 갈무리 설계 크기로 그려진다', () => {
  for (const { name, family, size } of resolve(parseRules())) {
    assert.ok(family in DESIGN, `${name}: 글꼴 ${family}`);
    assert.equal(Number(size), DESIGN[family], `${name}: ${family} ${size}px`);
  }
});

test('세션 카드: 테스트의 카드 구조가 card.ts가 쓰는 클래스를 모두 담는다', () => {
  const used = new Set([...cardSrc.matchAll(/div\('([\w-]+)'|className = '([\w-]+)'/g)].map((m) => m[1] ?? m[2]));
  const inTree = new Set<string>();
  const walk = (n: Node) => {
    n.cls.forEach((c) => inTree.add(c));
    n.children?.forEach(walk);
  };
  walk(CARD);
  assert.deepEqual([...used].sort(), [...inTree].sort());
});
