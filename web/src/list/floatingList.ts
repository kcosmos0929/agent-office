// 사무실 화면 위에 떠 있는 작은 목록(오른쪽 위, 연결 띠 아래). 목록 보기의 줄(row)을 그대로 다시 쓰고,
// 접으면 '❗1 · ❓1 · ▶2 · ✅3' 한 줄 요약만. 줄을 누르면 그 캐릭터를 누른 것과 같은 세션 카드를 연다.
// 글자는 전부 textContent로 넣는다(데이터를 innerHTML에 넣지 않음).
import { groupOf } from '../../../src/shared/labels.ts';
import { sortForBoard } from '../../../src/shared/sort.ts';
import type { Agent, Snapshot } from '../../../src/shared/types.ts';
import { row } from './listBoard.ts';

/** 펼침/접힘을 이 브라우저에 기억하는 키(localStorage) */
export const FLOAT_OPEN_KEY = 'so-float-open';
/** 세션 카드 폭(style.css .card) — 줄을 누르면 카드가 작은 목록 왼쪽에 오게 */
const CARD_W = 264;

/** 접은 줄 요약: 승인·질문·일하는 중·끝남 개수(0은 뺌). 쉬는 세션(😴·⏳·👋)은 세지 않는다 */
export function floatSummary(agents: readonly Agent[]): string {
  if (agents.length === 0) return '세션 없음';
  const count = (f: (a: Agent) => boolean) => agents.filter(f).length;
  const parts: Array<[string, number]> = [
    // ️: 그림 문자로 고정(도트 글꼴의 흑백 ❗·❓ 대신) — 상태 이름표(STATUS_LABEL)와 같게
    ['❗️', count((a) => a.status === 'permission')],
    ['❓️', count((a) => a.status === 'question')],
    ['▶', count((a) => groupOf(a.status) === 'working')],
    ['✅', count((a) => a.status === 'done')],
  ];
  const shown = parts.filter(([, n]) => n > 0).map(([icon, n]) => `${icon}${n}`);
  return shown.length ? shown.join(' · ') : '모두 쉬는 중';
}

/** 좁은 화면(폰·작은 창)이면 처음엔 접어 둔다 — 사무실을 가리지 않게 */
export function isNarrow(width: number, height: number): boolean {
  return width < 720 || height < 520;
}

/** 기억한 값('1'·'0')이 먼저, 없으면 좁은 화면만 접힘 */
export function initialFloatOpen(stored: string | null, narrow: boolean): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return !narrow;
}

/** 줄을 누르면 여는 카드 자리(사무실 화면 기준): 작은 목록 왼쪽, 그 줄 높이. showCard가 x+16·y−40에 둔다 */
export function cardAnchor(rowRect: { left: number; top: number }, officeRect: { left: number; top: number }): { x: number; y: number } {
  return { x: rowRect.left - officeRect.left - CARD_W - 32, y: rowRect.top - officeRect.top + 40 };
}

export type FloatView = { root: HTMLElement; summary: HTMLElement; caret: HTMLElement; rows: HTMLElement };

/** 스냅샷 → 작은 목록. 접혀 있으면 줄은 그리지 않는다 */
export function renderFloat(v: FloatView, snap: Snapshot, open: boolean, doc: Document = document): void {
  v.root.className = open ? 'float-list' : 'float-list closed';
  v.summary.textContent = floatSummary(snap.agents);
  v.caret.textContent = open ? '▾' : '▸';
  v.rows.hidden = !open;
  if (!open) {
    v.rows.replaceChildren();
    return;
  }
  const agents = sortForBoard(snap.agents);
  if (agents.length === 0) {
    const empty = doc.createElement('div');
    empty.className = 'empty';
    empty.textContent = '지금 열린 세션이 없어요';
    v.rows.replaceChildren(empty);
    return;
  }
  v.rows.replaceChildren(...agents.map((a) => row(doc, a, snap.now)));
}

export type FloatingList = { el: HTMLElement; update(snap: Snapshot): void };

/** 머리줄(누르면 접기·펴기)과 줄 묶음(누르면 카드)을 만든다 */
export function buildFloatingList(opts: { open: boolean; onToggle(open: boolean): void; onPick(agentId: string, rowRect: DOMRect): void }): FloatingList {
  let open = opts.open;
  let last: Snapshot | null = null;
  const root = document.createElement('div');
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'float-head';
  const title = document.createElement('span');
  title.className = 'float-title';
  title.textContent = '세션';
  const summary = document.createElement('span');
  summary.className = 'float-summary';
  const caret = document.createElement('span');
  caret.className = 'float-caret';
  head.append(title, summary, caret);
  const rows = document.createElement('div');
  rows.className = 'float-rows';
  root.append(head, rows);
  const v: FloatView = { root, summary, caret, rows };

  const draw = () => {
    if (last) renderFloat(v, last, open);
    head.setAttribute('aria-expanded', String(open));
  };
  head.addEventListener('click', () => {
    open = !open;
    opts.onToggle(open);
    draw();
  });
  rows.addEventListener('click', (e) => {
    const r = (e.target as Element | null)?.closest('[data-agent]');
    const id = r?.getAttribute('data-agent');
    if (r && id) opts.onPick(id, r.getBoundingClientRect());
  });
  draw();
  return {
    el: root,
    update(snap) {
      last = snap;
      draw();
    },
  };
}
