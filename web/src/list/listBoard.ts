// 목록형 상황판. 글자는 전부 textContent로 넣는다(데이터를 innerHTML에 넣지 않음).
import { groupOf, STATUS_LABEL } from '../../../src/shared/labels.ts';
import { sortForBoard } from '../../../src/shared/sort.ts';
import type { Agent, AgentContext, Snapshot } from '../../../src/shared/types.ts';
import { agentModel, agentName, formatElapsed, formatReset } from '../format.ts';
import { contextPct, gaugeLevel, rowGaugeText } from '../gauge.ts';
import { renderStrip } from '../strip.ts';
import { avatarUrl } from '../office/sprites/compose.ts';
import { faceFor, lookFor } from '../office/sprites/look.ts';

function el(doc: Document, tag: string, cls: string, text?: string): HTMLElement {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 대화 게이지: 문구 + (창을 알면) 막대 */
function gauge(doc: Document, c: AgentContext): HTMLElement {
  const pct = contextPct(c);
  const g = el(doc, 'div', pct === null ? 'gauge' : `gauge ${gaugeLevel(pct)}`);
  g.appendChild(el(doc, 'span', 'gauge-label', rowGaugeText(c)));
  if (pct !== null) {
    const track = el(doc, 'div', 'gauge-track');
    const fill = el(doc, 'div', 'gauge-fill');
    fill.setAttribute('style', `width:${Math.min(100, Math.max(0, pct))}%`);
    track.appendChild(fill);
    g.appendChild(track);
  }
  return g;
}

/** 오피스와 같은 사람(머리·옷)의 얼굴, 표정은 상태대로. 그림이 아직이면 빈 칸으로 두었다가 채운다 */
function avatar(doc: Document, a: Agent): HTMLElement {
  const img = el(doc, 'img', 'avatar');
  img.setAttribute('alt', '');
  const url = avatarUrl(lookFor(a.hat), faceFor(a.status), (u) => img.setAttribute('src', u));
  if (url) img.setAttribute('src', url);
  return img;
}

function row(doc: Document, a: Agent, now: number): HTMLElement {
  const group = groupOf(a.status);
  const r = el(doc, 'div', `row ${group}${a.status === 'stalled' ? ' stalled' : ''}`);
  r.setAttribute('data-agent', a.id);
  r.appendChild(avatar(doc, a));
  const meta = el(doc, 'div', 'meta');
  meta.append(el(doc, 'div', 'name', agentName(a)), el(doc, 'div', 'state', STATUS_LABEL[a.status]));
  const chips = el(doc, 'div', 'chips');
  chips.appendChild(el(doc, 'span', 'chip', a.project));
  const model = agentModel(a);
  if (model) chips.appendChild(el(doc, 'span', 'model', model));
  if (a.detail) chips.appendChild(el(doc, 'span', 'detail', a.detail));
  if (a.subagents.length) chips.appendChild(el(doc, 'span', 'detail', `도우미 ${a.subagents.length}`));
  if (a.hookless) chips.appendChild(el(doc, 'span', 'tag-hookless', '훅 없음'));
  meta.appendChild(chips);
  if (a.context) meta.appendChild(gauge(doc, a.context));
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

export function renderList(root: HTMLElement, snap: Snapshot, doc: Document = document, connected = true): void {
  const board = el(doc, 'div', 'board');
  const top = el(doc, 'div', 'board-bar');
  top.appendChild(el(doc, 'span', 'board-title', 'THE SYNTHETIC OFFICE'));
  const waiting = snap.agents.filter((a) => groupOf(a.status) === 'urgent' || a.status === 'done').length;
  if (waiting > 0) {
    const urgent = snap.agents.some((a) => groupOf(a.status) === 'urgent');
    top.appendChild(el(doc, 'span', `badge${urgent ? ' urgent' : ''}`, `기다리는 중 ${waiting}`));
  }
  // 펼쳐 둔 띠는 다시 그려도 펼친 채로
  const open = root.querySelector?.('details.strip[open]') != null;
  top.appendChild(renderStrip(doc, connected, snap.health, snap.now, open));
  board.appendChild(top);
  const rows = el(doc, 'div', 'rows');
  const agents = sortForBoard(snap.agents);
  if (agents.length === 0) rows.appendChild(el(doc, 'div', 'empty', '지금 열린 세션이 없어요'));
  for (const a of agents) rows.appendChild(row(doc, a, snap.now));
  board.append(rows, usageBar(doc, snap));
  root.replaceChildren(board);
}
