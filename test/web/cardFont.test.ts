import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 갈무리 도트 글꼴은 설계된 크기에서만 또렷하다. 1px만 작아도 획이 빠져 "Claude"가 "Clεude"처럼 깨진다
const DESIGN: Record<string, number> = { Galmuri11: 12, GalmuriMono11: 12, Galmuri14: 15 };
const css = readFileSync(new URL('../../web/src/style.css', import.meta.url), 'utf8');

test('세션 카드: 갈무리 글꼴은 설계 크기로만 쓴다', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => /\.card\b|\.card-/.test(sel));
  assert.ok(rules.length >= 10);
  let checked = 0;
  for (const [, sel, body] of rules) {
    const font = /(?:^|;)\s*font:\s*([^;]+)/.exec(body)?.[1];
    const size = font ? /(\d+(?:\.\d+)?)px/.exec(font)?.[1] : /font-size:\s*(\d+(?:\.\d+)?)px/.exec(body)?.[1];
    if (!size) continue;
    const family = /'(Galmuri\w*)'/.exec(font ?? body)?.[1] ?? 'Galmuri11'; // 글꼴을 따로 안 정하면 .card의 Galmuri11을 물려받는다
    assert.equal(Number(size), DESIGN[family], `${sel.trim().split('\n').pop()}: ${family} ${size}px`);
    checked++;
  }
  assert.ok(checked >= 3);
});
