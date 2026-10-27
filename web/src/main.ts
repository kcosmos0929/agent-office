import './style.css';
import type { Snapshot } from '../../src/shared/types.ts';
import { connect } from './connection.ts';
import { buildFloatingList, cardAnchor, deferredCard, FLOAT_OPEN_KEY, initialFloatOpen, isNarrow } from './list/floatingList.ts';
import { renderList } from './list/listBoard.ts';
import { buildSettings } from './settings.ts';
import { SoundPlayer, shouldRestoreSound, soundEvents } from './sound.ts';
import { renderStrip } from './strip.ts';
import { buildToolbar, type MiniTarget } from './toolbar.ts';
import { chooseView, initialOverride, type ViewName } from './view.ts';
import { reloadOnce } from './reload.ts';

/** 3D 오피스가 구현하는 화면 (Task 11에서 연결). openCard = 작은 목록에서 고른 세션의 카드 */
export type OfficeHost = { update(s: Snapshot): void; rebase?(): void; dispose(): void; openCard?(agentId: string, at: { x: number; y: number }): void };
export type OfficeFactory = (container: HTMLElement) => OfficeHost;

type ClientConfig = { softSound: boolean; loopback: boolean; codexAutoApprove?: boolean; build?: string | null };

const SOUND_KEY = 'so-sound-on';

/** sessionStorage는 막혀 있을 수 있어(사생활 보호 모드 등) 읽기·쓰기를 모두 감싼다. value가 null이면 지움 */
function storedGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function storedSet(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // 기억하지 못할 뿐 동작엔 지장 없음
  }
}
/** 이 브라우저에 오래 기억(작은 목록 펼침) — 막혀 있으면 기억만 못 함 */
function keptGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keptSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 기억하지 못할 뿐 동작엔 지장 없음
  }
}

export async function start(makeOffice: OfficeFactory | null): Promise<void> {
  const params = new URLSearchParams(location.search);
  // 오피스/목록 토글은 이 탭에서 기억한다(자동 새로 고침 뒤에도 유지). ?view= 가 있으면 그게 우선
  let override: string | null = initialOverride(params.get('view'), storedGet('so-view'));
  const isMini = params.get('mini') === '1';
  const config: ClientConfig = await fetch('/api/client-config').then((r) => r.json()).catch(() => ({ softSound: true, loopback: false }));

  const app = document.getElementById('app')!;
  const officeEl = document.createElement('div');
  officeEl.className = 'office-host';
  const listEl = document.createElement('div');
  listEl.className = 'list-host';
  // 연결 띠(오른쪽 위): 오피스 화면이거나 아직 스냅샷이 없을 때. 목록은 머리줄에 따로 그린다
  const strip = document.createElement('div');
  strip.className = 'office-strip';

  const player = new SoundPlayer();
  player.softEnabled = config.softSound;
  // 자동 새로 고침 직전에 소리가 켜져 있었다면 되살린다. 브라우저가 막으면(AudioContext가 running이 아님)
  // player.enabled가 false라 🔔가 계속 깜빡이고, 사용자가 한 번 다시 누르면 된다
  if (shouldRestoreSound(storedGet(SOUND_KEY))) {
    storedSet(SOUND_KEY, null);
    try {
      void player.enable().catch(() => {});
    } catch {
      // AudioContext를 못 만들면 소리는 꺼진 채
    }
  }
  const minis = new Set<MiniTarget>();
  const settings = buildSettings({ codexAutoApprove: config.codexAutoApprove ?? true });
  let office: OfficeHost | null = null;
  let snap: Snapshot | null = null;
  let prev: Snapshot | null = null;
  let receivedAt = 0;
  let connected = false;

  const currentView = (): ViewName => (makeOffice ? chooseView(innerWidth, innerHeight, override) : 'list');
  const toolbar = buildToolbar({
    player,
    showSettings: config.loopback && !isMini,
    currentView,
    onToggleView: () => {
      override = currentView() === 'office' ? 'list' : 'office';
      storedSet('so-view', override);
      render();
    },
    onToggleSettings: () => settings.toggle(),
    onMini: (target, stop) => {
      minis.add(target);
      const s = current();
      if (s) renderList(target.root, s, target.doc, connected);
      target.doc.defaultView?.addEventListener('pagehide', () => { minis.delete(target); stop(); });
    },
  });
  // 사무실 위 작은 목록(오른쪽 위): 목록 보기로 바꾸지 않아도 세션을 훑어보게. 작게 띄우기 창엔 없음
  const float = isMini ? null : buildFloatingList({
    open: initialFloatOpen(keptGet(FLOAT_OPEN_KEY), isNarrow(innerWidth, innerHeight)),
    onToggle: (open) => keptSet(FLOAT_OPEN_KEY, open ? '1' : '0'),
    onPick: (id, rowRect) => office?.openCard?.(id, cardAnchor(rowRect, officeEl.getBoundingClientRect())),
  });
  if (isMini) document.body.classList.add('mini');
  else app.append(toolbar.el, settings.el);
  app.append(officeEl, listEl, strip);
  if (float) app.append(float.el);

  /** 서버 시각 + 받은 뒤 흐른 시간 → 경과 시간이 스냅샷 사이에도 흐르게 */
  function current(): Snapshot | null {
    return snap && { ...snap, now: snap.now + (Date.now() - receivedAt) };
  }

  let awaitFresh = false;

  function render() {
    const s = current();
    const view = currentView();
    document.body.classList.toggle('view-list', view === 'list');
    officeEl.hidden = view !== 'office';
    listEl.hidden = view !== 'list';
    toolbar.refresh();
    if (view === 'office' && makeOffice && !office) office = makeOffice(officeEl);
    if (view === 'list' && office) {
      office.dispose();
      office = null;
    }
    strip.hidden = view === 'list' && s !== null;
    if (!strip.hidden) {
      const open = strip.querySelector('details.strip[open]') != null;
      strip.replaceChildren(renderStrip(document, connected, s?.health ?? null, s?.now ?? Date.now(), open));
    }
    if (float) float.el.hidden = view !== 'office' || !s;
    if (!s) return;
    if (view === 'office') {
      float?.update(s);
      if (!awaitFresh) office?.update(s); // 다시 연결한 직후엔 낡은 스냅샷으로 기준을 잡지 않는다
    } else renderList(listEl, s, document, connected);
    for (const m of minis) renderList(m.root, s, m.doc, connected);
  }

  connect(
    (s, build) => {
      // 새 빌드면 새로 고침(소리가 켜져 있었음을 남김) — 곧 사라질 화면이라 소리·그리기는 건너뜀
      if (reloadOnce(config.build ?? null, build, () => { if (player.enabled) storedSet(SOUND_KEY, '1'); })) return;
      for (const kind of soundEvents(prev, s)) player.play(kind);
      awaitFresh = false;
      prev = s;
      snap = s;
      receivedAt = Date.now();
      render();
    },
    (up) => {
      connected = up;
      awaitFresh = up; // 다시 연결: 새로 오는 스냅샷이 기준(반짝·링 퍼짐 없음) — 그 전엔 낡은 스냅샷을 오피스에 안 넘김. 끊기면 풀어 둠(끊긴 채 만든 화면이 비지 않게)
      if (up) office?.rebase?.();
      render();
    },
  );
  setInterval(render, 10_000);
  addEventListener('resize', render);
  render();
}

/** three.js는 무거우니 오피스 화면이 필요할 때만 불러온다(폰 목록형은 안 받음) */
function lazyOffice(container: HTMLElement): OfficeHost {
  let view: OfficeHost | null = null;
  let last: Snapshot | null = null;
  let disposed = false;
  // 사무실을 불러오는 중에 작은 목록에서 고른 카드 — 다 불러온 뒤 연다(사무실은 스냅샷이 오면 연다)
  const card = deferredCard<{ agentId: string; at: { x: number; y: number } }>(({ agentId, at }) => {
    if (!view) return false;
    view.openCard?.(agentId, at);
    return true;
  });
  // 픽셀 글꼴을 먼저 받아야 TV(캔버스) 글자가 그 글꼴로 그려진다
  const fonts = ['16px Galmuri11', '16px GalmuriMono11', '16px Galmuri14'].map((f) => document.fonts.load(f));
  void Promise.all(fonts).catch(() => null).then(() => import('./office/officeView.ts')).then(({ OfficeView }) => {
    if (disposed) return;
    view = new OfficeView(container);
    card.flush(); // 스냅샷보다 먼저 넘겨도 사무실이 맡아 두었다가 update 때 연다
    if (last) view.update(last);
  });
  return {
    update(s) {
      last = s;
      view?.update(s);
    },
    rebase() {
      last = null; // 아직 three.js를 받는 중이면 낡은 스냅샷을 버려, 불러온 뒤 첫 동기화가 새 스냅샷의 기준이 되게
      view?.rebase?.();
    },
    openCard(agentId, at) {
      card.request({ agentId, at });
    },
    dispose() {
      disposed = true;
      view?.dispose();
    },
  };
}

void start(lazyOffice);
