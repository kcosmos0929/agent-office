import './style.css';
import type { Snapshot } from '../../src/shared/types.ts';
import { connect } from './connection.ts';
import { renderList } from './list/listBoard.ts';
import { buildSettings } from './settings.ts';
import { SoundPlayer, soundEvents } from './sound.ts';
import { renderStrip } from './strip.ts';
import { buildToolbar, type MiniTarget } from './toolbar.ts';
import { chooseView, type ViewName } from './view.ts';
import { reloadOnce } from './reload.ts';

/** 3D 오피스가 구현하는 화면 (Task 11에서 연결) */
export type OfficeHost = { update(s: Snapshot): void; dispose(): void };
export type OfficeFactory = (container: HTMLElement) => OfficeHost;

type ClientConfig = { softSound: boolean; loopback: boolean; codexAutoApprove?: boolean; build?: string | null };

export async function start(makeOffice: OfficeFactory | null): Promise<void> {
  const params = new URLSearchParams(location.search);
  let override = params.get('view');
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
  if (isMini) document.body.classList.add('mini');
  else app.append(toolbar.el, settings.el);
  app.append(officeEl, listEl, strip);

  /** 서버 시각 + 받은 뒤 흐른 시간 → 경과 시간이 스냅샷 사이에도 흐르게 */
  function current(): Snapshot | null {
    return snap && { ...snap, now: snap.now + (Date.now() - receivedAt) };
  }

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
    if (!s) return;
    if (view === 'office') office?.update(s);
    else renderList(listEl, s, document, connected);
    for (const m of minis) renderList(m.root, s, m.doc, connected);
  }

  connect(
    (s, build) => {
      reloadOnce(config.build ?? null, build);
      for (const kind of soundEvents(prev, s)) player.play(kind);
      prev = s;
      snap = s;
      receivedAt = Date.now();
      render();
    },
    (up) => {
      connected = up;
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
  // 픽셀 글꼴을 먼저 받아야 TV(캔버스) 글자가 그 글꼴로 그려진다
  const fonts = ['16px Galmuri11', '16px GalmuriMono11', '16px Galmuri14'].map((f) => document.fonts.load(f));
  void Promise.all(fonts).catch(() => null).then(() => import('./office/officeView.ts')).then(({ OfficeView }) => {
    if (disposed) return;
    view = new OfficeView(container);
    if (last) view.update(last);
  });
  return {
    update(s) {
      last = s;
      view?.update(s);
    },
    dispose() {
      disposed = true;
      view?.dispose();
    },
  };
}

void start(lazyOffice);
