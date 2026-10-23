// 캐릭터를 누르면 뜨는 상세 카드. 글자는 textContent로만.
import { HAT_COLORS, STATUS_LABEL } from '../../../src/shared/labels.ts';
import type { Agent } from '../../../src/shared/types.ts';
import { agentName, formatElapsed } from '../format.ts';
import { cardContextLine } from '../gauge.ts';
import { bubbleTone, shortCwd } from './bubbles.ts';

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

/** 카드를 열고(이미 있으면 바꿔 넣고) 닫는 함수를 돌려준다 */
export function showCard(container: HTMLElement, a: Agent, now: number, at: { x: number; y: number }): () => void {
  container.querySelector('.card')?.remove();
  const card = div('card');
  const head = div('card-head');
  const swatch = div('card-swatch');
  swatch.style.background = HAT_COLORS[a.hat % HAT_COLORS.length];
  head.append(swatch, div('card-kind', `Claude · 세션 ${a.hat + 1}`));
  if (a.hookless) {
    const tag = document.createElement('span');
    tag.className = 'tag-hookless';
    tag.textContent = '훅 없음';
    head.appendChild(tag);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'card-close';
  close.textContent = '✕';
  head.appendChild(close);

  const stateRow = div('card-state');
  const pill = document.createElement('span');
  pill.className = 'card-pill';
  pill.textContent = STATUS_LABEL[a.status];
  const tone = bubbleTone(a);
  pill.style.background = tone.bg;
  pill.style.color = tone.fg;
  stateRow.append(pill, document.createTextNode(` ${formatElapsed(now - a.since)}`));

  card.append(head, div('card-title', agentName(a)), stateRow, div('card-context', cardContextLine(a.context)));
  if (a.detail) card.appendChild(div('card-detail', a.detail));
  const proj = div('card-project', '프로젝트 · ');
  const b = document.createElement('b');
  b.textContent = a.project;
  proj.appendChild(b);
  card.append(proj, div('card-cwd', shortCwd(a.cwd)));
  if (a.subagents.length) card.appendChild(div('card-cwd', `도우미 ${a.subagents.length}명 회의실에서 일하는 중`));

  container.appendChild(card);
  const w = container.clientWidth;
  const h = container.clientHeight;
  card.style.left = `${Math.min(Math.max(12, at.x + 16), w - 252)}px`;
  card.style.top = `${Math.min(Math.max(12, at.y - 40), h - card.offsetHeight - 12)}px`;
  const remove = () => card.remove();
  close.addEventListener('click', remove);
  return remove;
}
