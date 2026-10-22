// 왼쪽 위 버튼들: 작게 띄우기 · 목록/오피스 · 소리 · 설정
import type { SoundPlayer } from './sound.ts';
import type { ViewName } from './view.ts';

export type MiniTarget = { root: HTMLElement; doc: Document };

type ToolbarOptions = {
  player: SoundPlayer;
  showSettings: boolean;
  currentView: () => ViewName;
  onToggleView: () => void;
  onToggleSettings: () => void;
  onMini: (target: MiniTarget, stop: () => void) => void;
};

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** 크롬의 '항상 위 작은 창'(Document PiP)에 목록을 띄우고, 없으면 작은 팝업 창 */
async function openMini(onMini: ToolbarOptions['onMini']): Promise<void> {
  const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
  if (!dpip) {
    window.open('/?view=list&mini=1', 'so-mini', 'width=320,height=480,popup');
    return;
  }
  const w = await dpip.requestWindow({ width: 320, height: 480 });
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = w.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = node.href; // 절대 주소로
      w.document.head.appendChild(link);
    } else {
      w.document.head.appendChild(node.cloneNode(true));
    }
  }
  w.document.title = 'Synthetic Office';
  w.document.body.className = 'mini';
  const root = w.document.createElement('div');
  w.document.body.appendChild(root);
  const target = { root, doc: w.document };
  let stopped = false;
  const stop = () => { stopped = true; };
  onMini(target, stop);
  w.addEventListener('pagehide', () => { if (!stopped) stop(); });
}

export function buildToolbar(o: ToolbarOptions): { el: HTMLElement; refresh(): void } {
  const el = document.createElement('div');
  el.className = 'toolbar';
  const mini = button('⧉ 작게 띄우기', () => void openMini(o.onMini));
  const view = button('', o.onToggleView);
  const sound = button('', async () => {
    if (o.player.enabled) o.player.disable();
    else await o.player.enable();
    refresh();
  });
  el.append(mini, view, sound);
  if (o.showSettings) el.appendChild(button('⚙', o.onToggleSettings));

  function refresh() {
    view.textContent = o.currentView() === 'office' ? '☰ 목록' : '🏢 오피스';
    sound.textContent = o.player.enabled ? '🔔 소리 켬' : '🔔 소리 켜기';
    sound.classList.toggle('blink', !o.player.enabled);
  }
  refresh();
  return { el, refresh };
}
