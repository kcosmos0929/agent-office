// 목록형 상황판. 글자는 전부 textContent로 넣는다(데이터를 innerHTML에 넣지 않음).
import { groupOf, HAT_COLORS, KIND_COLOR, STATUS_LABEL } from '../../../src/shared/labels.ts';
import { sortForBoard } from '../../../src/shared/sort.ts';
import type { Agent, Snapshot } from '../../../src/shared/types.ts';
import { agentName, formatElapsed, formatReset } from '../format.ts';
import { avatar } from './avatar.ts';

function el(doc: Document, tag: string, cls: string, text?: string): HTMLElement {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(doc: Document, a: Agent, now: number): HTMLElement {
  const group = groupOf(a.status);
  const r = el(doc, 'div', `row ${group}${a.status === 'stalled' ? ' stalled' : ''}`);
  r.setAttribute('data-agent', a.id);
  r.appendChild(avatar(doc, KIND_COLOR[a.kind], HAT_COLORS[a.hat % HAT_COLORS.length]) as unknown as HTMLElement);
  const meta = el(doc, 'div', 'meta');
  meta.append(el(doc, 'div', 'name', agentName(a)), el(doc, 'div', 'state', STATUS_LABEL[a.status]));
  const chips = el(doc, 'div', 'chips');
  chips.appendChild(el(doc, 'span', 'chip', a.project));
  if (a.detail) chips.appendChild(el(doc, 'span', 'detail', a.detail));
  if (a.subagents.length) chips.appendChild(el(doc, 'span', 'detail', `도우미 ${a.subagents.length}`));
  meta.appendChild(chips);
  r.append(meta, el(doc, 'span', 'time', formatElapsed(now - a.since)));
  return r;
}

function usageBar(doc: Document, snap: Snapshot): HTMLElement {
  const bar = el(doc, 'div', 'usage');
  const w = snap.usage?.fiveHour;
  bar.appendChild(el(doc, 'span', 'usage-pct', w ? `사용량 ${Math.round(w.pct)}%` : '사용량 —'));
  const track = el(doc, 'div', 'track');
  const fill = el(doc, 'div', 'fill');
  fill.setAttribute('style', `width:${w ? Math.min(100, Math.max(0, Math.round(w.pct))) : 0}%`);
  track.appendChild(fill);
  bar.appendChild(track);
  bar.appendChild(el(doc, 'span', 'usage-reset', w ? `리셋 ${formatReset(w.resetsAt, snap.now)}` : ''));
  return bar;
}

export function renderList(root: HTMLElement, snap: Snapshot, doc: Document = document): void {
  const board = el(doc, 'div', 'board');
  const top = el(doc, 'div', 'board-bar');
  top.appendChild(el(doc, 'span', 'board-title', 'THE SYNTHETIC OFFICE'));
  const waiting = snap.agents.filter((a) => a.status === 'permission' || a.status === 'done').length;
  if (waiting > 0) {
    const urgent = snap.agents.some((a) => a.status === 'permission');
    top.appendChild(el(doc, 'span', `badge${urgent ? ' urgent' : ''}`, `기다리는 중 ${waiting}`));
  }
  board.appendChild(top);
  const rows = el(doc, 'div', 'rows');
  const agents = sortForBoard(snap.agents);
  if (agents.length === 0) rows.appendChild(el(doc, 'div', 'empty', '지금 열린 세션이 없어요'));
  for (const a of agents) rows.appendChild(row(doc, a, snap.now));
  board.append(rows, usageBar(doc, snap));
  root.replaceChildren(board);
}
